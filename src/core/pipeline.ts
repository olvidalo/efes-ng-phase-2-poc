import {DepGraph} from "dependency-graph";
import {CacheManager} from "./cache";
import {glob} from "glob";
import path from "node:path";

interface NodeOutputReference {
    node: PipelineNode<any, any>;
    name: string;
}

function inputIsNodeOutputReference(input: Input): input is NodeOutputReference {
    return typeof input === 'object' && 'node' in input && 'name' in input;
}

export type Input = string | string[] | NodeOutputReference;
type NodeOutput<TKey extends string> = Record<TKey, string[]>;

export function from<TNode extends PipelineNode<any, TOutput>, TOutput extends string>(node: TNode, output: TOutput): NodeOutputReference {
    return {node, name: output as string};
}

export interface PipelineNodeConfig {
    name: string;
    inputs: Record<string, Input>;
    explicitDependencies?: string[];
}

export interface NodeRequest {
    node: PipelineNode<any, any>;
    outputReference: string;
    replaceInput: string;
}

export abstract class PipelineNode<TConfig extends PipelineNodeConfig = PipelineNodeConfig, TOutput extends string = string> {
    constructor(public readonly config: TConfig) {
    }

    get name() {
        return this.config.name;
    }

    get inputs(): TConfig["inputs"] {
        return this.config.inputs;
    }

    async analyze(context: PipelineContext): Promise<NodeRequest[]> {
        return [];
    }

    abstract run(context: PipelineContext): Promise<NodeOutput<TOutput>[]>;

    // Unified caching for single or multiple items
    protected async withCache<T>(
        context: PipelineContext,
        items: string[],
        getCacheKey: (item: string) => string,
        getOutputPath: (item: string) => string,
        performWork: (item: string) => Promise<T | { result?: T, implicitDependencies?: string[] } | void>
    ): Promise<Array<{ item: string, output: string, cached: boolean, result?: T }>> {
        // Auto-detect dependencies from from() inputs
        const deps: Record<string, { path: string, hash: string }> = {};
        for (const [inputName, input] of Object.entries(this.inputs)) {
            if (inputIsNodeOutputReference(input)) {
                const resolvedPaths = await context.resolveInput(input);
                if (resolvedPaths.length > 0) {
                    deps[inputName] = {
                        path: resolvedPaths[0],
                        hash: await context.cache.computeFileHash(resolvedPaths[0])
                    };
                }
            }
        }

        const cacheKeys = items.map(getCacheKey);
        await context.cache.cleanExcept(this.name, cacheKeys);

        const results = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const cacheKey = cacheKeys[i];
            const outputPath = getOutputPath(item);

            const cached = await context.cache.getCache(this.name, cacheKey);
            if (cached && await context.cache.isValid(cached)) {
                context.log(`  - Skipping: ${item} (cached)`);
                results.push({item, output: cached.outputPaths[0], cached: true});
                continue;
            }

            const processed = await performWork(item);

            // Handle different return types
            let result: T | undefined;
            let implicitDependencies: string[] | undefined;

            if (processed && typeof processed === 'object' && 'implicitDependencies' in processed) {
                // Object with implicit dependencies
                result = processed.result;
                implicitDependencies = processed.implicitDependencies;
            } else {
                // Simple result value or void
                result = processed as T;
            }

            const cacheEntry = await context.cache.buildCacheEntry(
                [item], [outputPath], deps, cacheKey, implicitDependencies
            );
            await context.cache.setCache(this.name, cacheKey, cacheEntry);

            results.push({item, output: outputPath, cached: false, result});
        }
        return results;
    }
}

export interface PipelineContext {
    resolveInput(input: Input): Promise<string[]>;

    log(message: string): void;

    cache: CacheManager;
    buildDir: string;

    getBuildPath(nodeName: string, inputPath: string, newExtension?: string): string;
}

export class Pipeline {
    private graph = new DepGraph<PipelineNode>();
    private nodeOutputs = new Map<string, NodeOutput<any>[]>;
    private cache = new CacheManager();

    constructor(
        public readonly name: string,
        public readonly buildDir: string = '.efes-build'
    ) {
    }

    addNode(node: PipelineNode<any, any>): this {
        this.graph.addNode(node.name, node);
        return this;
    }

    // TODO probably useless
    addExplicitDependency(fromNodeName: string, toNodeName: string): this {
        // Validate that both nodes exist
        if (!this.graph.hasNode(fromNodeName)) {
            throw new Error(`Node "${fromNodeName}" not found in pipeline`);
        }
        if (!this.graph.hasNode(toNodeName)) {
            throw new Error(`Node "${toNodeName}" not found in pipeline`);
        }

        // Add to the node's explicit dependencies config
        const node = this.graph.getNodeData(fromNodeName);
        if (!node.config.explicitDependencies) {
            node.config.explicitDependencies = [];
        }
        if (!node.config.explicitDependencies.includes(toNodeName)) {
            node.config.explicitDependencies.push(toNodeName);
        }

        return this;
    }

    private setupDependencies() {
        // Process all nodes, not just entry nodes
        for (const nodeName of this.graph.overallOrder()) {
            const node = this.graph.getNodeData(nodeName);

            // Handle input-based dependencies (existing logic)
            for (const [_, input] of Object.entries(node.inputs)) {
                if (typeof input === 'object' && 'node' in input) {
                    try {
                        console.log(`Adding input dependency for node ${node.name}: ${input.node.name}`);
                        this.graph.addDependency(node.name, input.node.name);
                    } catch (err: any) {
                        throw new Error(`Failed to add input dependency for node ${node.name}: ${err.message}`);
                    }
                }
            }

            // Handle explicit dependencies (new logic)
            if (node.config.explicitDependencies) {
                for (const depNodeName of node.config.explicitDependencies) {
                    try {
                        // Validate that the dependency node exists
                        if (!this.graph.hasNode(depNodeName)) {
                            throw new Error(`Explicit dependency "${depNodeName}" not found in pipeline`);
                        }
                        console.log(`Adding explicit dependency for node ${node.name}: ${depNodeName}`);
                        this.graph.addDependency(node.name, depNodeName);
                    } catch (err: any) {
                        throw new Error(`Failed to add explicit dependency for node ${node.name}: ${err.message}`);
                    }
                }
            }
        }
    }

    private async analyze() {
        const context: PipelineContext = {
            resolveInput: async (input: Input): Promise<string[]> => {
                // Node references won't work during analysis since nodes haven't run yet
                if (inputIsNodeOutputReference(input)) {
                    return []; // Skip node references during analysis
                }

                // File paths and arrays work fine
                if (typeof input === "string") {
                    const results = await glob(input)
                    return results.length > 0 ? results : [input]; // Return original if no matches
                }

                if (Array.isArray(input)) {
                    const results: string[] = [];
                    for (const item of input) {
                        results.push(...(await context.resolveInput(item)))
                    }
                    return results;
                }

                return []
            },
            log: () => {
            }, // Silent during analysis
            cache: this.cache,
            buildDir: this.buildDir,
            getBuildPath: (nodeName: string, inputPath: string, newExtension?: string): string => {
                const relativePath = path.relative(process.cwd(), inputPath);
                const buildPath = path.join(this.buildDir, nodeName, relativePath);
                return newExtension ?
                    buildPath.replace(path.extname(buildPath), newExtension) :
                    buildPath;
            }
        }

        const nodesToAnalyze = this.graph.overallOrder();

        for (const nodeName of nodesToAnalyze) {
            const node = this.graph.getNodeData(nodeName);

            const requests = await node.analyze(context);

            for (const request of requests) {
                // Add the requested node
                this.addNode(request.node);

                // Update the original node's inputs to reference the new node's output
                node.config.inputs[request.replaceInput] = from(request.node, request.outputReference);
            }
        }
    }

    async run() {
        console.log(`Running pipeline ${this.name}`);
        console.log(`Number of nodes: ${this.graph.size()}`);

        await this.analyze();
        this.setupDependencies();

        const executionOrder = this.graph.overallOrder();
        console.log(executionOrder)
        const context: PipelineContext = {
            resolveInput: async (input: Input): Promise<string[]> => {

                // Node references
                if (inputIsNodeOutputReference(input)) {
                    const outputs = this.nodeOutputs.get(input.node.name)?.flatMap(output => output[input.name]);
                    if (!outputs) {
                        throw new Error(`Node "${input.node.name}" hasn't run yet or has not produced any outputs.`);
                    }
                    return outputs
                }

                // File paths
                if (typeof input === "string") {
                    const results = await glob(input)
                    if (results.length === 0) {
                        throw new Error(`No files found for pattern: ${input}`);
                    }
                    return results
                }

                // Arrays of node references or file paths
                if (Array.isArray(input)) {
                    const results: string[] = [];
                    for (const item of input) {
                        results.push(...(await context.resolveInput(item)))
                    }
                    return results;
                }

                return []
            },
            log: (message: string) => console.log(`  [${this.name}] ${message}`),
            cache: this.cache,
            buildDir: this.buildDir,
            getBuildPath: (nodeName: string, inputPath: string, newExtension?: string): string => {
                const relativePath = path.relative(process.cwd(), inputPath);
                const buildPath = path.join(this.buildDir, nodeName, relativePath);
                return newExtension ?
                    buildPath.replace(path.extname(buildPath), newExtension) :
                    buildPath;
            }
        }

        for (const nodeName of executionOrder) {
            const node = this.graph.getNodeData(nodeName);
            context.log(`▶ Running node: ${node.name}`);

            try {
                const output = await node.run(context);
                context.log(`  → Generated: ${JSON.stringify(output)}`);

                this.nodeOutputs.set(node.name, output);
                context.log(`  - Completed: ${node.name}`);
            } catch (err: any) {
                context.log(`  - Failed: ${node.name}`);
                context.log(`    ${err.message}`);
                throw err;
            }
        }

        context.log(`Pipeline completed.`);
    }
}