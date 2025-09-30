import {
    type Input,
    type NodeRequest,
    type PipelineContext,
    PipelineNode,
    type PipelineNodeConfig
} from "../../core/pipeline";
import {CompileStylesheetNode} from "./compileStylesheetNode";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";

// @ts-ignore
import {transform, getResource, getPlatform} from 'saxonjs-he';

// Register Kiln extension functions at module load
// @ts-ignore
import SaxonJS from 'saxonjs-he';

// Register the kiln:url-for-match function implementation
SaxonJS.registerExtensionFunctions({
    "namespace": "http://www.kcl.ac.uk/artshums/depts/ddh/kiln/ns/1.0",
    "signatures": {
        "url-for-match": {
            "as": "xs:string",
            "param": ["xs:string", "xs:string*", "xs:integer"],
            "arity": [3],
            "impl": function(matchId: string, params: any, priority: number): string {
                // Simple implementation: generate static URLs based on parameters
                // matchId is like 'local-epidoc-display-html'
                // params is an iterator of [language, filename]
                const paramArray = Array.from(params);
                console.log(paramArray)
                console.log(`url-for-match(${matchId}, ${paramArray}, ${priority})`);
                const language = paramArray[0] || 'en';
                const filename = paramArray[1] || 'unknown';

                if (matchId === 'local-epidoc-display-html') {
                    const result = `/${language}/inscriptions/${filename}.html`;
                    console.log(`RETURNING ABSOLUTE: ${result}`);
                    return result;
                }

                // Fallback for other match IDs
                return `/${language}/${filename}.html`;
            }
        }
    }
});


interface XsltTransformConfig extends PipelineNodeConfig {
    name: string;
    inputs: {
        sefStylesheet?: Input;
        xsltStylesheet?: Input;
        sourceXml?: Input;
    };
    outputFilenameMapping?: (inputPath: string) => string;
    resultDocumentsDir?: string;
    initialTemplate?: string;
    stylesheetParams?: Record<string, any | ((inputPath: string) => any)>;
    initialMode?: string;
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
                    replaceInput: 'sefStylesheet',
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
                // TODO: maybe we can get document() calls from SaxonJs getPlatform().readFile
                const transformOptions: any = {
                    stylesheetFileName: sefStylesheetPath,
                    destination: 'serialized',
                    collectionFinder: (uri: string) => {
                        let collectionPath = uri
                        if (collectionPath.startsWith('file:')) {
                            collectionPath = collectionPath.substring(5);
                        }
                        context.log(`  - Collection finder: ${collectionPath}`);
                        const files = fsSync.globSync(collectionPath);
                        const platform = SaxonJS.internals.getPlatform();
                        const results = files.map(file => {
                            const content = fsSync.readFileSync(file, 'utf-8');
                            const doc = platform.parseXmlFromString(content);
                            // Set the document URI property that SaxonJS uses for document-uri()
                            // This matches how SaxonJS sets _saxonDocUri when loading documents
                            (doc as any)._saxonDocUri = `file://${path.resolve(file)}`;
                            return doc;
                        })
                        context.log(`  - Collection finder: ${results.length} files found`);
                        return results
                    },
                    ...this.config.initialTemplate ? {initialTemplate: this.config.initialTemplate} : {},
                    ...this.config.stylesheetParams ? {stylesheetParams: this.resolveStylesheetParams(sourcePath)} : {},
                    ...this.config.initialMode ? {initialMode: this.config.initialMode} : {},
                };

                if (!isNoSourceMode) {
                    transformOptions.sourceFileName = sourcePath;
                }

                const result = await transform(transformOptions);
                const outputPath = isNoSourceMode ?
                    (this.config.outputFilenameMapping?.(sefStylesheetPath) ?? sefStylesheetPath.replace('.sef.json', '.html')) :
                    outputFilenameMapper(sourcePath);

                // Ensure directory exists before writing
                await fs.mkdir(path.dirname(outputPath), { recursive: true });
                await fs.writeFile(outputPath, result.principalResult);
                context.log(`  - Generated: ${outputPath}`);
            }
        );

        return results.map(r => ({
            transformed: [r.output],
            "result-documents": []
        }));
    }

    private resolveStylesheetParams(sourcePath: string): Record<string, any> {
        if (!this.config.stylesheetParams) return {};

        const resolved: Record<string, any> = {};
        for (const [key, value] of Object.entries(this.config.stylesheetParams)) {
            if (typeof value === 'function') {
                resolved[key] = value(sourcePath);
            } else {
                resolved[key] = value;
            }
        }
        return resolved;
    }
}