import {type PipelineNodeConfig, PipelineNode, type PipelineContext, type Input} from "../core/pipeline";
import {Zip, ZipPassThrough} from "fflate";
import {createReadStream, createWriteStream} from "node:fs";
import {mkdir} from "node:fs/promises";
import path from "node:path";

interface ZipCompressConfig extends PipelineNodeConfig {
    items: Input;
    outputConfig: {
        filename: string;  // Output zip filename (e.g., "inscriptions.zip")
        outputDir?: string; // Optional output directory
        base?: string;      // Base path to strip from zip entries
    };
}

export class ZipCompressNode extends PipelineNode<ZipCompressConfig, "zip"> {
    async run(context: PipelineContext) {
        const inputPaths = await context.resolveInput(this.items!);

        // Treat all inputs as a single "item" for caching - we create ONE zip from MANY files
        // The actual dependency tracking happens via inputPaths being read during cache validation
        const allInputsKey = inputPaths.join('|');

        const results = await this.withCache(
            context,
            [allInputsKey],  // Single dummy item to trigger one execution
            (item) => `zip-all-${inputPaths.length}-files`,
            () => this.config.outputConfig.outputDir ?? path.join(context.buildDir, this.name),
            (item, outputKey) => {
                const outputDir = this.config.outputConfig.outputDir ?? path.join(context.buildDir, this.name);
                return path.join(outputDir, this.config.outputConfig.filename);
            },
            async (item) => {
                const zipPath = path.join(
                    this.config.outputConfig.outputDir ?? path.join(context.buildDir, this.name),
                    this.config.outputConfig.filename
                );

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

                // Add each file
                for (const filePath of inputPaths) {
                    const entryName = this.config.outputConfig.base
                        ? path.relative(this.config.outputConfig.base, filePath)
                        : filePath;

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