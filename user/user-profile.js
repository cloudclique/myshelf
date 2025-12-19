import { auth, db, collectionName } from '../firebase-config.js';

// --- Constants ---
const ITEMS_PER_PAGE = 32;
const COMMENTS_PER_PAGE = 10;
const STATUS_OPTIONS = ['Owned', 'Wished', 'Ordered'];
const DEFAULT_IMAGE_URL = 'https://placehold.co/150x150/444/eee?text=No+Image';
const DEFAULT_BANNER_URL = 'https://placehold.co/1000x200/555/eee?text=User+Profile+Banner'; 

const ROLE_HIERARCHY = {
    'admin': { assigns: ['mod', "shop", "og", 'user'] },
    'mod': { assigns: ["shop", "og", 'user'] },
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
if (sortSelect) sortSelect.onchange = applySortAndFilter;
if (tagFilterDropdown) tagFilterDropdown.onchange = applySortAndFilter;
if (applyFilterBtn) applyFilterBtn.onclick = applySortAndFilter;
if (clearFilterBtn) clearFilterBtn.onclick = () => { if (tagFilterDropdown) tagFilterDropdown.value = ''; applySortAndFilter(); };
if (postCommentBtn) postCommentBtn.onclick = postComment;

// --- URL Hash and Query Helpers ---
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
    await fetchAndRenderBanner(targetUserId);
    targetUsername = await fetchUsername(targetUserId);
    profileTitle.textContent = `${targetUsername}'s Collection`;
    
    const currentUser = auth.currentUser;
    isProfileOwner = currentUser && targetUserId === currentUser.uid;
    
    if (openChatBtn) customizeHeaderForOwner(); 

    // Initialize Staff Modal if not profile owner
    if (currentUser && !isProfileOwner) {
        setupRoleModal(currentUser.uid);
    }

    const { status: hashStatus, page: hashPage, search: hashSearch } = parseURLHash();
    currentStatusFilter = STATUS_OPTIONS.includes(hashStatus) ? hashStatus : 'Owned';
    currentPage = hashPage || 1;
    await renderStatusButtons();
    await fetchProfileItems(currentStatusFilter);
    if (hashSearch) {
        profileSearchInput.value = hashSearch;
        await handleProfileSearch();
    } else {
        renderPageItems(lastFetchedItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE));
    }
    await loadComments(targetUserId);
    await fetchAndRenderGalleryPreview(targetUserId);
    if (profileLoader) profileLoader.classList.add('hidden');
}

// --- Staff Role Logic ---
async function setupRoleModal(currentUid) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    try {
        // Get current user's role
        const myDoc = await db.collection('artifacts').doc(appId).collection('user_profiles').doc(currentUid).get();
        const myRole = myDoc.data()?.role || 'user';

        // Get target user's role
        const targetDoc = await db.collection('artifacts').doc(appId).collection('user_profiles').doc(targetUserId).get();
        const targetRole = targetDoc.data()?.role || 'user';

        // Compute roles that current user can assign
        const allowedRoles = ROLE_HIERARCHY[myRole]?.assigns || [];

        // Hide button if no assignable roles OR target user is at same/higher level
        const targetAssignable = allowedRoles.filter(role => {
            // prevent mod assigning anything to another mod/admin
            if (myRole === 'mod') return !['admin', 'mod'].includes(targetRole);
            return true; // admin can assign anything
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
      fetchProfileItems(status);
      updateURLHash();
    };
    statusFilters.appendChild(button);
  });
}

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

function renderPageItems(items) {
  profileItemsGrid.innerHTML = '';
  loadingStatus.textContent = ''; 
  items.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status)));
  renderPaginationButtons();
}

function renderProfileItem(doc, status) {
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

  let imageSrc = (item.itemImageUrls && item.itemImageUrls[0] && item.itemImageUrls[0].url) || DEFAULT_IMAGE_URL;
  const imageWrapper = document.createElement('div');
  imageWrapper.className = 'item-image-wrapper';
  
  if (shouldBlur) imageWrapper.classList.add('nsfw-blur');

  const img = document.createElement('img');
  img.src = imageSrc;
  img.alt = item.itemName;
  img.className = 'item-image';

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

  const info = document.createElement('div');
  info.className = 'item-info';
  const title = document.createElement('h3');
  title.textContent = item.itemName;

  const badge = document.createElement('span');
  switch (currentSortValue) {
    case 'ageAsc':
    case 'ageDesc': badge.textContent = item.itemAgeRating ?? 'N/A'; break;
    case 'scaleAsc':
    case 'scaleDesc': badge.textContent = item.itemScale ?? 'N/A'; break;
    case 'releaseAsc':
    case 'releaseDesc': badge.textContent = item.itemReleaseDate ? new Date(item.itemReleaseDate).toLocaleDateString() : 'N/A'; break;
    default: badge.textContent = status; break;
  }

  info.appendChild(title);
  info.appendChild(badge);
  card.appendChild(imageWrapper);
  card.appendChild(info);
  link.appendChild(card);
  return link;
}

function renderPaginationButtons() {
  if (!paginationContainer) return;
  paginationContainer.innerHTML = '';
  const totalItems = lastFetchedItems.length;
  if (totalItems <= ITEMS_PER_PAGE) return;
  const prevBtn = document.createElement('button');
  prevBtn.innerHTML = '<i class="bi bi-caret-left-fill"></i>';
  prevBtn.className = 'action-btn';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => { currentPage--; applySortAndFilter(); updateURLHash(); };
  paginationContainer.appendChild(prevBtn);
  const pageIndicator = document.createElement('span');
  pageIndicator.textContent = `Page ${currentPage}`;
  pageIndicator.className = 'page-indicator';
  paginationContainer.appendChild(pageIndicator);
  const nextBtn = document.createElement('button');
  nextBtn.innerHTML = '<i class="bi bi-caret-right-fill"></i>';
  nextBtn.className = 'action-btn';
  nextBtn.disabled = (currentPage * ITEMS_PER_PAGE >= totalItems);
  nextBtn.onclick = () => { currentPage++; applySortAndFilter(); updateURLHash(); };
  paginationContainer.appendChild(nextBtn);
}

async function handleProfileSearch() {
    const queryText = profileSearchInput.value.trim().toLowerCase();
    if (!targetUserId) return handleProfileClearSearch();
    profileItemsGrid.innerHTML = '';
    loadingStatus.textContent = `Searching ${currentStatusFilter.toLowerCase()} items...`;
    const keywords = queryText.split(/\s+/);
    const filtered = lastFetchedItems.filter(item => {
        const data = item.doc.data();
        const searchable = [data.itemName || '', (data.tags || []).join(' '), data.itemCategory || '', data.itemScale || '', data.itemAgeRating || ''].join(' ').toLowerCase();
        return keywords.every(kw => searchable.includes(kw));
    });
    profileItemsGrid.innerHTML = '';
    filtered.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status)));
    loadingStatus.textContent = `${filtered.length} item(s) found.`;
    profileClearSearchBtn.style.display = 'inline-block';
    currentPage = 1;
    updateURLHash();
}

function handleProfileClearSearch() {
    profileSearchInput.value = '';
    profileClearSearchBtn.style.display = 'none';
    renderPageItems(lastFetchedItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE));
    updateURLHash();
}

async function fetchAndRenderGalleryPreview(userId) {
    const previewGrid = document.getElementById('previewGrid');
    if (!previewGrid || !userId) return;
    previewGrid.innerHTML = '<p style="grid-column: 1/span 4; text-align: center;">Loading images...</p>';
    try {
        const galleryRef = getGalleryCollectionRef();
        const gallerySnapshot = await galleryRef.where('uploaderId', '==', userId).orderBy('createdAt', 'desc').limit(4).get();
        previewGrid.innerHTML = '';
        if (gallerySnapshot.empty) {
            previewGrid.innerHTML = '<p style="grid-column: 1/span 4; text-align: center; color: #888;">No uploaded gallery images found.</p>';
            return;
        }
        gallerySnapshot.docs.forEach(doc => {
            const imageDoc = doc.data();
            const imageUrl = imageDoc.url || DEFAULT_IMAGE_URL;
            const link = document.createElement('a');
            link.className = 'gallery-thumbnail-link';
            const img = document.createElement('img');
            img.src = imageUrl;
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
  if (!lastFetchedItems.length) return;
  currentSortValue = sortSelect?.value ?? '';
  let items = [...lastFetchedItems];
  const selectedTag = tagFilterDropdown?.value;
  if (selectedTag) items = items.filter(item => (item.doc.data().tags || []).includes(selectedTag));
  items.sort((a, b) => {
    const dataA = a.doc.data();
    const dataB = b.doc.data();
    const getNumber = (val) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const parsed = parseFloat(val.replace(/[^\d.]/g, ''));
        return isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    };
    switch (currentSortValue) {
      case 'ageAsc': return getNumber(dataA.itemAgeRating) - getNumber(dataB.itemAgeRating);
      case 'ageDesc': return getNumber(dataB.itemAgeRating) - getNumber(dataA.itemAgeRating);
      case 'scaleDesc': return getNumber(dataA.itemScale) - getNumber(dataB.itemScale);
      case 'scaleAsc': return getNumber(dataB.itemScale) - getNumber(dataA.itemScale);
      case 'releaseAsc': return new Date(dataA.itemReleaseDate || 0) - new Date(dataB.itemReleaseDate || 0);
      case 'releaseDesc': return new Date(dataB.itemReleaseDate || 0) - new Date(a.doc.data().itemReleaseDate || 0);
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
        renderPageItems(lastFetchedItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE));
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
    return text.replace(urlPattern, function(url) {
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
            const canvasWidth = 1000; const canvasHeight = 200;
            canvas.width = canvasWidth; canvas.height = canvasHeight;
            const scale = Math.max(canvasWidth / img.width, canvasHeight / img.height);
            const scaledWidth = img.width * scale; const scaledHeight = img.height * scale;
            let offsetX = (canvasWidth - scaledWidth) / 2; let offsetY = 0;
            const maxOffsetY = Math.max(0, scaledHeight - canvasHeight);
            const draw = () => { ctx.clearRect(0, 0, canvasWidth, canvasHeight); ctx.drawImage(img, 0, offsetY / scale, img.width, canvasHeight / scale, offsetX, 0, scaledWidth, canvasHeight); };
            draw();
            let dragging = false; let startY = 0;
            canvas.onmousedown = (e) => { dragging = true; startY = e.clientY; };
            const onMouseMove = (e) => { if (!dragging) return; const delta = e.clientY - startY; offsetY = Math.min(Math.max(offsetY - delta, 0), maxOffsetY); startY = e.clientY; draw(); };
            const onMouseUp = () => { dragging = false; };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            const cleanup = () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = "text-align:center; margin-top:10px;";
            const okBtn = document.createElement('button'); okBtn.textContent = "Save";
            const cancelBtn = document.createElement('button'); cancelBtn.textContent = "Cancel"; cancelBtn.style.marginLeft = "10px";
            btnContainer.appendChild(okBtn); btnContainer.appendChild(cancelBtn); popup.appendChild(btnContainer);
            okBtn.onclick = () => { const finalBase64 = canvas.toDataURL('image/jpeg', 0.9); cleanup(); document.body.removeChild(overlay); resolve(finalBase64); };
            cancelBtn.onclick = () => { cleanup(); document.body.removeChild(overlay); resolve(null); };
        };
        popup.appendChild(canvas);
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