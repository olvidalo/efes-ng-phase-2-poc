# EFES-NG Phase 1 Proof of Concept

This repository demonstrates two approaches for migrating Kiln/EFES digital editions to modern static site generation.

A demo deployment is available at https://olvidalo.github.io/efes-ng-phase-1-poc/.

## Repository Structure

```
efes-ng-phase-1-poc/
├── src/                    # Core pipeline system (TypeScript)
│   ├── core/              # Pipeline orchestration, caching, workers
│   └── xml/               # XSLT compilation and transformation nodes
│   └── ...
├── projects/              # Three proof-of-concept implementations
│   ├── ircyr-11ty/       # IRCyr inscriptions (Eleventy)
│   ├── ircyr-xslt/       # IRCyr inscriptions (XSLT-based, "EFES clone")
│   └── sigidoc-feind-11ty/ # SigiDoc Feind seals (Eleventy + SigiDoc)
└── pages/                 # Assembled output for GitHub Pages deployment
```

## Scope

The demonstrations feature a list of inscriptions and EpiDoc XSLT-generated pages for each inscription (or seal) with
simple navigation.

## Two Approaches

### Approach 1: Eleventy + EpiDoc Stylesheets (ircyr-11ty, sigidoc-feind-11ty)

**Use case**: For publishing new collections or migrating projects with significant refactoring.

### Approach 2: Maximum EFES Stylesheet Reuse (ircyr-xslt)

**Use case**: Producing static site versions of existing EFES collections with minimal changes.

## Projects

**General Project Structure**

- `1-input`: Contains all files from which the output is generated
- `2-intermedate`: Will contain temporary files generated during the build process
- `3-output`: Will contain the final static website output
- `*.pipeline.ts`: Contains the definition of the project pipeline. To run a pipeline, change to the project directory
  and run
  `npx tsx ircyr-11ty.pipeline.ts`.

### IRCyr-11ty

Transforms the EpiDoc source files to HTML partials and integrates them with a minimal Eleventy site. Depends on a clone
of the EpiDoc stylesheets checked out as a submodule and the IRCyR EpiDoc source files.

**Input Structure**

- `eleventy-site`: Eleventy templates and layouts. This is where everything "around" the inscriptions comes from (e.g.,
  navigation, header, footer).
- `epidoc-stylesheets`: EpiDoc XSLT stylesheet submodule from https://github.com/EpiDoc/Stylesheets/
- `inscriptions`: EpiDoc XML source files copied in from the IRCyR EFES repo
  at https://github.com/kingsdigitallab/ircyr-efes/tree/master/webapps/ROOT/content/xml/epidoc.
- `stylesheets`: Custom EpiDoc stylesheets used for processing the inscriptions.
    - `create-11ty-frontmatter-for-epidoc.xsl`: Extracts metadata from each EpiDoc XML source file to a JSON
      companion file as metadata for Eleventy that it can use to generate the inscription navigation and the inscription
      list.

### IRCyr-XSLT

Pure XSLT transformation approach that maximizes reuse of existing EFES/Kiln XSLT stylesheets. Demonstrates how to
produce a static site version of an existing EFES collection with minimal changes to the original.
The transformations resemble the original Cocoon pipelines and use the original unmodified stylesheets and templates
where possible.

**Input Structure**

- `ircyr-efes`: Clone of the IRCyR EFES repository submodule from https://github.com/kingsdigitallab/ircyr-efes/
- `stylesheets`: Custom XSLT stylesheets.
    - `aggregate-epidoc-solr-docs.xsl`: Aggregates metadata from all EpiDoc files into a single Solr-like XML document
    - `create-menu-aggregation.xsl`: Aggregates XML/HTML files with the contextualised menu template for processing with
      Kiln templates.
    - `expand-xincludes.xsl`: Resolves XInclude references in Kiln templates.
    - `preprocess-kiln-xsl.xsl`: Adapts Kiln XSLT stylesheets and templates to work in the static generation context.
    - `solr-docs-to-results.xsl`: Converts Solr documents into Solr results for "emulating" a Solr query.

### SigiDoc-Feind-11ty

Transforms the EpiDoc source files to HTML partials and integrates them into a multilingual Eleventy site. Depends on a
clone of the SigiDoc stylesheets checked out as a submodule and the IRCyR EpiDoc source files. Features English, German,
and Greek translations with language-specific navigation.

**Input Structure**

- `eleventy-site`: Eleventy templates and layouts.
- `feind-collection`: SigiDoc XML source files from the Feind collection
  at https://github.com/byzantinistik-koeln/feind-collection as a submodule.
- `i18n`: Translation files (`messages_en.xml`, `messages_de.xml`, `messages_el.xml`) for field labels taken from
  SigiDoc EFES at https://github.com/SigiDoc/EFES-SigiDoc/tree/master/webapps/ROOT/assets/translations.
- `sigidoc-stylesheets`: SigiDoc XSLT stylesheet submodule from https://github.com/SigiDoc/Stylesheets/
- `stylesheets`: Custom stylesheets used for processing the seals.
    - `create-11ty-frontmatter-for-sigidoc.xsl`: Extracts metadata from each SigiDoc XML source file to JSON for
      Eleventy
    - `epidoc-to-html.xsl`: Wrapper stylesheet that imports SigiDoc stylesheets and performs i18n label replacement
    - `prune-to-language.xsl`: Filters multilingual content to produce language-specific outputs

## Building

```bash
# Install dependencies
npm install

# Build all projects
npm run build:all

# Assemble for deployment
npm run assemble

# Relativize paths for subdirectory hosting
npm run relativize

# Demo page will be generated in `pages`.
```