import {
    type Input,
    type PipelineContext,
    PipelineNode,
    type PipelineNodeConfig,
    type NodeOutput,
    type UnifiedOutputConfig
} from "../core/pipeline";
import path from "node:path";
import fs from "node:fs/promises";

interface AggregateSearchDataNodeConfig extends PipelineNodeConfig {
    name: string;
    config: {
        frontmatterFiles: Input;
        /** Map of language codes to display labels */
        languageLabels?: Record<string, string>;
    };
    outputConfig?: UnifiedOutputConfig;
}

const DEFAULT_LANGUAGE_LABELS: Record<string, string> = {
    grc: "Ancient Greek",
    la: "Latin",
    "grc-Latn": "Transliterated Greek"
};

function parseYear(val: string): number | null {
    if (!val) return null;
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
}

/**
 * Aggregates search data from individual frontmatter files into a single
 * search-documents.json file for FlexSearch indexing.
 */
export class AggregateSearchDataNode extends PipelineNode<
    AggregateSearchDataNodeConfig,
    "searchData"
> {
    async run(context: PipelineContext): Promise<NodeOutput<"searchData">[]> {
        const files = await context.resolveInput(this.config.config.frontmatterFiles);
        const outputDir = this.config.outputConfig?.outputDir ??
            context.getBuildPath(this.name, "search");
        const languageLabels = this.config.config.languageLabels ?? DEFAULT_LANGUAGE_LABELS;

        this.log(context, `Aggregating search data from ${files.length} frontmatter files`);

        const documents: Record<string, any>[] = [];

        for (const file of files) {
            try {
                const content = JSON.parse(await fs.readFile(file, "utf-8"));
                const documentId = content.documentId;

                if (!documentId) continue;

                const search = content.search;
                if (!search) {
                    this.log(context, `Warning: No search data in ${file}`);
                    continue;
                }

                // Pull standard fields from content root
                const doc: Record<string, any> = {
                    documentId,
                    title: content.title || "",
                    origDate: content.origDate || "",
                    findspot: content.findspot || "",
                };

                // Merge all search fields (project-agnostic pass-through)
                for (const [key, value] of Object.entries(search)) {
                    if (key === 'dateNotBefore' || key === 'dateNotAfter') {
                        doc[key] = parseYear(String(value));
                    } else if (key === 'language') {
                        if (Array.isArray(value)) {
                            doc[key] = (value as string[]).map(v => languageLabels[String(v)] || String(v));
                        } else {
                            doc[key] = languageLabels[String(value)] || String(value) || "";
                        }
                    } else {
                        doc[key] = value;
                    }
                }

                documents.push(doc);
            } catch (err) {
                this.log(context, `Warning: Failed to parse ${file}: ${err}`);
            }
        }

        // Sort by documentId for consistent output
        documents.sort((a, b) => a.documentId.localeCompare(b.documentId));

        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, "search-documents.json");
        await fs.writeFile(outputPath, JSON.stringify(documents, null, 2));

        this.log(context, `Generated search data: ${documents.length} documents`);

        return [{ searchData: [outputPath] }];
    }
}
