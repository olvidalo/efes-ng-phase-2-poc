import {
    type Input,
    type NodeRequest,
    type PipelineContext,
    PipelineNode,
    type PipelineNodeConfig
} from "./core/pipeline";
import {CompileStylesheetNode} from "./xml/nodes/compileStylesheetNode";
import path from "node:path";
import fs from "node:fs/promises";

// @ts-ignore
import {transform} from 'saxon-js';


interface XsltTransformConfig extends PipelineNodeConfig {
    name: string;
    inputs: {
        sefStylesheet?: Input;
        xsltStylesheet?: Input;
        sourceXml?: Input;
    };
    outputFilenameMapping?: (inputPath: string) => string;
    resultDocumentsDir?: string;
}

export class XsltTransformNode extends PipelineNode<XsltTransformConfig, "transformed" | "result-documents"> {
    constructor(config: XsltTransformConfig) {
        super(config);

        // Runtime validation: exactly one stylesheet input required
        const hasSef = !!this.inputs.sefStylesheet;
        const hasXslt = !!this.inputs.xsltStylesheet;

        if (!hasSef && !hasXslt) {
            throw new Error(`XsltTransformNode "${this.name}" requires either sefStylesheet or xsltStylesheet input`);
        }
        if (hasSef && hasXslt) {
            throw new Error(`XsltTransformNode "${this.name}" cannot have both sefStylesheet and xsltStylesheet inputs`);
        }
    }

    private defaultOutputFilenameMapping = (inputPath: string) => {
        const inputFilename = path.basename(inputPath);
        const inputDirname = path.dirname(inputPath);
        const inputBasename = path.basename(inputFilename, path.extname(inputFilename));
        return path.join(inputDirname, inputBasename + '.html');
    }

    async analyze(context: PipelineContext): Promise<NodeRequest[]> {
        // If user provided raw XSLT, request compilation
        if (this.inputs.xsltStylesheet && !this.inputs.sefStylesheet) {
            const xsltPaths = await context.resolveInput(this.inputs.xsltStylesheet);
            if (xsltPaths.length > 0) {
                const xsltPath = xsltPaths[0];

                const compileNode = new CompileStylesheetNode({
                    name: `${this.name}-auto-compile`,
                    inputs: {xslt: this.inputs.xsltStylesheet}
                    // No outputFilename - will use build directory by default
                });

                return [{
                    node: compileNode,
                    outputReference: 'compiledStylesheet',
                    replaceInput: 'sefStylesheet'
                }];
            }
        }

        return [];
    }

    async run(context: PipelineContext) {
        // By the time we reach run(), analyze() should have ensured sefStylesheet exists
        if (!this.inputs.sefStylesheet) {
            throw new Error(`XsltTransformNode "${this.name}" has neither sefStylesheet nor xsltStylesheet input`);
        }

        const sefStylesheetPath = (await context.resolveInput(this.inputs.sefStylesheet))[0];

        // Handle no-source mode (stylesheet uses document() for input)
        const sourcePaths = this.inputs.sourceXml ?
            await context.resolveInput(this.inputs.sourceXml) :
            [sefStylesheetPath];

        const isNoSourceMode = !this.inputs.sourceXml;
        context.log(`${isNoSourceMode ? 'Running stylesheet' : `Transforming ${sourcePaths.length} file(s)`} with ${sefStylesheetPath}`);

        const outputFilenameMapper = this.config.outputFilenameMapping ??
            ((inputPath: string) => context.getBuildPath(this.name, inputPath, '.html'));

        const results = await this.withCache(
            context,
            sourcePaths,
            (item) => isNoSourceMode ? `no-source-${sefStylesheetPath}` : `${item}-with-${sefStylesheetPath}`,
            (item) => isNoSourceMode ?
                (this.config.outputFilenameMapping?.(sefStylesheetPath) ?? context.getBuildPath(this.name, sefStylesheetPath, '.html')) :
                outputFilenameMapper(item),
            async (sourcePath) => {

                const transformOptions: any = {
                    stylesheetFileName: sefStylesheetPath,
                    destination: 'serialized'
                };

                if (!isNoSourceMode) {
                    transformOptions.sourceFileName = sourcePath;
                }

                const result = await transform(transformOptions);
                const outputPath = isNoSourceMode ?
                    (this.config.outputFilenameMapping?.(sefStylesheetPath) ?? sefStylesheetPath.replace('.sef.json', '.html')) :
                    outputFilenameMapper(sourcePath);

                await fs.writeFile(outputPath, result.principalResult);
                context.log(`  - Generated: ${outputPath}`);
            }
        );

        return results.map(r => ({
            transformed: [r.output],
            "result-documents": []
        }));
    }
}