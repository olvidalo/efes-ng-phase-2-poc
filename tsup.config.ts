import { defineConfig } from 'tsup';

export default defineConfig(() => {
    // Build entry configuration - always include worker
    const entry: Record<string, string> = {
        'saxonWorker': 'src/xml/saxonWorker.ts',  // Output to dist/saxonWorker.js
    };

    // Add main entry based on environment variable or default
    const customEntry = process.env.TSUP_ENTRY;
    if (customEntry) {
        entry.main = customEntry;
    } else {
        entry.index = 'src/index.ts';
    }

    return {
        entry,
        format: ['cjs', 'esm'],
        dts: !customEntry,  // Only generate .d.ts for library build
        splitting: false,
        sourcemap: true,
        clean: true,
        treeshake: true,
        minify: true,
        target: 'node22',
        outDir: 'dist',
        external: ['saxonjs-he', 'xslt3-he']
    };
});