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

const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageStatusElement = document.getElementById('pageStatus');

const prevPageBtnTop = document.getElementById('prevPageBtnTop');
const nextPageBtnTop = document.getElementById('nextPageBtnTop');
const pageStatusElementTop = document.getElementById('pageStatusTop');

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const clearSearchBtn = document.getElementById('clearSearchBtn');

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

    const horAlign = itemData['img-align-hor']?.toLowerCase() || 'center';
    const verAlign = itemData['img-align-ver']?.toLowerCase() || 'center';
    const imageClasses = `item-image img-align-hor-${
        ['left', 'center', 'right'].includes(horAlign) ? horAlign : 'center'
    } img-align-ver-${
        ['top', 'center', 'bottom'].includes(verAlign) ? verAlign : 'center'
    }`;

    card.innerHTML = `
        <div class="item-image-wrapper">
            <img src="${imageSource}" alt="${itemData.itemName}" class="${imageClasses}">
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
    loadingStatus.textContent = 'Loading items...';

    try {
        const snapshot = await db
            .collection(collectionName)
            .orderBy('createdAt', 'desc')
            .get();

        allItems = snapshot.docs.map(doc => {
            const data = doc.data();

            if (Array.isArray(data.tags)) {
                data.tags = data.tags.map(tag => (tag || '').toLowerCase());
            }

            data.id = doc.id;
            return data;
        });

        // --- APPLY NSFW FILTER ---
        filteredItems = allItems.filter(item => {
            if (!allowNSFW && item.itemAgeRating === '18+') {
                return false;
            }
            return true;
        });

        restoreStateFromURL();
        handleSearch(false);

        loadingStatus.textContent = '';
    } catch (err) {
        console.error(err);
        loadingStatus.textContent = `Error: ${err.message}`;
    }
}

function handleSearch(resetPage = true) {
    
    const query = searchInput.value.trim().toLowerCase();

    if (!query) {
        filteredItems = allItems.filter(item => {
            if (!allowNSFW && item.itemAgeRating === '18+') return false;
            return true;
        });
    } else {
        const keywords = query.split(/\s+/).filter(Boolean);

        filteredItems = allItems.filter(item => {
            if (!allowNSFW && item.itemAgeRating === '18+') return false;

            const name = (item.itemName || '').toLowerCase();
            const tags = (item.tags || []).map(t => t.toLowerCase());
            const category = (item.itemCategory || '').toLowerCase();
            const scale = (item.itemScale || '').toLowerCase();
            const age = (item.itemAgeRating || '').toLowerCase();

            const combinedText = [name, category, scale, age, ...tags].join(' ');

            return keywords.every(kw => combinedText.includes(kw));
        });
    }

    if (resetPage) currentPage = 1;
    renderItemsWithPagination(filteredItems);
    updateURLPage();
    
}

function handleClearSearch() {
    searchInput.value = '';
    filteredItems = allItems.filter(item => {
        if (!allowNSFW && item.itemAgeRating === '18+') return false;
        return true;
    });

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
    setupHeaderLogoRedirect();
});

// -- EVENT LISTENERS --
searchBtn.onclick = () => handleSearch();
clearSearchBtn.onclick = handleClearSearch;

searchInput.onkeypress = e => {
    if (e.key === 'Enter') handleSearch();
};

prevPageBtn.onclick = prevPageBtnTop.onclick = handlePrev;
nextPageBtn.onclick = nextPageBtnTop.onclick = handleNext;

// --- Redirect logo to user profile ---
function setupHeaderLogoRedirect() {
    const logo = document.querySelector('.header-logo');
    if (!logo) return;

    logo.style.cursor = 'pointer';
    logo.onclick = () => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            alert('You must be logged in to view your profile.');
            return;
        }
        window.location.href = `../user/?uid=${currentUser.uid}`;
    };
}


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
        if (!allowNSFW && item.itemAgeRating === '18+') continue;
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
        div.innerHTML = `<span class="search-suggestion-icon">${ICONS[match.type]}</span> ${match.text}`;

        // Clicking a suggestion will fill the search bar and trigger full search
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
    if (!searchSuggestions.contains(e.target) && e.target !== searchInput) {
        searchSuggestions.innerHTML = '';
    }
});

// Attach to input event
searchInput.addEventListener('input', updateSearchSuggestions);