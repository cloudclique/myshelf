import { auth, db, collectionName } from './firebase-config.js';

// --- Constants ---
const ITEMS_PER_PAGE = 28;
const COMMENTS_PER_PAGE = 10;


let commentsCurrentPage = 1;
let pageCursors = [null]; // cursors for Firestore pagination


const STATUS_OPTIONS = ['Owned', 'Wished', 'Ordered'];
const DEFAULT_IMAGE_URL = 'https://placehold.co/150x150/444/eee?text=No+Image';
// NEW CONSTANT FOR BANNER
const DEFAULT_BANNER_URL = 'https://placehold.co/1000x200/555/eee?text=Profile+Banner';
// NEW CONSTANT FOR SIZE LIMIT (1 MB)
const MAX_BANNER_SIZE_BYTES = 1024 * 1024;

// --- Variables ---
let currentUserId = null;
let currentStatusFilter = 'Owned';
let currentPage = 1;
let hasNextPage = false;
let lastFetchedItems = []; // all detailed items in current category
let currentSortValue = ''; // ← track current sort for badge display

// --- DOM Elements ---
const profileItemsGrid = document.getElementById('profileItemsGrid');
const statusFilters = document.getElementById('statusFilters');
const loadingStatus = document.getElementById('loadingStatus');
const headerTools = document.getElementById('headerTools');
const paginationContainer = document.getElementById('paginationContainer');

const profileSearchInput = document.getElementById('profileSearchInput');
const profileSearchBtn = document.getElementById('profileSearchBtn');
const profileClearSearchBtn = document.getElementById('profileClearSearchBtn');

const sortSelect = document.getElementById('sortSelect');
const tagFilterDropdown = document.getElementById('tagFilterDropdown');
const applyFilterBtn = document.getElementById('applyFilterBtn');
const clearFilterBtn = document.getElementById('clearFilterBtn');

// NEW BANNER DOM ELEMENTS
const profileBanner = document.getElementById('profileBanner');
const editBannerBtn = document.getElementById('editBannerBtn');
const bannerFileInput = document.getElementById('bannerFileInput');


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

// NEW BANNER EVENT LISTENERS
if (editBannerBtn) editBannerBtn.onclick = () => bannerFileInput.click();
if (bannerFileInput) bannerFileInput.onchange = handleBannerUpload;


// --- URL Hash Helpers ---
function updateURLHash() {
  history.replaceState(null, '', `#${currentStatusFilter}+${currentPage}`);
}

function parseURLHash() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return { status: 'Owned', page: 1 };
  const match = raw.match(/^([A-Za-z]+)\+(\d+)$/);
  if (match) {
    const status = match[1];
    const page = parseInt(match[2], 10) || 1;
    if (STATUS_OPTIONS.includes(status)) return { status, page };
  }
  return { status: 'Owned', page: 1 };
}

// --- Firestore Helper ---
function getUserCollectionRef(userId) {
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  return db.collection('artifacts').doc(appId)
           .collection('user_profiles').doc(userId)
           .collection('items');
}

// Get the reference to the user's profile document
function getUserProfileDocRef(userId) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return db.collection('artifacts').doc(appId)
             .collection('user_profiles').doc(userId);
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

// --- BANNER FUNCTIONS ---

async function fetchAndRenderBanner(userId) {
    if (!userId || !profileBanner) return;
    try {
        const userDoc = await getUserProfileDocRef(userId).get();
        const bannerBase64 = userDoc.data()?.bannerBase64;
        if (bannerBase64) {
            profileBanner.src = bannerBase64;
        } else {
            profileBanner.src = DEFAULT_BANNER_URL;
        }
    } catch (err) {
        console.error("Error fetching banner:", err);
        profileBanner.src = DEFAULT_BANNER_URL;
    }
}

/**
 * Resizes an image if its Base64 representation exceeds a size limit.
 * @param {string} base64Image The image as a data URL (Base64).
 * @param {number} maxWidth The maximum width for the resized image.
 * @param {number} maxHeight The maximum height for the resized image.
 * @param {number} quality The JPEG quality (0.0 to 1.0) for resizing/recompressing.
 * @returns {Promise<string>} The new Base64 data URL, resized or original.
 */
function resizeImageIfTooLarge(base64Image, maxWidth, maxHeight, quality = 0.8) {
    return new Promise((resolve) => {
        // Calculate the approximate binary size of the Base64 string
        const base64Content = base64Image.split(',')[1];
        const approximateSize = atob(base64Content).length;

        // If the size is already acceptable, return the original
        if (approximateSize <= MAX_BANNER_SIZE_BYTES) {
            return resolve(base64Image);
        }

        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            let width = img.width;
            let height = img.height;

            // Calculate new dimensions to fit within maxWidth/maxHeight while maintaining aspect ratio
            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }
            
            // Set canvas size
            canvas.width = width;
            canvas.height = height;

            // Draw the image
            ctx.drawImage(img, 0, 0, width, height);

            // Convert canvas content back to JPEG data URL with reduced quality
            // We use 'image/jpeg' to ensure a smaller file size than PNG, regardless of original type.
            let resizedBase64 = canvas.toDataURL('image/jpeg', quality);
            
            // Re-check size. If still too big, we should reduce quality further (or stop to prevent infinite loops)
            // For simplicity, we assume one pass of reduction (max dimensions + 0.8 quality) is enough.

            resolve(resizedBase64);
        };
        img.onerror = () => resolve(base64Image); // Resolve with original on error
        img.src = base64Image;
    });
}

async function handleBannerUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    loadingStatus.textContent = 'Processing image...';

    const reader = new FileReader();
    reader.onload = async (e) => {
        let base64Image = e.target.result;
        
        // --- RESIZING LOGIC ---
        // Resize the image if it is too large. Using 1500px as a reasonable max width for a banner.
        base64Image = await resizeImageIfTooLarge(base64Image, 1500, 1500, 0.8);
        
        // Update the UI immediately
        profileBanner.src = base64Image;
        loadingStatus.textContent = 'Saving banner...';
        
        // Save to Firestore
        try {
            await getUserProfileDocRef(currentUserId).set({
                bannerBase64: base64Image
            }, { merge: true }); // Use merge so other fields aren't overwritten
            loadingStatus.textContent = 'Banner saved successfully.';
        } catch (err) {
            console.error("Error saving banner:", err);
            loadingStatus.textContent = `Error saving banner: ${err.message}`;
            // Revert UI to previous banner if save fails (optional, but good UX)
            fetchAndRenderBanner(currentUserId);
        }
        // Clear file input value so selecting the same file triggers change again
        bannerFileInput.value = ''; 
    };
    reader.readAsDataURL(file);
}


// --- Auth ---
auth.onAuthStateChanged(async (user) => {
  headerTools.innerHTML = '';
  if (user) {
    currentUserId = user.uid;
    document.getElementById('addCommentBox').style.display = 'block';
    document.getElementById('loginToComment').style.display = 'none';

    // load comments when logged in
    loadComments(currentUserId);

    document.getElementById('postCommentBtn').onclick = postComment;
    headerTools.innerHTML = `<button id="logoutBtn" class="logout-btn">Logout</button>`;
    document.getElementById('logoutBtn').onclick = handleLogout;

    // NEW: Fetch and render banner on login
    await fetchAndRenderBanner(currentUserId);

    renderStatusButtons();

    const { status: hashStatus, page: hashPage } = parseURLHash();
    currentStatusFilter = STATUS_OPTIONS.includes(hashStatus) ? hashStatus : localStorage.getItem('galleryStatusFilter') || 'Owned';

    await fetchProfileItems(currentStatusFilter);

    if (hashPage > 1) {
      for (let i = 1; i < hashPage; i++) {
        currentPage++;
        await fetchPage();
      }
    }

    updateURLHash();
  } else {
    currentUserId = null;
    document.getElementById('addCommentBox').style.display = 'none';
    document.getElementById('loginToComment').style.display = 'block';

    // clear comments
    document.getElementById('commentsList').innerHTML = '';

    headerTools.innerHTML = `<button id="loginBtn" class="login-btn">Login/Register</button>`;
    document.getElementById('loginBtn').onclick = () => window.location.href = 'login.html';
    profileItemsGrid.innerHTML = '<p>Please log in to view your collection...</p>';
    statusFilters.innerHTML = '';
    paginationContainer.innerHTML = '';
    // NEW: Reset banner on logout
    if (profileBanner) profileBanner.src = DEFAULT_BANNER_URL;
  }
});

function handleLogout() {
  localStorage.removeItem('galleryCurrentPage');
  localStorage.removeItem('galleryStatusFilter');
  auth.signOut().catch(console.error);
}

// --- Status Buttons ---
async function renderStatusButtons() {
  if (!currentUserId) return;
  statusFilters.innerHTML = '';

  const counts = await fetchStatusCounts(currentUserId);

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
  if (!currentUserId) return;
  profileItemsGrid.innerHTML = '';
  paginationContainer.innerHTML = '';
  loadingStatus.textContent = `Loading ${status.toLowerCase()} items...`;

  currentPage = 1;
  hasNextPage = false;

  await fetchPage();
}

// --- Fetch Page ---
async function fetchPage() {
  if (!currentUserId) return;

  profileItemsGrid.innerHTML = '';
  loadingStatus.textContent = `Loading page ${currentPage}...`;

  try {
    const userCollectionRef = getUserCollectionRef(currentUserId);
    const snapshot = await userCollectionRef.where('status', '==', currentStatusFilter).get();
    if (snapshot.empty) {
      lastFetchedItems = [];
      renderPageItems([]);
      loadingStatus.textContent = `No items in "${currentStatusFilter}" collection.`;
      return;
    }

    const mainCollectionRef = db.collection(collectionName);
    const detailedItems = await Promise.all(snapshot.docs.map(async doc => {
      const itemDoc = await mainCollectionRef.doc(doc.data().itemId).get();
      if (!itemDoc.exists) return null;
      return { doc: itemDoc, status: doc.data().status };
    }));

    lastFetchedItems = detailedItems.filter(Boolean);
    populateTagDropdown();
    applySortAndFilter(); // ← render sorted and paginated
  } catch (err) {
    console.error(err);
    loadingStatus.textContent = `Error: ${err.message}`;
  }
}

// --- Populate Tag Dropdown ---
function populateTagDropdown() {
  if (!lastFetchedItems.length || !tagFilterDropdown) return;

  const allTagsSet = new Set();
  lastFetchedItems.forEach(item => {
    const tags = item.doc.data().tags || [];
    tags.forEach(tag => allTagsSet.add(tag));
  });

  const allTags = Array.from(allTagsSet).sort();
  tagFilterDropdown.innerHTML = '<option value="">All tags</option>';
  allTags.forEach(tag => {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    tagFilterDropdown.appendChild(option);
  });
}

// --- Render Items ---
function renderPageItems(items) {
  profileItemsGrid.innerHTML = '';
  loadingStatus.textContent = '';
  items.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status)));
  renderPaginationButtons();
}

// --- Single Item Rendering ---
function renderProfileItem(doc, status) {
  const item = doc.data();
  const itemId = doc.id;
  const link = document.createElement('a');
  link.href = `item-details.html?id=${itemId}`;
  link.className = 'item-card-link';

  const card = document.createElement('div');
  card.className = 'item-card';
  card.setAttribute('data-status', status.toLowerCase());

  let imageSrc = DEFAULT_IMAGE_URL;
  if (item.itemImageBase64) {
    const base64 = item.itemImageBase64.replace(/^data:image\/.*;base64,/, '').trim();
    if (base64.length > 0) imageSrc = `data:${item.itemImageMimeType || 'image/jpeg'};base64,${base64}`;
  }

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

  // --- Display value of currently sorted field ---
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
      badge.textContent = status; // fallback
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
  prevBtn.onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      applySortAndFilter();
      updateURLHash();
    }
  };
  paginationContainer.appendChild(prevBtn);

  const pageIndicator = document.createElement('span');
  pageIndicator.textContent = `Page ${currentPage}`;
  pageIndicator.className = 'page-indicator';
  paginationContainer.appendChild(pageIndicator);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next';
  nextBtn.className = 'action-btn';
  nextBtn.disabled = (currentPage * ITEMS_PER_PAGE >= totalItems);
  nextBtn.onclick = () => {
    if (currentPage * ITEMS_PER_PAGE < totalItems) {
      currentPage++;
      applySortAndFilter();
      updateURLHash();
    }
  };
  paginationContainer.appendChild(nextBtn);
}

// --- Search ---
async function handleProfileSearch() {
  const queryText = profileSearchInput.value.trim().toLowerCase();
  if (!queryText || !currentUserId) { handleProfileClearSearch(); return; }

  profileItemsGrid.innerHTML = '';
  loadingStatus.textContent = `Searching ${currentStatusFilter.toLowerCase()} items...`;

  const filtered = lastFetchedItems.filter(item => {
    const name = item.doc.data().itemName?.toLowerCase() || '';
    const id = item.doc.id.toLowerCase();
    return name.includes(queryText) || id.includes(queryText);
  });

  profileItemsGrid.innerHTML = '';
  filtered.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status)));
  loadingStatus.textContent = `${filtered.length} item(s) found.`;
  profileClearSearchBtn.style.display = 'inline-block';
}

// --- Clear Search ---
function handleProfileClearSearch() {
  profileSearchInput.value = '';
  profileClearSearchBtn.style.display = 'none';
  applySortAndFilter();
}

// --- Sort & Filter ---
function applySortAndFilter() {
  if (!lastFetchedItems.length) return;

  currentSortValue = sortSelect?.value ?? '';

  let items = [...lastFetchedItems];

  // Filter by tag
  const selectedTag = tagFilterDropdown?.value;
  if (selectedTag) items = items.filter(item => (item.doc.data().tags || []).includes(selectedTag));

  // Sort
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
      case 'releaseDesc': return new Date(dataB.itemReleaseDate || 0) - new Date(dataA.itemReleaseDate || 0);
      default: return 0;
    }
  });

  // Pagination
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const pagedItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  profileItemsGrid.innerHTML = '';
  pagedItems.forEach(item => profileItemsGrid.appendChild(renderProfileItem(item.doc, item.status)));
  loadingStatus.textContent = `${items.length} item(s) shown after filter/sort.`;

  renderPaginationButtons();
}

// --- Hash Navigation ---
window.addEventListener('hashchange', async () => {
  const { status, page } = parseURLHash();
  if (status !== currentStatusFilter) { currentStatusFilter = status; renderStatusButtons(); await fetchProfileItems(status); }
  if (page !== currentPage) { currentPage = page; applySortAndFilter(); }
});

// --- Save State ---
window.addEventListener('beforeunload', () => {
  localStorage.setItem('galleryCurrentPage', currentPage);
  localStorage.setItem('galleryStatusFilter', currentStatusFilter);
});




// Escape HTML but also convert URLs to clickable links
// Now uses pageCursors array to manage state
/**
 * Utility function to convert URLs in text into clickable anchor tags.
 * Supports http, https, and www.
 * @param {string} text The comment text.
 * @returns {string} The text with clickable links.
 */
function linkify(text) {
    // Regex to find URLs starting with http://, https://, or www.
    // The pattern captures the protocol/www part and the rest of the URL.
    const urlPattern = /(\b(https?:\/\/|www\.)[^\s]+\b)/g;

    return text.replace(urlPattern, function(url) {
        let fullUrl = url;

        // Prepend 'http://' if the URL starts with 'www.' to ensure it's a valid link format
        if (url.startsWith('www.')) {
            fullUrl = 'http://' + url;
        }

        // Use rel="noopener noreferrer" for security and target="_blank" to open in a new tab
        return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
}

async function loadComments(profileUserId) {
  const commentsList = document.getElementById('commentsList');
  commentsList.innerHTML = '<p>Loading comments...</p>';

  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  const currentUser = auth.currentUser;
  const currentUid = currentUser ? currentUser.uid : null;

  // Fetch current user role for admin/mod check
  let currentUserRole = null;
  if (currentUid) {
    try {
      const roleDoc = await db.collection('artifacts')
        .doc(appId)
        .collection('user_profiles')
        .doc(currentUid)
        .get();
      currentUserRole = roleDoc.data()?.role || null;
    } catch (err) {
      console.error("Error fetching user role:", err);
    }
  }

  // Get the cursor for the current page
  const startDoc = pageCursors[commentsCurrentPage - 1] || null;

  let query = db.collection('artifacts')
    .doc(appId)
    .collection('user_profiles')
    .doc(profileUserId)
    .collection('comments')
    .orderBy('timestamp', 'desc')
    .limit(COMMENTS_PER_PAGE);

  if (startDoc) query = query.startAfter(startDoc);

  const snapshot = await query.get();

  if (snapshot.empty) {
    commentsList.innerHTML = '<p>No comments yet.</p>';
    if (commentsCurrentPage > 1) commentsCurrentPage--;
    return;
  }

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
          <span class="comment-author"  style="text-decoration: underline;">${linkify(c.displayName || 'User')}</span>
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
              await db.collection('artifacts')
                .doc(appId)
                .collection('user_profiles')
                .doc(profileUserId)
                .collection('comments')
                .doc(commentId)
                .delete();

              // Reset pagination to first page after deletion
              commentsCurrentPage = 1;
              pageCursors = [null];
              loadComments(profileUserId);
            } catch (err) {
              console.error("Failed to delete comment:", err);
            }
          });
        };
      }
  });

  // Save last document as cursor for next page
  if (snapshot.docs.length === COMMENTS_PER_PAGE) {
    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (pageCursors.length === commentsCurrentPage) pageCursors.push(lastDoc);
  } else {
    pageCursors.length = commentsCurrentPage; // end of pages
  }

  // Render pagination buttons
  renderCommentPagination(profileUserId);
}


async function postComment() {
  if (!currentUserId) return;

  const input = document.getElementById('commentInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';

  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  const user = auth.currentUser;

  await db.collection('artifacts')
    .doc(appId)
    .collection('user_profiles')
    .doc(currentUserId)
    .collection('comments')
    .add({
      userId: currentUserId,
      displayName: user.displayName || user.email || "Anonymous",
      text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

  // Reset pagination to first page
  commentsCurrentPage = 1;
  pageCursors = [null];
  loadComments(currentUserId);
}

function renderCommentPagination(profileUserId) {
  const container = document.getElementById('commentPagination');
  if (!container) return;
  container.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.style.margin = '20px';
  prevBtn.className = 'action-btn';
  prevBtn.textContent = 'Previous';
  prevBtn.disabled = commentsCurrentPage === 1;
  prevBtn.onclick = () => {
    if (commentsCurrentPage > 1) {
      commentsCurrentPage--;
      loadComments(profileUserId);
    }
  };

  const nextBtn = document.createElement('button');
  nextBtn.style.margin = '20px';
  nextBtn.className = 'action-btn';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = pageCursors.length <= commentsCurrentPage;
  nextBtn.onclick = () => {
    if (pageCursors.length > commentsCurrentPage) {
      commentsCurrentPage++;
      loadComments(profileUserId);
    }
  };

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

  function cleanup() {
    modal.style.display = 'none';
    yesBtn.onclick = null;
    noBtn.onclick = null;
  }

  yesBtn.onclick = () => { cleanup(); onConfirm(); };
  noBtn.onclick = cleanup;
}