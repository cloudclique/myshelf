import { auth, db, collectionName } from '../firebase-config.js';

const PAGE_SIZE = 52;
const DEFAULT_IMAGE_URL = 'path/to/your/default-image.jpg';

let currentUserId = null;
let currentPage = 1;
let allItems = [];
let filteredItems = [];
let hasMore = true;

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

    let imageSource = (itemData.itemImageUrls && itemData.itemImageUrls[0] && itemData.itemImageUrls[0].url) || DEFAULT_IMAGE_URL;

    const horAlign = itemData['img-align-hor']?.toLowerCase() || 'center';
    const verAlign = itemData['img-align-ver']?.toLowerCase() || 'center';
    const imageClasses = `item-image img-align-hor-${['left','center','right'].includes(horAlign)?horAlign:'center'} img-align-ver-${['top','center','bottom'].includes(verAlign)?verAlign:'center'}`;

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

    [prevPageBtn, prevPageBtnTop].forEach(btn => btn.disabled = isPrevDisabled);
    [nextPageBtn, nextPageBtnTop].forEach(btn => btn.disabled = isNextDisabled);
    [pageStatusElement, pageStatusElementTop].forEach(span => span.textContent = `Page ${currentPage}`);
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
        const snapshot = await db.collection(collectionName).orderBy('createdAt', 'desc').get();

        allItems = snapshot.docs.map(doc => {
            const data = doc.data();

            // Normalize tags to lowercase
            if (Array.isArray(data.tags)) {
                data.tags = data.tags.map(tag => (tag || '').toLowerCase());
            }

            data.id = doc.id;
            return data;
        });

        filteredItems = [...allItems];

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
        filteredItems = [...allItems];
    } else {
        filteredItems = allItems.filter(item => {
            const nameMatch = (item.itemName || '').toLowerCase().includes(query);
            const tagMatch = (item.tags || []).some(tag => tag.includes(query));
            const categoryMatch = (item.itemCategory || '').toLowerCase().includes(query);
            const scaleMatch = (item.itemScale || '').toLowerCase().includes(query);
            const ageRatingMatch = (item.itemAgeRating || '').toLowerCase().includes(query);

            return (
                nameMatch ||
                tagMatch ||
                categoryMatch ||
                scaleMatch ||
                ageRatingMatch
            );
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

// --- AUTH ---
auth.onAuthStateChanged(user => {
    headerTools.innerHTML = '';
    if (user) {
        currentUserId = user.uid;
        headerTools.innerHTML = `<button id="logoutBtn" class="logout-btn">Logout</button>`;
        document.getElementById('logoutBtn').onclick = () => auth.signOut();
    } else {
        currentUserId = null;
        headerTools.innerHTML = `<button onclick="window.location.href='../login/'" class="login-btn">Login / Signup</button>`;
    }
    fetchAllItems();
});

// --- EVENT LISTENERS ---
searchBtn.onclick = () => handleSearch();
clearSearchBtn.onclick = handleClearSearch;

searchInput.onkeypress = e => {
    if (e.key === 'Enter') handleSearch();
};

prevPageBtn.onclick = prevPageBtnTop.onclick = handlePrev;
nextPageBtn.onclick = nextPageBtnTop.onclick = handleNext;
