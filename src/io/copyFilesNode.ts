import {type PipelineNodeConfig, PipelineNode, type PipelineContext, type Input, type UnifiedOutputConfig} from "../core/pipeline";
import {copyFile, mkdir, stat, access, constants} from "node:fs/promises";
import path from "node:path";

interface CopyFilesConfig extends PipelineNodeConfig {
    config: {
        sourceFiles: Input;
    };
    outputConfig: UnifiedOutputConfig & {
        overwrite?: boolean;
    };
}

export class CopyFilesNode extends PipelineNode<CopyFilesConfig, "copied"> {
    async run(context: PipelineContext) {
        const paths = await context.resolveInput(this.config.config.sourceFiles);
        const copiedFiles: string[] = [];

        // Validate that outputDir is specified
        if (!this.config.outputConfig?.outputDir) {
            throw new Error(`CopyFilesNode "${this.name}" requires outputConfig.outputDir to be specified`);
        }

        for (const sourcePath of paths) {
            // Use unified path calculation
            const destPath = this.calculateOutputPath(sourcePath, context, this.config.outputConfig, undefined);

            // Ensure destination directory exists
            await mkdir(path.dirname(destPath), { recursive: true });

            if (!this.config.outputConfig.overwrite) {
                try {
                    await access(destPath, constants.F_OK)
                    // File already exists, skip but add to list of copied files for resolving outputs
                    // this.log(context, `Skipped: ${sourcePath} → ${destPath}`);
                    copiedFiles.push(destPath);
                    continue;
                } catch (error: any) {
                    if (error?.code === 'ENOENT') {
                    } else {
                        throw error;
                    }
                }
            }

            // Copy the file
            if ((await stat(sourcePath)).isFile()) {
                await copyFile(sourcePath, destPath, constants.COPYFILE_FICLONE);
                copiedFiles.push(destPath);
            }

            this.log(context, `Copied: ${sourcePath} → ${destPath}`);
        }

        return [{ copied: copiedFiles }];
    }
}