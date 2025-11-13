import {CopyFilesNode} from "../../src/io/copyFilesNode";
import {fileRef, from, Pipeline} from "../../src/core/pipeline";
import path from "node:path";
import {XsltTransformNode} from "../../src/xml/nodes/xsltTransformNode";



// ----- PREPARE KILN XSLs AND TEMPLATES -----

// Copy all Kiln / EFES files to the preprocessed directory so relative imports in XSLs work, such as for authority
// files
const copyKiln = new CopyFilesNode({
    name: "copy-kiln",
    config: {
        sourceFiles: "1-input/ircyr-efes/**/*"
    },
    outputConfig: {
        outputDir: "2-intermediate",
        stripPathPrefix: "1-input"
    }
})

// Preprocess the EFES/Kiln XSLs so they can run outside of Kiln and outputs them to the intermediate bukd directory.
// The preprocess-kiln-xsl stylesheet resolves internal cocoon:// (e.g. references to compiled templates that trigger a
// pipeline) urls by replacing them with the absolute path to the corresponding file in the build directory.
// It also resolves and replaces paths referencing the user.dir system property which is not available outside of Kiln.
const preprocessKilnXsl = new XsltTransformNode({
    name: "kiln-xsl-preprocess",
    config: {
        sourceFiles: from(copyKiln, "copied", "2-intermediate/ircyr-efes/webapps/ROOT/**/*.xsl"),
        stylesheet: fileRef("1-input/stylesheets/preprocess-kiln-xsl.xsl"),
        stylesheetParams: {
            "stylesheet-base-path": path.resolve("2-intermediate/ircyr-efes/webapps/ROOT"),
            "efes-base-path": path.resolve("1-input/ircyr-efes"),
        }
    },
    outputConfig: {
        outputDir: "2-intermediate",
        stripPathPrefix: "2-intermediate",
        extension: ".xsl"
    }
})

// Same as above, but for the Kiln templates.
const preprocessKilnTemplates = new XsltTransformNode({
    name: "templates-preprocess",
    config: {
        sourceFiles: from(copyKiln, "copied", "2-intermediate/ircyr-efes/webapps/ROOT/assets/templates/**/*.xml"),
        stylesheet: fileRef("1-input/stylesheets/preprocess-kiln-xsl.xsl"),
        stylesheetParams: {
            "stylesheet-base-path": path.resolve("2-intermediate/ircyr-efes/webapps/ROOT"),
            "efes-base-path": path.resolve("1-input/ircyr-efes")
        }
    },
    outputConfig: {
        outputDir: "2-intermediate",
        stripPathPrefix: "2-intermediate",
    }
})

// Kiln templates can contain XIncludes for template composition. As Saxon-JS does not support XIncludes, we expand them
// using a custom XSLT.
const templatesExpandXIncludes = new XsltTransformNode({
    name: "templates-expand-xincludes",
    config: {
        sourceFiles: from(preprocessKilnTemplates, "transformed", "2-intermediate/ircyr-efes/webapps/ROOT/assets/templates/{epidoc-inslib,inscription-index,home}.xml"),
        stylesheet: fileRef("1-input/stylesheets/expand-xincludes.xsl")
    }
})

// Uses the Kiln inherit-template stylesheet to transform Kiln templates into XSLT so they can be called with XML input.
const templatesInherit = new XsltTransformNode({
    name: "template-inherit-template",
    config: {
        sourceFiles: from(templatesExpandXIncludes, "transformed"),
        stylesheet: from(preprocessKilnXsl, "transformed", "2-intermediate/ircyr-efes/webapps/ROOT/kiln/stylesheets/template/inherit-template.xsl"),

        // Templates use functions from the kiln: namespace. We provide a stub with an own implementation of these
        // functions so that the XSLT can run outside of Kiln.
        stubLibPath: fileRef("kiln-functions-stub.json")
    },
    outputConfig: {
        extension: '.xsl'
    }
})


// ----- CREATE INSCRIPTION PAGES -----

// Kiln templates generally expect an <aggregation> element containing several children that compose the template
// input. For example, the epidoc-inslib template that creates the Inscription pages expects the data for the
// navigational Menu and the transformed EpiDoc sources files combined in an <aggregation> element.
// So for each EpiDoc source file, we create such an aggregation with this node.
const epidocMenuAggregation = new XsltTransformNode({
    name: "epidoc-menu-aggregation",
    config: {
        sourceFiles: "1-input/ircyr-efes/webapps/ROOT/content/xml/epidoc/*.xml",
        stylesheet: fileRef("1-input/stylesheets/create-menu-aggregation.xsl"),
        stylesheetParams: {
            url: (inputPath: string) => {
                const inputFilename = path.basename(inputPath);
                const inputBasename = path.basename(inputFilename, path.extname(inputFilename));
                return path.join( "/en/inscriptions", inputBasename + '.html');
            },
            language: "en"
        }
    },
    explicitDependencies: ["copy-kiln", "kiln-xsl-preprocess", "templates-preprocess"]
})

// Transforms each inscription+menu aggregation created in the previous step with the epidoc-inslib template to create
// the final Inscription pages.
const epidocTransform = new XsltTransformNode({
    name: `transform-epidoc`,
    config: {
        sourceFiles: from(epidocMenuAggregation, "transformed"),
        stylesheet: from(templatesInherit, "transformed", "2-intermediate/ircyr-efes/webapps/ROOT/assets/templates/epidoc-inslib.xsl"),
        stylesheetParams: {
            "language": "en"
        },
        serializationParams: {
            "method": "html",
            "indent": true
        },
        stubLibPath: fileRef("kiln-functions-stub.json")
    },
    outputConfig: {
        outputDir: "3-output/en/inscriptions",
        flattenToBasename: true,
        extension: ".html"
    }
})


// ----- CREATE INSCRIPTION INDEX -----

// We use the EFES/Kiln stylesheets that creates the index data for Solr to extract metadata from the EpiDoc XML sources.
const transformEpiDocToSolr = new XsltTransformNode({
    name: 'epidoc-to-solr',
    config: {
        sourceFiles: "1-input/ircyr-efes/webapps/ROOT/content/xml/epidoc/*.xml",
        stylesheet: from(preprocessKilnXsl, "transformed", "2-intermediate/ircyr-efes/webapps/ROOT/stylesheets/solr/tei-to-solr.xsl"),
        stylesheetParams: {
            'file-path': function (inputPath: string) {
                const relativePath = inputPath.replace("1-input/ircyr-efes/webapps/ROOT/content/xml/", "")
                return relativePath.replace(".xml", "")
            }
        }
    }
})

// The Kiln templates for rendering the indices and bibliography expect all Solr docs in a single <aggregation> element,
// which we create here.
const aggregateSolrDocs = new XsltTransformNode({
    name: 'epidoc-aggregate-solr-docs',
    config: {
        stylesheet: fileRef('1-input/stylesheets/aggregate-epidoc-solr-docs.xsl'),
        initialTemplate: 'main',
        stylesheetParams: {
            'documents': from(transformEpiDocToSolr, "transformed")
        }
    }
})

// Transform the aggregated Solr docs into the format expected by the Kiln templates. This basically
// "emulates" a Solr query for all documents.
const solrDocsToResults = new XsltTransformNode({
    name: "epidoc-solr-docs-to-results",
    config: {
        sourceFiles: from(aggregateSolrDocs, "transformed"),
        stylesheet: fileRef("1-input/stylesheets/solr-docs-to-results.xsl"),
        stylesheetParams: {
            "document_type": "epidoc"
        }
    }
})


// Create a menu aggregation for the Inscription list page (see epidocMenuAggregation above)
const createInscriptionListMenuAggregation = new XsltTransformNode({
    name: "epidoc-inscription-list-menu-aggregation",
    config: {
        sourceFiles: from(solrDocsToResults, "transformed"),
        stylesheet: fileRef("1-input/stylesheets/create-menu-aggregation.xsl"),
        stylesheetParams: {
            url: "/en/inscriptions/index.html",
            language: "en"
        }
    },
    explicitDependencies: ["copy-kiln", "kiln-xsl-preprocess", "templates-preprocess"]
})


// Create the final Inscription list page using the inscription-index template from the original EFES.
const createInscriptionList = new XsltTransformNode({
    name: "epidoc-create-inscription-list",
    config: {
        sourceFiles: from(createInscriptionListMenuAggregation, "transformed"),
        stylesheet: from(templatesInherit, "transformed", "2-intermediate/ircyr-efes/webapps/ROOT/assets/templates/inscription-index.xsl"),
        stylesheetParams: {
            "language": "en"
        },
        stubLibPath: fileRef("kiln-functions-stub.json")
    },
    outputConfig: {
        outputDir: "3-output",
        outputFilename: "en/inscriptions/index.html"
    }
})


// ----- CREATE HOME PAGE -----

// Create a menu aggregation for the home (landing) page (see epidocMenuAggregation above)
const homeMenuAggregation = new XsltTransformNode({
    name: "home-menu-aggregation",
    config: {
        sourceFiles: from(preprocessKilnTemplates, "transformed", "2-intermediate/ircyr-efes/webapps/ROOT/assets/templates/home.xml"),
        stylesheet: fileRef("1-input/stylesheets/create-menu-aggregation.xsl"),
        stylesheetParams: {
            url: "/en",
            language: "en"
        }
    },
    explicitDependencies: ["copy-kiln", "kiln-xsl-preprocess", "templates-preprocess"]
})

// Create the final home page using the home template from the original EFES.
const transformHome = new XsltTransformNode({
    name: `transform-home`,
    config: {
        sourceFiles: from(homeMenuAggregation, "transformed"),
        stylesheet: from(templatesInherit, "transformed", "2-intermediate/ircyr-efes/webapps/ROOT/assets/templates/home.xsl"),
        stubLibPath: fileRef("kiln-functions-stub.json")

    },
    outputConfig: {
        outputDir: "3-output",
        outputFilename: "en/index.html"
    }
})


// The final HTML pages generated by the original Kiln/EFES stylesheets reference assets, such as images, CSS and JS files.
// We copy them to the output directory, so they are available for the final HTML pages.
const copyKilnAssets = new CopyFilesNode({
    name: "copy-assets",
    config: {
        sourceFiles: "1-input/ircyr-efes/webapps/ROOT/assets/{foundation,styles,images,scripts}/**/*"
    },
    outputConfig: {
        outputDir: "3-output",
        stripPathPrefix: "1-input/ircyr-efes/webapps/ROOT"
    }
});



// Create the pipeline
const pipeline = new Pipeline("IRCyR XSLT",".efes-build", ".efes-cache", "dynamic");

// Add all nodes
(async () => {
    await pipeline
        .addNode(copyKiln)
        .addNode(preprocessKilnXsl)
        .addNode(preprocessKilnTemplates)
        .addNode(templatesExpandXIncludes)
        .addNode(templatesInherit)

        .addNode(epidocMenuAggregation)
        .addNode(epidocTransform)

        .addNode(transformEpiDocToSolr)
        .addNode(aggregateSolrDocs)
        .addNode(solrDocsToResults)
        .addNode(createInscriptionListMenuAggregation)
        .addNode(createInscriptionList)

        .addNode(homeMenuAggregation)
        .addNode(transformHome)

        .addNode(copyKilnAssets)

        .run();
})()
