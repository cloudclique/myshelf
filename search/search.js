import { auth, db, collectionName } from '../firebase-config.js';

const PAGE_SIZE = 52;
const DEFAULT_IMAGE_URL = 'path/to/your/default-image.jpg';

let currentUserId = null;
let allowNSFW = false; // <- NEW
let currentPage = 1;
let allItems = [];
let filteredItems = [];
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


// --- HELPERS ---
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

function renderItemsWithPagination(items) {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = startIndex + PAGE_SIZE;
    const itemsToShow = items.slice(startIndex, endIndex);

    hasMore = endIndex < items.length;

    latestAdditionsGrid.innerHTML = '';
    if (itemsToShow.length === 0) {
        latestAdditionsGrid.innerHTML = '<p>No items found.</p>';
        return;
    }

    itemsToShow.forEach(item => latestAdditionsGrid.appendChild(createItemCard(item)));

    const isPrevDisabled = currentPage === 1;
    const isNextDisabled = !hasMore;

    [prevPageBtn, prevPageBtnTop].forEach(btn => (btn.disabled = isPrevDisabled));
    [nextPageBtn, nextPageBtnTop].forEach(btn => (btn.disabled = isNextDisabled));
    [pageStatusElement, pageStatusElementTop].forEach(
        span => (span.textContent = `Page ${currentPage}`)
    );
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

async function fetchAllItems() {
    loadingStatus.textContent = '';

    if (latestAdditionsGrid.children.length === 0) {
        renderSkeletonGrid();
    }

    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const metadataRef = db.collection('artifacts').doc(appId).collection('metadata').doc('items_sharding');
        const metaSnap = await metadataRef.get();
        let maxShard = 1;
        if (metaSnap.exists) {
            maxShard = metaSnap.data().currentShardId || 1;
        }

        allItems = [];
        const shardPromises = [];
        // Fetch all shards in parallel
        for (let i = 1; i <= maxShard; i++) {
            shardPromises.push(db.collection(`items-${i}`).doc('items').get());
        }

        const snapshots = await Promise.all(shardPromises);

        snapshots.forEach(doc => {
            if (doc.exists) {
                const items = doc.data().items || [];
                items.forEach(item => {
                    // Normalize data
                    if (Array.isArray(item.tags)) {
                        item.tags = item.tags.map(tag => (tag || '').toLowerCase());
                    }
                    item.id = item.itemId; // Ensure ID access
                    allItems.push(item);
                });
            }
        });

        // Also fetch legacy/review items if needed, but assuming migration moved everything to shards.

        // Sort client-side since we lost DB sorting
        allItems.sort((a, b) => {
            const dateA = a.createdAt?.seconds || 0;
            const dateB = b.createdAt?.seconds || 0;
            return dateB - dateA; // Descending
        });

        filteredItems = [...allItems];

        restoreStateFromURL();
        handleSearch(false);
    } catch (err) {
        console.error(err);
        loadingStatus.textContent = `Error: ${err.message}`;
        latestAdditionsGrid.innerHTML = '<p>Error loading items.</p>';
    }
}

function handleSearch(resetPage = true) {
    // If resetting page (new search), show skeletons briefly if we were fetching (though this is client-side filtering, so it's fast)
    // For client-side filter it might be too fast to need skeletons, BUT if we had async search, we'd put it here.
    // For now, let's keep it snappy without skeletons for local filtering, 
    // OR we can add a tiny artificial delay/skeleton if the dataset is huge (optional).
    // Given the request is for "gimics", let's clear loading status.

    const query = searchInput.value.trim().toLowerCase();

    if (!query) {
        filteredItems = [...allItems];
    } else {
        const regex = /\{([^}]+)\}|(\S+)/g;
        const requiredKeywords = [];
        const excludedKeywords = [];
        let match;

        while ((match = regex.exec(query)) !== null) {
            const term = (match[1] || match[2]).toLowerCase();
            // Check if the term starts with a minus sign and isn't just a "-"
            if (term.startsWith('-') && term.length > 1) {
                excludedKeywords.push(term.substring(1));
            } else {
                requiredKeywords.push(term);
            }
        }

        filteredItems = allItems.filter(item => {
            // No longer filtering by 18+ here, we will blur in the card rendering

            const name = (item.itemName || '').toLowerCase();
            const tags = (item.tags || []).map(t => t.toLowerCase());
            const category = (item.itemCategory || '').toLowerCase();
            const scale = (item.itemScale || '').toLowerCase();
            const age = (item.itemAgeRating || '').toLowerCase();

            // Use a separator to prevent word bleeding between fields
            const status = item.isDraft ? 'draft' : 'released';
            const combinedText = [name, category, scale, age, status, ...tags].join(' | ');

            // 1. Exclusion Check: If any excluded keyword is present, discard item
            const hasExcluded = excludedKeywords.some(kw => combinedText.includes(kw));
            if (hasExcluded) return false;

            // 2. Requirement Check: Item must contain every required keyword
            // If no required keywords exist (only exclusions), allow the item
            if (requiredKeywords.length === 0) return true;
            return requiredKeywords.every(kw => combinedText.includes(kw));
        });
    }

    if (resetPage) currentPage = 1;
    renderItemsWithPagination(filteredItems);
    updateURLPage();
}

function handleClearSearch() {
    searchInput.value = '';
    filteredItems = [...allItems];

    currentPage = 1;
    renderItemsWithPagination(filteredItems);
    updateURLPage();
}

function handleNext() {
    if (!hasMore) return;
    currentPage++;
    renderItemsWithPagination(filteredItems);
    updateURLPage();
}

function handlePrev() {
    if (currentPage === 1) return;
    currentPage--;
    renderItemsWithPagination(filteredItems);
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

    fetchAllItems();
});

// -- EVENT LISTENERS --
searchBtn.onclick = () => handleSearch();
clearSearchBtn.onclick = handleClearSearch;

searchInput.onkeypress = e => {
    if (e.key === 'Enter') handleSearch();
};

prevPageBtn.onclick = prevPageBtnTop.onclick = handlePrev;
nextPageBtn.onclick = nextPageBtnTop.onclick = handleNext;

const searchSuggestions = document.getElementById('searchSuggestions');

function updateSearchSuggestions() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
        searchSuggestions.innerHTML = '';
        return;
    }

    const matchesByType = {
        tag: [],
        age: [],
        scale: [],
        category: [],
        name: []
    };

    const addedItemIds = new Set();
    const addedTexts = new Set(); // track unique text for tag/age/scale/category

    for (let item of allItems) {
        if (addedItemIds.has(item.id)) continue;

        // Check tags
        const tagMatch = (item.tags || []).find(t => t.toLowerCase().includes(query));
        if (tagMatch && !addedTexts.has(tagMatch.toLowerCase())) {
            matchesByType.tag.push({ type: 'tag', text: tagMatch, item });
            addedTexts.add(tagMatch.toLowerCase());
            addedItemIds.add(item.id);
            continue;
        }

        // Check age rating
        if ((item.itemAgeRating || '').toLowerCase().includes(query) && !addedTexts.has(item.itemAgeRating.toLowerCase())) {
            matchesByType.age.push({ type: 'age', text: item.itemAgeRating, item });
            addedTexts.add(item.itemAgeRating.toLowerCase());
            addedItemIds.add(item.id);
            continue;
        }

        // Check scale
        if ((item.itemScale || '').toLowerCase().includes(query) && !addedTexts.has(item.itemScale.toLowerCase())) {
            matchesByType.scale.push({ type: 'scale', text: item.itemScale, item });
            addedTexts.add(item.itemScale.toLowerCase());
            addedItemIds.add(item.id);
            continue;
        }

        // Check category
        if ((item.itemCategory || '').toLowerCase().includes(query) && !addedTexts.has(item.itemCategory.toLowerCase())) {
            matchesByType.category.push({ type: 'category', text: item.itemCategory, item });
            addedTexts.add(item.itemCategory.toLowerCase());
            addedItemIds.add(item.id);
            continue;
        }

        // Check name (name can repeat, don't filter by text uniqueness)
        if ((item.itemName || '').toLowerCase().includes(query)) {
            matchesByType.name.push({ type: 'name', text: item.itemName, item });
            addedItemIds.add(item.id);
        }

        // Stop if we already have 10 results
        const totalCount = Object.values(matchesByType).flat().length;
        if (totalCount >= 10) break;
    }

    // Merge results in priority order and limit to 10
    const orderedMatches = [
        ...matchesByType.tag,
        ...matchesByType.age,
        ...matchesByType.scale,
        ...matchesByType.category,
        ...matchesByType.name
    ].slice(0, 10);

    renderSearchSuggestions(orderedMatches);
}

function renderSearchSuggestions(matches) {
    searchSuggestions.innerHTML = '';

    matches.forEach(match => {
        const div = document.createElement('div');
        div.className = 'search-suggestion-item';

        // The display remains clean without braces
        div.innerHTML = `<span class="search-suggestion-icon">${ICONS[match.type]}</span> ${match.text}`;

        div.onclick = () => {
            // Define which types should be treated as "complete parts"
            const bracedTypes = ['tag', 'age', 'category', 'scale'];

            if (bracedTypes.includes(match.type)) {
                // Wrap in braces for the search bar
                searchInput.value = `{${match.text}}`;
            } else {
                // Names usually stay as standard text
                searchInput.value = match.text;
            }

            handleSearch();
            searchSuggestions.innerHTML = '';
        };

        searchSuggestions.appendChild(div);
    });
}

// Hide suggestions when clicking outside
document.addEventListener('click', e => {
    if (!searchSuggestions.contains(e.target) && e.target !== searchInput) {
        searchSuggestions.innerHTML = '';
    }
});

// Attach to input event
searchInput.addEventListener('input', updateSearchSuggestions);


// Add these variables to your constants/variables section
const LISTS_PER_PAGE = 6;
let allPublicLists = [];
let publicListsPage = 1;
let filteredPublicLists = [];
const listSearchInput = document.getElementById('listSearchInput');

// Function to fetch public lists from Firestore
async function fetchPublicLists() {
    const grid = document.getElementById('publicListsGrid');
    if (!grid) return;

    grid.innerHTML = '<p>Loading lists...</p>';

    // try {  <-- Removing this outer try
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const metadataRef = db.collection('artifacts').doc(appId).collection('metadata').doc('lists_sharding');
        const metaSnap = await metadataRef.get();
        let maxShard = 1;

        if (metaSnap.exists) {
            maxShard = metaSnap.data().currentShardId || 1;
        } else {
            // Fallback: try to scan a few if metadata is missing (e.g. migration validation)
            maxShard = 5;
        }

        allPublicLists = [];
        const promises = [];

        // Parallel fetch for speed
        for (let i = 1; i <= maxShard; i++) {
            promises.push(db.collection(`lists-${i}`).doc('lists').get().then(doc => ({ doc, shardId: i })));
        }

        const results = await Promise.all(promises);

        results.forEach(({ doc, shardId }) => {
            if (doc.exists) {
                const listMap = doc.data();
                Object.entries(listMap).forEach(([key, list]) => {
                    list.id = list.id || list.listId || key;
                    list.shardId = shardId; // Attach shardId
                    allPublicLists.push(list);
                });
            }
        });

        allPublicLists.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        // Initialize filtered list with all lists
        filteredPublicLists = [...allPublicLists];
        renderPublicLists(1);
    } catch (error) {
        console.error("Error fetching public lists:", error);
        grid.innerHTML = '<p>Error loading public lists.</p>';
    }
}

// Add the search handler function
function handleListSearch() {
    const query = listSearchInput.value.trim().toLowerCase();

    if (!query) {
        filteredPublicLists = [...allPublicLists];
    } else {
        filteredPublicLists = allPublicLists.filter(list =>
            (list.name || '').toLowerCase().includes(query)
        );
    }

    renderPublicLists(1); // Reset to first page of results
}

// Update renderPublicLists to use filteredPublicLists instead of allPublicLists
function renderPublicLists(page) {
    publicListsPage = page;
    const grid = document.getElementById('publicListsGrid');
    grid.innerHTML = '';

    const start = (page - 1) * LISTS_PER_PAGE;
    const end = start + LISTS_PER_PAGE;

    // Use the filtered array here
    const paginatedLists = filteredPublicLists.slice(start, end);

    if (paginatedLists.length === 0) {
        grid.innerHTML = '<p>No public lists found.</p>';
        return;
    }

    paginatedLists.forEach(list => {
        const card = document.createElement('a');
        card.href = `../lists/?list=${list.id}&type=public&shard=${list.shardId}`;
        card.className = 'item-card-link';

        const listIcon = list.mode === 'live' ? 'bi-journal-code' : 'bi-journal-bookmark-fill';

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
                        <span>${list.items?.length || 0} Items</span>
                        ${list.mode === 'live' ? '<span class="badge-live">LIVE</span>' : ''}
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

listSearchInput.addEventListener('input', handleListSearch);
// Initialize the fetch when the page loads
document.addEventListener('DOMContentLoaded', () => {
    fetchPublicLists();
});