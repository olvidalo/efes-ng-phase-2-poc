import {
    type FileRef,
    type Input,
    inputIsNodeOutputReference,
    type PipelineContext,
    PipelineNode,
    type PipelineNodeConfig
} from "../../core/pipeline";
import path from "node:path";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WorkerPool } from "../workerPool";

// @ts-ignore
// Register Kiln extension functions at module load
// @ts-ignore

interface SefTransformConfig extends PipelineNodeConfig {
    items?: Input;  // sourceXml files (optional for no-source transforms)
    config: {
        sefStylesheet: FileRef | Input;  // Can be FileRef or NodeOutputReference
        initialTemplate?: string;
        stylesheetParams?: Record<string, any | ((inputPath: string) => any)>;
        // TODO: passing {indent: false} indents anyway
        serializationParams?: Record<string, any>;
        initialMode?: string;
    };
    outputConfig?: {
        outputDir?: string;
        outputFilenameMapping?: (inputPath: string) => string;
        resultDocumentsDir?: string;
        resultExtension?: string;
    };
}


export class SefTransformNode extends PipelineNode<SefTransformConfig, "transformed" | "result-documents"> {
    private static workerPool: WorkerPool | null = null;

    // Shared worker pool for all SefTransformNode instances
    private static getWorkerPool(): WorkerPool {
        if (!SefTransformNode.workerPool) {
            // In dev: src/xml/nodes/ -> ../saxonWorker.ts
            // In prod: dist/ -> saxonWorker.js
            const currentDir = path.dirname(fileURLToPath(import.meta.url));
            const devPath = path.resolve(currentDir, '../saxonWorker.ts');
            const prodPath = path.resolve(currentDir, 'saxonWorker.js');

            const workerPath = fs.existsSync(prodPath) ? prodPath : devPath;
            SefTransformNode.workerPool = new WorkerPool(6, workerPath);
        }
        return SefTransformNode.workerPool;
    }

    // Terminate the shared worker pool
    // TODO: This should be handled via pipeline cleanup hooks in the future,
    // so pipeline code doesn't need to know about specific node types
    static async terminateWorkerPool(): Promise<void> {
        if (SefTransformNode.workerPool) {
            await SefTransformNode.workerPool.terminate();
            SefTransformNode.workerPool = null;
        }
    }

    // Helper: Calculate transformed output path (DRY - reused in getOutputPath and performWork)
    private getTransformedPath(item: string, context: PipelineContext): string {
        // If explicit outputDir specified, all paths are relative to it
        if (this.config.outputConfig?.outputDir) {
            const outputDir = this.config.outputConfig.outputDir;

            // Custom mapping returns path relative to outputDir
            if (this.config.outputConfig.outputFilenameMapping) {
                const relativePath = this.config.outputConfig.outputFilenameMapping(item);
                return path.join(outputDir, relativePath);
            }

            // Default: preserve relative path structure from source (strip build prefix)
            const extension = this.config.outputConfig?.resultExtension ?? '.xml';
            const basename = path.basename(item, path.extname(item));
            const relativePath = this.getCleanRelativePath(item, context);
            return path.join(outputDir, relativePath, basename + extension);
        }

        // No outputDir: use default build directory logic via getBuildPath
        if (this.config.outputConfig?.outputFilenameMapping) {
            const strippedItem = context.stripBuildPrefix(item);
            const relativePath = this.config.outputConfig.outputFilenameMapping(strippedItem);
            return path.join(context.buildDir, this.name, relativePath);
        }

        const extension = this.config.outputConfig?.resultExtension ?? '.xml';
        return context.getBuildPath(this.name, item, extension);
    }

    async run(context: PipelineContext) {
        // Handle both FileRef and Input (NodeOutputReference) for sefStylesheet
        const sefStylesheetPath = (this.config.config.sefStylesheet as any).path
            ? (this.config.config.sefStylesheet as FileRef).path
            : (await context.resolveInput(this.config.config.sefStylesheet as Input))[0];

        const sefStylesheetJson = await readFile(sefStylesheetPath, 'utf-8')
        const sefStylesheet = JSON.parse(sefStylesheetJson)

        // Handle no-source mode (stylesheet uses document() for input)
        const sourcePaths = this.items ?
            await context.resolveInput(this.items) :
            [sefStylesheetPath];

        const isNoSourceMode = !this.items;
        context.log(`${isNoSourceMode ? 'Running stylesheet' : `Transforming ${sourcePaths.length} file(s)`} with ${sefStylesheetPath}`);

        const results = await this.withCache<"transformed" | "result-documents">(
            context,
            sourcePaths,
            (item) => isNoSourceMode ? `no-source-${sefStylesheetPath}` : `${item}-with-${sefStylesheetPath}`,
            () => {
                // Output base directory
                return this.config.outputConfig?.outputDir ??
                       path.join(context.buildDir, this.name);
            },
            (item, outputKey, filename?): string | undefined => {
                if (outputKey === "transformed") {
                    return this.getTransformedPath(item, context);
                }
                else if (outputKey === "result-documents") {
                    // Without filename: can't recalculate, return undefined (use cached structure)
                    if (!filename) {
                        return undefined;
                    }

                    // With filename: can calculate path (used during performWork)
                    const transformedPath = this.getTransformedPath(item, context);
                    const baseDir = path.dirname(transformedPath);
                    const resultPath = path.normalize(path.join(baseDir, filename));

                    // Security: ensure result stays within node's build directory
                    if (!resultPath.startsWith(baseDir)) {
                        throw new Error(`Result-document path escapes build directory: ${filename}`);
                    }

                    return resultPath;
                }
                throw new Error(`Unknown output key: ${outputKey}`);
            },
            async (sourcePath) => {
                const outputPath = this.getTransformedPath(sourcePath, context);
                const baseDir = path.dirname(outputPath);

                // Prepare transform options for worker (no callbacks - they're in the worker)
                const transformOptions = {
                    initialTemplate: this.config.config.initialTemplate,
                    stylesheetParams: await this.resolveStylesheetParams(context, sourcePath),
                    initialMode: this.config.config.initialMode,
                    outputProperties: this.config.config.serializationParams
                };

                // Execute transform in worker thread
                const workerPool = SefTransformNode.getWorkerPool();
                const result = await workerPool.execute<{
                    outputPath: string;
                    resultDocumentPaths: string[];
                }>({
                    sourcePath: isNoSourceMode ? null : sourcePath,
                    sefStylesheetPath,
                    stylesheetInternal: sefStylesheet,
                    outputPath,
                    baseDir,
                    transformOptions
                });

                context.log(`  - Generated: ${result.outputPath}`);
                for (const docPath of result.resultDocumentPaths) {
                    context.log(`  - Result document: ${docPath}`);
                }

                return {
                    outputs: {
                        transformed: [result.outputPath],
                        "result-documents": result.resultDocumentPaths
                    }
                };
            }
        );

        return results.map(r => r.outputs);
    }

    private async resolveStylesheetParams(context: PipelineContext, sourcePath: string): Promise<Record<string, any>> {
        if (!this.config.config.stylesheetParams) return {};

        const resolved: Record<string, any> = {};
        for (const [key, value] of Object.entries(this.config.config.stylesheetParams)) {
            if (typeof value === 'function') {
                resolved[key] = value(sourcePath);
            } else if (inputIsNodeOutputReference(value)) {
                resolved[key] = await context.resolveInput(value);
            } else {
                resolved[key] = value;
            }
        }
        return resolved;
    }
}