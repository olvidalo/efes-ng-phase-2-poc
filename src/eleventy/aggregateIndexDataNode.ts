import {
    type Input,
    type FileRef,
    type PipelineContext,
    PipelineNode,
    type PipelineNodeConfig,
    type NodeOutput,
    type UnifiedOutputConfig
} from "../core/pipeline";
import path from "node:path";
import fs from "node:fs/promises";

// @ts-ignore
import { getResource, XPath } from 'saxonjs-he';

/**
 * Column configuration with optional type for rendering
 */
interface ColumnConfig {
    key: string;
    header: string;
    /** Column type: 'text' (default), 'link' (external URL), 'references' (aggregated refs) */
    type?: 'text' | 'link' | 'references';
    /** For 'link' columns: field key to use as display label instead of the URL */
    labelKey?: string;
}

/**
 * Index configuration parsed from indices-config.xsl
 */
interface IndexConfig {
    id: string;
    title: string;
    order: number;
    description?: string;
    columns: ColumnConfig[];
    notes?: string[];
    /** Fields to sort by, in order. Falls back to sortKey if not specified. */
    sortKeys?: string[];
    /** Optional groupBy configuration for splitting entries into groups */
    groupBy?: {
        field: string;
        labels: Record<string, string>;  // value -> label mapping
        order: string[];  // ordered list of group values from config
    };
}

interface AggregateIndexDataNodeConfig extends PipelineNodeConfig {
    name: string;
    config: {
        /** Input frontmatter files (typically from XSLT extraction) */
        frontmatterFiles: Input;
        /** Path to indices-config.xsl (single source of truth for index metadata) */
        indicesConfigFile: FileRef | string;
    };
    outputConfig?: UnifiedOutputConfig;
}

interface EntityWithRef {
    indexType?: string;
    sortKey?: string;
    name?: string;
    abbr?: string;
    location?: string;
    inscriptionId: string;
    line?: string;
    isRestored?: boolean;
    [key: string]: unknown;
}

interface AggregatedEntry {
    sortKey: string;
    isRestored?: boolean;
    references: { inscriptionId: string; line?: string }[];
    [key: string]: unknown;
}

const IDX_NS = 'http://efes.info/indices';

/**
 * Aggregates entity data from individual frontmatter files into index data files.
 *
 * Index configuration (titles, columns, notes) is parsed from indices-config.xsl,
 * making it the single source of truth.
 */
export class AggregateIndexDataNode extends PipelineNode<
    AggregateIndexDataNodeConfig,
    "indexData"
> {
    async run(context: PipelineContext): Promise<NodeOutput<"indexData">[]> {
        const files = await context.resolveInput(this.config.config.frontmatterFiles);
        const configFile = typeof this.config.config.indicesConfigFile === 'string'
            ? this.config.config.indicesConfigFile
            : this.config.config.indicesConfigFile.path;
        const outputDir = this.config.outputConfig?.outputDir ??
            context.getBuildPath(this.name, "indices");

        // Parse index configuration from XSL file
        const indexConfigs = await this.parseIndicesConfig(configFile);
        this.log(context, `Parsed ${indexConfigs.length} index configs from ${path.basename(configFile)}`);

        this.log(context, `Aggregating entities from ${files.length} frontmatter files`);

        // Read all frontmatter files and collect entities
        const allEntities: Record<string, EntityWithRef[]> = {};

        for (const file of files) {
            try {
                const content = JSON.parse(await fs.readFile(file, "utf-8"));
                const inscriptionId = content.documentId;

                if (!inscriptionId) {
                    this.log(context, `Warning: No documentId in ${file}`);
                    continue;
                }

                if (content.entities) {
                    for (const [indexId, entities] of Object.entries(content.entities)) {
                        if (!Array.isArray(entities)) continue;
                        if (!allEntities[indexId]) allEntities[indexId] = [];

                        for (const entity of entities) {
                            allEntities[indexId].push({
                                ...entity,
                                inscriptionId,
                            });
                        }
                    }
                }
            } catch (err) {
                this.log(context, `Warning: Failed to parse ${file}: ${err}`);
            }
        }

        // Group and deduplicate per index
        const outputPaths: string[] = [];
        await fs.mkdir(outputDir, { recursive: true });

        for (const indexConfig of indexConfigs) {
            const entities = allEntities[indexConfig.id] || [];
            const grouped = this.groupEntities(entities, indexConfig.sortKeys);

            const outputPath = path.join(outputDir, `${indexConfig.id}.json`);

            // Build output structure - grouped or flat
            let outputData: Record<string, unknown>;
            if (indexConfig.groupBy) {
                // Group entries by the specified field
                const groupedEntries = new Map<string, AggregatedEntry[]>();
                for (const entry of grouped) {
                    const groupValue = String(entry[indexConfig.groupBy.field] || 'other');
                    if (!groupedEntries.has(groupValue)) groupedEntries.set(groupValue, []);
                    groupedEntries.get(groupValue)!.push(entry);
                }

                // Sort groups by config order
                const configOrder = indexConfig.groupBy.order;
                const sortedGroups = Array.from(groupedEntries.entries())
                    .sort(([a], [b]) => configOrder.indexOf(a) - configOrder.indexOf(b));

                outputData = {
                    id: indexConfig.id,
                    title: indexConfig.title,
                    description: indexConfig.description,
                    columns: indexConfig.columns,
                    notes: indexConfig.notes,
                    groupBy: indexConfig.groupBy.field,
                    groups: sortedGroups.map(([value, entries]) => ({
                        groupValue: value,
                        groupLabel: indexConfig.groupBy!.labels[value] || value,
                        entries
                    }))
                };
                this.log(context, `Generated ${indexConfig.id} index: ${grouped.length} unique entries in ${groupedEntries.size} groups from ${entities.length} occurrences`);
            } else {
                outputData = {
                    id: indexConfig.id,
                    title: indexConfig.title,
                    description: indexConfig.description,
                    columns: indexConfig.columns,
                    notes: indexConfig.notes,
                    entries: grouped
                };
                this.log(context, `Generated ${indexConfig.id} index: ${grouped.length} unique entries from ${entities.length} occurrences`);
            }

            await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
            outputPaths.push(outputPath);
        }

        // Output summary file for indices overview
        const summaryPath = path.join(outputDir, "_summary.json");
        await fs.writeFile(summaryPath, JSON.stringify({
            indices: indexConfigs.map(cfg => ({
                id: cfg.id,
                title: cfg.title,
                description: cfg.description,
                order: cfg.order,
                entryCount: this.groupEntities(allEntities[cfg.id] || [], cfg.sortKeys).length
            })).sort((a, b) => a.order - b.order)
        }, null, 2));
        outputPaths.push(summaryPath);

        return [{ indexData: outputPaths }];
    }

    /**
     * Parses index configuration from indices-config.xsl using XPath.
     */
    private async parseIndicesConfig(configPath: string): Promise<IndexConfig[]> {
        const content = await fs.readFile(configPath, 'utf-8');
        const doc = await getResource({ text: content, type: 'xml' });

        const nsContext = { idx: IDX_NS };

        // Get all idx:index elements
        const indexElements = XPath.evaluate("//idx:index", doc, {
            namespaceContext: nsContext,
            resultForm: 'array'
        });

        return indexElements.map((indexEl: Element) => {
            const id = XPath.evaluate("string(@id)", indexEl, { resultForm: 'value' });
            const title = XPath.evaluate("string(@title)", indexEl, { resultForm: 'value' });
            const order = parseInt(XPath.evaluate("string(@order)", indexEl, { resultForm: 'value' }) || '99', 10);
            const description = XPath.evaluate("string(idx:description)", indexEl, {
                namespaceContext: nsContext,
                resultForm: 'value'
            }) || undefined;

            // Parse columns
            const columnElements = XPath.evaluate("idx:columns/idx:column", indexEl, {
                namespaceContext: nsContext,
                resultForm: 'array'
            });
            const columns: ColumnConfig[] = columnElements.map((col: Element) => {
                const type = XPath.evaluate("string(@type)", col, { resultForm: 'value' });
                const labelKey = XPath.evaluate("string(@labelKey)", col, { resultForm: 'value' });
                return {
                    key: XPath.evaluate("string(@key)", col, { resultForm: 'value' }),
                    header: XPath.evaluate("string(.)", col, { resultForm: 'value' }),
                    ...(type && { type: type as 'text' | 'link' | 'references' }),
                    ...(labelKey && { labelKey })
                };
            });

            // Parse notes
            const noteElements = XPath.evaluate("idx:notes/idx:p", indexEl, {
                namespaceContext: nsContext,
                resultForm: 'array'
            });
            const notes = noteElements.length > 0
                ? noteElements.map((n: Element) => XPath.evaluate("string(.)", n, { resultForm: 'value' }))
                : undefined;

            // Parse sort keys
            const sortKeyElements = XPath.evaluate("idx:sort/idx:key/@field", indexEl, {
                namespaceContext: nsContext,
                resultForm: 'array'
            });
            const sortKeys = sortKeyElements.length > 0
                ? sortKeyElements.map((attr: Attr) => attr.value)
                : undefined;

            // Parse groupBy configuration
            const groupByElements = XPath.evaluate("idx:groupBy", indexEl, {
                namespaceContext: nsContext,
                resultForm: 'array'
            });
            let groupBy: IndexConfig['groupBy'];
            if (groupByElements.length > 0) {
                const groupByEl = groupByElements[0];
                const field = XPath.evaluate("string(@field)", groupByEl, { resultForm: 'value' });
                const groupEls = XPath.evaluate("idx:group", groupByEl, {
                    namespaceContext: nsContext,
                    resultForm: 'array'
                });
                const labels: Record<string, string> = {};
                const order: string[] = [];
                for (const g of groupEls) {
                    const value = XPath.evaluate("string(@value)", g, { resultForm: 'value' });
                    const label = XPath.evaluate("string(@label)", g, { resultForm: 'value' });
                    if (value) {
                        labels[value] = label || value;
                        order.push(value);
                    }
                }
                groupBy = { field, labels, order };
            }

            return { id, title, order, description, columns, notes, sortKeys, groupBy };
        });
    }

    /**
     * Groups entities by sortKey and collects references.
     * @param sortKeys Optional array of field names to sort by, in order
     */
    private groupEntities(entities: EntityWithRef[], sortKeys?: string[]): AggregatedEntry[] {
        const groups = new Map<string, EntityWithRef[]>();

        for (const entity of entities) {
            const key = entity.sortKey || entity.name || entity.abbr || entity.location || "";
            if (!key) continue;

            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(entity);
        }

        return Array.from(groups.entries())
            .map(([sortKey, refs]) => {
                const { inscriptionId, line, indexType, isRestored, ...baseFields } = refs[0];
                return {
                    ...baseFields,
                    sortKey,
                    references: refs.map(r => {
                        const { indexType, sortKey, ...refFields } = r;
                        return refFields;
                    }).sort((a, b) => a.inscriptionId.localeCompare(b.inscriptionId))
                };
            })
            .sort((a, b) => {
                // Multi-field sort if sortKeys provided
                if (sortKeys && sortKeys.length > 0) {
                    for (const key of sortKeys) {
                        const cmp = String(a[key] || '').localeCompare(String(b[key] || ''));
                        if (cmp !== 0) return cmp;
                    }
                    return 0;
                }
                // Fall back to single sortKey field
                return a.sortKey.localeCompare(b.sortKey);
            });
    }
}
