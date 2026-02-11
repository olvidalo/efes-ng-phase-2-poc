# EFES-NG Phase 2 Proof of Concept

Prototype for generating static collection sites from EpiDoc/SigiDoc XML files, replacing the Cocoon/Kiln-based EFES system. Uses Saxon-JS for XSLT processing, Eleventy for static site generation, and a custom TypeScript pipeline for build orchestration.

A demo deployment is available at https://olvidalo.github.io/efes-ng-phase-2-poc/.

## Repository Structure

```
efes-ng-phase-2-poc/
├── src/                       # Core pipeline system (TypeScript)
│   ├── core/                 # Pipeline orchestration, caching, workers
│   ├── xml/                  # XSLT compilation and transformation nodes
│   ├── eleventy/             # Aggregate nodes (indices, search, bibliography)
│   ├── search/               # FlexSearch index generation
│   └── xslt/                # Shared XSLT stylesheets
│       └── create-11ty-frontmatter.xsl  # Generic frontmatter extraction
├── projects/                  # Two proof-of-concept implementations
│   ├── ircyr-11ty/           # IRCyr inscriptions (~2,360 documents)
│   └── sigidoc-feind-11ty/   # SigiDoc Feind seals (~320 documents, trilingual)
└── pages/                     # Assembled output for GitHub Pages deployment
```

## Projects

Each project follows the same structure:

- `1-input/`: Source files — XML documents, stylesheets, Eleventy templates, authority files, configuration
- `2-intermediate/`: Generated during build — frontmatter JSON, aggregated index/search data
- `3-output/`: Final static website
- `*.pipeline.ts`: Pipeline definition. Run with `npx tsx <project>.pipeline.ts` from the project directory.

### IRCyr-11ty

Generates a static site from the IRCyr (Inscriptions of Roman Cyrenaica) EpiDoc collection.

**Input Structure**

- `epidoc-stylesheets/`: EpiDoc XSLT stylesheet submodule from https://github.com/EpiDoc/Stylesheets/
- `inscriptions/`: EpiDoc XML source files from the IRCyR EFES repo
- `authority/`: XML authority files from the IRCyR EFES repo
- `indices-config.xsl`: Central configuration — defines all entity extraction templates, search facets
- `eleventy-site/`: Eleventy templates, layouts, index/search pages, partials, and static assets
- `stylesheets/`:
    - `create-11ty-frontmatter-for-epidoc.xsl`: Thin wrapper importing the shared generic XSL and `indices-config.xsl`

### SigiDoc-Feind-11ty

Generates a trilingual (EN/DE/EL) static site from the Robert Feind seal collection.

**Input Structure**

- `sigidoc-stylesheets/`: SigiDoc XSLT stylesheet submodule from https://github.com/SigiDoc/Stylesheets/
- `feind-collection/`: SigiDoc XML source file submodule from https://github.com/byzantinistik-koeln/feind-collection
- `authority/`: Authority file submodule from https://github.com/byzantinistik-koeln/authority
- `indices-config.xsl`: Central configuration — entity extraction, search facets
- `eleventy-site/`: Eleventy templates with multilingual support, index/search/bibliography pages, partials, and static assets
- `stylesheets/`:
    - `create-11ty-frontmatter-for-sigidoc.xsl`: Thin wrapper importing the shared generic XSL and `indices-config.xsl`
    - `epidoc-to-html.xsl`: Imports SigiDoc stylesheets and performs i18n label replacement
    - `prune-to-language.xsl`: Filters multilingual content to produce language-specific outputs (based on the original EFES)

## Building

```bash
# Install dependencies
npm install

# Build all projects
npm run build:all

# Or build individually
npm run build:ircyr-11ty
npm run build:sigidoc-feind-11ty

# Assemble for GitHub Pages deployment
npm run assemble
npm run relativize
```