import { spawn } from "child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export interface CompileJob {
    nodeName: string;
    xsltPath: string;
    outputPath: string;
    stubLibPath: string;
}

export interface CompileResult {
    outputPath: string;
}

// Resolve xslt3-he binary path
function resolveXslt3Binary(): string {
    // Try to find in node_modules/.bin relative to this file
    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    // When running in dev: src/xml/compileWorkload.ts -> ../../node_modules/.bin/xslt3-he
    // When running built: dist/xml/compileWorkload.js -> ../../node_modules/.bin/xslt3-he
    const devPath = path.resolve(currentDir, '../../node_modules/.bin/xslt3-he');

    if (fs.existsSync(devPath)) {
        return devPath;
    }

    // Fallback to PATH lookup (for built/installed versions)
    return 'xslt3-he';
}

export async function performWork(job: CompileJob): Promise<CompileResult> {
    return new Promise<CompileResult>((resolve, reject) => {
        // Use spawn instead of fork since xslt3-he is a binary, not a Node script
        const xslt3Binary = resolveXslt3Binary();
        const child = spawn(xslt3Binary, [
            `-xsl:${job.xsltPath}`,
            `-export:${job.outputPath}`,
            `-stublib:${job.stubLibPath}`,
            '-nogo'
        ], {
            stdio: ['ignore', 'pipe', 'pipe'] // Capture stdout and stderr
        });

        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
        }

        child.on('close', (code) => {
            if (code === 0) {
                console.log(`Successfully compiled: ${path.basename(job.outputPath)}`);
                resolve({ outputPath: job.outputPath });
            } else {
                reject(new Error(`XSLT compilation failed with exit code ${code}\nstderr: ${stderr}`));
            }
        });

        child.on('error', (err) => {
            reject(new Error(`Failed to fork xslt3 process: ${err.message}`));
        });
    });
}
