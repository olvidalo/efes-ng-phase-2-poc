/**
 * EFES-NG Faceted Search
 *
 * Client-side full-text search with faceted filtering using FlexSearch.
 * Expects FlexSearch to be loaded globally before this script runs.
 *
 * Usage:
 *   <script src="flexsearch.bundle.min.js"></script>
 *   <script src="/assets/js/search.js"></script>
 *   <script>
 *     EfesSearch.init({
 *       searchDataUrl: '/search-data',
 *       facets: {
 *         material:   { label: 'Material' },
 *         objectType: { label: 'Object Type' },
 *       },
 *       expandedFacets: ['material', 'objectType'],
 *       resultUrl: (doc) => '/en/inscriptions/' + doc.documentId + '.html',
 *       resultDetails: ['origDate', 'findspot', 'material'],
 *     });
 *   </script>
 */
const EfesSearch = (function() {

    // --- State ---
    let searchIndex = null;
    let allDocuments = [];
    let facetData = {};
    let activeFilters = {};
    let activeDateRange = { from: null, to: null };
    let searchQuery = '';

    // --- Config (set by init) ---
    let config = {};
    let facetConfig = {};
    let expandedByDefault = new Set();

    // --- DOM refs ---
    let els = {};

    function init(userConfig) {
        config = Object.assign({
            searchDataUrl: '/search-data',
            facets: {},
            expandedFacets: [],
            resultUrl: (doc) => doc.documentId + '.html',
            resultDetails: ['origDate', 'findspot', 'material'],
        }, userConfig);

        facetConfig = config.facets;
        expandedByDefault = new Set(config.expandedFacets);

        els = {
            searchInput:    document.getElementById('search-input'),
            searchButton:   document.getElementById('search-button'),
            progressDiv:    document.getElementById('search-progress'),
            progressText:   document.getElementById('progress-text'),
            resultsDiv:     document.getElementById('search-results'),
            statusEl:       document.getElementById('search-status'),
            resultsList:    document.getElementById('results-list'),
            facetsContainer: document.getElementById('facets-container'),
            activeFiltersDiv: document.getElementById('active-filters'),
            dateFrom:       document.getElementById('date-from'),
            dateTo:         document.getElementById('date-to'),
            clearDates:     document.getElementById('clear-dates'),
            clearAllBtn:    document.getElementById('clear-all-filters'),
        };

        loadIndex();
    }

    // --- Index loading ---

    async function loadIndex() {
        try {
            els.progressText.textContent = 'Loading search index...';
            const base = config.searchDataUrl;

            const [configRes, facetsRes, docsRes, indexListRes] = await Promise.all([
                fetch(base + '/config.json'),
                fetch(base + '/facets.json'),
                fetch(base + '/documents.json'),
                fetch(base + '/index.json')
            ]);

            const indexConfig = await configRes.json();
            facetData = await facetsRes.json();
            allDocuments = await docsRes.json();
            const indexFiles = await indexListRes.json();

            els.progressText.textContent =
                'Loading ' + indexFiles.length + ' index segments (' + allDocuments.length + ' documents)...';

            searchIndex = new FlexSearch.Document(indexConfig);

            for (const file of indexFiles) {
                const res = await fetch(base + '/' + file);
                const data = await res.text();
                searchIndex.import(file, data);
            }

            els.progressText.textContent = 'Index loaded: ' + allDocuments.length + ' documents.';

            buildFacets();
            setupEventListeners();

            els.progressDiv.style.display = 'none';
            els.resultsDiv.style.display = 'block';

            performFilteredSearch();

        } catch (err) {
            els.progressText.textContent = 'Error loading search index: ' + err.message;
            console.error('Search init error:', err);
        }
    }

    // --- Facet UI ---

    function buildFacets() {
        els.facetsContainer.innerHTML = '';
        for (const [field, fc] of Object.entries(facetConfig)) {
            const values = facetData[field];
            if (!values || Object.keys(values).length === 0) continue;

            activeFilters[field] = new Set();
            const startCollapsed = !expandedByDefault.has(field);

            const section = document.createElement('div');
            section.className = 'facet-section';

            const header = document.createElement('div');
            header.className = 'facet-header' + (startCollapsed ? ' collapsed' : '');
            header.textContent = fc.label;
            header.addEventListener('click', function() {
                this.nextElementSibling.classList.toggle('collapsed');
                this.classList.toggle('collapsed');
            });

            const content = document.createElement('div');
            content.className = 'facet-content' + (startCollapsed ? ' collapsed' : '');
            content.id = 'facet-' + field;

            const sorted = Object.entries(values).sort((a, b) => b[1] - a[1]);

            for (const [value, count] of sorted) {
                const item = document.createElement('label');
                item.className = 'facet-item';
                item.setAttribute('data-value', value);

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = value;
                cb.dataset.field = field;
                cb.addEventListener('change', onFacetChange);

                const text = document.createElement('span');
                text.className = 'facet-label';
                text.textContent = value;

                const countSpan = document.createElement('span');
                countSpan.className = 'facet-count';
                countSpan.textContent = '(' + count + ')';

                item.appendChild(cb);
                item.appendChild(text);
                item.appendChild(countSpan);
                content.appendChild(item);
            }

            section.appendChild(header);
            section.appendChild(content);
            els.facetsContainer.appendChild(section);
        }
    }

    // --- Event handling ---

    function setupEventListeners() {
        els.searchInput.addEventListener('input', debounce(performFilteredSearch, 300));
        els.searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') performFilteredSearch();
        });
        els.searchButton.addEventListener('click', performFilteredSearch);

        els.dateFrom.addEventListener('change', performFilteredSearch);
        els.dateTo.addEventListener('change', performFilteredSearch);
        els.clearDates.addEventListener('click', function() {
            els.dateFrom.value = '';
            els.dateTo.value = '';
            activeDateRange = { from: null, to: null };
            performFilteredSearch();
        });

        els.clearAllBtn.addEventListener('click', clearAllFilters);
    }

    function onFacetChange(e) {
        const field = e.target.dataset.field;
        const value = e.target.value;
        if (e.target.checked) {
            activeFilters[field].add(value);
        } else {
            activeFilters[field].delete(value);
        }
        performFilteredSearch();
    }

    // --- Search & filter ---

    function performFilteredSearch() {
        searchQuery = els.searchInput.value.trim();
        activeDateRange.from = els.dateFrom.value ? parseInt(els.dateFrom.value, 10) : null;
        activeDateRange.to = els.dateTo.value ? parseInt(els.dateTo.value, 10) : null;

        let resultIds = null;

        if (searchQuery && searchIndex) {
            const searchResults = searchIndex.search(searchQuery);
            const idSet = new Set();
            for (const fieldResult of searchResults) {
                for (const item of fieldResult.result) {
                    idSet.add(String(item));
                }
            }
            resultIds = idSet;
        }

        let candidates;
        if (resultIds !== null) {
            candidates = allDocuments.filter(doc => resultIds.has(String(doc.documentId)));
        } else {
            candidates = allDocuments;
        }

        candidates = applyFacetFilters(candidates);
        candidates = applyDateFilter(candidates);

        updateFacetCounts(candidates);
        displayResults(candidates);
        displayActiveFilters();
    }

    function applyFacetFilters(docs) {
        for (const [field, selectedValues] of Object.entries(activeFilters)) {
            if (selectedValues.size === 0) continue;
            docs = docs.filter(doc => {
                const docValue = doc[field];
                if (Array.isArray(docValue)) {
                    return [...selectedValues].some(v => docValue.includes(v));
                }
                return selectedValues.has(String(docValue || ''));
            });
        }
        return docs;
    }

    function applyDateFilter(docs) {
        if (activeDateRange.from === null && activeDateRange.to === null) return docs;
        return docs.filter(doc => {
            const notBefore = doc.dateNotBefore;
            const notAfter = doc.dateNotAfter;
            if (notBefore === null && notAfter === null) return false;
            const docStart = notBefore !== null ? notBefore : notAfter;
            const docEnd = notAfter !== null ? notAfter : notBefore;
            if (activeDateRange.from !== null && docEnd < activeDateRange.from) return false;
            if (activeDateRange.to !== null && docStart > activeDateRange.to) return false;
            return true;
        });
    }

    // --- UI updates ---

    function updateFacetCounts(filteredDocs) {
        for (const [field] of Object.entries(facetConfig)) {
            const counts = {};
            for (const doc of filteredDocs) {
                const val = doc[field];
                if (Array.isArray(val)) {
                    for (const v of val) {
                        if (v) counts[v] = (counts[v] || 0) + 1;
                    }
                } else if (val) {
                    counts[val] = (counts[val] || 0) + 1;
                }
            }

            const container = document.getElementById('facet-' + field);
            if (!container) continue;

            container.querySelectorAll('.facet-item').forEach(item => {
                const value = item.getAttribute('data-value');
                const count = counts[value] || 0;
                item.querySelector('.facet-count').textContent = '(' + count + ')';

                const cb = item.querySelector('input');
                if (count === 0 && !cb.checked) {
                    item.classList.add('facet-item-disabled');
                } else {
                    item.classList.remove('facet-item-disabled');
                }
            });
        }
    }

    function displayResults(docs) {
        docs.sort((a, b) => (a.documentId || '').localeCompare(b.documentId || ''));

        const hasFilters = hasActiveFilters();

        if (searchQuery && hasFilters) {
            els.statusEl.textContent = 'Found ' + docs.length + ' result(s) for "' + searchQuery + '" with filters:';
        } else if (searchQuery) {
            els.statusEl.textContent = 'Found ' + docs.length + ' result(s) for "' + searchQuery + '":';
        } else if (hasFilters) {
            els.statusEl.textContent = 'Found ' + docs.length + ' document(s) matching filters:';
        } else {
            els.statusEl.textContent = 'Showing all ' + docs.length + ' documents:';
        }

        els.resultsList.innerHTML = '';
        for (const doc of docs) {
            const li = document.createElement('li');
            li.className = 'search-result-item';

            const link = document.createElement('a');
            link.href = config.resultUrl(doc);
            link.innerHTML = '<span class="doc-id">' + escapeHtml(doc.documentId) + '</span> ' + escapeHtml(doc.title || '');

            const details = document.createElement('div');
            details.className = 'search-result-details';

            for (const field of config.resultDetails) {
                const val = doc[field];
                if (val) {
                    const span = document.createElement('span');
                    span.className = 'search-result-' + field;
                    span.textContent = val;
                    details.appendChild(span);
                }
            }

            li.appendChild(link);
            li.appendChild(details);
            els.resultsList.appendChild(li);
        }
    }

    function displayActiveFilters() {
        const tags = [];

        if (activeDateRange.from !== null || activeDateRange.to !== null) {
            const fromStr = activeDateRange.from !== null ? activeDateRange.from : '...';
            const toStr = activeDateRange.to !== null ? activeDateRange.to : '...';
            tags.push({
                label: 'Date: ' + fromStr + ' to ' + toStr,
                onRemove: function() {
                    els.dateFrom.value = '';
                    els.dateTo.value = '';
                    activeDateRange = { from: null, to: null };
                    performFilteredSearch();
                }
            });
        }

        for (const [field, selectedValues] of Object.entries(activeFilters)) {
            for (const value of selectedValues) {
                const fieldLabel = facetConfig[field]?.label || field;
                tags.push({
                    label: fieldLabel + ': ' + value,
                    onRemove: function() {
                        activeFilters[field].delete(value);
                        const container = document.getElementById('facet-' + field);
                        if (container) {
                            const cb = container.querySelector('input[value="' + CSS.escape(value) + '"]');
                            if (cb) cb.checked = false;
                        }
                        performFilteredSearch();
                    }
                });
            }
        }

        els.activeFiltersDiv.innerHTML = '';
        if (tags.length === 0) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'active-filters-wrapper';

        const title = document.createElement('span');
        title.className = 'active-filters-title';
        title.textContent = 'Active Filters: ';
        wrapper.appendChild(title);

        for (const tag of tags) {
            const el = document.createElement('span');
            el.className = 'filter-tag';
            el.textContent = tag.label + ' ';

            const removeBtn = document.createElement('button');
            removeBtn.className = 'filter-tag-remove';
            removeBtn.textContent = '\u00d7';
            removeBtn.addEventListener('click', tag.onRemove);

            el.appendChild(removeBtn);
            wrapper.appendChild(el);
        }

        els.activeFiltersDiv.appendChild(wrapper);
    }

    // --- Utilities ---

    function clearAllFilters() {
        for (const field of Object.keys(activeFilters)) {
            activeFilters[field].clear();
            const container = document.getElementById('facet-' + field);
            if (container) {
                container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            }
        }
        els.dateFrom.value = '';
        els.dateTo.value = '';
        activeDateRange = { from: null, to: null };
        els.searchInput.value = '';
        searchQuery = '';
        performFilteredSearch();
    }

    function hasActiveFilters() {
        if (activeDateRange.from !== null || activeDateRange.to !== null) return true;
        for (const values of Object.values(activeFilters)) {
            if (values.size > 0) return true;
        }
        return false;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function debounce(fn, ms) {
        let timer;
        return function() {
            clearTimeout(timer);
            timer = setTimeout(fn, ms);
        };
    }

    return { init };
})();
