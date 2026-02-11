<?xml version="1.0" encoding="UTF-8"?>
<!--
    Entity Indices Configuration for SigiDoc FEIND

    This file contains both:
    1. Index metadata (in idx: namespace) - title, columns, notes
    2. Extraction templates (xsl:template) - XPath logic for each index type

    To add a new index:
    1. Add an <idx:index> element with metadata
    2. Add an <xsl:template mode="extract-{id}"> with extraction logic
-->
<xsl:stylesheet version="3.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:tei="http://www.tei-c.org/ns/1.0"
    xmlns:idx="http://efes.info/indices"
    xmlns:map="http://www.w3.org/2005/xpath-functions/map"
    exclude-result-prefixes="xs map">

    <!-- ================================================================== -->
    <!-- INDEX: persons (Prosopography)                                      -->
    <!-- ================================================================== -->
    <idx:index id="persons" title="Persons" order="1">
        <idx:description>Prosopography of seal issuers.</idx:description>
        <idx:columns>
            <idx:column key="name">Name</idx:column>
            <idx:column key="references" type="references">Seals</idx:column>
        </idx:columns>
    </idx:index>

    <xsl:template match="tei:TEI" mode="extract-persons">
        <xsl:for-each select=".//tei:listPerson[@type='issuer']/tei:person">
            <xsl:variable name="en-name" select="tei:persName[@xml:lang='en']"/>
            <xsl:variable name="forename" select="normalize-space($en-name/tei:forename)"/>
            <xsl:variable name="surname" select="normalize-space($en-name/tei:surname)"/>
            <xsl:variable name="displayName" select="normalize-space(
                string-join(($forename, $surname[string-length(.) > 0]), ' ')
            )"/>
            <xsl:if test="string-length($displayName) > 0">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'persons'"/>
                    <xsl:map-entry key="'name'" select="$displayName"/>
                    <xsl:map-entry key="'sortKey'" select="lower-case($displayName)"/>
                    <xsl:map-entry key="'collectionName'"
                        select="normalize-space(ancestor::tei:TEI//tei:rs[@type='collection-name'][@xml:lang='en'])"/>
                    <xsl:map-entry key="'invNr'"
                        select="normalize-space(ancestor::tei:TEI//tei:idno[@type='inv-nr-current'][normalize-space()][1])"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: places (Place Names)                                         -->
    <!-- ================================================================== -->
    <idx:index id="places" title="Place Names" order="2">
        <idx:description>Place names attested on seals.</idx:description>
        <idx:columns>
            <idx:column key="name">Name</idx:column>
            <idx:column key="pleiades" type="link" labelKey="pleiadesId">Pleiades</idx:column>
            <idx:column key="geonames" type="link" labelKey="geonamesId">Geonames</idx:column>
            <idx:column key="tib" type="link" labelKey="tibId">TIB</idx:column>
            <idx:column key="references" type="references">Seals</idx:column>
        </idx:columns>
    </idx:index>

    <!-- ================================================================== -->
    <!-- INDEX: dignities (Dignities)                                       -->
    <!-- ================================================================== -->
    <idx:index id="dignities" title="Dignities" order="3">
        <idx:description>Dignities and titles attested on seals.</idx:description>
        <idx:columns>
            <idx:column key="name">Dignity</idx:column>
            <idx:column key="references" type="references">Seals</idx:column>
        </idx:columns>
    </idx:index>

    <!-- ================================================================== -->
    <!-- INDEX: offices (Offices)                                           -->
    <!-- ================================================================== -->
    <idx:index id="offices" title="Offices" order="4">
        <idx:description>Offices attested on seals.</idx:description>
        <idx:columns>
            <idx:column key="name">Office</idx:column>
            <idx:column key="officeType">Type</idx:column>
            <idx:column key="references" type="references">Seals</idx:column>
        </idx:columns>
    </idx:index>

    <!-- ================================================================== -->
    <!-- INDEX: invocations (Invocations)                                   -->
    <!-- ================================================================== -->
    <idx:index id="invocations" title="Invocations" order="5">
        <idx:description>Invocations attested on seals.</idx:description>
        <idx:columns>
            <idx:column key="name">Invocation</idx:column>
            <idx:column key="references" type="references">Seals</idx:column>
        </idx:columns>
    </idx:index>

    <!-- Authority file paths – passed as stylesheet parameters (absolute URIs) -->
    <xsl:param name="geography-file" as="xs:string" select="''"/>
    <xsl:variable name="geography" select="if ($geography-file != '') then document($geography-file) else ()"/>
    <xsl:param name="dignities-file" as="xs:string" select="''"/>
    <xsl:variable name="dignities" select="if ($dignities-file != '') then document($dignities-file) else ()"/>
    <xsl:param name="offices-file" as="xs:string" select="''"/>
    <xsl:variable name="offices" select="if ($offices-file != '') then document($offices-file) else ()"/>
    <xsl:param name="invocations-file" as="xs:string" select="''"/>
    <xsl:variable name="invocations" select="if ($invocations-file != '') then document($invocations-file) else ()"/>
    <xsl:param name="bibliography-file" as="xs:string" select="''"/>
    <xsl:variable name="bibliography-authority" select="if ($bibliography-file != '') then document($bibliography-file) else ()"/>

    <xsl:template match="tei:TEI" mode="extract-places">
        <xsl:for-each select=".//tei:div[@type='textpart']//tei:placeName[starts-with(@ref, '#geo')]">
            <xsl:variable name="geo-id" select="substring-after(@ref, '#')"/>
            <xsl:variable name="place" select="$geography//tei:place[@xml:id = $geo-id]"/>
            <xsl:variable name="displayName" select="normalize-space($place/tei:placeName[@xml:lang='en'])"/>
            <xsl:if test="string-length($displayName) > 0">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'places'"/>
                    <xsl:map-entry key="'name'" select="$displayName"/>
                    <xsl:map-entry key="'sortKey'" select="$geo-id"/>
                    <xsl:map-entry key="'pleiades'"
                        select="string($place/tei:idno[@type='pleiades']/following-sibling::tei:link[contains(@target,'pleiades')]/@target)"/>
                    <xsl:map-entry key="'pleiadesId'"
                        select="normalize-space($place/tei:idno[@type='pleiades'])"/>
                    <xsl:map-entry key="'geonames'"
                        select="string($place/tei:idno[@type='geonames']/following-sibling::tei:link[contains(@target,'geonames')]/@target)"/>
                    <xsl:map-entry key="'geonamesId'"
                        select="normalize-space($place/tei:idno[@type='geonames'])"/>
                    <xsl:map-entry key="'tib'"
                        select="string($place/tei:idno[@type='TIB']/following-sibling::tei:link[contains(@target,'tib')]/@target)"/>
                    <xsl:map-entry key="'tibId'"
                        select="normalize-space($place/tei:idno[@type='TIB'])"/>
                    <xsl:map-entry key="'collectionName'"
                        select="normalize-space(ancestor::tei:TEI//tei:rs[@type='collection-name'][@xml:lang='en'])"/>
                    <xsl:map-entry key="'invNr'"
                        select="normalize-space(ancestor::tei:TEI//tei:idno[@type='inv-nr-current'][normalize-space()][1])"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <xsl:template match="tei:TEI" mode="extract-dignities">
        <xsl:for-each select=".//tei:div[@type='textpart']//tei:rs[@type='dignity'][starts-with(@ref, '#d')]">
            <xsl:variable name="ref-id" select="substring-after(@ref, '#')"/>
            <xsl:variable name="item" select="$dignities//tei:item[@xml:id = $ref-id]"/>
            <!-- Use Greek term (matching original EFES), fall back to English -->
            <xsl:variable name="displayName" select="normalize-space(
                ($item/tei:term[@xml:lang='grc'], $item/tei:term[@xml:lang='la'], $item/tei:term[@xml:lang='en'])[normalize-space()][1]
            )"/>
            <xsl:if test="string-length($displayName) > 0">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'dignities'"/>
                    <xsl:map-entry key="'name'" select="$displayName"/>
                    <xsl:map-entry key="'sortKey'" select="$ref-id"/>
                    <xsl:map-entry key="'collectionName'"
                        select="normalize-space(ancestor::tei:TEI//tei:rs[@type='collection-name'][@xml:lang='en'])"/>
                    <xsl:map-entry key="'invNr'"
                        select="normalize-space(ancestor::tei:TEI//tei:idno[@type='inv-nr-current'][normalize-space()][1])"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <xsl:template match="tei:TEI" mode="extract-offices">
        <xsl:for-each select=".//tei:div[@type='textpart']//tei:rs[@type='office'][@subtype][starts-with(@ref, '#of')]">
            <xsl:variable name="ref-id" select="substring-after(@ref, '#')"/>
            <xsl:variable name="item" select="$offices//tei:item[@xml:id = $ref-id]"/>
            <xsl:variable name="displayName" select="normalize-space(
                ($item/tei:term[@xml:lang='grc'], $item/tei:term[@xml:lang='la'], $item/tei:term[@xml:lang='en'])[normalize-space()][1]
            )"/>
            <xsl:if test="string-length($displayName) > 0">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'offices'"/>
                    <xsl:map-entry key="'name'" select="$displayName"/>
                    <xsl:map-entry key="'sortKey'" select="$ref-id"/>
                    <xsl:map-entry key="'officeType'" select="string(@subtype)"/>
                    <xsl:map-entry key="'collectionName'"
                        select="normalize-space(ancestor::tei:TEI//tei:rs[@type='collection-name'][@xml:lang='en'])"/>
                    <xsl:map-entry key="'invNr'"
                        select="normalize-space(ancestor::tei:TEI//tei:idno[@type='inv-nr-current'][normalize-space()][1])"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <xsl:template match="tei:TEI" mode="extract-invocations">
        <xsl:for-each select=".//tei:div[@type='textpart']//tei:rs[@type='invocation'][starts-with(@ref, '#inv')]">
            <xsl:variable name="ref-id" select="substring-after(@ref, '#')"/>
            <xsl:variable name="item" select="$invocations//tei:item[@xml:id = $ref-id]"/>
            <xsl:variable name="displayName" select="normalize-space(
                ($item/tei:term[@xml:lang='grc'], $item/tei:term[@xml:lang='la'], $item/tei:term[@xml:lang='en'])[normalize-space()][1]
            )"/>
            <xsl:if test="string-length($displayName) > 0">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'invocations'"/>
                    <xsl:map-entry key="'name'" select="$displayName"/>
                    <xsl:map-entry key="'sortKey'" select="$ref-id"/>
                    <xsl:map-entry key="'collectionName'"
                        select="normalize-space(ancestor::tei:TEI//tei:rs[@type='collection-name'][@xml:lang='en'])"/>
                    <xsl:map-entry key="'invNr'"
                        select="normalize-space(ancestor::tei:TEI//tei:idno[@type='inv-nr-current'][normalize-space()][1])"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- BIBLIOGRAPHY CONCORDANCE                                            -->
    <!-- ================================================================== -->

    <xsl:template match="tei:TEI" mode="extract-bibliography">
        <xsl:for-each select=".//tei:body//tei:div//tei:bibl[tei:ptr[@target != '']]">
            <xsl:variable name="target" select="string(tei:ptr/@target)"/>
            <xsl:variable name="auth" select="$bibliography-authority//tei:bibl[@xml:id = $target]"/>
            <xsl:variable name="shortCitation" select="normalize-space($auth/tei:bibl[@type='abbrev'])"/>
            <xsl:variable name="fullCitation" select="normalize-space($auth)"/>

            <xsl:choose>
                <xsl:when test="tei:citedRange">
                    <xsl:for-each select="tei:citedRange">
                        <xsl:map>
                            <xsl:map-entry key="'indexType'" select="'bibliography'"/>
                            <xsl:map-entry key="'bibRef'" select="$target"/>
                            <xsl:map-entry key="'shortCitation'" select="$shortCitation"/>
                            <xsl:map-entry key="'fullCitation'" select="$fullCitation"/>
                            <xsl:map-entry key="'citedRange'" select="normalize-space(.)"/>
                        </xsl:map>
                    </xsl:for-each>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:map>
                        <xsl:map-entry key="'indexType'" select="'bibliography'"/>
                        <xsl:map-entry key="'bibRef'" select="$target"/>
                        <xsl:map-entry key="'shortCitation'" select="$shortCitation"/>
                        <xsl:map-entry key="'fullCitation'" select="$fullCitation"/>
                        <xsl:map-entry key="'citedRange'" select="''"/>
                    </xsl:map>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- HOOKS for generic frontmatter XSL                                  -->
    <!-- ================================================================== -->

    <!-- Dispatch: calls all extraction templates -->
    <xsl:template match="tei:TEI" mode="extract-all-entities">
        <xsl:apply-templates select="." mode="extract-persons"/>
        <xsl:apply-templates select="." mode="extract-places"/>
        <xsl:apply-templates select="." mode="extract-dignities"/>
        <xsl:apply-templates select="." mode="extract-offices"/>
        <xsl:apply-templates select="." mode="extract-invocations"/>
        <xsl:apply-templates select="." mode="extract-bibliography"/>
    </xsl:template>

    <!-- Search facets -->
    <xsl:template match="tei:TEI" mode="extract-search">
        <xsl:param name="entities" as="map(*)" tunnel="yes"/>

        <!-- Derive facets from entity data -->
        <xsl:variable name="places-list" select="if (map:contains($entities, 'places')) then $entities?places?* else ()"/>
        <xsl:variable name="dignities-list" select="if (map:contains($entities, 'dignities')) then $entities?dignities?* else ()"/>
        <xsl:variable name="offices-list" select="if (map:contains($entities, 'offices')) then $entities?offices?* else ()"/>

        <xsl:variable name="personalNames" as="xs:string*"
            select="distinct-values(
                //tei:listPerson[@type='issuer']/tei:person/tei:persName[@xml:lang='en']/tei:forename
                    /normalize-space(.)[string-length(.) > 0]
            )"/>
        <xsl:variable name="familyNames" as="xs:string*"
            select="distinct-values(
                //tei:listPerson[@type='issuer']/tei:person/tei:persName[@xml:lang='en']/tei:surname
                    /normalize-space(.)[string-length(.) > 0]
            )"/>

        <xsl:variable name="genderValues" as="xs:string*">
            <xsl:for-each select="distinct-values(//tei:listPerson[@type='issuer']/tei:person/@gender)">
                <xsl:choose>
                    <xsl:when test=". = 'M'"><xsl:sequence select="'Male'"/></xsl:when>
                    <xsl:when test=". = 'F'"><xsl:sequence select="'Female'"/></xsl:when>
                    <xsl:when test=". = 'E'"><xsl:sequence select="'Eunuch'"/></xsl:when>
                    <xsl:otherwise><xsl:sequence select="string(.)"/></xsl:otherwise>
                </xsl:choose>
            </xsl:for-each>
        </xsl:variable>

        <xsl:variable name="milieuValues" as="xs:string*"
            select="distinct-values(
                //tei:listPerson[@type='issuer']/tei:person/@role
                    ! translate(., '-', ' ')
            )"/>

        <xsl:variable name="placeNamesList" as="xs:string*"
            select="distinct-values($places-list ! ?name)"/>
        <xsl:variable name="dignityNamesList" as="xs:string*"
            select="distinct-values($dignities-list ! ?name)"/>
        <xsl:variable name="civilOfficesList" as="xs:string*"
            select="distinct-values($offices-list[?officeType = 'civil'] ! ?name)"/>
        <xsl:variable name="ecclesiasticalOfficesList" as="xs:string*"
            select="distinct-values($offices-list[?officeType = 'ecclesiastical'] ! ?name)"/>
        <xsl:variable name="militaryOfficesList" as="xs:string*"
            select="distinct-values($offices-list[?officeType = 'military'] ! ?name)"/>

        <xsl:variable name="metricalValue">
            <xsl:choose>
                <xsl:when test="//tei:div[@type='edition'][@subtype='editorial']//tei:div[@type='textpart']//tei:lg">yes</xsl:when>
                <xsl:otherwise>no</xsl:otherwise>
            </xsl:choose>
        </xsl:variable>

        <xsl:variable name="monogramValues" as="xs:string*"
            select="distinct-values(
                //tei:div[@type='edition'][@subtype='editorial']
                    //tei:div[@type='textpart'][starts-with(@rend, 'monogram')]
                    /@rend ! replace(., '^monogram-?', '')
            )"/>

        <xsl:variable name="fullText" select="normalize-space(string-join(
            //tei:div[@type='edition'][@subtype='editorial']//text(), ' '
        ))"/>

        <xsl:map>
            <xsl:map-entry key="'objectType'" select="normalize-space(//tei:objectType/tei:term/tei:seg[@xml:lang='en'])"/>
            <xsl:map-entry key="'material'" select="normalize-space(//tei:material/tei:seg[@xml:lang='en'])"/>
            <xsl:map-entry key="'language'" select="string((//tei:div[@type='edition'][@subtype='editorial']//tei:div[@type='textpart']/@xml:lang)[1])"/>
            <xsl:map-entry key="'personalNames'" select="array{ $personalNames }"/>
            <xsl:map-entry key="'familyNames'" select="array{ $familyNames }"/>
            <xsl:map-entry key="'gender'" select="string($genderValues[1])"/>
            <xsl:map-entry key="'milieu'" select="array{ $milieuValues }"/>
            <xsl:map-entry key="'placeNames'" select="array{ $placeNamesList }"/>
            <xsl:map-entry key="'dignities'" select="array{ $dignityNamesList }"/>
            <xsl:map-entry key="'civilOffices'" select="array{ $civilOfficesList }"/>
            <xsl:map-entry key="'ecclesiasticalOffices'" select="array{ $ecclesiasticalOfficesList }"/>
            <xsl:map-entry key="'militaryOffices'" select="array{ $militaryOfficesList }"/>
            <xsl:map-entry key="'metrical'" select="string($metricalValue)"/>
            <xsl:map-entry key="'monogram'" select="if (count($monogramValues) > 0)
                then string-join($monogramValues, ', ') else ''"/>
            <xsl:map-entry key="'collection'" select="normalize-space(//tei:rs[@type='collection-name'][@xml:lang='en'])"/>
            <xsl:map-entry key="'dateNotBefore'" select="string(//tei:origDate/@notBefore)"/>
            <xsl:map-entry key="'dateNotAfter'" select="string(//tei:origDate/@notAfter)"/>
            <xsl:map-entry key="'fullText'" select="$fullText"/>
        </xsl:map>
    </xsl:template>

    <!-- Project-specific metadata -->
    <xsl:template match="tei:TEI" mode="extract-metadata">
        <xsl:map>
            <xsl:map-entry key="'tags'" select="'seals'"/>
            <xsl:map-entry key="'permalink'" select="concat($language, '/seals/', $filename, '.html')"/>
            <xsl:map-entry key="'category'"
                select="string-join(//tei:msDesc/tei:msContents/tei:summary[@n='whole']/tei:seg)"/>
        </xsl:map>
    </xsl:template>

</xsl:stylesheet>
