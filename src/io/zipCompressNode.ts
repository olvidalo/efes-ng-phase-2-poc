import {type PipelineNodeConfig, PipelineNode, type PipelineContext, type Input, type UnifiedOutputConfig} from "../core/pipeline";
import {Zip, ZipPassThrough} from "fflate";
import {createReadStream, createWriteStream} from "node:fs";
import {mkdir} from "node:fs/promises";
import path from "node:path";

interface ZipCompressConfig extends PipelineNodeConfig {
    items: Input;
    outputConfig: UnifiedOutputConfig;
}

export class ZipCompressNode extends PipelineNode<ZipCompressConfig, "zip"> {
    async run(context: PipelineContext) {
        const inputPaths = await context.resolveInput(this.items!);

        // Validate that outputFilename is specified
        if (!this.config.outputConfig?.outputFilename) {
            throw new Error(`ZipCompressNode "${this.name}" requires outputConfig.outputFilename to be specified`);
        }

        // Treat all inputs as a single "item" for caching - we create ONE zip from MANY files
        // The actual dependency tracking happens via inputPaths being read during cache validation
        const allInputsKey = inputPaths.join('|');

        const results = await this.withCache(
            context,
            [allInputsKey],  // Single dummy item to trigger one execution
            (item) => `zip-all-${inputPaths.length}-files`,
            () => this.config.outputConfig?.outputDir ?? path.join(context.buildDir, this.name),
            (item, outputKey) => {
                const outputDir = this.config.outputConfig?.outputDir ?? path.join(context.buildDir, this.name);
                const filename = typeof this.config.outputConfig!.outputFilename === 'function'
                    ? this.config.outputConfig!.outputFilename(item)
                    : this.config.outputConfig!.outputFilename!;
                return path.join(outputDir, filename);
            },
            async (item) => {
                const outputDir = this.config.outputConfig?.outputDir ?? path.join(context.buildDir, this.name);
                const filename = typeof this.config.outputConfig!.outputFilename === 'function'
                    ? this.config.outputConfig!.outputFilename(item)
                    : this.config.outputConfig!.outputFilename!;
                const zipPath = path.join(outputDir, filename);

                await mkdir(path.dirname(zipPath), {recursive: true});

                const zip = new Zip();
                const outputStream = createWriteStream(zipPath);

                // Promisify the zip output
                const finished = new Promise<void>((resolve, reject) => {
                    zip.ondata = (err, data, final) => {
                        if (err) return reject(err);
                        outputStream.write(data);
                        if (final) {
                            outputStream.end();
                            resolve();
                        }
                    };
                });

                // Add each file - use unified path handling for entry names
                for (const filePath of inputPaths) {
                    // Use unified config for entry path calculation (but no extension change)
                    const entryConfig = {
                        ...this.config.outputConfig,
                        outputDir: undefined,  // Don't add outputDir to entry paths
                        outputFilename: undefined  // Don't override filename
                    };
                    const entryPath = this.calculateOutputPath(filePath, context, entryConfig, undefined);
                    const entryName = entryPath;

                    this.log(context, `Adding: ${entryName}`);

                    const file = new ZipPassThrough(entryName);
                    zip.add(file);

                    // Promisify stream reading (default is Buffer mode, no encoding)
                    await new Promise<void>((resolve, reject) => {
                        createReadStream(filePath)
                            .on('data', (chunk: string | Buffer) => file.push(new Uint8Array(<Buffer>chunk)))
                            .on('end', () => { file.push(new Uint8Array(0), true); resolve(); })
                            .on('error', reject);
                    });
                }

                zip.end();
                await finished;

                this.log(context, `Created: ${zipPath} (${inputPaths.length} files)`);

                return { outputs: { zip: [zipPath] } };
            }
        );

        // Map withCache results to NodeOutput format
        return results.map(r => r.outputs);
    }
}