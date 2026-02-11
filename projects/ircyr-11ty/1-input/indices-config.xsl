<?xml version="1.0" encoding="UTF-8"?>
<!--
    Entity Indices Configuration

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
    xmlns:efes="http://efes.info/functions"
    xmlns:map="http://www.w3.org/2005/xpath-functions/map"
    exclude-result-prefixes="xs efes map">

    <!-- ================================================================== -->
    <!-- INDEX: persons                                                      -->
    <!-- ================================================================== -->
    <idx:index id="personal_names" title="Personal Names" order="1">
        <idx:description>Index of personal names attested in the inscriptions.</idx:description>
        <idx:columns>
            <idx:column key="name">Name</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate partially or completely restored text.</idx:p>
        </idx:notes>
    </idx:index>

    <xsl:template match="tei:TEI" mode="extract-personal_names">
        <xsl:for-each select=".//tei:name[@nymRef][ancestor::tei:persName[@type='attested']][ancestor::tei:div/@type='edition']">
            <!-- Normalize sigma forms to match original EFES grouping -->
            <xsl:variable name="normalizedName" select="replace(
                translate(normalize-unicode(@nymRef, 'NFD'), 'Ϲϲ', 'Σσ'),
                'σ(\p{P}|\s|$)', 'ς$1')"/>

            <xsl:map>
                <xsl:map-entry key="'indexType'" select="'personal_names'"/>
                <xsl:map-entry key="'name'" select="$normalizedName"/>
                <xsl:map-entry key="'sortKey'" select="lower-case($normalizedName)"/>
                <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
            </xsl:map>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: persons (People)                                             -->
    <!-- ================================================================== -->
    <idx:index id="persons" title="People" order="10">
        <idx:description>Index of people attested in the inscriptions, showing genealogical relationships.</idx:description>
        <idx:columns>
            <idx:column key="name">Person</idx:column>
            <idx:column key="externalResource" type="link">LGPN</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate partially or completely restored text.</idx:p>
        </idx:notes>
    </idx:index>

    <!-- Helper: get own names of a persName (not in nested persNames) -->
    <xsl:function name="efes:own-names" as="xs:string">
        <xsl:param name="person" as="element()"/>
        <xsl:sequence select="string-join(
            $person//tei:name[@nymRef][ancestor::tei:persName[@type='attested'][1] is $person]/@nymRef,
            ' ')"/>
    </xsl:function>

    <!-- Helper: build descendant genealogical chain recursively -->
    <xsl:function name="efes:descendant-chain" as="xs:string?">
        <xsl:param name="person" as="element()"/>
        <xsl:variable name="child" select="$person/tei:persName[@type='attested']
            [descendant::tei:name[@nymRef]][1]"/>
        <xsl:if test="$child">
            <xsl:variable name="deeper" select="efes:descendant-chain($child)"/>
            <xsl:sequence select="string-join((efes:own-names($child), $deeper), ' child of ')"/>
        </xsl:if>
    </xsl:function>

    <!-- Helper: place qualifiers -->
    <xsl:function name="efes:place-qualifiers" as="xs:string?">
        <xsl:param name="person" as="element()"/>
        <xsl:variable name="from" select="$person/tei:placeName[not(@type='ethnic')][@nymRef]/@nymRef"/>
        <xsl:variable name="ethnic" select="$person/tei:placeName[@type='ethnic']/@nymRef"/>
        <xsl:sequence select="string-join((
            if (exists($from)) then concat(' from ', string-join($from, ' and ')) else (),
            if (exists($ethnic)) then concat(' ', string-join($ethnic, ' ')) else ()
        ), '')"/>
    </xsl:function>

    <xsl:template match="tei:TEI" mode="extract-persons">
        <xsl:for-each select=".//tei:persName[@type='attested'][descendant::tei:name[@nymRef]][ancestor::tei:div/@type='edition']">
            <xsl:variable name="level" select="count(ancestor::tei:persName[@type='attested'])"/>
            <xsl:variable name="ownNames" select="efes:own-names(.)"/>
            <xsl:variable name="chain" select="efes:descendant-chain(.)"/>

            <!-- Build display name with genealogical context -->
            <xsl:variable name="displayName">
                <xsl:value-of select="$ownNames"/>
                <!-- Descendant chain (child of ...) -->
                <xsl:if test="$chain">
                    <xsl:choose>
                        <xsl:when test="$level = 0 and descendant::tei:w[@lemma='ἀπελεύθερος' or @lemma='libertus']">
                            <xsl:text> freedman of </xsl:text>
                        </xsl:when>
                        <xsl:otherwise><xsl:text> child of </xsl:text></xsl:otherwise>
                    </xsl:choose>
                    <xsl:value-of select="$chain"/>
                </xsl:if>
                <!-- For ancestors (level 1+): add "parent of" context back to the enclosing person -->
                <xsl:if test="$level > 0">
                    <xsl:variable name="siblingNames" select="(preceding-sibling::tei:name[@nymRef]|following-sibling::tei:name[@nymRef])/@nymRef"/>
                    <xsl:choose>
                        <xsl:when test="preceding-sibling::tei:w[@lemma='ἀπελεύθερος' or @lemma='libertus']
                                     or following-sibling::tei:w[@lemma='ἀπελεύθερος' or @lemma='libertus']">
                            <xsl:text> former master of </xsl:text>
                        </xsl:when>
                        <xsl:otherwise><xsl:text> parent of </xsl:text></xsl:otherwise>
                    </xsl:choose>
                    <xsl:value-of select="string-join($siblingNames, ' ')"/>
                </xsl:if>
                <xsl:value-of select="efes:place-qualifiers(.)"/>
            </xsl:variable>

            <xsl:map>
                <xsl:map-entry key="'indexType'" select="'persons'"/>
                <xsl:map-entry key="'name'" select="normalize-space($displayName)"/>
                <xsl:map-entry key="'sortKey'" select="lower-case(normalize-space($displayName))"/>
                <xsl:map-entry key="'externalResource'" select="string(@key)"/>
                <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
            </xsl:map>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: abbreviations                                                -->
    <!-- ================================================================== -->
    <idx:index id="abbreviations" title="Abbreviations" order="2">
        <idx:description>Index of abbreviations found in the edition text.</idx:description>
        <idx:sort>
            <idx:key field="abbr"/>
            <idx:key field="expansion"/>
        </idx:sort>
        <idx:columns>
            <idx:column key="abbr">Abbreviation</idx:column>
            <idx:column key="expansion">Expansion</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate partially or completely restored text.</idx:p>
        </idx:notes>
    </idx:index>

    <xsl:template match="tei:TEI" mode="extract-abbreviations">
        <!-- Select expansions within edition div, not nested in abbr -->
        <xsl:for-each select=".//tei:expan[ancestor::tei:div/@type='edition'][not(parent::tei:abbr)]">
            <xsl:variable name="abbr" select="normalize-space(string-join(.//tei:abbr//text(), ''))"/>
            <xsl:variable name="expansion" select="normalize-space(string-join(.//text()[not(ancestor::tei:am)], ''))"/>
            <xsl:if test="string-length($abbr) > 0">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'abbreviations'"/>
                    <xsl:map-entry key="'abbr'" select="$abbr"/>
                    <xsl:map-entry key="'expansion'" select="$expansion"/>
                    <!-- sortKey includes both abbr and expansion so different expansions are separate entries -->
                    <xsl:map-entry key="'sortKey'" select="lower-case(concat($abbr, '|', $expansion))"/>
                    <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                    <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
                    <xsl:map-entry key="'language'" select="string(ancestor-or-self::*[@xml:lang][1]/@xml:lang)"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: findspots                                                    -->
    <!-- ================================================================== -->
    <idx:index id="findspots" title="Findspots" order="3">
        <idx:description>Index of findspots where inscriptions were discovered.</idx:description>
        <idx:sort>
            <idx:key field="upperLevel"/>
            <idx:key field="intermediateLevel"/>
            <idx:key field="lowerLevel"/>
        </idx:sort>
        <idx:columns>
            <idx:column key="upperLevel">Findspots (upper level)</idx:column>
            <idx:column key="intermediateLevel">Findspots (intermediate level)</idx:column>
            <idx:column key="lowerLevel">Findspots (lower level)</idx:column>
            <idx:column key="externalResource" type="link">HGL</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
    </idx:index>

    <xsl:template match="tei:TEI" mode="extract-findspots">
        <xsl:for-each select=".//tei:provenance[@type='found']//tei:placeName[@type='ancientFindspot'][1]">
            <xsl:variable name="intermediate" select="following-sibling::tei:placeName[not(@type)][1]"/>
            <xsl:variable name="monuList" select="following-sibling::tei:placeName[@type='monuList']"/>

            <xsl:variable name="upperLevel" select="normalize-space(.)"/>
            <xsl:variable name="intermediateLevel" select="(normalize-space($intermediate)[. != ''], '-')[1]"/>
            <xsl:variable name="lowerLevel" select="(string-join($monuList/normalize-space(.), '; ')[. != ''], '-')[1]"/>

            <xsl:variable name="sortKey" select="lower-case(string-join((
                string(@ref), string($intermediate/@ref), $monuList/string(@ref)
            ), '-'))"/>

            <!-- External resource: cascade monuList -> intermediate -> upper -->
            <xsl:variable name="externalResource" select="string(($monuList[1]/@ref, $intermediate/@ref, @ref)[1])"/>

            <xsl:if test="$upperLevel != ''">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'findspots'"/>
                    <xsl:map-entry key="'upperLevel'" select="$upperLevel"/>
                    <xsl:map-entry key="'intermediateLevel'" select="$intermediateLevel"/>
                    <xsl:map-entry key="'lowerLevel'" select="$lowerLevel"/>
                    <xsl:map-entry key="'sortKey'" select="$sortKey"/>
                    <xsl:map-entry key="'externalResource'" select="$externalResource"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: death (Age at Death)                                         -->
    <!-- ================================================================== -->
    <idx:index id="death" title="Age at Death" order="4">
        <idx:description>Index of ages at death recorded in the inscriptions.</idx:description>
        <idx:columns>
            <idx:column key="age">Age</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate partially or completely restored text.</idx:p>
        </idx:notes>
    </idx:index>

    <xsl:template match="tei:TEI" mode="extract-death">
        <xsl:for-each select=".//tei:date[@type='life-span'][@dur][ancestor::tei:div/@type='edition']">
            <xsl:variable name="d" select="xs:duration(@dur)"/>
            <xsl:variable name="years" select="years-from-duration($d)"/>
            <xsl:variable name="months" select="months-from-duration($d)"/>
            <xsl:variable name="days" select="days-from-duration($d)"/>
            <xsl:variable name="hours" select="hours-from-duration($d)"/>

            <!-- Build human-readable age string with pluralization -->
            <xsl:variable name="age" select="string-join((
                if ($years > 0) then concat($years, ' year', 's'[$years > 1]) else (),
                if ($months > 0) then concat($months, ' month', 's'[$months > 1]) else (),
                if ($days > 0) then concat($days, ' day', 's'[$days > 1]) else (),
                if ($hours > 0) then concat($hours, ' hour', 's'[$hours > 1]) else ()
            ), ' ')"/>

            <!-- Padded numeric sort key for proper ordering -->
            <xsl:variable name="sortKey" select="concat(
                format-number($years, '0000'), format-number($months, '00'),
                format-number($days, '00'), format-number($hours, '00'))"/>

            <xsl:if test="$age != ''">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'death'"/>
                    <xsl:map-entry key="'age'" select="$age"/>
                    <xsl:map-entry key="'sortKey'" select="$sortKey"/>
                    <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                    <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: divine_beings (Divine Beings)                                -->
    <!-- ================================================================== -->
    <idx:index id="divine_beings" title="Divine Beings" order="5">
        <idx:description>Index of divine beings and deities mentioned in the inscriptions.</idx:description>
        <idx:columns>
            <idx:column key="name">Divine Being</idx:column>
            <idx:column key="externalResource" type="link">Wikidata</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate partially or completely restored text.</idx:p>
        </idx:notes>
    </idx:index>

    <!-- Load divine authority file (path relative to this XSL file) -->
    <xsl:variable name="divine-authority" select="document('authority/divine.xml')"/>

    <xsl:template match="tei:TEI" mode="extract-divine_beings">
        <xsl:for-each select=".//tei:persName[@type='divine'][@key]">
            <xsl:variable name="key" select="string(@key)"/>
            <xsl:variable name="auth" select="$divine-authority//tei:person[@xml:id = $key]"/>
            <xsl:variable name="displayName" select="(
                string-join($auth/tei:persName[position() le 2], ' / ')[. != ''],
                normalize-space(.)[. != ''],
                $key
            )[1]"/>

            <xsl:map>
                <xsl:map-entry key="'indexType'" select="'divine_beings'"/>
                <xsl:map-entry key="'name'" select="$displayName"/>
                <xsl:map-entry key="'sortKey'" select="lower-case($key)"/>
                <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
                <xsl:map-entry key="'externalResource'" select="string($auth/tei:idno[@type='wikidata'])"/>
            </xsl:map>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: emperors (Emperors and Imperial Family)                      -->
    <!-- ================================================================== -->
    <idx:index id="emperors" title="Emperors and Imperial Family" order="6">
        <idx:description>Index of emperors and members of the imperial family mentioned in the inscriptions.</idx:description>
        <idx:columns>
            <idx:column key="name">Person</idx:column>
            <idx:column key="externalResource" type="link">Wikidata</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate partially or completely restored text.</idx:p>
        </idx:notes>
    </idx:index>

    <!-- Load emperors authority file -->
    <xsl:variable name="emperors-authority" select="document('authority/emperors.xml')"/>

    <xsl:template match="tei:TEI" mode="extract-emperors">
        <xsl:for-each select=".//tei:persName[@type='emperor'][@key]">
            <xsl:variable name="el" select="."/>
            <xsl:for-each select="tokenize(normalize-space(@key), '\s+')[. != '']">
                <xsl:variable name="key" select="."/>
                <xsl:variable name="auth" select="$emperors-authority//tei:person[@xml:id = $key]"/>
                <xsl:variable name="displayName" select="(
                    concat($auth/tei:persName, (' (' || $auth/tei:floruit || ')')[normalize-space($auth/tei:floruit)])[normalize-space($auth)],
                    $key
                )[1]"/>

                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'emperors'"/>
                    <xsl:map-entry key="'name'" select="$displayName"/>
                    <xsl:map-entry key="'sortKey'" select="format-number(($auth/@n, 999)[1], '000')"/>
                    <xsl:map-entry key="'isRestored'" select="exists($el//tei:supplied) or exists($el/ancestor::tei:supplied)"/>
                    <xsl:map-entry key="'line'" select="string($el/preceding::tei:lb[1]/@n)"/>
                    <xsl:map-entry key="'externalResource'" select="string($auth/tei:idno[@type='wikidata'])"/>
                </xsl:map>
            </xsl:for-each>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: fragments (Fragments of Text)                                -->
    <!-- ================================================================== -->
    <idx:index id="fragments" title="Fragments of Text" order="7">
        <idx:description>Index of incomplete or fragmentary text in the inscriptions.</idx:description>
        <idx:columns>
            <idx:column key="fragment">Fragment</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate partially or completely restored text.</idx:p>
        </idx:notes>
    </idx:index>

    <xsl:template match="tei:TEI" mode="extract-fragments">
        <!-- Select orig elements (not in del or choice) and partial words -->
        <xsl:for-each select=".//tei:orig[ancestor::tei:div/@type='edition'][not(parent::tei:del or parent::tei:choice)] | .//tei:w[@part != 'N'][ancestor::tei:div/@type='edition']">
            <!-- Normalize the text: join all text nodes, normalize unicode, convert lunar sigma -->
            <xsl:variable name="rawText" select="normalize-space(normalize-unicode(string-join(.//text(), '')))"/>
            <!-- Convert lunar sigma (Ϲϲ) to regular sigma (Σσ) -->
            <xsl:variable name="fragment" select="translate($rawText, 'Ϲϲ', 'Σσ')"/>

            <xsl:if test="string-length($fragment) > 0">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'fragments'"/>
                    <xsl:map-entry key="'fragment'" select="$fragment"/>
                    <xsl:map-entry key="'sortKey'" select="lower-case($fragment)"/>
                    <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                    <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: numerals (Numerals)                                          -->
    <!-- ================================================================== -->
    <idx:index id="numerals" title="Numerals" order="8">
        <idx:description>Index of numerals found in the inscriptions.</idx:description>
        <idx:columns>
            <idx:column key="numeral">Numeral</idx:column>
            <idx:column key="value">Value</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate partially or completely restored text.</idx:p>
        </idx:notes>
    </idx:index>

    <xsl:template match="tei:TEI" mode="extract-numerals">
        <xsl:for-each select=".//tei:num[@value][ancestor::tei:div/@type='edition']">
            <xsl:variable name="numeral" select="string-join(.//text(), '')"/>
            <xsl:variable name="value" select="string(@value)"/>

            <xsl:if test="$numeral != ''">
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'numerals'"/>
                    <xsl:map-entry key="'numeral'" select="$numeral"/>
                    <xsl:map-entry key="'value'" select="$value"/>
                    <!-- sortKey groups by numeral+value (matching EFES), with numeric prefix for ordering -->
                    <xsl:map-entry key="'sortKey'" select="concat(format-number(xs:integer($value), '000000000'), '##', $numeral)"/>
                    <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                    <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
                </xsl:map>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: months (Months)                                              -->
    <!-- ================================================================== -->
    <idx:index id="months" title="Months" order="9">
        <idx:description>Index of months mentioned in the inscriptions.</idx:description>
        <idx:groupBy field="language">
            <idx:group value="la" label="Latin"/>
            <idx:group value="grc" label="Greek"/>
        </idx:groupBy>
        <idx:columns>
            <idx:column key="name">Name</idx:column>
            <idx:column key="externalResource" type="link">Wikidata</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate partially or completely restored text.</idx:p>
        </idx:notes>
    </idx:index>

    <!-- Load months authority file -->
    <xsl:variable name="months-authority" select="document('authority/months.xml')"/>

    <xsl:template match="tei:TEI" mode="extract-months">
        <xsl:for-each select=".//tei:rs[@type='month'][@key][ancestor::tei:div/@type='edition']">
            <xsl:variable name="key" select="string(@key)"/>
            <xsl:variable name="authority-entry" select="$months-authority//tei:item[@xml:id = $key]"/>
            <xsl:variable name="lang" select="ancestor-or-self::*[@xml:lang][1]/@xml:lang"/>

            <!-- Build name with optional date -->
            <xsl:variable name="name">
                <xsl:choose>
                    <xsl:when test="$authority-entry/tei:term[1]">
                        <xsl:value-of select="$authority-entry/tei:term[1]"/>
                    </xsl:when>
                    <xsl:otherwise>
                        <xsl:value-of select="$key"/>
                    </xsl:otherwise>
                </xsl:choose>
                <xsl:if test="$authority-entry/tei:date">
                    <xsl:text> (</xsl:text>
                    <xsl:value-of select="$authority-entry/tei:date"/>
                    <xsl:text>)</xsl:text>
                </xsl:if>
            </xsl:variable>

            <xsl:map>
                <xsl:map-entry key="'indexType'" select="'months'"/>
                <xsl:map-entry key="'name'" select="$name"/>
                <xsl:map-entry key="'language'" select="string($lang)"/>
                <xsl:map-entry key="'sortKey'" select="string($authority-entry/@n)"/>
                <xsl:map-entry key="'externalResource'" select="string($authority-entry/tei:idno[@type='wikidata'])"/>
                <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
            </xsl:map>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: mentioned_places (Places)                                    -->
    <!-- ================================================================== -->
    <idx:index id="mentioned_places" title="Places" order="11">
        <idx:description>Index of places mentioned in the inscriptions.</idx:description>
        <idx:sort>
            <idx:key field="name"/>
            <idx:key field="attestedForm"/>
        </idx:sort>
        <idx:columns>
            <idx:column key="name">Place</idx:column>
            <idx:column key="attestedForm">Attested form</idx:column>
            <idx:column key="placeType">Toponym / Ethnic</idx:column>
            <idx:column key="externalResource" type="link">External resource</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
        <idx:notes>
            <idx:p>Square brackets [ ] indicate that the name/word is partially or completely restored in this inscription.</idx:p>
        </idx:notes>
    </idx:index>

    <!-- Load places authority file -->
    <xsl:variable name="places-authority" select="document('authority/places.xml')"/>

    <xsl:template match="tei:TEI" mode="extract-mentioned_places">
        <xsl:for-each select=".//tei:div[@type='edition']//tei:placeName[@ref][@nymRef]">
            <xsl:variable name="ref-id" select="normalize-unicode(substring-after(@ref, '#'), 'NFD')"/>
            <xsl:variable name="nymRef-id" select="normalize-unicode(substring-after(@nymRef, '#'), 'NFD')"/>
            <xsl:variable name="auth" select="$places-authority//tei:place[@xml:id = $ref-id]"/>

            <!-- Display name from authority: prefer en, then la, then first -->
            <xsl:variable name="displayName" select="(
                $auth//tei:placeName[@xml:lang='en'][1][normalize-space()],
                $auth//tei:placeName[@xml:lang='la'][1][normalize-space()],
                $auth//tei:placeName[1][normalize-space()],
                $ref-id
            )[1]"/>

            <!-- Attested form from @nymRef -->
            <xsl:variable name="attestedForm" select="$nymRef-id"/>

            <!-- Toponym or Ethnic -->
            <xsl:variable name="placeType" select="if (@type = 'ethnic') then 'Ethnic' else 'Toponym'"/>

            <!-- External resources: all idno elements from authority -->
            <xsl:variable name="externalResource" select="string-join($auth/tei:idno, ' ')"/>

            <!-- Group key matches original: ref + nymRef + type -->
            <xsl:variable name="sortKey" select="lower-case(concat($ref-id, '-', $nymRef-id, '-', @type))"/>

            <xsl:map>
                <xsl:map-entry key="'indexType'" select="'mentioned_places'"/>
                <xsl:map-entry key="'name'" select="string($displayName)"/>
                <xsl:map-entry key="'attestedForm'" select="$attestedForm"/>
                <xsl:map-entry key="'placeType'" select="$placeType"/>
                <xsl:map-entry key="'externalResource'" select="$externalResource"/>
                <xsl:map-entry key="'sortKey'" select="$sortKey"/>
                <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
            </xsl:map>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- INDEX: symbols (Symbols)                                            -->
    <!-- ================================================================== -->
    <idx:index id="symbols" title="Symbols" order="12">
        <idx:description>Index of symbols found in the inscriptions.</idx:description>
        <idx:columns>
            <idx:column key="name">Symbol</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
    </idx:index>

    <!-- Load symbols authority file -->
    <xsl:variable name="symbols-authority" select="document('authority/symbols.xml')"/>

    <xsl:template match="tei:TEI" mode="extract-symbols">
        <xsl:for-each select=".//tei:g[@ref][ancestor::tei:div/@type='edition']">
            <xsl:variable name="ref-id" select="substring-after(@ref, '#')"/>
            <xsl:variable name="glyph" select="$symbols-authority//tei:glyph[@xml:id = $ref-id]"/>

            <!-- Display name: text-display, optionally with (glyph-display) -->
            <xsl:variable name="textDisplay" select="$glyph/tei:charProp[tei:localName = 'text-display']/tei:value"/>
            <xsl:variable name="glyphDisplay" select="$glyph/tei:charProp[tei:localName = 'glyph-display']/tei:value"/>
            <xsl:variable name="displayName" select="concat(
                ($textDisplay, $ref-id)[1],
                if (normalize-space($glyphDisplay)) then concat(' (', $glyphDisplay, ')') else ''
            )"/>

            <xsl:map>
                <xsl:map-entry key="'indexType'" select="'symbols'"/>
                <xsl:map-entry key="'name'" select="$displayName"/>
                <xsl:map-entry key="'sortKey'" select="lower-case(($textDisplay, $ref-id)[1])"/>
                <xsl:map-entry key="'isRestored'" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
                <xsl:map-entry key="'line'" select="string(preceding::tei:lb[1]/@n)"/>
            </xsl:map>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- BIBLIOGRAPHY CONCORDANCE                                            -->
    <!-- ================================================================== -->

    <!-- Load bibliography authority file -->
    <xsl:variable name="bibliography-authority" select="document('authority/bibliography.xml')"/>

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
    <!-- INDEX: words (Words / Lemmata)                                      -->
    <!-- ================================================================== -->
    <idx:index id="words" title="Words" order="13">
        <idx:description>Index of words (lemmata) found in the inscriptions.</idx:description>
        <idx:columns>
            <idx:column key="name">Lemma</idx:column>
            <idx:column key="language">Language code</idx:column>
            <idx:column key="references" type="references">References</idx:column>
        </idx:columns>
    </idx:index>

    <xsl:template match="tei:TEI" mode="extract-words">
        <xsl:for-each select=".//tei:w[@lemma][ancestor::tei:div/@type='edition']">
            <xsl:variable name="el" select="."/>
            <xsl:variable name="lang" select="string(ancestor-or-self::*[@xml:lang][1]/@xml:lang)"/>
            <xsl:variable name="isRestored" select="exists(.//tei:supplied) or exists(ancestor::tei:supplied)"/>
            <xsl:variable name="line" select="string(preceding::tei:lb[1]/@n)"/>

            <!-- Tokenize @lemma: a single w element may carry multiple lemmata -->
            <xsl:for-each select="tokenize(normalize-space(@lemma), '\s+')[. != '']">
                <xsl:variable name="lemma" select="normalize-unicode(., 'NFD')"/>
                <xsl:map>
                    <xsl:map-entry key="'indexType'" select="'words'"/>
                    <xsl:map-entry key="'name'" select="$lemma"/>
                    <xsl:map-entry key="'language'" select="$lang"/>
                    <xsl:map-entry key="'sortKey'" select="lower-case($lemma)"/>
                    <xsl:map-entry key="'isRestored'" select="$isRestored"/>
                    <xsl:map-entry key="'line'" select="$line"/>
                </xsl:map>
            </xsl:for-each>
        </xsl:for-each>
    </xsl:template>

    <!-- ================================================================== -->
    <!-- HOOKS for generic frontmatter XSL                                  -->
    <!-- ================================================================== -->

    <!-- Dispatch: calls all extraction templates -->
    <xsl:template match="tei:TEI" mode="extract-all-entities">
        <xsl:apply-templates select="." mode="extract-personal_names"/>
        <xsl:apply-templates select="." mode="extract-persons"/>
        <xsl:apply-templates select="." mode="extract-abbreviations"/>
        <xsl:apply-templates select="." mode="extract-findspots"/>
        <xsl:apply-templates select="." mode="extract-death"/>
        <xsl:apply-templates select="." mode="extract-divine_beings"/>
        <xsl:apply-templates select="." mode="extract-emperors"/>
        <xsl:apply-templates select="." mode="extract-fragments"/>
        <xsl:apply-templates select="." mode="extract-months"/>
        <xsl:apply-templates select="." mode="extract-numerals"/>
        <xsl:apply-templates select="." mode="extract-mentioned_places"/>
        <xsl:apply-templates select="." mode="extract-symbols"/>
        <xsl:apply-templates select="." mode="extract-words"/>
        <xsl:apply-templates select="." mode="extract-bibliography"/>
    </xsl:template>

    <!-- Search facets -->
    <xsl:template match="tei:TEI" mode="extract-search">
        <xsl:map>
            <xsl:map-entry key="'material'" select="normalize-space(string-join(.//tei:support//tei:material, ', '))"/>
            <xsl:map-entry key="'objectType'" select="normalize-space(string-join(.//tei:support//tei:objectType, ', '))"/>
            <xsl:map-entry key="'textType'" select="array{ .//tei:titleStmt//tei:rs[@type='textType']/normalize-space(.) }"/>
            <xsl:map-entry key="'repository'" select="normalize-space(.//tei:msIdentifier/tei:repository)"/>
            <xsl:map-entry key="'dateNotBefore'" select="string(.//tei:origDate/@notBefore)"/>
            <xsl:map-entry key="'dateNotAfter'" select="string(.//tei:origDate/@notAfter)"/>
            <xsl:map-entry key="'language'" select="string(.//tei:div[@type='edition']/@xml:lang)"/>
            <xsl:map-entry key="'fullText'" select="normalize-space(string-join(.//tei:div[@type='edition']//text(), ' '))"/>
        </xsl:map>
    </xsl:template>

    <!-- Project-specific metadata -->
    <xsl:template match="tei:TEI" mode="extract-metadata">
        <xsl:map>
            <xsl:map-entry key="'tags'" select="'inscriptions'"/>
            <xsl:map-entry key="'permalink'" select="concat($language, '/inscriptions/', $filename, '.html')"/>
            <xsl:map-entry key="'findspot'" select="string-join(.//tei:placeName[@type='ancientFindspot'], ', ')"/>
        </xsl:map>
    </xsl:template>

</xsl:stylesheet>
