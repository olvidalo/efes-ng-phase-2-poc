import {XsltTransformNode} from "../../src/xml/nodes/xsltTransformNode";
import {fileRef, Pipeline} from "../../src/core/pipeline";
import {CopyFilesNode} from "../../src/io/copyFilesNode";
import {EleventyBuildNode} from "../../src/eleventy";


// We copy the eleventy site files to the intermediate directory so that they can be used as input for the Eleventy build.
// In the next step, we add the transformed EpiDoc XML files as HTML partials to the inscription directory.
const copyEleventySite = new CopyFilesNode({
    name: "copy-eleventy-site",
    config: {
        sourceFiles: "1-input/eleventy-site/**/*"
    },
    outputConfig: {
        outputDir: "2-intermediate",
        stripPathPrefix: "1-input"
    }
})

// Transforms the EpiDoc XML files into HTML partials using the EpiDoc stylesheets.
// Outputs them to the inscription directory of the intermediate eleventy-site directory.
const transformEpiDoc = new XsltTransformNode({
    name: "transform-epidoc",
    config: {
        sourceFiles: '1-input/inscriptions/*.xml',
        stylesheet: fileRef("1-input/epidoc-stylesheets/start-edition.xsl"),
        initialTemplate: "inslib-body-structure",
        stylesheetParams: {
            "parm-edition-type": "interpretive",
            "parm-edn-structure": "inslib",
            "parm-external-app-style": "inslib",
            "parm-internal-app-style": "none",
            "parm-leiden-style": "panciera",
            "parm-line-inc": "5",
            "parm-verse-lines": "on",
        }
    },
    outputConfig: {
        outputDir: "2-intermediate/eleventy-site/en/inscriptions",
        stripPathPrefix: "1-input/inscriptions",
        extension: ".html"
    }
})

// Extracts metadata from each EpiDoc XML source file to a JSON
// companion file as metadata for Eleventy that it can use to generate the inscription navigation and the inscription
// list. Outputs the JSON files to the inscription directory of the intermediate eleventy-site directory, alongside the
// HTML partials.

const createEpiDoc11tyFrontmatter = new XsltTransformNode({
    name: "create-epidoc-11ty-frontmatter",
    config: {
        sourceFiles: "1-input/inscriptions/*.xml",
        stylesheet: fileRef("1-input/stylesheets/create-11ty-frontmatter-for-epidoc.xsl")
    },
    outputConfig: {
        outputDir: "2-intermediate/eleventy-site/en/inscriptions",
        stripPathPrefix: "1-input/inscriptions",
        extension: ".11tydata.json"
    }
})

// Calls Eleventy to build the site and outputs the result to the output directory.
const eleventyBuild = new EleventyBuildNode({
    name: 'eleventy-build',
    config: {
        sourceDir: './2-intermediate/eleventy-site'
    },
    outputConfig: {
        outputDir: '3-output',
    },

    // Make sure the other nodes run before this one so all necessary files have been generated.
    explicitDependencies: ["transform-epidoc", "copy-eleventy-site", "create-epidoc-11ty-frontmatter"],
});


// Create the pipeline
const pipeline = new Pipeline("IRCyR Eleventy", ".efes-build", ".efes-cache", "dynamic");

(async () => {
    await pipeline

        // Add all nodes
        .addNode(transformEpiDoc)
        .addNode(createEpiDoc11tyFrontmatter)
        .addNode(copyEleventySite)
        .addNode(eleventyBuild)

        // Run the pipeline
        .run();
})()
