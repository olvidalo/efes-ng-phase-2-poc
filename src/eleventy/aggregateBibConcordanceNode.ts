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

interface AggregateBibConcordanceNodeConfig extends PipelineNodeConfig {
    name: string;
    config: {
        frontmatterFiles: Input;
    };
    outputConfig?: UnifiedOutputConfig;
}

interface BibRef {
    bibRef: string;
    shortCitation: string;
    fullCitation: string;
    citedRange: string;
}

interface BibConcordanceEntry {
    bibRef: string;
    shortCitation: string;
    fullCitation: string;
    citedRanges: {
        citedRange: string;
        inscriptions: string[];
    }[];
}

/**
 * Aggregates bibliography data from individual frontmatter files into a single
 * concordance JSON file. Groups by bibRef → citedRange → inscriptions.
 */
export class AggregateBibConcordanceNode extends PipelineNode<
    AggregateBibConcordanceNodeConfig,
    "concordance"
> {
    async run(context: PipelineContext): Promise<NodeOutput<"concordance">[]> {
        const files = await context.resolveInput(this.config.config.frontmatterFiles);
        const outputDir = this.config.outputConfig?.outputDir ??
            context.getBuildPath(this.name, "concordance");

        this.log(context, `Aggregating bibliography from ${files.length} frontmatter files`);

        // Collect all bibliography references with their inscription IDs
        const allRefs: (BibRef & { inscriptionId: string })[] = [];

        for (const file of files) {
            try {
                const content = JSON.parse(await fs.readFile(file, "utf-8"));
                const inscriptionId = content.documentId;

                if (!inscriptionId) continue;

                const bibEntries = content.entities?.bibliography;
                if (!Array.isArray(bibEntries)) continue;

                for (const entry of bibEntries) {
                    if (!entry.bibRef) continue;
                    allRefs.push({ ...entry, inscriptionId });
                }
            } catch (err) {
                this.log(context, `Warning: Failed to parse ${file}: ${err}`);
            }
        }

        // Group by bibRef
        const byBibRef = new Map<string, {
            shortCitation: string;
            fullCitation: string;
            citedRanges: Map<string, string[]>;
        }>();

        for (const ref of allRefs) {
            if (!byBibRef.has(ref.bibRef)) {
                byBibRef.set(ref.bibRef, {
                    shortCitation: ref.shortCitation || ref.bibRef,
                    fullCitation: ref.fullCitation || ref.bibRef,
                    citedRanges: new Map()
                });
            }

            const entry = byBibRef.get(ref.bibRef)!;
            const rangeKey = ref.citedRange || '';
            if (!entry.citedRanges.has(rangeKey)) {
                entry.citedRanges.set(rangeKey, []);
            }

            const inscriptions = entry.citedRanges.get(rangeKey)!;
            if (!inscriptions.includes(ref.inscriptionId)) {
                inscriptions.push(ref.inscriptionId);
            }
        }

        // Build sorted output
        const entries: BibConcordanceEntry[] = Array.from(byBibRef.entries())
            .map(([bibRef, data]) => ({
                bibRef,
                shortCitation: data.shortCitation,
                fullCitation: data.fullCitation,
                citedRanges: Array.from(data.citedRanges.entries())
                    .map(([citedRange, inscriptions]) => ({
                        citedRange,
                        inscriptions: inscriptions.sort((a, b) => a.localeCompare(b))
                    }))
                    .sort((a, b) => a.citedRange.localeCompare(b.citedRange))
            }))
            .sort((a, b) => (a.shortCitation || a.bibRef).localeCompare(b.shortCitation || b.bibRef));

        // Write output
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, "bibliography.json");
        await fs.writeFile(outputPath, JSON.stringify({ entries }, null, 2));

        this.log(context, `Generated bibliography concordance: ${entries.length} entries from ${allRefs.length} references`);

        return [{ concordance: [outputPath] }];
    }
}
