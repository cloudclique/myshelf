import { auth, db, collectionName } from '../firebase-config.js';

// --- Constants ---
const ITEMS_PER_PAGE = 32;
const COMMENTS_PER_PAGE = 10;

let commentsCurrentPage = 1;
let pageCursors = [null]; // cursors for Firestore pagination

const STATUS_OPTIONS = ['Owned', 'Wished', 'Ordered'];
// This constant already uses a URL, so it's fit for purpose
const DEFAULT_IMAGE_URL = 'https://placehold.co/150x150/444/eee?text=No+Image';
const DEFAULT_BANNER_URL = 'https://placehold.co/1000x200/555/eee?text=User+Profile+Banner'; 

// --- Variables ---
let targetUserId = null;
let targetUsername = 'User Profile';
let currentStatusFilter = 'Owned';
let currentPage = 1;
let lastFetchedItems = []; 
let currentSortValue = ''; 
let isProfileOwner = false;

// --- DOM Elements ---

const profileLoader = document.getElementById('profileLoader');

const profileItemsGrid = document.getElementById('profileItemsGrid');
const statusFilters = document.getElementById('statusFilters');
const loadingStatus = document.getElementById('loadingStatus');
const profileTitle = document.getElementById('profileTitle'); 
const paginationContainer = document.getElementById('paginationContainer');

const profileSearchInput = document.getElementById('profileSearchInput');
const profileSearchBtn = document.getElementById('profileSearchBtn');
const profileClearSearchBtn = document.getElementById('profileClearSearchBtn');

const sortSelect = document.getElementById('sortSelect');
const tagFilterDropdown = document.getElementById('tagFilterDropdown');
const applyFilterBtn = document.getElementById('applyFilterBtn');
const clearFilterBtn = document.getElementById('clearFilterBtn');
const openChatBtn = document.getElementById('openChatBtn');

const profileBanner = document.getElementById('profileBanner');

// NEW: Gallery elements
const viewMoreGalleryBtn = document.getElementById('viewMoreGalleryBtn');


// --- Comment / Auth DOM ---
const addCommentBox = document.getElementById('addCommentBox');
const loginToCommentMsg = document.getElementById('loginToComment');
const postCommentBtn = document.getElementById('postCommentBtn');
const headerTools = document.getElementById('headerTools');

// --- Event Listeners ---
if (profileSearchBtn) profileSearchBtn.onclick = handleProfileSearch;
if (profileClearSearchBtn) profileClearSearchBtn.onclick = handleProfileClearSearch;
if (profileSearchInput) profileSearchInput.onkeypress = (e) => { if (e.key === 'Enter') handleProfileSearch(); };

if (sortSelect) sortSelect.onchange = applySortAndFilter;
if (tagFilterDropdown) tagFilterDropdown.onchange = applySortAndFilter;
if (applyFilterBtn) applyFilterBtn.onclick = applySortAndFilter;
if (clearFilterBtn) clearFilterBtn.onclick = () => {
  if (tagFilterDropdown) tagFilterDropdown.value = '';
  applySortAndFilter();
};


if (postCommentBtn) postCommentBtn.onclick = postComment;

// --- URL Hash and Query Helpers ---
function getUserIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('uid');
}

function updateURLHash() {
    const searchQuery = profileSearchInput.value.trim().replace(/\s+/g, '-'); // replace spaces with dashes
    const searchPart = searchQuery ? `+search=${encodeURIComponent(searchQuery)}` : '';
    history.replaceState(
        null, 
        '', 
        `?uid=${targetUserId}#${currentStatusFilter}+${currentPage}${searchPart}`
    );
}

function parseURLHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return { status: 'Owned', page: 1, search: '' };

    // Match status+page and optional search part
    const match = raw.match(/^([A-Za-z]+)\+(\d+)(\+search=(.*))?$/);
    if (match) {
        const status = match[1];
        const page = parseInt(match[2], 10) || 1;
        const search = match[4] ? decodeURIComponent(match[4].replace(/-/g, ' ')) : '';
        if (STATUS_OPTIONS.includes(status)) return { status, page, search };
    }

    return { status: 'Owned', page: 1, search: '' };
}

// --- Firestore Helpers ---
function getUserCollectionRef(userId) {
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  return db.collection('artifacts').doc(appId)
           .collection('user_profiles').doc(userId)
           .collection('items');
}

function getUserProfileDocRef(userId) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return db.collection('artifacts').doc(appId)
             .collection('user_profiles').doc(userId);
}

/**
 * Returns the reference to the public Gallery collection: /artifacts/{appId}/gallery
 */
function getGalleryCollectionRef() {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    // Path based on user feedback: /artifacts/{appId}/gallery/{imageId}
    return db.collection('artifacts').doc(appId).collection('gallery');
}


async function fetchUsername(userId) {
    if (!userId) return 'Unknown User';
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const profileDocRef = db.collection('artifacts').doc(appId).collection('user_profiles').doc(userId);
        const docSnap = await profileDocRef.get();
        return docSnap.exists ? (docSnap.data().username || 'User Profile') : 'Unknown User';
    } catch (e) {
        console.error("Error fetching username:", e);
        return 'User Profile';
    }
}

async function fetchStatusCounts(userId) {
  const counts = { Owned: 0, Wished: 0, Ordered: 0 };
  if (!userId) return counts;

  try {
    const userCollectionRef = getUserCollectionRef(userId);
    const snapshot = await userCollectionRef.get();
    snapshot.forEach(doc => {
      const status = doc.data().status;
      if (STATUS_OPTIONS.includes(status)) counts[status]++;
    });
  } catch (err) {
    console.error("Error fetching status counts:", err);
  }

  return counts;
}

// --- Banner Functions ---
async function fetchAndRenderBanner(userId) {
    if (!userId || !profileBanner) return;
    try {
        const userDoc = await getUserProfileDocRef(userId).get();
        const bannerBase64 = userDoc.data()?.bannerBase64;
        profileBanner.src = bannerBase64 || DEFAULT_BANNER_URL;
        const finalBannerSrc = bannerBase64 || DEFAULT_BANNER_URL;
        profileBanner.src = finalBannerSrc;
    } catch (err) {
        console.error("Error fetching banner:", err);
        profileBanner.src = DEFAULT_BANNER_URL;
    }
}

// --- Initialize Profile ---
async function initializeProfile() {
    // --- SHOW LOADER ---
    if (profileLoader) profileLoader.classList.remove('hidden');

    targetUserId = getUserIdFromUrl();

    if (!targetUserId) {
        profileTitle.textContent = 'Error: No User ID Provided';
        loadingStatus.textContent = 'Please return to the Users search page.';
        if (profileLoader) profileLoader.classList.add('hidden');
        return;
    }

    // Set up the "View Full Collection" button
    if (viewMoreGalleryBtn) {
        viewMoreGalleryBtn.onclick = () => {
            window.location.href = `../?uid=${targetUserId}`;
        };
    }

    await fetchAndRenderBanner(targetUserId);
    targetUsername = await fetchUsername(targetUserId);
    profileTitle.textContent = `${targetUsername}'s Collection`;

    const currentUser = auth.currentUser;
    isProfileOwner = currentUser && targetUserId === currentUser.uid;

    if (openChatBtn) {
        customizeHeaderForOwner(); 
    }

    // --- Parse URL hash (status, page, search) ---
    const { status: hashStatus, page: hashPage, search: hashSearch } = parseURLHash();
    currentStatusFilter = STATUS_OPTIONS.includes(hashStatus) ? hashStatus : 'Owned';
    currentPage = hashPage || 1;

    // --- Render Status Buttons ---
    await renderStatusButtons();

    // --- Fetch Profile Items ---
    await fetchProfileItems(currentStatusFilter);

    // --- Apply search from hash if present ---
    if (hashSearch) {
        profileSearchInput.value = hashSearch;
        await handleProfileSearch(); // triggers multi-keyword search
    } else {
        // Show the current page items if no search
        renderPageItems(lastFetchedItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE));
    }

    // --- Load comments ---
    await loadComments(targetUserId);

    // --- Load gallery preview ---
    await fetchAndRenderGalleryPreview(targetUserId);

    // --- HIDE LOADER ---
    if (profileLoader) profileLoader.classList.add('hidden');
}

// --- Status Buttons ---
async function renderStatusButtons() {
  if (!targetUserId) return;
  statusFilters.innerHTML = '';

  const counts = await fetchStatusCounts(targetUserId);

  STATUS_OPTIONS.forEach(status => {
    const button = document.createElement('button');
    button.textContent = `${status} (${counts[status] || 0})`;
    button.className = `status-tab ${status === currentStatusFilter ? 'active' : ''}`;
    
    button.onclick = () => {
      currentStatusFilter = status;
      currentPage = 1;
      document.querySelectorAll('.status-tab').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      fetchProfileItems(status);
      updateURLHash();
    };
    statusFilters.appendChild(button);
  });
}

// --- Fetch Collection ---
async function fetchProfileItems(status) {
  if (!targetUserId) return;
  profileItemsGrid.innerHTML = '';
  paginationContainer.innerHTML = '';
  loadingStatus.textContent = `Loading ${targetUsername}'s ${status.toLowerCase()} items...`;

  currentPage = 1;
  await fetchPage();
}

async function fetchPage() {
  if (!targetUserId) return;

  profileItemsGrid.innerHTML = '';
  loadingStatus.textContent = `Loading collection data...`;

  try {
    const userCollectionRef = getUserCollectionRef(targetUserId);
    const snapshot = await userCollectionRef.where('status', '==', currentStatusFilter).get();
    
    if (snapshot.empty) {
      lastFetchedItems = [];
      renderPageItems([]);
      loadingStatus.textContent = `${targetUsername} has no items in the "${currentStatusFilter}" collection.`;
      return;
    }

    const mainCollectionRef = db.collection(collectionName);
    const detailedItems = await Promise.all(snapshot.docs.map(async doc => {
      const itemDoc = await mainCollectionRef.doc(doc.data().itemId).get();
      if (!itemDoc.exists) return null;
      return { doc: itemDoc, status: doc.data().status }; 
    }));

    lastFetchedItems = detailedItems.filter(Boolean);
    applySortAndFilter();
  } catch (err) {
    console.error(err);
    loadingStatus.textContent = `Error loading collection: ${err.message}`;
  }
}



// --- Render Items ---
function renderPageItems(items) {
  profileItemsGrid.innerHTML = '';
  loadingStatus.textContent = ''; 
  items.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status)));
  renderPaginationButtons();
}


function renderProfileItem(doc, status) {
  const item = doc.data();
  const itemId = doc.id;
  const link = document.createElement('a');
  link.href = `../items/?id=${itemId}`;
  link.className = 'item-card-link';

  const card = document.createElement('div');
  card.className = 'item-card';
  card.setAttribute('data-status', status.toLowerCase());

  // *** MODIFIED LOGIC START: Access the 'url' field of the first object in itemImageUrls ***
  let imageSrc = (item.itemImageUrls && item.itemImageUrls[0] && item.itemImageUrls[0].url) || DEFAULT_IMAGE_URL;

  const imageWrapper = document.createElement('div');
  imageWrapper.className = 'item-image-wrapper';
  const img = document.createElement('img');
  img.src = imageSrc;
  img.alt = item.itemName;
  img.className = 'item-image';

  const horAlign = (item['img-align-hor'] || 'center').toLowerCase();
  const verAlign = (item['img-align-ver'] || 'center').toLowerCase();
  img.classList.add(`img-align-hor-${['left', 'center', 'right'].includes(horAlign) ? horAlign : 'center'}`);
  img.classList.add(`img-align-ver-${['top', 'center', 'bottom'].includes(verAlign) ? verAlign : 'center'}`);

  imageWrapper.appendChild(img);

  const info = document.createElement('div');
  info.className = 'item-info';
  const title = document.createElement('h3');
  title.textContent = item.itemName;

  const badge = document.createElement('span');
  switch (currentSortValue) {
    case 'ageAsc':
    case 'ageDesc':
      badge.textContent = item.itemAgeRating ?? 'N/A';
      break;
    case 'scaleAsc':
    case 'scaleDesc':
      badge.textContent = item.itemScale ?? 'N/A';
      break;
    case 'releaseAsc':
    case 'releaseDesc':
      badge.textContent = item.itemReleaseDate ? new Date(item.itemReleaseDate).toLocaleDateString() : 'N/A';
      break;
    default:
      badge.textContent = status; 
      break;
  }

  info.appendChild(title);
  info.appendChild(badge);

  card.appendChild(imageWrapper);
  card.appendChild(info);
  link.appendChild(card);
  return link;
}

// --- Pagination ---
function renderPaginationButtons() {
  if (!paginationContainer) return;
  paginationContainer.innerHTML = '';

  const totalItems = lastFetchedItems.length;
  if (totalItems <= ITEMS_PER_PAGE) return;

  const prevBtn = document.createElement('button');
  prevBtn.textContent = 'Previous';
  prevBtn.className = 'action-btn';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => { currentPage--; applySortAndFilter(); updateURLHash(); };
  paginationContainer.appendChild(prevBtn);

  const pageIndicator = document.createElement('span');
  pageIndicator.textContent = `Page ${currentPage}`;
  pageIndicator.className = 'page-indicator';
  paginationContainer.appendChild(pageIndicator);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next';
  nextBtn.className = 'action-btn';
  nextBtn.disabled = (currentPage * ITEMS_PER_PAGE >= totalItems);
  nextBtn.onclick = () => { currentPage++; applySortAndFilter(); updateURLHash(); };
  paginationContainer.appendChild(nextBtn);
}

// --- Enhanced Search ---
async function handleProfileSearch() {
    const queryText = profileSearchInput.value.trim().toLowerCase();
    if (!targetUserId) return handleProfileClearSearch();

    profileItemsGrid.innerHTML = '';
    loadingStatus.textContent = `Searching ${currentStatusFilter.toLowerCase()} items...`;

    const keywords = queryText.split(/\s+/);

    const filtered = lastFetchedItems.filter(item => {
        const data = item.doc.data();
        const searchable = [
            data.itemName || '',
            (data.tags || []).join(' '),
            data.itemCategory || '',
            data.itemScale || '',
            data.itemAgeRating || ''
        ].join(' ').toLowerCase();

        return keywords.every(kw => searchable.includes(kw));
    });

    profileItemsGrid.innerHTML = '';
    filtered.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status)));
    loadingStatus.textContent = `${filtered.length} item(s) found.`;
    profileClearSearchBtn.style.display = 'inline-block';

    currentPage = 1; // Reset to page 1 for new search
    updateURLHash(); // Include search in hash
}

function handleProfileClearSearch() {
    profileSearchInput.value = '';
    profileClearSearchBtn.style.display = 'none';
    renderPageItems(lastFetchedItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE));
    updateURLHash(); // Clear search from hash
}

import { auth, db, collectionName } from '../firebase-config.js';

// --- Constants ---
const ITEMS_PER_PAGE = 32;
const COMMENTS_PER_PAGE = 10;
const STATUS_OPTIONS = ['Owned', 'Wished', 'Ordered'];
const DEFAULT_IMAGE_URL = 'https://placehold.co/150x150/444/eee?text=No+Image';
const DEFAULT_BANNER_URL = 'https://placehold.co/1000x200/555/eee?text=User+Profile+Banner';

let targetUserId = null;
let targetUsername = 'User Profile';
let currentStatusFilter = 'Owned';
let currentPage = 1;
let lastFetchedItems = [];
let currentSortValue = '';
let isProfileOwner = false;
let allowNSFW = false;

// --- DOM Elements ---
const profileLoader = document.getElementById('profileLoader');
const profileItemsGrid = document.getElementById('profileItemsGrid');
const statusFilters = document.getElementById('statusFilters');
const loadingStatus = document.getElementById('loadingStatus');
const profileTitle = document.getElementById('profileTitle');
const paginationContainer = document.getElementById('paginationContainer');

const profileSearchInput = document.getElementById('profileSearchInput');
const profileSearchBtn = document.getElementById('profileSearchBtn');
const profileClearSearchBtn = document.getElementById('profileClearSearchBtn');
const sortSelect = document.getElementById('sortSelect');
const tagFilterDropdown = document.getElementById('tagFilterDropdown');
const applyFilterBtn = document.getElementById('applyFilterBtn');
const clearFilterBtn = document.getElementById('clearFilterBtn');
const openChatBtn = document.getElementById('openChatBtn');
const profileBanner = document.getElementById('profileBanner');
const viewMoreGalleryBtn = document.getElementById('viewMoreGalleryBtn');
const addCommentBox = document.getElementById('addCommentBox');
const loginToCommentMsg = document.getElementById('loginToComment');
const postCommentBtn = document.getElementById('postCommentBtn');
const headerTools = document.getElementById('headerTools');
let commentsCurrentPage = 1;
let pageCursors = [null]; // For comment pagination

// --- Event Listeners ---
if (profileSearchBtn) profileSearchBtn.onclick = handleProfileSearch;
if (profileClearSearchBtn) profileClearSearchBtn.onclick = handleProfileClearSearch;
if (profileSearchInput) profileSearchInput.onkeypress = e => { if (e.key === 'Enter') handleProfileSearch(); };
if (sortSelect) sortSelect.onchange = applySortAndFilter;
if (tagFilterDropdown) tagFilterDropdown.onchange = applySortAndFilter;
if (applyFilterBtn) applyFilterBtn.onclick = applySortAndFilter;
if (clearFilterBtn) clearFilterBtn.onclick = () => { if (tagFilterDropdown) tagFilterDropdown.value = ''; applySortAndFilter(); };
if (postCommentBtn) postCommentBtn.onclick = postComment;

// --- URL Helpers ---
function getUserIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('uid');
}
function updateURLHash() {
    const searchQuery = profileSearchInput.value.trim().replace(/\s+/g, '-');
    const searchPart = searchQuery ? `+search=${encodeURIComponent(searchQuery)}` : '';
    history.replaceState(null, '', `?uid=${targetUserId}#${currentStatusFilter}+${currentPage}${searchPart}`);
}
function parseURLHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return { status: 'Owned', page: 1, search: '' };
    const match = raw.match(/^([A-Za-z]+)\+(\d+)(\+search=(.*))?$/);
    if (match) {
        const status = match[1];
        const page = parseInt(match[2], 10) || 1;
        const search = match[4] ? decodeURIComponent(match[4].replace(/-/g, ' ')) : '';
        if (STATUS_OPTIONS.includes(status)) return { status, page, search };
    }
    return { status: 'Owned', page: 1, search: '' };
}

// --- Firestore Helpers ---
function getUserCollectionRef(userId) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return db.collection('artifacts').doc(appId)
             .collection('user_profiles').doc(userId)
             .collection('items');
}
function getUserProfileDocRef(userId) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return db.collection('artifacts').doc(appId)
             .collection('user_profiles').doc(userId);
}
function getGalleryCollectionRef() {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return db.collection('artifacts').doc(appId).collection('gallery');
}

// --- Fetch Helpers ---
async function fetchUsername(userId) {
    if (!userId) return 'Unknown User';
    try {
        const docSnap = await getUserProfileDocRef(userId).get();
        return docSnap.exists ? (docSnap.data().username || 'User Profile') : 'Unknown User';
    } catch (e) { console.error(e); return 'User Profile'; }
}
async function fetchStatusCounts(userId) {
    const counts = { Owned: 0, Wished: 0, Ordered: 0 };
    if (!userId) return counts;
    try {
        const snapshot = await getUserCollectionRef(userId).get();
        snapshot.forEach(doc => { const status = doc.data().status; if (STATUS_OPTIONS.includes(status)) counts[status]++; });
    } catch (err) { console.error(err); }
    return counts;
}

// --- Banner ---
async function fetchAndRenderBanner(userId) {
    if (!userId || !profileBanner) return;
    try {
        const userDoc = await getUserProfileDocRef(userId).get();
        const bannerBase64 = userDoc.data()?.bannerBase64;
        profileBanner.src = bannerBase64 || DEFAULT_BANNER_URL;
    } catch (err) { console.error(err); profileBanner.src = DEFAULT_BANNER_URL; }
}

// --- NSFW Helper ---
async function checkAllowNSFW() {
    const currentUser = auth.currentUser;
    if (!currentUser) { allowNSFW = false; return; }
    try {
        const doc = await getUserProfileDocRef(currentUser.uid).get();
        allowNSFW = doc.exists ? doc.data()?.allowNSFW === true : false;
    } catch (err) { console.error(err); allowNSFW = false; }
}

// --- Initialize Profile ---
async function initializeProfile() {
    if (profileLoader) profileLoader.classList.remove('hidden');

    targetUserId = getUserIdFromUrl();
    if (!targetUserId) { profileTitle.textContent = 'Error: No User ID Provided'; loadingStatus.textContent = 'Please return to the Users search page.'; if (profileLoader) profileLoader.classList.add('hidden'); return; }

    if (viewMoreGalleryBtn) viewMoreGalleryBtn.onclick = () => window.location.href = `../?uid=${targetUserId}`;
    await fetchAndRenderBanner(targetUserId);
    targetUsername = await fetchUsername(targetUserId);
    profileTitle.textContent = `${targetUsername}'s Collection`;

    const currentUser = auth.currentUser;
    isProfileOwner = currentUser && targetUserId === currentUser.uid;
    await checkAllowNSFW();

    if (openChatBtn) customizeHeaderForOwner();
    const { status: hashStatus, page: hashPage, search: hashSearch } = parseURLHash();
    currentStatusFilter = STATUS_OPTIONS.includes(hashStatus) ? hashStatus : 'Owned';
    currentPage = hashPage || 1;

    await renderStatusButtons();
    await fetchProfileItems(currentStatusFilter);

    if (hashSearch) { profileSearchInput.value = hashSearch; await handleProfileSearch(); }
    else renderPageItems(lastFetchedItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE));

    await loadComments(targetUserId);
    await fetchAndRenderGalleryPreview(targetUserId);

    if (profileLoader) profileLoader.classList.add('hidden');
}

// --- Status Buttons ---
async function renderStatusButtons() {
    if (!targetUserId) return;
    statusFilters.innerHTML = '';
    const counts = await fetchStatusCounts(targetUserId);
    STATUS_OPTIONS.forEach(status => {
        const button = document.createElement('button');
        button.textContent = `${status} (${counts[status] || 0})`;
        button.className = `status-tab ${status === currentStatusFilter ? 'active' : ''}`;
        button.onclick = () => { currentStatusFilter = status; currentPage = 1; document.querySelectorAll('.status-tab').forEach(btn => btn.classList.remove('active')); button.classList.add('active'); fetchProfileItems(status); updateURLHash(); };
        statusFilters.appendChild(button);
    });
}

// --- Fetch Profile Items ---
async function fetchProfileItems(status) {
    if (!targetUserId) return;
    profileItemsGrid.innerHTML = '';
    paginationContainer.innerHTML = '';
    loadingStatus.textContent = `Loading ${targetUsername}'s ${status.toLowerCase()} items...`;
    currentPage = 1;
    await fetchPage();
}
async function fetchPage() {
    if (!targetUserId) return;
    profileItemsGrid.innerHTML = '';
    loadingStatus.textContent = `Loading collection data...`;
    try {
        const snapshot = await getUserCollectionRef(targetUserId).where('status', '==', currentStatusFilter).get();
        if (snapshot.empty) { lastFetchedItems = []; renderPageItems([]); loadingStatus.textContent = `${targetUsername} has no items in "${currentStatusFilter}" collection.`; return; }

        const detailedItems = await Promise.all(snapshot.docs.map(async doc => {
            const itemDoc = await db.collection(collectionName).doc(doc.data().itemId).get();
            if (!itemDoc.exists) return null;
            return { doc: itemDoc, status: doc.data().status };
        }));
        lastFetchedItems = detailedItems.filter(Boolean);
        applySortAndFilter();
    } catch (err) { console.error(err); loadingStatus.textContent = `Error loading collection: ${err.message}`; }
}

// --- Render Items ---
function renderPageItems(items) {
    profileItemsGrid.innerHTML = '';
    loadingStatus.textContent = '';
    items.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status)));
    renderPaginationButtons();
}

function renderProfileItem(doc, status) {
    const item = doc.data();
    const itemId = doc.id;
    const link = document.createElement('a');
    link.className = 'item-card-link';

    const card = document.createElement('div');
    card.className = 'item-card';
    card.setAttribute('data-status', status.toLowerCase());

    let imageSrc = (item.itemImageUrls && item.itemImageUrls[0] && item.itemImageUrls[0].url) || DEFAULT_IMAGE_URL;

    const horAlign = (item['img-align-hor'] || 'center').toLowerCase();
    const verAlign = (item['img-align-ver'] || 'center').toLowerCase();

    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'item-image-wrapper';
    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = item.itemName || 'Item';
    img.className = `item-image img-align-hor-${horAlign} img-align-ver-${verAlign}`;
    imageWrapper.appendChild(img);

    // NSFW check
    if (item.itemAgeRating === "18+" && !allowNSFW) {
        img.style.filter = 'blur(10px)';
        img.alt = "NSFW content hidden";
        link.removeAttribute('href');
        link.style.cursor = 'not-allowed';
    } else {
        link.href = `../items/?id=${itemId}`;
    }

    const info = document.createElement('div');
    info.className = 'item-info';
    const title = document.createElement('h3'); title.textContent = item.itemName || 'Untitled';
    const badge = document.createElement('span'); badge.textContent = status;
    info.appendChild(title); info.appendChild(badge);

    card.appendChild(imageWrapper);
    card.appendChild(info);
    link.appendChild(card);
    return link;
}

// --- Pagination ---
function renderPaginationButtons() {
    if (!paginationContainer) return;
    paginationContainer.innerHTML = '';
    const totalItems = lastFetchedItems.length;
    if (totalItems <= ITEMS_PER_PAGE) return;

    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'Previous'; prevBtn.className = 'action-btn';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => { currentPage--; applySortAndFilter(); updateURLHash(); };
    const pageIndicator = document.createElement('span'); pageIndicator.textContent = `Page ${currentPage}`; pageIndicator.className = 'page-indicator';
    const nextBtn = document.createElement('button'); nextBtn.textContent = 'Next'; nextBtn.className = 'action-btn';
    nextBtn.disabled = (currentPage * ITEMS_PER_PAGE >= totalItems);
    nextBtn.onclick = () => { currentPage++; applySortAndFilter(); updateURLHash(); };

    paginationContainer.appendChild(prevBtn);
    paginationContainer.appendChild(pageIndicator);
    paginationContainer.appendChild(nextBtn);
}

// --- Sort & Filter ---
function applySortAndFilter() {
    if (!lastFetchedItems.length) return;
    currentSortValue = sortSelect?.value ?? '';
    let items = [...lastFetchedItems];

    const selectedTag = tagFilterDropdown?.value;
    if (selectedTag) items = items.filter(item => (item.doc.data().tags || []).includes(selectedTag));

    items.sort((a, b) => {
        const dataA = a.doc.data(), dataB = b.doc.data();
        const getNumber = val => typeof val === 'number' ? val : parseFloat((val || '0').toString().replace(/[^\d.]/g, '')) || 0;
        switch (currentSortValue) {
            case 'ageAsc': return getNumber(dataA.itemAgeRating) - getNumber(dataB.itemAgeRating);
            case 'ageDesc': return getNumber(dataB.itemAgeRating) - getNumber(dataA.itemAgeRating);
            case 'scaleAsc': return getNumber(dataA.itemScale) - getNumber(dataB.itemScale);
            case 'scaleDesc': return getNumber(dataB.itemScale) - getNumber(dataA.itemScale);
            case 'releaseAsc': return new Date(dataA.itemReleaseDate || 0) - new Date(dataB.itemReleaseDate || 0);
            case 'releaseDesc': return new Date(dataB.itemReleaseDate || 0) - new Date(dataA.itemReleaseDate || 0);
            default: return 0;
        }
    });

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const pagedItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    profileItemsGrid.innerHTML = '';
    pagedItems.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status)));
    loadingStatus.textContent = `${items.length} item(s) shown after filter/sort.`;

    renderPaginationButtons();
}

// --- Gallery Preview with NSFW ---
async function fetchAndRenderGalleryPreview(userId) {
    const previewGrid = document.getElementById('previewGrid');
    if (!previewGrid || !userId) return;
    previewGrid.innerHTML = '<p style="grid-column: 1/span 4; text-align: center;">Loading images...</p>';

    try {
        const gallerySnapshot = await getGalleryCollectionRef()
            .where('uploaderId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(4)
            .get();

        previewGrid.innerHTML = '';
        if (gallerySnapshot.empty) { previewGrid.innerHTML = '<p style="grid-column: 1/span 4; text-align: center; color: #888;">No uploaded gallery images found.</p>'; return; }

        gallerySnapshot.docs.forEach(doc => {
            const imageDoc = doc.data();
            const imageUrl = imageDoc.url || DEFAULT_IMAGE_URL;
            const altText = imageDoc.altText || 'User gallery image';
            const itemAge = imageDoc.itemAgeRating || '';
            const link = document.createElement('a'); link.className = 'gallery-thumbnail-link';

            if (itemAge === "18+" && !allowNSFW) { link.removeAttribute('href'); link.style.cursor = 'not-allowed'; }
            else link.href = `../items/?id=${imageDoc.itemId || '#'}`;

            const img = document.createElement('img'); img.src = imageUrl; img.alt = altText; img.className = 'gallery-thumbnail';
            img.onerror = () => img.src = DEFAULT_IMAGE_URL;
            if (itemAge === "18+" && !allowNSFW) { img.style.filter = 'blur(10px)'; img.alt = "NSFW content hidden"; }

            link.appendChild(img); previewGrid.appendChild(link);
        });
    } catch (err) { console.error(err); previewGrid.innerHTML = '<p style="grid-column: 1/span 4; text-align: center; color: red;">Failed to load gallery preview.</p>'; }
}

// --- Authentication & NSFW ---
auth.onAuthStateChanged(async user => {
    updateHeaderAuthButton(user);
    setupHeaderLogoRedirect();
    await checkAllowNSFW();
});

// --- Header & Chat ---
function updateHeaderAuthButton(user) {
    if (!headerTools) return;
    headerTools.innerHTML = '';
    const btn = document.createElement('button');
    if (user) { btn.textContent = 'Logout'; btn.className = 'logout-btn'; btn.onclick = async () => { try { await auth.signOut(); } catch (err) { console.error(err); } }; addCommentBox.style.display = 'block'; loginToCommentMsg.style.display = 'none'; }
    else { btn.textContent = 'Login'; btn.className = 'login-btn'; btn.onclick = () => { window.location.href = '../login'; }; addCommentBox.style.display = 'none'; loginToCommentMsg.style.display = 'block'; }
    headerTools.appendChild(btn);
}

function customizeHeaderForOwner() {
    if (!openChatBtn) return;
    if (isProfileOwner) { openChatBtn.textContent = 'User Settings'; openChatBtn.onclick = () => { window.location.href = '../settings'; }; enableBannerEditing(); }
    else { openChatBtn.textContent = 'Message User'; openChatBtn.onclick = () => startChatWithUser(); }
}

// --- Banner Editing ---
function enableBannerEditing() {
    if (!profileBanner || !isProfileOwner) return;
    const bannerContainer = document.querySelector('.profile-banner-container');
    if (!bannerContainer) return;

    const editOverlay = document.createElement('div');
    editOverlay.className = 'banner-edit-overlay';
    editOverlay.innerHTML = 'Click to Change Banner';
    editOverlay.style.cssText = `
        position: absolute; top:0; left:0; width:100%; height:100%;
        background-color: rgba(0,0,0,0.5); color:white; display:flex;
        align-items:center; justify-content:center; cursor:pointer; opacity:0;
        transition: opacity 0.3s; font-size:1.2em; font-weight:bold;
    `;
    bannerContainer.style.position = 'relative';
    bannerContainer.appendChild(editOverlay);
    bannerContainer.onmouseover = () => editOverlay.style.opacity = '1';
    bannerContainer.onmouseout = () => editOverlay.style.opacity = '0';
    editOverlay.onclick = handleBannerEdit;
}

async function handleBannerEdit() {
    const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/*';
    fileInput.onchange = async e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async event => {
            let base64Image = event.target.result;
            const MAX_SIZE_MB = 1; if (file.size > MAX_SIZE_MB*1024*1024) base64Image = await resizeImage(base64Image, MAX_SIZE_MB*1024*1024);
            const croppedBase64 = await showCropPopup(base64Image); if (!croppedBase64) return;
            profileBanner.src = croppedBase64;
            try {
                const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
                await db.collection('artifacts').doc(appId).collection('user_profiles').doc(targetUserId).set({ bannerBase64: croppedBase64 }, { merge: true });
            } catch (err) { console.error(err); alert("Error saving banner."); }
        };
        reader.readAsDataURL(file);
    };
    fileInput.click();
}

// --- Crop/Resize Helpers ---
function showCropPopup(base64Image) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';
        const popup = document.createElement('div'); popup.style.cssText = 'background:#fff;border-radius:8px;padding:10px;position:relative;max-width:90%;max-height:80%;overflow:hidden;';
        overlay.appendChild(popup); document.body.appendChild(overlay);
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
        const img = new Image(); img.src = base64Image;
        img.onload = () => {
            const canvasWidth = 1000; const canvasHeight = 200; canvas.width = canvasWidth; canvas.height = canvasHeight;
            const scale = Math.max(canvasWidth / img.width, canvasHeight / img.height);
            const scaledWidth = img.width*scale; const scaledHeight = img.height*scale;
            let offsetX = (canvasWidth-scaledWidth)/2, offsetY = 0; const maxOffsetY = Math.max(0, scaledHeight-canvasHeight);
            const draw = () => { ctx.clearRect(0,0,canvasWidth,canvasHeight); ctx.drawImage(img,0,offsetY/scale,img.width,canvasHeight/scale,offsetX,0,scaledWidth,canvasHeight); };
            draw();
            let dragging=false,startY=0;
            canvas.onmousedown = e=>{ dragging=true; startY=e.clientY; };
            const onMouseMove = e=>{ if(!dragging)return; offsetY=Math.min(Math.max(offsetY-(e.clientY-startY),0),maxOffsetY); startY=e.clientY; draw(); };
            const onMouseUp = () => { dragging=false; };
            window.addEventListener('mousemove',onMouseMove); window.addEventListener('mouseup',onMouseUp);
            const cleanup = ()=>{ window.removeEventListener('mousemove',onMouseMove); window.removeEventListener('mouseup',onMouseUp); };
            const btnContainer = document.createElement('div'); btnContainer.style.cssText="text-align:center;margin-top:10px;";
            const okBtn = document.createElement('button'); okBtn.textContent="Save";
            const cancelBtn = document.createElement('button'); cancelBtn.textContent="Cancel"; cancelBtn.style.marginLeft="10px";
            btnContainer.appendChild(okBtn); btnContainer.appendChild(cancelBtn); popup.appendChild(btnContainer);
            okBtn.onclick = ()=>{ cleanup(); document.body.removeChild(overlay); resolve(canvas.toDataURL('image/jpeg',0.9)); };
            cancelBtn.onclick = ()=>{ cleanup(); document.body.removeChild(overlay); resolve(null); };
        };
        popup.appendChild(canvas);
    });
}

async function resizeImage(base64Str,maxBytes){return new Promise(resolve=>{const img=new Image();img.onload=()=>{let canvas=document.createElement('canvas');let ctx=canvas.getContext('2d');let [w,h]=[img.width,img.height];let scale=0.9;canvas.width=w;canvas.height=h;ctx.drawImage(img,0,0,w,h);let data=canvas.toDataURL('image/jpeg',0.9);let quality=0.9;while(data.length>maxBytes&&quality>0.1){quality-=0.05;canvas.width=w*scale;canvas.height=h*scale;ctx.drawImage(img,0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/jpeg',quality);scale*=0.9;}resolve(data);};img.src=base64Str;});}

// --- Chat ---
async function startChatWithUser() {
    const loggedUser = auth.currentUser;
    if (!loggedUser) { alert("You must be logged in to start a chat."); return; }
    const myId = loggedUser.uid;
    const otherId = targetUserId;
    if (!otherId || myId===otherId) return alert("Unable to message this user.");
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const chatId = [myId,otherId].sort().join('_');
    const chatRef = db.collection('artifacts').doc(appId).collection('chats').doc(chatId);
    try { await chatRef.set({ users:[myId,otherId], lastMessage:'', lastSent:new Date(0) },{merge:true}); window.location.href=`../chat/?chat=${otherId}`; }
    catch(e){console.error(e); alert("Could not start chat."); }
}

// --- Comments ---
async function loadComments(profileUserId) {
    const commentsList = document.getElementById('commentsList');
    commentsList.innerHTML='<p>Loading comments...</p>';
    const appId = typeof __app_id!=='undefined'?__app_id:'default-app-id';
    const currentUser = auth.currentUser; const currentUid=currentUser?currentUser.uid:null;
    let currentUserRole=null; if(currentUid){try{const roleDoc=await db.collection('artifacts').doc(appId).collection('user_profiles').doc(currentUid).get();currentUserRole=roleDoc.data()?.role||null;}catch(err){console.error(err);}}
    const startDoc = pageCursors[commentsCurrentPage-1]||null;
    let query=db.collection('artifacts').doc(appId).collection('user_profiles').doc(profileUserId).collection('comments').orderBy('timestamp','desc').limit(COMMENTS_PER_PAGE);
    if(startDoc) query=query.startAfter(startDoc);
    const snapshot=await query.get();
    if(snapshot.empty){commentsList.innerHTML='<p>No comments yet.</p>'; if(commentsCurrentPage>1) commentsCurrentPage--; return;}
    commentsList.innerHTML='';
    snapshot.forEach(doc=>{const c=doc.data();const commentId=doc.id;const time=c.timestamp?.toDate().toLocaleString()||'Just now';const isOwner=currentUid===c.userId;const isProfileOwner=currentUid===profileUserId;const isAdminOrMod=['admin','mod'].includes(currentUserRole);const canDelete=isOwner||isProfileOwner||isAdminOrMod;
        const div=document.createElement('div'); div.className='comment';
        div.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:5px;">
                ${canDelete?`<button class="delete-comment-btn" data-id="${commentId}" title="Delete comment">&times;</button>`:''}
                <a href="../user/?uid=${c.userId}" class="comment-author" style="text-decoration:underline;">${linkify(c.displayName||'User')}</a>
            </div>
            <div style="font-size:0.8em;color:#888;">${time}</div>
        </div>
        <div class="comment-text">${linkify(c.text)}</div>`;
        commentsList.appendChild(div);
        if(canDelete) div.querySelector('.delete-comment-btn').onclick=()=>{showConfirmationModal("Are you sure you want to delete this comment?",async()=>{try{await db.collection('artifacts').doc(appId).collection('user_profiles').doc(profileUserId).collection('comments').doc(commentId).delete();commentsCurrentPage=1;pageCursors=[null];loadComments(profileUserId);}catch(err){console.error(err);}});};
    });
    if(snapshot.docs.length===COMMENTS_PER_PAGE){const lastDoc=snapshot.docs[snapshot.docs.length-1];if(pageCursors.length===commentsCurrentPage)pageCursors.push(lastDoc);}else pageCursors.length=commentsCurrentPage;
    renderCommentPagination(profileUserId);
}
async function postComment(event){if(event)event.preventDefault();const currentUser=auth.currentUser;if(!currentUser)return;const input=document.getElementById('commentInput');const text=input.value.trim();if(!text)return;input.value='';const appId=typeof __app_id!=='undefined'?__app_id:'default-app-id';try{await db.collection('artifacts').doc(appId).collection('user_profiles').doc(targetUserId).collection('comments').add({userId:currentUser.uid,displayName:currentUser.displayName||currentUser.email||'Anonymous',text,timestamp:firebase.firestore.FieldValue.serverTimestamp()});commentsCurrentPage=1;pageCursors=[null];loadComments(targetUserId);}catch(err){console.error(err);}}
function renderCommentPagination(profileUserId){const container=document.getElementById('commentPagination');if(!container)return;container.innerHTML='';const prevBtn=document.createElement('button');prevBtn.style.margin='20px';prevBtn.className='action-btn';prevBtn.textContent='Previous';prevBtn.disabled=commentsCurrentPage===1;prevBtn.onclick=()=>{commentsCurrentPage--;loadComments(profileUserId);};const nextBtn=document.createElement('button');nextBtn.style.margin='20px';nextBtn.className='action-btn';nextBtn.textContent='Next';nextBtn.disabled=pageCursors.length<=commentsCurrentPage;nextBtn.onclick=()=>{commentsCurrentPage++;loadComments(profileUserId);};const pageIndicator=document.createElement('span');pageIndicator.textContent=`Page ${commentsCurrentPage}`;container.appendChild(prevBtn);container.appendChild(pageIndicator);container.appendChild(nextBtn);}
function showConfirmationModal(message,onConfirm){const modal=document.getElementById('confirmationModal');const textEl=document.getElementById('confirmationText');const yesBtn=document.getElementById('confirmYesBtn');const noBtn=document.getElementById('confirmNoBtn');textEl.textContent=message;modal.style.display='flex';function cleanup(){modal.style.display='none';yesBtn.onclick=null;noBtn.onclick=null;}yesBtn.onclick=()=>{cleanup();onConfirm();};noBtn.onclick=cleanup;}

// --- Utility ---
function linkify(text){const urlPattern=/(\b(https?:\/\/|www\.)[^\s]+\b)/g;return text.replace(urlPattern,url=>{let fullUrl=url;if(url.startsWith('www.'))fullUrl='http://'+url;return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;});}

// --- Header Logo ---
function setupHeaderLogoRedirect() {
    const logo = document.querySelector('.header-logo'); if(!logo)return;
    logo.style.cursor='pointer'; logo.onclick=()=>{
        const currentUser=auth.currentUser; if(!currentUser){alert("You must be logged in to view your profile.");return;}
        window.location.href=`../user/?uid=${currentUser.uid}`;
    };
}

// --- Start ---
initializeProfile();
window.addEventListener('hashchange',initializeProfile);
