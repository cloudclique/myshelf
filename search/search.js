import { auth, db, collectionName } from '../firebase-config.js';

const PAGE_SIZE = 52;
const DEFAULT_IMAGE_URL = 'path/to/your/default-image.jpg';
const SEARCH_ENDPOINT = 'https://imgbbapi.stanislav-zhukov.workers.dev/search';

let currentUserId = null;
let allowNSFW = false;
let currentPage = 1;

// We no longer keep allItems in memory
let hasMore = true;

const ICONS = {
    name: '<i class="bi bi-sticky-fill"></i>',
    category: '<i class="bi bi-folder-fill"></i>',
    scale: '<i class="bi bi-arrows-fullscreen"></i>',
    age: '<i class="bi bi-exclamation-octagon"></i>',
    tag: '<i class="bi bi-tag-fill"></i>'
};


// DOM elements
const latestAdditionsGrid = document.getElementById('latestAdditionsGrid');
const headerTools = document.getElementById('headerTools');
const loadingStatus = document.getElementById('loadingStatus');

// --- SKELETON LOADING ---
function renderSkeletonGrid() {
    latestAdditionsGrid.innerHTML = '';
    const tempLimit = PAGE_SIZE; // Show a reasonable number of skeletons
    for (let i = 0; i < tempLimit; i++) {
        const div = document.createElement('div');
        div.className = 'skeleton-card';
        div.innerHTML = `
            <div class="skeleton skeleton-img"></div>
        `;
        latestAdditionsGrid.appendChild(div);
    }
}

const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageStatusElement = document.getElementById('pageStatus');

const prevPageBtnTop = document.getElementById('prevPageBtnTop');
const nextPageBtnTop = document.getElementById('nextPageBtnTop');
const pageStatusElementTop = document.getElementById('pageStatusTop');

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const clearSearchBtn = document.getElementById('clearSearchBtn');

// --- Hover Tooltip Logic ---
const hoverTooltip = document.createElement('div');
hoverTooltip.className = 'hover-tooltip';
document.body.appendChild(hoverTooltip);

let hoverTimeout = null;

latestAdditionsGrid.addEventListener('mouseover', (e) => {
    const cardLink = e.target.closest('.item-card-link');
    if (!cardLink) return;

    const itemName = cardLink.querySelector('h3')?.textContent || 'No Title';
    const displayTitle = itemName.length > 50 ? itemName.substring(0, 50) + '...' : itemName;

    hoverTimeout = setTimeout(() => {
        hoverTooltip.textContent = displayTitle;
        hoverTooltip.classList.add('visible');
    }, 500);
});

latestAdditionsGrid.addEventListener('mouseout', (e) => {
    const cardLink = e.target.closest('.item-card-link');
    if (!cardLink) return;

    clearTimeout(hoverTimeout);
    hoverTooltip.classList.remove('visible');
});

latestAdditionsGrid.addEventListener('mousemove', (e) => {
    if (hoverTooltip.classList.contains('visible') || hoverTimeout) {
        const tooltipWidth = hoverTooltip.offsetWidth;
        const tooltipHeight = hoverTooltip.offsetHeight;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = e.clientX + 15;
        let top = e.clientY + 15;

        // Reflect horizontally if it goes off screen
        if (left + tooltipWidth > viewportWidth) {
            left = e.clientX - tooltipWidth - 15;
        }

        // Reflect vertically if it goes off screen
        if (top + tooltipHeight > viewportHeight) {
            top = e.clientY - tooltipHeight - 15;
        }

        hoverTooltip.style.left = left + 'px';
        hoverTooltip.style.top = top + 'px';
    }
});


// --- TYPESENSE HELPERS ---
async function queryTypesense(collection, params) {
    try {
        const response = await fetch(SEARCH_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: collection,
                ...params
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Search failed: ${response.status} ${errText}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Typesense Query Error:", error);
        return { hits: [], found: 0 };
    }
}

// --- ITEM RENDER HELPERS ---
function createItemCard(itemData) {
    const link = document.createElement('a');
    link.href = `../items/?id=${itemData.id}`;
    link.className = 'item-card-link';

    const card = document.createElement('div');
    card.className = 'item-card';

    let imageSource =
        (itemData.itemImageUrls &&
            itemData.itemImageUrls[0] &&
            itemData.itemImageUrls[0].url) ||
        DEFAULT_IMAGE_URL;

    const imageClasses = 'item-image';

    const isAdultContent = (itemData.itemAgeRating === '18+' || itemData.itemAgeRating === 'Adult');
    const shouldBlur = isAdultContent && !allowNSFW;

    card.innerHTML = `
        <div class="item-image-wrapper ${shouldBlur ? 'nsfw-blur' : ''}">
            <img src="${imageSource}" alt="${itemData.itemName}" class="${imageClasses}">
            ${shouldBlur ? '<div class="nsfw-overlay">18+</div>' : ''}
            ${itemData.isDraft ? '<div class="draft-overlay">Draft</div>' : ''}
        </div>
        <div class="item-info">
            <h3>${itemData.itemName || 'Untitled'}</h3>
            <p><strong>Category:</strong> ${itemData.itemCategory || 'N/A'}</p>
            <p><strong>Scale:</strong> ${itemData.itemScale || 'N/A'}</p>
        </div>
    `;

    link.appendChild(card);
    return link;
}

function renderItems(items) {
    latestAdditionsGrid.innerHTML = '';
    if (items.length === 0) {
        latestAdditionsGrid.innerHTML = '<p>No items found.</p>';
        return;
    }
    items.forEach(item => latestAdditionsGrid.appendChild(createItemCard(item)));
}

function getPageFromURL() {
    const params = new URLSearchParams(window.location.search);
    const page = parseInt(params.get('page'), 10);
    return isNaN(page) || page < 1 ? 1 : page;
}

function restoreStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    searchInput.value = params.get('q') || '';
    currentPage = getPageFromURL();
}

function updateURLPage() {
    const url = new URL(window.location);

    url.searchParams.set('page', currentPage);

    if (searchInput.value) url.searchParams.set('q', searchInput.value);
    else url.searchParams.delete('q');

    window.history.replaceState({}, '', url);
}

// Fetch items using Typesense
async function fetchItems(page = 1) {
    loadingStatus.textContent = '';

    if (page === 1) renderSkeletonGrid();
    else {
        renderSkeletonGrid();
    }

    try {
        let queryText = searchInput.value.trim();
        let filterBy = '';

        if (/\bdraft\b/i.test(queryText)) {
            filterBy = 'isDraft:true';
            queryText = queryText.replace(/\bdraft\b/gi, '').trim();
        }

        const cleanedQuery = queryText.replace(/[\{\}]/g, '');

        const tsParams = {
            q: cleanedQuery || '*',
            query_by: 'itemName,itemCategory,itemScale,itemAgeRating,tags',
            sort_by: 'createdAt:desc',
            page: page,
            per_page: PAGE_SIZE, // Ensures hits match visibility
            // Bandwidth Optimization: Only fetch what is needed for the card UI
            include_fields: 'itemName,itemImageUrls,id,itemAgeRating,isDraft' 
        };

        if (filterBy) {
            tsParams.filter_by = filterBy;
        }

        const result = await queryTypesense('items', tsParams);

        const items = result.hits.map(hit => {
            const doc = hit.document;
            return {
                ...doc,
                id: doc.id 
            };
        });

        hasMore = (page * PAGE_SIZE) < result.found;

        renderItems(items);

        const isPrevDisabled = page === 1;
        const isNextDisabled = !hasMore;

        [prevPageBtn, prevPageBtnTop].forEach(btn => (btn.disabled = isPrevDisabled));
        [nextPageBtn, nextPageBtnTop].forEach(btn => (btn.disabled = isNextDisabled));
        [pageStatusElement, pageStatusElementTop].forEach(
            span => (span.textContent = `Page ${page}`)
        );

    } catch (err) {
        console.error(err);
        loadingStatus.textContent = `Error: ${err.message}`;
        latestAdditionsGrid.innerHTML = '<p>Error loading items.</p>';
    }
}

// --- SEARCH HANDLING ---
function handleSearch() {
    currentPage = 1;
    fetchItems(currentPage);
    updateURLPage();
}

function handleClearSearch() {
    searchInput.value = '';
    handleSearch();
}

function handleNext() {
    if (!hasMore) return;
    currentPage++;
    fetchItems(currentPage);
    updateURLPage();
}

function handlePrev() {
    if (currentPage === 1) return;
    currentPage--;
    fetchItems(currentPage);
    updateURLPage();
}

// --- LOAD USER PROFILE + NSFW STATE ---
async function loadUserProfile(uid) {
    try {
        const profileRef = db
            .collection('artifacts')
            .doc('default-app-id')
            .collection('user_profiles')
            .doc(uid);

        const snap = await profileRef.get();

        if (snap.exists) {
            const data = snap.data();
            allowNSFW = data.allowNSFW === true;
        } else {
            allowNSFW = false;
        }
    } catch (err) {
        console.error('Error loading profile:', err);
        allowNSFW = false;
    }
}

// --- AUTH ---
auth.onAuthStateChanged(async user => {
    headerTools.innerHTML = '';

    if (user) {
        currentUserId = user.uid;

        // Load NSFW setting
        await loadUserProfile(currentUserId);

        headerTools.innerHTML = `<button id="logoutBtn" class="logout-btn">Logout</button>`;
        document.getElementById('logoutBtn').onclick = () => auth.signOut();
    } else {
        // User is logged out → NSFW disabled
        currentUserId = null;
        allowNSFW = false;

        headerTools.innerHTML = `<button onclick="window.location.href='../login/'" class="login-btn">Login / Signup</button>`;
    }

    restoreStateFromURL();
    fetchItems(currentPage);
});

// -- EVENT LISTENERS --
searchBtn.onclick = () => handleSearch();
clearSearchBtn.onclick = handleClearSearch;

searchInput.onkeypress = e => {
    if (e.key === 'Enter') handleSearch();
};

prevPageBtn.onclick = prevPageBtnTop.onclick = handlePrev;
nextPageBtn.onclick = nextPageBtnTop.onclick = handleNext;


// --- SEARCH SUGGESTIONS (Client-Side hack or Typesense?)
// We can use a separate Typesense query for suggestions if we want, or just remove them if not supported.
// The previous implementation used 'allItems' which we don't have anymore.
// We can implement a quick prefix search to Typesense or disable suggestions for now.
// For now, let's disable generic suggestions to avoid complexity or implement a simple debounce search for suggestions.
// Given strict instructions to "adjust... code", I'll leave the UI element but clear the logic OR implement it properly.
// A proper suggestion implementation requires a separate index or fast queries.
// Let's implement a debounce query to Typesense for suggestions.

const searchSuggestions = document.getElementById('searchSuggestions');
let suggestionTimeout;

function updateSearchSuggestions() {
    clearTimeout(suggestionTimeout);
    const query = searchInput.value.trim();

    if (!query) {
        searchSuggestions.innerHTML = '';
        return;
    }

    suggestionTimeout = setTimeout(async () => {
        // Fetch suggestions
        try {
            const result = await queryTypesense('items', {
                q: query,
                query_by: 'itemName,tags,itemCategory',
                per_page: 3,
                // Only return these fields to save bandwidth
                include_fields: 'itemName,tags'
            });

            const matches = result.hits.map(h => ({
                text: h.document.itemName, 
                type: 'name'
            }));

            renderSearchSuggestions(matches);
        } catch (e) {
            console.error("Suggestion error", e);
        }
    }, 500);
}

function renderSearchSuggestions(matches) {
    searchSuggestions.innerHTML = '';

    matches.forEach(match => {
        const div = document.createElement('div');
        div.className = 'search-suggestion-item';
        div.innerHTML = `<span class="search-suggestion-icon">${ICONS[match.type] || ''}</span> ${match.text}`;
        div.onclick = () => {
            searchInput.value = match.text;
            handleSearch();
            searchSuggestions.innerHTML = '';
        };
        searchSuggestions.appendChild(div);
    });
}

// Hide suggestions when clicking outside
document.addEventListener('click', e => {
    if (searchSuggestions && !searchSuggestions.contains(e.target) && e.target !== searchInput) {
        searchSuggestions.innerHTML = '';
    }
});

// Attach to input event
searchInput.addEventListener('input', updateSearchSuggestions);


// --- PUBLIC LISTS ----
const LISTS_PER_PAGE = 6;
let publicListsPage = 1;
// we can't filter client side anymore easily, so we rely on search
const listSearchInput = document.getElementById('listSearchInput');


// Function to fetch public lists from Typesense
async function fetchPublicLists(searchQuery = "") {
    const grid = document.getElementById('publicListsGrid');
    if (!grid) return;

    if (publicListsPage === 1 && !searchQuery) grid.innerHTML = '<p>Loading lists...</p>';

    try {
        const params = {
            q: searchQuery || '*',
            query_by: 'name',
            sort_by: 'createdAt:desc',
            page: publicListsPage,
            per_page: LISTS_PER_PAGE,
            // Bandwidth Optimization: Only return name, id, and mode
            include_fields: 'name,id,mode' 
        };

        const result = await queryTypesense('public_lists', params); 

        const lists = result.hits.map(h => ({ ...h.document, id: h.document.id }));

        renderPublicLists(lists, grid);
    } catch (error) {
        console.error("Error fetching public lists:", error);
        grid.innerHTML = '<p>Error loading public lists.</p>';
    }
}

// Add the search handler function
function handleListSearch() {
    const query = listSearchInput.value.trim();
    publicListsPage = 1;
    fetchPublicLists(query);
}

// Update renderPublicLists
function renderPublicLists(lists, grid) {
    grid.innerHTML = ''; 

    if (lists.length === 0) {
        grid.innerHTML = '<p>No public lists found.</p>';
        return;
    }

    lists.forEach(list => {
        const card = document.createElement('a');
        card.href = `../lists/?list=${list.id}&type=public`;
        card.className = 'item-card-link';

        const listIcon = list.mode === 'live' ? 'bi-journal-code' : 'bi-journal-bookmark-fill';

        // Removed the itemsCount calculation logic

        card.innerHTML = `
            <div class="list-card">
                <div class="list-image-wrapper">
                    <div class="list-stack-effect">
                         <i class="bi ${listIcon}" style="font-size: 1.8rem; color: var(--accent-clr);"></i>
                    </div>
                </div>
                <div class="list-info">
                    <h3>${list.name || 'Untitled List'}</h3>
                    <div class="list-meta">
                        ${list.mode === 'live' ? '<span class="badge-live">LIVE</span>' : ''}
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}
}

if (listSearchInput) {
    listSearchInput.addEventListener('input', () => {
        // debounce or simple input
        handleListSearch();
    });
}

// Initialize the fetch when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Wait for auth to trigger fetchItems, but lists can allow valid fetch immediately if public?
    // Public lists are public.
    fetchPublicLists();
});