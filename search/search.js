import { auth, db, collectionName } from '../firebase-config.js';

const PAGE_SIZE = 52;
const DEFAULT_IMAGE_URL = 'path/to/your/default-image.jpg'; // Ensure this path is correct in your project

let currentUserId = null;
let allowNSFW = false;
let currentPage = 1;

// Global Cache for Denormalized Data (Array of objects with ID inserted)
let allGlobalItems = [];
let allGlobalLists = [];

let currentItems = []; // The currently filtered items being shown

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

const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageStatusElement = document.getElementById('pageStatus');

const prevPageBtnTop = document.getElementById('prevPageBtnTop');
const nextPageBtnTop = document.getElementById('nextPageBtnTop');
const pageStatusElementTop = document.getElementById('pageStatusTop');

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const clearSearchBtn = document.getElementById('clearSearchBtn');

// --- SKELETON LOADING ---
function renderSkeletonGrid() {
    latestAdditionsGrid.innerHTML = '';
    const tempLimit = PAGE_SIZE;
    for (let i = 0; i < tempLimit; i++) {
        const div = document.createElement('div');
        div.className = 'skeleton-card';
        div.innerHTML = `
            <div class="skeleton skeleton-img"></div>
        `;
        latestAdditionsGrid.appendChild(div);
    }
}

// --- HOVER TOOLTIP LOGIC ---
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

        if (left + tooltipWidth > viewportWidth) left = e.clientX - tooltipWidth - 15;
        if (top + tooltipHeight > viewportHeight) top = e.clientY - tooltipHeight - 15;

        hoverTooltip.style.left = left + 'px';
        hoverTooltip.style.top = top + 'px';
    }
});


// --- DATA FETCHING (DENORMALIZED) ---

async function fetchAllData() {
    try {
        loadingStatus.textContent = 'Loading data...';

        const CACHE_KEY_ITEMS = 'myshelf_cache_items_v2';
        const CACHE_KEY_LISTS = 'myshelf_cache_lists_v2';
        const CACHE_KEY_TS = 'myshelf_cache_ts_v2';
        const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

        // Check Cache
        const cachedTs = localStorage.getItem(CACHE_KEY_TS);
        const now = Date.now();
        let useCache = false;

        if (cachedTs && (now - parseInt(cachedTs, 10) < CACHE_DURATION)) {
            const cachedItems = localStorage.getItem(CACHE_KEY_ITEMS);
            const cachedLists = localStorage.getItem(CACHE_KEY_LISTS);

            if (cachedItems && cachedLists) {
                try {
                    allGlobalItems = JSON.parse(cachedItems);
                    allGlobalLists = JSON.parse(cachedLists);
                    console.log("Loaded data from cache.");
                    useCache = true;
                } catch (e) {
                    console.warn("Cache parse error, refetching.");
                }
            }
        }

        if (!useCache) {
            console.log("Fetching fresh data from Firestore...");

            // Fetch Items
            const itemsDoc = await db.collection('denormalized_data').doc('items').get();
            if (itemsDoc.exists) {
                const data = itemsDoc.data();
                allGlobalItems = Object.entries(data).map(([id, item]) => ({
                    id,
                    ...item
                }));
                // Sort by createdAt desc by default
                allGlobalItems.sort((a, b) => {
                    const ta = a.createdAt?.seconds || 0;
                    const tb = b.createdAt?.seconds || 0;
                    return tb - ta;
                });
            } else {
                allGlobalItems = [];
            }

            // Fetch Lists
            const listsDoc = await db.collection('denormalized_data').doc('lists').get();
            if (listsDoc.exists) {
                const data = listsDoc.data();
                allGlobalLists = [];

                // Traverse { userId: { listId: { ...data } } }
                Object.values(data).forEach(userLists => {
                    if (typeof userLists === 'object') {
                        Object.entries(userLists).forEach(([listId, listData]) => {
                            allGlobalLists.push({
                                id: listId,
                                ...listData
                            });
                        });
                    }
                });

                // Sort by createdAt desc
                allGlobalLists.sort((a, b) => {
                    const ta = a.createdAt?.seconds || 0;
                    const tb = b.createdAt?.seconds || 0;
                    return tb - ta;
                });
            } else {
                allGlobalLists = [];
            }

            // Save to Cache (try-catch for quota limits)
            try {
                localStorage.setItem(CACHE_KEY_ITEMS, JSON.stringify(allGlobalItems));
                localStorage.setItem(CACHE_KEY_LISTS, JSON.stringify(allGlobalLists));
                localStorage.setItem(CACHE_KEY_TS, now.toString());
            } catch (e) {
                console.warn("Failed to cache data (likely storage limit):", e);
            }
        }

        loadingStatus.textContent = '';
        return true;
    } catch (e) {
        console.error("Error fetching denormalized data:", e);
        loadingStatus.textContent = 'Error loading data: ' + e.message;
        return false;
    }
}


// --- FILTERING & PAGINATION ---

function applyFilters() {
    let queryText = searchInput.value.trim().toLowerCase();
    let filterIsDraft = false;

    // Handle "draft" keyword
    if (/\bdraft\b/i.test(queryText)) {
        filterIsDraft = true;
        queryText = queryText.replace(/\bdraft\b/gi, '').trim();
    }
    const cleanedQuery = queryText.replace(/[\{\}]/g, ''); // strip braces

    currentItems = allGlobalItems.filter(item => {
        // Draft Check
        if (filterIsDraft) {
            // Include drafts in search results
            if (!item.isDraft) return false;
        } else {
            // Do not exclude drafts by default
        }

        // Text Search
        if (cleanedQuery) {
            const name = (item.itemName || '').toLowerCase();
            const tags = (item.tags || []).map(t => t.toLowerCase());
            const rating = (item.itemAgeRating || '').toLowerCase();

            return name.includes(cleanedQuery) ||
                tags.some(tag => tag.includes(cleanedQuery)) ||
                rating.includes(cleanedQuery);
        }

        return true;
    });
}

function renderCurrentPage() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const itemsToShow = currentItems.slice(start, end);

    renderItems(itemsToShow);

    // Update Pagination UI
    const totalPages = Math.ceil(currentItems.length / PAGE_SIZE) || 1;

    [prevPageBtn, prevPageBtnTop].forEach(btn => btn.disabled = currentPage === 1);
    [nextPageBtn, nextPageBtnTop].forEach(btn => btn.disabled = currentPage >= totalPages);

    [pageStatusElement, pageStatusElementTop].forEach(
        span => span.textContent = `Page ${currentPage} of ${totalPages}`
    );
}

function handleSearch() {
    currentPage = 1;
    applyFilters();
    renderCurrentPage();
    updateURLPage();
}

// --- ITEM RENDER HELPERS ---
function createItemCard(itemData) {
    const link = document.createElement('a');
    link.href = `../items/?id=${itemData.id}`;
    link.className = 'item-card-link';

    const card = document.createElement('div');
    card.className = 'item-card';

    // Use thumbnail from denormalized data
    let imageSource = itemData.thumbnail || DEFAULT_IMAGE_URL;
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
            <!-- Optional fields might not exist in denormalized data -->
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

// --- URL STATE ---
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

function handleNext() {
    const totalPages = Math.ceil(currentItems.length / PAGE_SIZE) || 1;
    if (currentPage >= totalPages) return;
    currentPage++;
    renderCurrentPage();
    updateURLPage();
}

function handlePrev() {
    if (currentPage === 1) return;
    currentPage--;
    renderCurrentPage();
    updateURLPage();
}

function handleClearSearch() {
    searchInput.value = '';
    handleSearch();
}

// --- LOAD USER PROFILE ---
async function loadUserProfile(uid) {
    try {
        const profileRef = db.collection('artifacts').doc('default-app-id').collection('user_profiles').doc(uid);
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

// --- INITIALIZATION ---
auth.onAuthStateChanged(async user => {
    headerTools.innerHTML = '';

    // Load Data First
    renderSkeletonGrid();
    await fetchAllData();
    // Also fetch lists? 'fetchPublicLists' handles its own rendering.

    if (user) {
        currentUserId = user.uid;
        await loadUserProfile(currentUserId);
        headerTools.innerHTML = `<button id="logoutBtn" class="logout-btn">Logout</button>`;
        document.getElementById('logoutBtn').onclick = () => auth.signOut();
    } else {
        currentUserId = null;
        allowNSFW = false;
        headerTools.innerHTML = `<button onclick="window.location.href='../login/'" class="login-btn">Login / Signup</button>`;
    }

    restoreStateFromURL();
    applyFilters();
    renderCurrentPage();

    // Init public lists
    handleListSearch();
});


// -- SEARCH SUGGESTIONS --
const searchSuggestions = document.getElementById('searchSuggestions');

function updateSearchSuggestions() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
        searchSuggestions.innerHTML = '';
        return;
    }

    const seenTexts = new Set();
    const tagMatches = [];
    const ageMatches = [];
    const nameMatches = [];

    // Helper to add unique matches to buckets
    function addUnique(bucket, text, type) {
        if (!text) return;
        const lower = text.toLowerCase();
        if (!seenTexts.has(lower)) {
            seenTexts.add(lower);
            bucket.push({ text, type });
        }
    }

    // 1. Check "draft" keyword
    if ("draft".includes(query)) {
        addUnique(tagMatches, "Draft", "tag");
    }

    // 2. Scan Items (Bucketing)
    const maxScan = 50; // internal limit to avoid lag
    let count = 0;

    for (const item of allGlobalItems) {
        if (count > allGlobalItems.length && count > 2000) break; // Safety break for huge lists
        count++;

        // Tags
        if (item.tags) {
            for (const tag of item.tags) {
                if (tag.toLowerCase().includes(query)) {
                    addUnique(tagMatches, tag, 'tag');
                }
            }
        }

        // Age Rating
        if (item.itemAgeRating && item.itemAgeRating.toLowerCase().includes(query)) {
            addUnique(ageMatches, item.itemAgeRating, 'age');
        }

        // Name
        if (item.itemName && item.itemName.toLowerCase().includes(query)) {
            addUnique(nameMatches, item.itemName, 'name');
        }

        // Stop if we have plenty of matches in top buckets
        if (tagMatches.length + ageMatches.length > 20) break;
    }

    // Combine in priority: Tags > Age > Name
    const finalMatches = [...tagMatches, ...ageMatches, ...nameMatches].slice(0, 5);

    renderSearchSuggestions(finalMatches);
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

document.addEventListener('click', e => {
    if (searchSuggestions && !searchSuggestions.contains(e.target) && e.target !== searchInput) {
        searchSuggestions.innerHTML = '';
    }
});
searchInput.addEventListener('input', updateSearchSuggestions);

// -- EVENT LISTENERS --
searchBtn.onclick = handleSearch;
clearSearchBtn.onclick = handleClearSearch;
searchInput.onkeypress = e => { if (e.key === 'Enter') handleSearch(); };

prevPageBtn.onclick = prevPageBtnTop.onclick = handlePrev;
nextPageBtn.onclick = nextPageBtnTop.onclick = handleNext;


// --- PUBLIC LISTS LOGIC ---
const LISTS_PER_PAGE = 6;
let publicListsPage = 1;
const listSearchInput = document.getElementById('listSearchInput');

function handleListSearch() {
    const query = (listSearchInput ? listSearchInput.value : "").trim().toLowerCase();
    publicListsPage = 1;

    // Filter lists
    const filteredLists = allGlobalLists.filter(list => {
        if (list.privacy !== 'public') return false;

        if (query) {
            return (list.name || "").toLowerCase().includes(query);
        }
        return true;
    });

    renderPublicLists(filteredLists);
}

function renderPublicLists(lists) {
    const grid = document.getElementById('publicListsGrid');
    if (!grid) return;

    grid.innerHTML = '';

    // Simple pagination for lists if we want, or just show top N
    // search.js original code did fetching per page. Let's slice.
    const start = (publicListsPage - 1) * LISTS_PER_PAGE;
    const end = start + LISTS_PER_PAGE;
    const pagedLists = lists.slice(start, end);

    if (pagedLists.length === 0) {
        grid.innerHTML = '<p>No public lists found.</p>';
        return;
    }

    pagedLists.forEach(list => {
        const card = document.createElement('a');
        card.href = `../lists/?list=${list.id}&type=public`;
        card.className = 'item-card-link';

        const listIcon = list.mode === 'live' ? 'bi-journal-code' : 'bi-journal-bookmark-fill';
        const itemsCount = list.items ? list.items.length : 0; // if count is stored not array

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
                        <span>List</span>
                        ${list.mode === 'live' ? '<span class="badge-live">LIVE</span>' : ''}
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

if (listSearchInput) {
    listSearchInput.addEventListener('input', handleListSearch);
}