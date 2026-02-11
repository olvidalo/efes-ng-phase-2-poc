<?xml version="1.0" encoding="UTF-8"?>
<!--
    Generic 11ty Frontmatter Generator

    Shared boilerplate for creating JSON frontmatter from TEI XML documents.
    Project-specific logic is provided via three hook template modes,
    implemented in each project's indices-config.xsl:

    - extract-all-entities: dispatches to individual extraction templates
    - extract-search: returns search facet data as a map
    - extract-metadata: returns project-specific fields (tags, permalink, etc.)
-->
<xsl:stylesheet version="3.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:tei="http://www.tei-c.org/ns/1.0"
    xmlns:fn="http://www.w3.org/2005/xpath-functions"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:map="http://www.w3.org/2005/xpath-functions/map"
    xmlns:idx="http://efes.info/indices"
    exclude-result-prefixes="tei fn xs map idx">

    <xsl:output method="text" encoding="UTF-8"/>
    <xsl:param name="source-file" select="base-uri()"/>
    <xsl:param name="language" select="'en'"/>

    <!-- Extract filename without extension -->
    <xsl:variable name="filename">
        <xsl:variable name="full-name" select="tokenize($source-file, '/')[last()]"/>
        <xsl:value-of select="substring-before($full-name, '.xml')"/>
    </xsl:variable>

    <!-- Extract title from TEI header -->
    <xsl:variable name="title">
        <xsl:variable name="tei-title" select="//*:titleStmt/*:title[1]/normalize-space(.)"/>
        <xsl:choose>
            <xsl:when test="string-length($tei-title) > 0">
                <xsl:value-of select="$tei-title"/>
            </xsl:when>
            <xsl:otherwise>
                <xsl:value-of select="$filename"/>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:variable>

    <!-- SortKey: split on letter/number boundaries, zero-pad numbers -->
    <xsl:variable name="sortKey">
        <xsl:analyze-string select="$filename" regex="([a-zA-Z]+)|([0-9]+)">
            <xsl:matching-substring>
                <xsl:choose>
                    <xsl:when test="regex-group(2)">
                        <xsl:value-of select="format-number(xs:integer(regex-group(2)), '00000')"/>
                    </xsl:when>
                    <xsl:otherwise>
                        <xsl:value-of select="regex-group(1)"/>
                    </xsl:otherwise>
                </xsl:choose>
                <xsl:text>.</xsl:text>
            </xsl:matching-substring>
        </xsl:analyze-string>
    </xsl:variable>

    <!-- Default hooks (overridden by indices-config via import precedence) -->
    <xsl:template match="tei:TEI" mode="extract-all-entities"/>
    <xsl:template match="tei:TEI" mode="extract-search"><xsl:map/></xsl:template>
    <xsl:template match="tei:TEI" mode="extract-metadata"><xsl:map/></xsl:template>

    <xsl:template match="/">
        <!-- Collect ALL entity maps via dispatch hook -->
        <xsl:variable name="all-entities" as="map(*)*">
            <xsl:apply-templates select="/tei:TEI" mode="extract-all-entities"/>
        </xsl:variable>

        <!-- Group by indexType → build entities map -->
        <xsl:variable name="entities" as="map(*)">
            <xsl:map>
                <xsl:for-each-group select="$all-entities" group-by="?indexType">
                    <xsl:map-entry key="current-grouping-key()"
                                   select="array{ current-group() }"/>
                </xsl:for-each-group>
            </xsl:map>
        </xsl:variable>

        <!-- Search hook (entities available via tunnel for derived facets) -->
        <xsl:variable name="search" as="map(*)">
            <xsl:apply-templates select="/tei:TEI" mode="extract-search">
                <xsl:with-param name="entities" select="$entities" tunnel="yes"/>
            </xsl:apply-templates>
        </xsl:variable>

        <!-- Metadata hook (tags, permalink, etc.) -->
        <xsl:variable name="metadata" as="map(*)">
            <xsl:apply-templates select="/tei:TEI" mode="extract-metadata"/>
        </xsl:variable>

        <!-- Merge: metadata overrides base keys (use-first on $metadata) -->
        <xsl:sequence select="fn:serialize(
            map:merge(($metadata, map{
                'layout': 'layouts/document.njk',
                'language': $language,
                'title': $title,
                'date': current-dateTime(),
                'documentId': $filename,
                'sourceFile': concat($filename, '.xml'),
                'sortKey': $sortKey,
                'origDate': string-join(//tei:origDate, ', '),
                'entities': $entities,
                'search': $search
            })),
            map{'method': 'json', 'indent': true()}
        )"/>
    </xsl:template>
</xsl:stylesheet>
