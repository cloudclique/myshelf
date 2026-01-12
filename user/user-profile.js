import { auth, db, collectionName } from '../firebase-config.js';

// --- Constants ---
let ITEMS_PER_PAGE = localStorage.getItem('profileViewMode') === 'list' ? 5 : 32;
const COMMENTS_PER_PAGE = 10;
let listsCurrentPage = 1;
const LISTS_PER_PAGE = 6;
let allUserLists = [];
const STATUS_OPTIONS = ['Owned', 'Wished', 'Ordered'];
const DEFAULT_IMAGE_URL = 'https://placehold.co/150x150/444/eee?text=No+Image';
const DEFAULT_BANNER_URL = 'https://placehold.co/1000x200/555/eee?text=User+Profile+Banner';

const ROLE_HIERARCHY = {
    'admin': { assigns: ['mod', "shop", "manufacturer", "og", 'user'] },
    'mod': { assigns: ["shop", "manufacturer", "og", 'user'] },
    'user': { assigns: [] }
};

// --- Variables ---
let targetUserId = null;
let targetUsername = 'User Profile';
let currentStatusFilter = 'Owned';
let currentPage = 1;
let lastFetchedItems = [];
let currentSortValue = '';
let isProfileOwner = false;
let isNsfwAllowed = false;
let commentsCurrentPage = 1;
let pageCursors = [null];
// View Toggle State
let currentViewMode = localStorage.getItem('profileViewMode') || 'grid';

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

// View Toggle Elements
const viewToggleBtn = document.getElementById('viewToggleBtn');
const viewToggleIcon = document.getElementById('viewToggleIcon');

// Role Modal Elements
const staffActionBtn = document.getElementById('staffActionBtn');
const roleModal = document.getElementById('roleModal');
const roleModalOptions = document.getElementById('roleModalOptions');
const closeRoleModal = document.getElementById('closeRoleModal');

const addCommentBox = document.getElementById('addCommentBox');
const loginToCommentMsg = document.getElementById('loginToComment');
const postCommentBtn = document.getElementById('postCommentBtn');
const headerTools = document.getElementById('headerTools');



// --- Event Listeners ---
if (profileSearchBtn) profileSearchBtn.onclick = handleProfileSearch;
if (profileClearSearchBtn) profileClearSearchBtn.onclick = handleProfileClearSearch;
if (profileSearchInput) profileSearchInput.onkeypress = (e) => { if (e.key === 'Enter') handleProfileSearch(); };
if (sortSelect) sortSelect.onchange = () => { applySortAndFilter(); updateURLHash(); };
if (tagFilterDropdown) tagFilterDropdown.onchange = applySortAndFilter;
if (applyFilterBtn) applyFilterBtn.onclick = applySortAndFilter;
if (clearFilterBtn) clearFilterBtn.onclick = () => { if (tagFilterDropdown) tagFilterDropdown.value = ''; applySortAndFilter(); };
if (postCommentBtn) postCommentBtn.onclick = postComment;

// Toggle Listener
if (viewToggleBtn) {
    viewToggleBtn.onclick = toggleViewMode;
}

// --- View Toggle Logic ---
function toggleViewMode() {
    currentViewMode = currentViewMode === 'grid' ? 'list' : 'grid';
    localStorage.setItem('profileViewMode', currentViewMode);

    // Update the dynamic limit based on the new view mode
    ITEMS_PER_PAGE = currentViewMode === 'list' ? 5 : 32;

    // Reset to page 1 to prevent being "out of bounds" on the new layout
    currentPage = 1;

    updateViewAppearance();

    // Check if there is an active search query
    const queryText = profileSearchInput ? profileSearchInput.value.trim() : '';

    if (queryText) {
        handleProfileSearch();
    } else {
        applySortAndFilter();
    }
}

function updateViewAppearance() {
    if (!profileItemsGrid) return;

    if (currentViewMode === 'list') {
        profileItemsGrid.classList.add('list-view');
        if (viewToggleIcon) viewToggleIcon.className = 'bi bi-grid-3x3-gap-fill';
    } else {
        profileItemsGrid.classList.remove('list-view');
        if (viewToggleIcon) viewToggleIcon.className = 'bi bi-list-ul';
    }
}

// --- URL Hash and Query Helpers ---
function getUserIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('uid');
}

// --- Updated URL Hash and Query Helpers ---
function updateURLHash() {
    const searchQuery = profileSearchInput.value.trim().replace(/\s+/g, '-');
    const searchPart = searchQuery ? `+search=${encodeURIComponent(searchQuery)}` : '';
    const sortPart = `+sort=${sortSelect.value}+order=${currentSortOrder}`;

    history.replaceState(null, '', `?uid=${targetUserId}#${currentStatusFilter}+${currentPage}${sortPart}${searchPart}`);
}

function parseURLHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return { status: 'Owned', page: 1, search: '', sort: '', order: 'desc' };

    // Updated regex to capture sort, order, and search
    const match = raw.match(/^([A-Za-z]+)\+(\d+)\+sort=([A-Za-z]*)\+order=(asc|desc)(\+search=(.*))?$/);

    if (match) {
        return {
            status: match[1],
            page: parseInt(match[2], 10) || 1,
            sort: match[3] || '',
            order: match[4] || 'desc',
            search: match[6] ? decodeURIComponent(match[6].replace(/-/g, ' ')) : ''
        };
    }

    // Fallback for simple hashes (like just #Owned+1)
    const simpleMatch = raw.match(/^([A-Za-z]+)\+(\d+)/);
    if (simpleMatch) {
        return { status: simpleMatch[1], page: parseInt(simpleMatch[2], 10) || 1, search: '', sort: '', order: 'desc' };
    }

    return { status: 'Owned', page: 1, search: '', sort: '', order: 'desc' };
}

// --- Firestore Helpers ---
function getUserCollectionRef(userId) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return db.collection('artifacts').doc(appId).collection('user_profiles').doc(userId).collection('items');
}

function getUserProfileDocRef(userId) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return db.collection('artifacts').doc(appId).collection('user_profiles').doc(userId);
}

function getGalleryCollectionRef() {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
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
    } catch (err) { console.error("Error fetching status counts:", err); }
    return counts;
}

let currentSortOrder = 'desc'; // Default to Descending
const sortOrderBtn = document.getElementById('sortOrderBtn');
const sortOrderIcon = document.getElementById('sortOrderIcon');

if (sortOrderBtn) {
    sortOrderBtn.onclick = () => {
        currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
        // Toggle icon: sort-down is Descending, sort-up is Ascending
        sortOrderIcon.className = currentSortOrder === 'desc' ? 'bi bi-sort-down' : 'bi bi-sort-up';
        applySortAndFilter();
    };
}

async function fetchAndRenderBanner(userId) {
    if (!userId || !profileBanner) return;
    try {
        const userDoc = await getUserProfileDocRef(userId).get();
        const bannerBase64 = userDoc.data()?.bannerBase64;
        profileBanner.src = bannerBase64 || DEFAULT_BANNER_URL;
    } catch (err) {
        console.error("Error fetching banner:", err);
        profileBanner.src = DEFAULT_BANNER_URL;
    }
}

// --- Initialize Profile ---
async function initializeProfile() {
    updateViewAppearance();

    if (profileLoader) profileLoader.classList.remove('hidden');
    targetUserId = getUserIdFromUrl();

    if (!targetUserId) {
        profileTitle.textContent = 'Error: No User ID Provided';
        loadingStatus.textContent = 'Please return to the Users search page.';
        if (profileLoader) profileLoader.classList.add('hidden');
        return;
    }

    if (viewMoreGalleryBtn) {
        viewMoreGalleryBtn.onclick = () => { window.location.href = `../?uid=${targetUserId}`; };
    }

    // Await core user data
    await fetchAndRenderBanner(targetUserId);
    targetUsername = await fetchUsername(targetUserId);
    profileTitle.textContent = `${targetUsername}'s Collection`;

    const currentUser = auth.currentUser;
    isProfileOwner = currentUser && targetUserId === currentUser.uid;

    if (openChatBtn) customizeHeaderForOwner();

    if (currentUser && !isProfileOwner) {
        setupRoleModal(currentUser.uid);
    }

    // Parse URL Hash for state
    const { status: hashStatus, page: hashPage, search: hashSearch, sort: hashSort, order: hashOrder } = parseURLHash();
    currentStatusFilter = STATUS_OPTIONS.includes(hashStatus) ? hashStatus : 'Owned';
    currentPage = hashPage || 1;
    currentSortOrder = hashOrder || 'desc';

    await renderStatusButtons(); // This calls updateSortOptions() internally

    // Apply sort from URL
    if (hashSort && sortSelect) {
        sortSelect.value = hashSort;
    }

    // Update the sort icon to match the URL state
    if (sortOrderIcon) {
        sortOrderIcon.className = currentSortOrder === 'desc' ? 'bi bi-sort-down' : 'bi bi-sort-up';
    }

    await fetchProfileItems(currentStatusFilter);
    await fetchUserLists(targetUserId);

    // After the await above, lastFetchedItems is guaranteed to be populated
    if (hashSearch) {
        profileSearchInput.value = hashSearch;
        handleProfileSearch(); // This internally calls applySortAndFilter()
    } else {
        applySortAndFilter(); // Standard render for current page/sort
    }

    await loadComments(targetUserId);
    await fetchAndRenderGalleryPreview(targetUserId);

    if (profileLoader) profileLoader.classList.add('hidden');
}

async function fetchUserLists(userId) {
    const profileListsGrid = document.getElementById('profileListsGrid');
    profileListsGrid.innerHTML = '<p>Loading lists...</p>';

    try {
        // 1. Load user profile (favorites live here)
        const userDoc = await db
            .collection('artifacts').doc('default-app-id')
            .collection('user_profiles').doc(userId)
            .get();

        const favoriteListIds = userDoc.data()?.favoriteLists || [];

        allUserLists = [];
        const listMap = new Map(); // dedupe by ID

        // 2. Fetch FAVORITE public lists by ID
        const favoritePromises = favoriteListIds.map(listId =>
            db.collection('public_lists').doc(listId).get()
        );

        const favoriteSnapshots = await Promise.all(favoritePromises);

        favoriteSnapshots.forEach(doc => {
            if (!doc.exists) return;

            listMap.set(doc.id, {
                id: doc.id,
                type: 'public',
                isFavorite: true,
                ...doc.data()
            });
        });

        // 3. Fetch USER OWNED public lists
        const publicSnapshot = await db
            .collection('public_lists')
            .where('userId', '==', userId)
            .get();

        publicSnapshot.forEach(doc => {
            const existing = listMap.get(doc.id);

            listMap.set(doc.id, {
                id: doc.id,
                type: 'public',
                isFavorite: existing?.isFavorite || favoriteListIds.includes(doc.id),
                ...doc.data()
            });
        });

        // 4. Fetch PRIVATE lists (profile owner only)
        if (isProfileOwner) {
            const privateSnapshot = await db
                .collection('artifacts').doc('default-app-id')
                .collection('user_profiles').doc(userId)
                .collection('lists')
                .get();

            privateSnapshot.forEach(doc => {
                listMap.set(doc.id, {
                    id: doc.id,
                    type: 'private',
                    isFavorite: false,
                    ...doc.data()
                });
            });
        }

        // 5. Convert map → array + sort
        allUserLists = Array.from(listMap.values());

        allUserLists.sort((a, b) => {
            if (a.isFavorite && !b.isFavorite) return -1;
            if (!a.isFavorite && b.isFavorite) return 1;
            return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });

        // 6. Render
        renderCreateListButton();
        renderListsPage(1);

    } catch (error) {
        console.error('Error fetching lists:', error);
        profileListsGrid.innerHTML = '<p>Error loading lists.</p>';
    }
}


function renderListsPage(page) {
    listsCurrentPage = page;
    const grid = document.getElementById('profileListsGrid');
    const pagination = document.getElementById('listsPagination');
    grid.innerHTML = '';

    const start = (page - 1) * LISTS_PER_PAGE;
    const end = start + LISTS_PER_PAGE;
    const paginatedLists = allUserLists.slice(start, end);

    if (paginatedLists.length === 0) {
        grid.innerHTML = '<p>No lists created yet.</p>';
        pagination.innerHTML = '';
        return;
    }

    paginatedLists.forEach(list => {
        const card = document.createElement('a');
        card.href = `../lists/?list=${list.id}&type=${list.type}`;
        card.className = 'item-card-link';

        // Star Icon HTML - only shows if list is favorited
        const starHtml = list.isFavorite
            ? `<i class="bi bi-star-fill" style="color: #ffcc00; position: absolute; top: 10px; right: 10px; font-size: 1.1rem; z-index: 2; filter: drop-shadow(0 0 2px rgba(0,0,0,0.3));"></i>`
            : '';

        // Determine icon based on list mode (Live vs Static)
        const listIconClass = list.mode === 'live' ? 'bi-journal-code' : 'bi-journal-bookmark-fill';

        card.innerHTML = `
            <div class="list-card" style="position: relative;">
                ${starHtml}
                <div class="list-image-wrapper">
                    <div class="list-stack-effect">
                         <i class="bi ${listIconClass}" style="font-size: clamp(1.4rem, 2vw, 1.8rem); color: var(--accent-clr);"></i>
                    </div>
                </div>
                <div class="list-info">
                    <h3>${list.name || 'Untitled List'}</h3>
                    <span>${list.items?.length || 0} Items • ${list.type}</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    renderListsPagination();
}

function renderListsPagination() {
    const container = document.getElementById('listsPagination');
    container.innerHTML = '';
    const totalPages = Math.ceil(allUserLists.length / LISTS_PER_PAGE);

    if (totalPages <= 1) return;

    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.innerText = i;
        btn.className = `action-btn ${i === listsCurrentPage ? 'active' : ''}`;
        btn.onclick = () => {
            renderListsPage(i);
        };
        container.appendChild(btn);
    }
}

// --- Staff Role Logic ---
async function setupRoleModal(currentUid) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    try {
        const myDoc = await db.collection('artifacts').doc(appId).collection('user_profiles').doc(currentUid).get();
        const myRole = myDoc.data()?.role || 'user';

        const targetDoc = await db.collection('artifacts').doc(appId).collection('user_profiles').doc(targetUserId).get();
        const targetRole = targetDoc.data()?.role || 'user';

        const allowedRoles = ROLE_HIERARCHY[myRole]?.assigns || [];

        const targetAssignable = allowedRoles.filter(role => {
            if (myRole === 'mod') return !['admin', 'mod'].includes(targetRole);
            return true;
        });

        if (targetAssignable.length === 0) {
            staffActionBtn.style.display = 'none';
            return;
        }

        staffActionBtn.style.display = 'inline-block';
        staffActionBtn.onclick = () => {
            roleModalOptions.innerHTML = '';
            targetAssignable.forEach(role => {
                const btn = document.createElement('button');
                btn.className = 'action-btn';
                btn.textContent = `Set as ${role.toUpperCase()}`;
                btn.onclick = () => {
                    roleModal.style.display = 'none';
                    showConfirmationModal(`Change this user's role to ${role.toUpperCase()}?`, async () => {
                        try {
                            await db.collection('artifacts').doc(appId).collection('user_profiles').doc(targetUserId).set({
                                role: role
                            }, { merge: true });
                            alert("Role updated to " + role);
                        } catch (err) {
                            console.error("Error updating role:", err);
                            alert("Failed to update role.");
                        }
                    });
                };
                roleModalOptions.appendChild(btn);
            });
            roleModal.style.display = 'flex';
        };

        closeRoleModal.onclick = () => { roleModal.style.display = 'none'; };
        window.onclick = (event) => { if (event.target === roleModal) roleModal.style.display = 'none'; };

    } catch (err) { console.error("Error setting up role tools:", err); }
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

            updateSortOptions(); // Triggers the menu update
            fetchProfileItems(status);
            updateURLHash();
        };
        statusFilters.appendChild(button);
    });
    updateSortOptions(); // Initial load
}

async function fetchProfileItems(status) {
    if (!targetUserId) return;
    profileItemsGrid.innerHTML = '';
    paginationContainer.innerHTML = '';
    loadingStatus.textContent = `Loading ${targetUsername}'s ${status.toLowerCase()} items...`;
    return await fetchPage();
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
            const userItemData = doc.data();
            const itemDoc = await mainCollectionRef.doc(userItemData.itemId).get();
            if (!itemDoc.exists) return null;
            // We now capture privateNotes from the user's specific document to display in list view
            return {
                doc: itemDoc,
                status: userItemData.status,
                privateNotes: userItemData.privateNotes || {}
            };
        }));
        lastFetchedItems = detailedItems.filter(Boolean);
        applySortAndFilter();
    } catch (err) {
        console.error(err);
        loadingStatus.textContent = `Error loading collection: ${err.message}`;
    }
}

function renderPageItems(items) {
    profileItemsGrid.innerHTML = '';
    loadingStatus.textContent = '';

    updateViewAppearance();

    items.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status, item.privateNotes)));
    renderPaginationButtons();
}

function renderProfileItem(doc, status, privateNotes = {}) {
    const item = doc.data();
    const itemId = doc.id;
    const isAdultContent = (item.itemAgeRating === '18+' || item.itemAgeRating === 'Adult');
    const shouldBlur = isAdultContent && !isNsfwAllowed;

    const link = document.createElement('a');
    link.href = `../items/?id=${itemId}`;
    link.className = 'item-card-link';

    const card = document.createElement('div');
    card.className = 'item-card';
    card.setAttribute('data-status', status.toLowerCase());

    // --- Image Section ---
    let imageSrc = (item.itemImageUrls && item.itemImageUrls[0] && item.itemImageUrls[0].url) || DEFAULT_IMAGE_URL;
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'item-image-wrapper';

    if (shouldBlur) imageWrapper.classList.add('nsfw-blur');

    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = item.itemName;
    img.className = 'item-image';

    // Alignment Logic
    const horAlign = (item['img-align-hor'] || 'center').toLowerCase();
    const verAlign = (item['img-align-ver'] || 'center').toLowerCase();
    img.classList.add(`img-align-hor-${['left', 'center', 'right'].includes(horAlign) ? horAlign : 'center'}`);
    img.classList.add(`img-align-ver-${['top', 'center', 'bottom'].includes(verAlign) ? verAlign : 'center'}`);
    imageWrapper.appendChild(img);

    if (shouldBlur) {
        const badgeOverlay = document.createElement('div');
        badgeOverlay.className = 'nsfw-overlay';
        badgeOverlay.textContent = '18+';
        imageWrapper.appendChild(badgeOverlay);
    }

    // --- Info Section ---
    const info = document.createElement('div');
    info.className = 'item-info';

    const title = document.createElement('h3');
    title.textContent = item.itemName;
    info.appendChild(title);

    // --- Column Logic for List View ---
    if (currentViewMode === 'list') {
        const extraCols = document.createElement('div');
        extraCols.className = 'list-view-columns';

        const n = privateNotes;
        let html = '';

        if (status === 'Owned') {
            html = `
            <div class="col-group price-group">
              <div class="col-group"><strong><i class="bi bi-boxes"></i></strong> <span>${n.amount || '1'}</span></div>
              <div class="col-group" style="margin-top: -2px;"><strong><i class="bi bi-star-fill"></i></strong> <span>${n.score || '-'}</span></div>
              </div>
              <div class="col-group price-group">
                  <div class="main-val"><strong><i class="bi bi-cash-stack"></i></strong> <span>${n.price || '-'}</span></div>
                  <div class="sub-val"><i class="bi bi-truck"></i> ${n.shipping || '-'}</div>
              </div>
              <div class="col-group price-group">
                  <div class="main-val"><strong><i class="bi bi-bag-fill"></i></strong> <span>${n.store || '-'}</span></div>
                  <div class="sub-val"><i class="bi bi-calendar2-check-fill"></i> ${n.collectionDate || '-'}</div>
              </div>
          `;
        } else if (status === 'Wished') {
            html = `<div class="col-group"><strong><i class="bi bi-star-fill"></i></strong> <span>${n.priority || 'Normal'}</span></div>`;
        } else if (status === 'Ordered') {
            html = `
              <div class="col-group"><strong><i class="bi bi-boxes"></i></strong> <span>${n.amount || '1'}</span></div>
              <div class="col-group price-group">
                  <div class="main-val"><strong><i class="bi bi-cash-stack"></i></strong> <span>${n.price || '-'}</span></div>
                  <div class="sub-val"><i class="bi bi-truck"></i> ${n.shipping || '-'}</div>
              </div>
              <div class="col-group"><strong><i class="bi bi-bag-fill"></i></strong> <span>${n.store || '-'}</span></div>
          `;
        }

        extraCols.innerHTML = html;
        info.appendChild(extraCols);
    } else {
        // Original Grid view badge
        const badge = document.createElement('span');
        badge.textContent = status;
        info.appendChild(badge);
    }

    card.appendChild(imageWrapper);
    card.appendChild(info);
    link.appendChild(card);
    return link;
}

function renderPaginationButtons(filteredTotal = lastFetchedItems.length) {
    if (!paginationContainer) return;

    paginationContainer.innerHTML = '';

    const totalItems = Number(filteredTotal) || 0;
    if (totalItems <= ITEMS_PER_PAGE) return;

    const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '<i class="bi bi-caret-left-fill"></i>';
    prevBtn.className = 'action-btn';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => {
        currentPage--;
        applySortAndFilter();
        updateURLHash();
        scrollToItemsTop();
    };

    const pageIndicator = document.createElement('span');
    pageIndicator.className = 'page-indicator';
    pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = '<i class="bi bi-caret-right-fill"></i>';
    nextBtn.className = 'action-btn';
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.onclick = () => {
        currentPage++;
        applySortAndFilter();
        updateURLHash();
        scrollToItemsTop();
    };

    paginationContainer.append(prevBtn, pageIndicator, nextBtn);
}


async function handleProfileSearch() {
    currentPage = 1;
    applySortAndFilter();
    if (profileClearSearchBtn) {
        profileClearSearchBtn.style.display = profileSearchInput.value.trim() ? 'inline-block' : 'none';
    }
    updateURLHash();
}

function handleProfileClearSearch() {
    profileSearchInput.value = '';
    profileClearSearchBtn.style.display = 'none';
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    renderPageItems(lastFetchedItems.slice(startIndex, startIndex + ITEMS_PER_PAGE));
    updateURLHash();
}

async function fetchAndRenderGalleryPreview(userId) {
    const previewGrid = document.getElementById('previewGrid');
    if (!previewGrid || !userId) return;
    previewGrid.innerHTML = '<p style="grid-column: 1/span 4; text-align: center;">Loading images...</p>';

    try {
        const galleryRef = getGalleryCollectionRef();
        // Fetch the user's gallery items to calculate likes client-side
        const gallerySnapshot = await galleryRef.where('uploaderId', '==', userId).get();

        previewGrid.innerHTML = '';
        if (gallerySnapshot.empty) {
            previewGrid.innerHTML = '<p style="grid-column: 1/span 4; text-align: center; color: #888;">No uploaded gallery images found.</p>';
            return;
        }

        const imagesWithLikes = gallerySnapshot.docs.map(doc => {
            const data = doc.data();

            // Sum the lengths of all arrays where the key starts with "likes_"
            const totalLikes = Object.keys(data)
                .filter(key => key.startsWith('likes_'))
                .reduce((sum, key) => {
                    const likeArray = data[key];
                    return sum + (Array.isArray(likeArray) ? likeArray.length : 0);
                }, 0);

            return {
                url: data.url || DEFAULT_IMAGE_URL,
                totalLikes: totalLikes,
                createdAt: data.createdAt
            };
        });

        // Sort: Most likes first, then newest first as a tie-breaker
        imagesWithLikes.sort((a, b) => {
            if (b.totalLikes !== a.totalLikes) {
                return b.totalLikes - a.totalLikes;
            }
            return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });

        // Display the top 4 most liked images
        imagesWithLikes.slice(0, 4).forEach(image => {
            const link = document.createElement('a');
            link.className = 'gallery-thumbnail-link';
            const img = document.createElement('img');
            img.src = image.url;
            img.className = 'gallery-thumbnail';
            img.onerror = () => img.src = DEFAULT_IMAGE_URL;
            link.appendChild(img);
            previewGrid.appendChild(link);
        });
    } catch (err) {
        console.error("Error fetching gallery preview:", err);
        previewGrid.innerHTML = '<p style="grid-column: 1/span 4; text-align: center; color: red;">Failed to load gallery preview.</p>';
    }
}

function applySortAndFilter() {
    if (!lastFetchedItems || !lastFetchedItems.length) {
        profileItemsGrid.innerHTML = '';
        loadingStatus.textContent = `No items found in this collection.`;
        renderPaginationButtons(0);
        return;
    }

    currentSortValue = sortSelect?.value ?? '';
    let items = [...lastFetchedItems];

    // --- 1. Apply Search & Tag Filters ---
    const queryText = profileSearchInput.value.trim().toLowerCase();

    if (queryText) {
        const regex = /\{([^}]+)\}|[^\s{}]+/g;
        const requiredKeywords = [];
        const excludedKeywords = [];
        let match;

        while ((match = regex.exec(queryText)) !== null) {
            const term = (match[1] ? match[1].trim() : match[0]).toLowerCase();
            // Check for exclusion prefix
            if (term.startsWith('-') && term.length > 1) {
                excludedKeywords.push(term.substring(1));
            } else {
                requiredKeywords.push(term);
            }
        }

        items = items.filter(item => {
            const data = item.doc.data();
            const notes = item.privateNotes || {};

            const name = (data.itemName || '').toLowerCase();
            const tags = (data.tags || []).map(t => t.toLowerCase());
            const category = (data.itemCategory || '').toLowerCase();
            const scale = (data.itemScale || '').toLowerCase();
            const age = (data.itemAgeRating || '').toLowerCase();
            const store = (notes.store || '').toLowerCase();

            const combinedText = [name, category, scale, age, store, ...tags].join(' ');

            // 1. Exclusion Check (Hard Filter)
            const isExcluded = excludedKeywords.some(kw => combinedText.includes(kw));
            if (isExcluded) return false;

            // 2. Requirement Check
            if (requiredKeywords.length === 0) return true; // Only exclusions provided
            return requiredKeywords.every(kw => combinedText.includes(kw));
        });
    }

    const selectedTag = tagFilterDropdown?.value;
    if (selectedTag) items = items.filter(item => (item.doc.data().tags || []).includes(selectedTag));

    // --- 2. Sorting Logic ---
    items.sort((a, b) => {
        const dataA = a.doc.data();
        const dataB = b.doc.data();
        const nA = a.privateNotes || {};
        const nB = b.privateNotes || {};

        const getNum = (val) => {
            if (val === undefined || val === null || val === '') return 0;
            let s = String(val).replace(/[^\d,.-]/g, '');
            if (!s) return 0;
            const lastComma = s.lastIndexOf(',');
            const lastDot = s.lastIndexOf('.');
            if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
            else if (lastDot > lastComma) s = s.replace(/,/g, '');
            else if (lastComma !== -1) s = s.replace(',', '.');
            return parseFloat(s) || 0;
        };

        const getStr = (val) => String(val || '').toLowerCase();

        let comparison = 0;

        switch (currentSortValue) {
            case 'amount':
                comparison = getNum(nA.amount || 1) - getNum(nB.amount || 1);
                break;
            case 'price':
                comparison = getNum(nA.price) - getNum(nB.price);
                break;
            case 'totalPrice':
                comparison = (getNum(nA.price) + getNum(nA.shipping)) - (getNum(nB.price) + getNum(nB.shipping));
                break;
            case 'priority':
                // Assumes priority is stored as a number or mapped elsewhere
                comparison = getNum(nA.priority) - getNum(nB.priority);
                break;
            case 'score':
                comparison = getNum(nA.score) - getNum(nB.score);
                break;
            case 'storeName':
                comparison = getStr(nA.store).localeCompare(getStr(nB.store));
                break;
            case 'release':
                comparison = new Date(dataA.itemReleaseDate || 0) - new Date(dataB.itemReleaseDate || 0);
                break;
            case 'collectionDate':
                comparison = new Date(nA.collectionDate || 0) - new Date(nB.collectionDate || 0);
                break;
            default:
                return 0;
        }

        // Apply the direction: If descending, multiply by -1 to flip the order
        // currentSortOrder should be a global variable ('asc' or 'desc')
        return currentSortOrder === 'desc' ? comparison * -1 : comparison;
    });

    // --- 3. Render ---
    const filteredTotal = items.length;
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const pagedItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    profileItemsGrid.innerHTML = '';
    pagedItems.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status, item.privateNotes)));
    renderPaginationButtons(filteredTotal);
}

window.addEventListener('hashchange', async () => {
    const newUserId = getUserIdFromUrl();
    if (newUserId !== targetUserId) { initializeProfile(); return; }
    const { status, page, search } = parseURLHash();
    if (status !== currentStatusFilter) {
        currentStatusFilter = status;
        await renderStatusButtons();
        await fetchProfileItems(status);
    }
    if (page !== currentPage) { currentPage = page; applySortAndFilter(); }
    if (search !== profileSearchInput.value.trim()) {
        profileSearchInput.value = search;
        await handleProfileSearch();
    } else {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        renderPageItems(lastFetchedItems.slice(startIndex, startIndex + ITEMS_PER_PAGE));
    }
});

async function startChatWithUser() {
    const loggedUser = auth.currentUser;
    if (!loggedUser) { alert("You must be logged in to start a chat."); return; }
    const myId = loggedUser.uid;
    const otherId = targetUserId;
    if (!otherId || myId === otherId) return alert("Unable to message this user.");
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const chatId = [myId, otherId].sort().join('_');
    const chatRef = db.collection('artifacts').doc(appId).collection('chats').doc(chatId);
    try {
        await chatRef.set({ users: [myId, otherId], lastMessage: '', lastSent: new Date(0) }, { merge: true });
        window.location.href = `../chat/?chat=${otherId}`;
    } catch (e) { console.error("Error creating chat:", e); alert("Could not start chat."); }
}

function linkify(text) {
    const urlPattern = /(\b(https?:\/\/|www\.)[^\s]+\b)/g;
    return text.replace(urlPattern, function (url) {
        let fullUrl = url;
        if (url.startsWith('www.')) fullUrl = 'http://' + url;
        return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
}

async function loadComments(profileUserId) {
    const commentsList = document.getElementById('commentsList');
    commentsList.innerHTML = '<p>Loading comments...</p>';
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const currentUser = auth.currentUser;
    const currentUid = currentUser ? currentUser.uid : null;
    let currentUserRole = null;
    if (currentUid) {
        try {
            const roleDoc = await db.collection('artifacts').doc(appId).collection('user_profiles').doc(currentUid).get();
            currentUserRole = roleDoc.data()?.role || null;
        } catch (err) { console.error("Error fetching user role:", err); }
    }
    const startDoc = pageCursors[commentsCurrentPage - 1] || null;
    let query = db.collection('artifacts').doc(appId).collection('user_profiles').doc(profileUserId).collection('comments').orderBy('timestamp', 'desc').limit(COMMENTS_PER_PAGE);
    if (startDoc) query = query.startAfter(startDoc);
    const snapshot = await query.get();
    if (snapshot.empty) { commentsList.innerHTML = '<p>No comments yet.</p>'; if (commentsCurrentPage > 1) commentsCurrentPage--; return; }
    commentsList.innerHTML = '';
    snapshot.forEach(doc => {
        const c = doc.data();
        const commentId = doc.id;
        const time = c.timestamp?.toDate().toLocaleString() ?? 'Just now';
        const isOwner = currentUid === c.userId;
        const isProfileOwner = currentUid === profileUserId;
        const isAdminOrMod = ['admin', 'mod'].includes(currentUserRole);
        const canDelete = isOwner || isProfileOwner || isAdminOrMod;
        const div = document.createElement('div');
        div.className = 'comment';
        div.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:5px;">
          ${canDelete ? `<button class="delete-comment-btn" data-id="${commentId}" title="Delete comment">&times;</button>` : ''}
          <a href="../user/?uid=${c.userId}" class="comment-author" style="text-decoration: underline;">${linkify(c.displayName || 'User')}</a>
        </div>
        <div style="font-size:0.8em; color:#888;">${time}</div>
      </div>
      <div class="comment-text">${linkify(c.text)}</div>
    `;
        commentsList.appendChild(div);
        if (canDelete) {
            div.querySelector('.delete-comment-btn').onclick = () => {
                showConfirmationModal("Are you sure you want to delete this comment?", async () => {
                    try {
                        await db.collection('artifacts').doc(appId).collection('user_profiles').doc(profileUserId).collection('comments').doc(commentId).delete();
                        commentsCurrentPage = 1; pageCursors = [null]; loadComments(profileUserId);
                    } catch (err) { console.error("Failed to delete comment:", err); }
                });
            };
        }
    });
    if (snapshot.docs.length === COMMENTS_PER_PAGE) {
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (pageCursors.length === commentsCurrentPage) pageCursors.push(lastDoc);
    } else pageCursors.length = commentsCurrentPage;
    renderCommentPagination(profileUserId);
}

async function postComment(event) {
    if (event) event.preventDefault();
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const input = document.getElementById('commentInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    try {
        await db.collection('artifacts').doc(appId).collection('user_profiles').doc(targetUserId).collection('comments').add({
            userId: currentUser.uid,
            displayName: currentUser.displayName || currentUser.email || 'Anonymous',
            text,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        commentsCurrentPage = 1; pageCursors = [null]; loadComments(targetUserId);
    } catch (err) { console.error("Failed to post comment:", err); }
}

function renderCommentPagination(profileUserId) {
    const container = document.getElementById('commentPagination');
    if (!container) return;
    container.innerHTML = '';
    const prevBtn = document.createElement('button');
    prevBtn.style.margin = '20px';
    prevBtn.className = 'action-btn';
    prevBtn.innerHTML = '<i class="bi bi-caret-left-fill"></i>';
    prevBtn.disabled = commentsCurrentPage === 1;
    prevBtn.onclick = () => { commentsCurrentPage--; loadComments(profileUserId); };
    const nextBtn = document.createElement('button');
    nextBtn.style.margin = '20px';
    nextBtn.className = 'action-btn';
    nextBtn.innerHTML = '<i class="bi bi-caret-right-fill"></i>';
    nextBtn.disabled = pageCursors.length <= commentsCurrentPage;
    nextBtn.onclick = () => { commentsCurrentPage++; loadComments(profileUserId); };
    const pageIndicator = document.createElement('span');
    pageIndicator.textContent = `Page ${commentsCurrentPage}`;
    container.appendChild(prevBtn);
    container.appendChild(pageIndicator);
    container.appendChild(nextBtn);
    pageIndicator.style.alignContent = "center";
}

function showConfirmationModal(message, onConfirm) {
    const modal = document.getElementById('confirmationModal');
    const textEl = document.getElementById('confirmationText');
    const yesBtn = document.getElementById('confirmYesBtn');
    const noBtn = document.getElementById('confirmNoBtn');
    textEl.textContent = message;
    modal.style.display = 'flex';
    function cleanup() { modal.style.display = 'none'; yesBtn.onclick = null; noBtn.onclick = null; }
    yesBtn.onclick = () => { cleanup(); onConfirm(); };
    noBtn.onclick = cleanup;
}

function updateHeaderAuthButton(user) {
    if (!headerTools) return;
    headerTools.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'logout-btn';
    if (user) {
        btn.textContent = 'Logout';
        btn.onclick = async () => { try { await auth.signOut(); } catch (err) { console.error(err); } };
        if (addCommentBox) addCommentBox.style.display = 'flex';
        if (loginToCommentMsg) loginToCommentMsg.style.display = 'none';
    } else {
        btn.className = 'login-btn';
        btn.textContent = 'Login';
        btn.onclick = () => { window.location.href = '../login'; };
        if (addCommentBox) addCommentBox.style.display = 'none';
        if (loginToCommentMsg) loginToCommentMsg.style.display = 'flex';
    }
    headerTools.appendChild(btn);
}

auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            const profileDoc = await db.collection('artifacts').doc(appId).collection('user_profiles').doc(user.uid).get();
            isNsfwAllowed = profileDoc.data()?.allowNSFW === true;
        } catch (err) { console.error("Error fetching NSFW preference:", err); isNsfwAllowed = false; }
    } else { isNsfwAllowed = false; }
    updateHeaderAuthButton(user);
    setupHeaderLogoRedirect();
    if (lastFetchedItems.length > 0) applySortAndFilter();
});

function customizeHeaderForOwner() {
    if (!openChatBtn) return;
    if (isProfileOwner) {
        openChatBtn.innerHTML = '<i class="bi bi-gear-fill"></i>';
        openChatBtn.onclick = () => { window.location.href = '../settings'; };
        enableBannerEditing();
    } else {
        openChatBtn.innerHTML = '<i class="bi bi-chat-left-dots-fill"></i>';
        openChatBtn.onclick = () => startChatWithUser();
    }
}

function enableBannerEditing() {
    if (!profileBanner || !isProfileOwner) return;
    const bannerContainer = document.querySelector('.profile-banner-container');
    if (!bannerContainer || bannerContainer.querySelector('.banner-edit-overlay')) return;
    const editOverlay = document.createElement('div');
    editOverlay.className = 'banner-edit-overlay';
    editOverlay.innerHTML = 'Click to Change Banner';
    editOverlay.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; transition: opacity 0.3s; font-size: 1.2em; font-weight: bold;`;
    bannerContainer.style.position = 'relative';
    bannerContainer.appendChild(editOverlay);
    bannerContainer.onmouseover = () => editOverlay.style.opacity = '1';
    bannerContainer.onmouseout = () => editOverlay.style.opacity = '0';
    editOverlay.onclick = handleBannerEdit;
}

async function handleBannerEdit() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (readerEvent) => {
            let base64Image = readerEvent.target.result;
            const MAX_SIZE_MB = 1;
            const maxBytes = MAX_SIZE_MB * 1024 * 1024;
            if (file.size > maxBytes) base64Image = await resizeImage(base64Image, maxBytes);
            const croppedBase64 = await showCropPopup(base64Image);
            if (!croppedBase64) return;
            profileBanner.src = croppedBase64;
            try {
                const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
                await db.collection('artifacts').doc(appId).collection('user_profiles').doc(targetUserId).set({ bannerBase64: croppedBase64 }, { merge: true });
            } catch (err) { console.error("Failed to save banner:", err); alert("Error saving banner."); }
        };
        reader.readAsDataURL(file);
    };
    fileInput.click();
}

function showCropPopup(base64Image) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `position: fixed; top:0; left:0; right:0; bottom:0; background-color: rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:10000;`;
        const popup = document.createElement('div');
        popup.style.cssText = `background:#fff; border-radius:8px; padding:10px; position: relative; max-width: 90%; max-height: 80%; overflow:hidden;`;
        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.src = base64Image;

        img.onload = () => {
            const canvasWidth = 1000;
            const canvasHeight = 200;
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            canvas.style.width = "80dvw";

            let scale = Math.max(canvasWidth / img.width, canvasHeight / img.height);
            let scaledWidth = img.width * scale;
            let scaledHeight = img.height * scale;
            let offsetX = (canvasWidth - scaledWidth) / 2;
            let offsetY = 0;
            const maxOffsetY = Math.max(0, scaledHeight - canvasHeight);

            const draw = () => {
                ctx.clearRect(0, 0, canvasWidth, canvasHeight);
                ctx.drawImage(img, 0, offsetY / scale, img.width, canvasHeight / scale, offsetX, 0, scaledWidth, canvasHeight);
            };
            draw();

            let dragging = false;
            let startY = 0;

            canvas.onmousedown = (e) => { dragging = true; startY = e.clientY; };
            window.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                const delta = e.clientY - startY;
                offsetY = Math.min(Math.max(offsetY - delta, 0), maxOffsetY);
                startY = e.clientY;
                draw();
            });
            window.addEventListener('mouseup', () => { dragging = false; });

            canvas.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                dragging = true;
                startY = e.touches[0].clientY;
                e.preventDefault();
            });
            canvas.addEventListener('touchmove', (e) => {
                if (!dragging || e.touches.length !== 1) return;
                const delta = e.touches[0].clientY - startY;
                offsetY = Math.min(Math.max(offsetY - delta, 0), maxOffsetY);
                startY = e.touches[0].clientY;
                draw();
                e.preventDefault();
            }, { passive: false });
            canvas.addEventListener('touchend', () => { dragging = false; });

            const cleanup = () => {
                document.body.removeChild(overlay);
            };

            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = "text-align:center; margin-top:10px;";

            const okBtn = document.createElement('button');
            okBtn.textContent = "Save";
            okBtn.onclick = () => {
                const finalBase64 = canvas.toDataURL('image/jpeg', 0.9);
                cleanup();
                resolve(finalBase64);
            };

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.marginLeft = "10px";
            cancelBtn.onclick = () => { cleanup(); resolve(null); };

            btnContainer.appendChild(okBtn);
            btnContainer.appendChild(cancelBtn);
            popup.appendChild(canvas);
            popup.appendChild(btnContainer);
        };
    });
}

async function resizeImage(base64Str, maxBytes) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let canvas = document.createElement('canvas'); let ctx = canvas.getContext('2d');
            let [width, height] = [img.width, img.height]; let scale = 0.9;
            canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
            let resizedBase64 = canvas.toDataURL('image/jpeg', 0.9); let quality = 0.9;
            while (resizedBase64.length > maxBytes && quality > 0.1) {
                quality -= 0.05; canvas.width = width * scale; canvas.height = height * scale;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resizedBase64 = canvas.toDataURL('image/jpeg', quality); scale *= 0.9;
            }
            resolve(resizedBase64);
        };
        img.src = base64Str;
    });
}

function setupHeaderLogoRedirect() {
    const logo = document.querySelector('.header-logo');
    if (!logo) return;
    logo.style.cursor = 'pointer';
    logo.onclick = () => {
        const currentUser = auth.currentUser;
        if (!currentUser) { alert("You must be logged in to view your profile."); return; }
        window.location.href = `../user/?uid=${currentUser.uid}`;
    };
}

initializeProfile();

const profileSearchSuggestions = document.createElement('div');
profileSearchSuggestions.id = 'profileSearchSuggestions';
profileSearchSuggestions.className = 'search-suggestions';

profileSearchInput.parentNode.appendChild(profileSearchSuggestions);

const ICONS = {
    name: '<i class="bi bi-sticky-fill"></i>',
    category: '<i class="bi bi-folder-fill"></i>',
    scale: '<i class="bi bi-arrows-fullscreen"></i>',
    age: '<i class="bi bi-exclamation-octagon"></i>',
    tag: '<i class="bi bi-tag-fill"></i>'
};

function updateProfileSearchSuggestions() {
    const query = profileSearchInput.value.trim().toLowerCase();
    profileSearchSuggestions.innerHTML = '';
    if (!query) return;

    const matchesByType = { tag: [], age: [], scale: [], category: [], name: [] };
    const addedItemIds = new Set();
    const addedTexts = new Set();

    for (let item of lastFetchedItems) {
        const data = item.doc.data();
        if (addedItemIds.has(item.doc.id)) continue;

        const tagMatch = (data.tags || []).find(t => t.toLowerCase().includes(query));
        if (tagMatch && !addedTexts.has(tagMatch.toLowerCase())) {
            matchesByType.tag.push({ type: 'tag', text: tagMatch, item });
            addedTexts.add(tagMatch.toLowerCase());
            addedItemIds.add(item.doc.id);
            continue;
        }

        if ((data.itemAgeRating || '').toLowerCase().includes(query) && !addedTexts.has(data.itemAgeRating.toLowerCase())) {
            matchesByType.age.push({ type: 'age', text: data.itemAgeRating, item });
            addedTexts.add(data.itemAgeRating.toLowerCase());
            addedItemIds.add(item.doc.id);
            continue;
        }

        if ((data.itemScale || '').toLowerCase().includes(query) && !addedTexts.has(data.itemScale.toLowerCase())) {
            matchesByType.scale.push({ type: 'scale', text: data.itemScale, item });
            addedTexts.add(data.itemScale.toLowerCase());
            addedItemIds.add(item.doc.id);
            continue;
        }

        if ((data.itemCategory || '').toLowerCase().includes(query) && !addedTexts.has(data.itemCategory.toLowerCase())) {
            matchesByType.category.push({ type: 'category', text: data.itemCategory, item });
            addedTexts.add(data.itemCategory.toLowerCase());
            addedItemIds.add(item.doc.id);
            continue;
        }

        if ((data.itemName || '').toLowerCase().includes(query)) {
            matchesByType.name.push({ type: 'name', text: data.itemName, item });
            addedItemIds.add(item.doc.id);
        }

        if (Object.values(matchesByType).flat().length >= 10) break;
    }

    const orderedMatches = [
        ...matchesByType.tag,
        ...matchesByType.age,
        ...matchesByType.scale,
        ...matchesByType.category,
        ...matchesByType.name
    ].slice(0, 10);

    orderedMatches.forEach(match => {
        const div = document.createElement('div');
        div.className = 'search-suggestion-item';
        // Display remains clean for the user
        div.innerHTML = `<span class="search-suggestion-icon">${ICONS[match.type]}</span> <span class="suggestion-text">${match.text}</span>`;

        div.onclick = () => {
            // Automatically wrap metadata in braces for the search bar
            if (['tag', 'age', 'scale', 'category'].includes(match.type)) {
                profileSearchInput.value = `{${match.text}}`;
            } else {
                profileSearchInput.value = match.text;
            }

            handleProfileSearch();
            profileSearchSuggestions.innerHTML = '';
        };
        profileSearchSuggestions.appendChild(div);
    });
}

profileSearchInput.addEventListener('input', updateProfileSearchSuggestions);
document.addEventListener('click', (e) => {
    if (!profileSearchSuggestions.contains(e.target) && e.target !== profileSearchInput) {
        profileSearchSuggestions.innerHTML = '';
    }
});

function updateSortOptions() {
    if (!sortSelect) return;

    const baseOptions = `
        <option value="">Sort By...</option>
        <option value="release">Release Date</option>
    `;

    let specificOptions = '';

    if (currentStatusFilter === 'Owned' || currentStatusFilter === 'Ordered') {
        specificOptions = `
            <option value="amount">Quantity</option>
            <option value="price">Price</option>
            <option value="totalPrice">Price + Shipping</option>
            <option value="storeName">Store</option>
        `;
        if (currentStatusFilter === 'Owned') {
            specificOptions += `
                <option value="score">My Score</option>
                <option value="collectionDate">Date Collected</option>
            `;
        }
    } else if (currentStatusFilter === 'Wished') {
        specificOptions = `
            <option value="priority">Priority</option>
        `;
    }

    sortSelect.innerHTML = baseOptions + specificOptions;
}

function renderCreateListButton() {
    if (!isProfileOwner) return;

    const container = document.getElementById('profileListsGrid');
    if (!container) return;

    if (document.getElementById('createListBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'createListBtn';
    btn.className = 'action-btn primary-btn';
    btn.style.marginBottom = '10px';
    btn.innerHTML = '<i class="bi bi-plus-lg"></i> Create List';

    btn.onclick = openCreateListModal;

    container.parentNode.insertBefore(btn, container);
}


const createListModal = document.getElementById('createListModal');
const listNameInput = document.getElementById('listNameInput');
const listPrivacySelect = document.getElementById('listPrivacySelect');
const listTypeSelect = document.getElementById('listTypeSelect');
const liveListOptions = document.getElementById('liveListOptions');
const liveQueryInput = document.getElementById('liveQueryInput');
const liveLogicSelect = document.getElementById('liveLogicSelect');
const createListError = document.getElementById('createListError');

function openCreateListModal() {
    createListModal.style.display = 'flex';
    resetCreateListModal();
}

function resetCreateListModal() {
    listNameInput.value = '';
    listPrivacySelect.value = 'private';
    listTypeSelect.value = 'static';
    liveQueryInput.value = '';
    liveLogicSelect.value = 'AND';
    liveListOptions.style.display = 'none';
    createListError.textContent = '';
}

listTypeSelect.onchange = () => {
    liveListOptions.style.display =
        listTypeSelect.value === 'live' ? 'block' : 'none';
};

document.getElementById('cancelCreateListBtn').onclick = () => {
    createListModal.style.display = 'none';
};

document.getElementById('confirmCreateListBtn').onclick = async () => {
    const name = listNameInput.value.trim();
    if (!name) {
        createListError.textContent = 'List name required.';
        return;
    }

    const user = auth.currentUser;
    if (!user) return;

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    let ref;
    const isPublic = listPrivacySelect.value === 'public';

    if (isPublic) {
        ref = db.collection('public_lists').doc();
    } else {
        ref = db.collection('artifacts')
            .doc(appId)
            .collection('user_profiles')
            .doc(user.uid)
            .collection('lists')
            .doc();
    }

    const payload = {
        name,
        userId: user.uid,
        items: [],
        mode: listTypeSelect.value,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (payload.mode === 'live') {
        if (!liveQueryInput.value.trim()) {
            createListError.textContent = 'Live lists need a query.';
            return;
        }
        payload.liveQuery = liveQueryInput.value.trim();
        payload.liveLogic = liveLogicSelect.value;
    }

    try {
        await ref.set(payload);
        createListModal.style.display = 'none';
        await fetchUserLists(targetUserId);
    } catch (err) {
        console.error(err);
        createListError.textContent = err.message;
    }
};
