import { auth, db } from '../firebase-config.js';

// ---------- URL PARAMETERS ----------
const params = new URLSearchParams(window.location.search);
const listId = params.get('list');
const listType = params.get('type');

// ---------- DOM ELEMENTS ----------
const listTitle = document.getElementById('listTitle');
const itemsGrid = document.getElementById('listItemsGrid');
const listSettingsBtn = document.getElementById('listSettingsBtn');
const deleteListBtn = document.getElementById('deleteListBtn');
const listLoader = document.getElementById('listLoader');
const editListModal = document.getElementById('editListModal');
const editListNameInput = document.getElementById('editListName');
const saveListChangesBtn = document.getElementById('saveListChanges');
const closeEditModalBtn = document.getElementById('closeEditModal');
const shareListBtn = document.getElementById('shareListBtn'); // Element from index.html

// Search Elements
const listSearchInput = document.getElementById('listSearchInput');
const listSearchSuggestions = document.getElementById('listSearchSuggestions');
const headerTools = document.getElementById('headerTools');

const listBioSection = document.getElementById('listBioSection');
const listBioText = document.getElementById('listBioText');
const editBioBtn = document.getElementById('editBioBtn');
const bioDisplayGroup = document.getElementById('bioDisplayGroup');
const bioEditGroup = document.getElementById('bioEditGroup');
const listBioInput = document.getElementById('listBioInput');
const saveBioBtn = document.getElementById('saveBioBtn');
const cancelBioBtn = document.getElementById('cancelBioBtn');

const favoriteListBtn = document.getElementById('favoriteListBtn');
const favIcon = document.getElementById('favIcon');
const favText = document.getElementById('favText');
let isFavorited = false;

// Comments DOM
const commentInput = document.getElementById('commentInput');
const postCommentBtn = document.getElementById('postCommentBtn');
const commentMessage = document.getElementById('commentMessage');
const commentsList = document.getElementById('commentsList');
const authCommentBox = document.getElementById('authCommentBox');
const loginToCommentMsg = document.getElementById('loginToCommentMsg');
const paginationControls = document.getElementById('paginationControls');

// ---------- STATE ----------
let listRef = null;
let listData = null;
let listOwnerId = null;
let isNsfwAllowed = false;
let currentUserRole = null;
let allFetchedItems = [];
let currentFilteredItems = []; // Track filtered items for pagination
const DEFAULT_IMAGE_URL = 'https://placehold.co/150x150/444/eee?text=No+Image';

// Pagination State
let currentPage = 1;
const ITEMS_PER_PAGE = 48;


const liveQueryGroup = document.getElementById('liveQueryGroup');
const editLiveQueryInput = document.getElementById('editLiveQuery');
const editModeRadios = document.getElementsByName('editMode');



// =====================================
// AUTH & HEADER UI LOGIC
// =====================================

function updateHeaderAuthButton(user) {
    if (!headerTools) return;
    headerTools.innerHTML = '';
    const btn = document.createElement('button');
    if (user) {
        btn.className = 'logout-btn';
        btn.textContent = 'Logout';
        btn.onclick = async () => {
            try {
                await auth.signOut();
                window.location.reload();
            } catch (err) { console.error(err); }
        };
    } else {
        btn.className = 'login-btn';
        btn.textContent = 'Login';
        btn.onclick = () => { window.location.href = '../login'; };
    }
    headerTools.appendChild(btn);
}

// =====================================
// AUTH & INITIALIZATION
// =====================================
auth.onAuthStateChanged(async (user) => {
    updateHeaderAuthButton(user);

    if (user) {
        if (authCommentBox) authCommentBox.style.display = 'block';
        if (loginToCommentMsg) loginToCommentMsg.style.display = 'none';
    } else {
        if (authCommentBox) authCommentBox.style.display = 'none';
        if (loginToCommentMsg) loginToCommentMsg.style.display = 'block';
    }

    if (user) {
        try {
            const profileDoc = await db.collection('artifacts').doc('default-app-id').collection('user_profiles').doc(user.uid).get();
            isNsfwAllowed = profileDoc.data()?.allowNSFW === true;
            currentUserRole = profileDoc.data()?.role || null;
            checkFavoriteStatus(user.uid);
        } catch (err) { isNsfwAllowed = false; }
    } else { isNsfwAllowed = false; }

    if (!listId || !listType) {
        if (listTitle) listTitle.textContent = "Invalid List Link";
        if (listLoader) listLoader.style.display = 'none';
        return;
    }
    loadList(user ? user.uid : null);
});

// =====================================
// LOAD LIST
// =====================================
async function loadList(currentUserId) {
    if (itemsGrid) itemsGrid.innerHTML = '';
    if (listSettingsBtn) listSettingsBtn.style.display = 'none';
    if (deleteListBtn) deleteListBtn.style.display = 'none';

    try {
        if (listType === 'public') {
            // Fetch from lists/{listId} directly
            const listDoc = await db.collection('lists').doc(listId).get();
            if (!listDoc.exists) {
                listTitle.textContent = "List Not Found";
                if (listLoader) listLoader.style.display = 'none';
                return;
            }
            listData = listDoc.data();
            listData.id = listId;
            listRef = db.collection('lists').doc(listId);
        } else {
            // Private list from user's subcollection
            listRef = db.collection('artifacts').doc('default-app-id')
                .collection('user_profiles').doc(currentUserId)
                .collection('lists').doc(listId);

            const listDoc = await listRef.get();
            if (!listDoc.exists) {
                listTitle.textContent = "List Not Found";
                if (listLoader) listLoader.style.display = 'none';
                return;
            }
            listData = listDoc.data();
            listData.id = listId;
        }

        listOwnerId = listData.userId;
        listTitle.textContent = listData.name || 'Unnamed List';
        listTitlePlaceholder.textContent = listData.name + (" - List")

        // Bio Logic
        if (listData.description || currentUserId === listOwnerId) {
            listBioSection.style.display = 'block';
            listBioText.textContent = listData.description || "";

            if (currentUserId === listOwnerId) {
                editBioBtn.style.display = 'inline-block';
                if (!listData.description) listBioText.textContent = "No description yet.";
            }
        }

        if (currentUserId === listOwnerId) {
            if (listSettingsBtn) listSettingsBtn.style.display = 'inline-block';
            if (deleteListBtn) deleteListBtn.style.display = 'inline-block';
        }

        // --- FETCH ALL ITEMS (Unified) ---
        // Whether Live or Static, we need to access items which are now sharded.
        // Reading all shards is the safest way to "get DB state".

        const allGlobalItems = await fetchAllGlobalItemsFromShards();

        // --- LIVE SYNC LOGIC ---
        if (listData.mode === 'live') {
            const allItems = allGlobalItems.map(item => ({ id: item.itemId, data: item }));

            // 2. Determine which items SHOULD be in the list based on query
            const matchedItems = filterItemsByQuery(allItems, listData.liveQuery, listData.liveLogic || 'AND');
            const matchedIds = matchedItems.map(item => item.id);

            // 3. Compare with current saved items array
            const currentIds = listData.items || [];
            const isDifferent = JSON.stringify(matchedIds.sort()) !== JSON.stringify((currentIds || []).sort());

            if (isDifferent && currentUserId) {
                // Anyone can sync a public live list; only the owner can sync a private one.
                const canSync = (currentUserId === listOwnerId) || (listType === 'public');

                if (canSync) {
                    // Update the list - now using direct document reference
                    await listRef.update({ items: matchedIds });
                    listData.items = matchedIds;
                }
            }

            allFetchedItems = matchedItems;
            renderFilteredItems(allFetchedItems);
        } else {
            // Static retrieval
            const targetIds = new Set(listData.items || []);
            allFetchedItems = allGlobalItems
                .filter(item => targetIds.has(item.itemId))
                .map(item => ({ id: item.itemId, data: item }));

            renderFilteredItems(allFetchedItems);
        }

    } catch (error) {
        console.error("Sync Error:", error);
        if (listTitle) listTitle.textContent = "Error Loading List";
    } finally {
        if (listLoader) listLoader.style.display = 'none';
        loadComments();
    }
    checkFavoriteStatus(currentUserId);
}

// Helper to fetch all items from the denormalized_data collection
async function fetchAllGlobalItemsFromShards() {
    try {
        const itemsDoc = await db.collection('denormalized_data').doc('items').get();
        if (itemsDoc.exists) {
            const data = itemsDoc.data();
            return Object.entries(data).map(([id, item]) => ({
                itemId: id,
                ...item
            }));
        }
        return [];
    } catch (e) {
        console.error("Error fetching denormalized data:", e);
        return [];
    }
}

async function updatePublicList(listId, updateData) {
    // Update the list document directly
    await db.collection('lists').doc(listId).update(updateData);
}

// Deprecated: fetchAllItems(itemIds) replaced by fetchAllGlobalItemsFromShards logic inside loadList

// =====================================
// RENDERING & SEARCH LOGIC
// =====================================

function renderFilteredItems(items) {
    if (!itemsGrid) return;
    itemsGrid.innerHTML = '';

    currentFilteredItems = items; // Update state

    if (items.length === 0) {
        itemsGrid.innerHTML = '<p>No items match your search.</p>';
        paginationControls.innerHTML = '';
        return;
    }

    // Pagination Logic
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const visibleItems = items.slice(start, end);

    visibleItems.forEach(itemObj => {
        itemsGrid.appendChild(createItemCard(itemObj.id, itemObj.data));
    });

    renderPagination(items.length);
}

function renderPagination(totalItems) {
    if (!paginationControls) return;
    paginationControls.innerHTML = '';

    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    // Previous Button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'action-btn';
    prevBtn.innerHTML = '<i class="bi bi-caret-left-fill"></i>';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => changePage(currentPage - 1);

    // Page Indicator
    const pageIndicator = document.createElement('span');
    pageIndicator.className = 'page-indicator';
    pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
    pageIndicator.style.alignContent = 'center';
    pageIndicator.style.margin = '0 10px';

    // Next Button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'action-btn';
    nextBtn.innerHTML = '<i class="bi bi-caret-right-fill"></i>';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => changePage(currentPage + 1);

    paginationControls.appendChild(prevBtn);
    paginationControls.appendChild(pageIndicator);
    paginationControls.appendChild(nextBtn);
}

function changePage(newPage) {
    currentPage = newPage;
    renderFilteredItems(currentFilteredItems);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function createItemCard(id, item) {
    const isAdult = (item.itemAgeRating === '18+' || item.itemAgeRating === 'Adult');
    const shouldBlur = isAdult && !isNsfwAllowed;

    const link = document.createElement('a');
    link.href = `../items/?id=${id}`;
    link.className = 'item-card-link';

    const card = document.createElement('div');
    card.className = 'item-card';

    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'item-image-wrapper';
    if (shouldBlur) imageWrapper.classList.add('nsfw-blur');

    const img = document.createElement('img');
    // detailed items have itemImageUrls, denormalized has thumbnail
    img.src = item.thumbnail || (item.itemImageUrls && item.itemImageUrls[0]?.url) || DEFAULT_IMAGE_URL;
    img.className = 'item-image';



    imageWrapper.appendChild(img);

    if (shouldBlur) {
        const badge = document.createElement('div');
        badge.className = 'nsfw-overlay';
        badge.textContent = '18+';
        imageWrapper.appendChild(badge);
    }

    if (item.isDraft) {
        const draftBadge = document.createElement('div');
        draftBadge.className = 'draft-overlay';
        draftBadge.textContent = 'Draft';
        imageWrapper.appendChild(draftBadge);
    }

    if (auth.currentUser?.uid === listOwnerId && listData?.mode !== 'live') {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = 'âœ•';
        removeBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeItemFromList(id);
        };
        imageWrapper.appendChild(removeBtn);
    }

    const info = document.createElement('div');
    info.className = 'item-info';
    info.innerHTML = `<h3>${item.itemName || 'Unnamed'}</h3><span>${item.itemCategory || 'Item'}</span>`;

    card.appendChild(imageWrapper);
    card.appendChild(info);
    link.appendChild(card);
    return link;
}

const ICONS = {
    name: '<i class="bi bi-sticky-fill"></i>',
    category: '<i class="bi bi-folder-fill"></i>',
    scale: '<i class="bi bi-arrows-fullscreen"></i>',
    age: '<i class="bi bi-exclamation-octagon"></i>',
    tag: '<i class="bi bi-tag-fill"></i>'
};

function updateSearchSuggestions() {
    const query = listSearchInput.value.trim().toLowerCase();
    if (!query) {
        listSearchSuggestions.innerHTML = '';
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
    const addedTexts = new Set(); // Track unique text for tag/age/scale/category

    for (let itemObj of allFetchedItems) {
        const item = itemObj.data;
        const itemId = itemObj.id;

        // Skip NSFW if not allowed
        if (!isNsfwAllowed && (item.itemAgeRating === '18+' || item.itemAgeRating === 'Adult')) continue;
        if (addedItemIds.has(itemId)) continue;

        // 1. Check tags
        const tagMatch = (item.tags || []).find(t => t.toLowerCase().includes(query));
        if (tagMatch && !addedTexts.has('tag:' + tagMatch.toLowerCase())) {
            matchesByType.tag.push({ type: 'tag', text: tagMatch });
            addedTexts.add('tag:' + tagMatch.toLowerCase());
            addedItemIds.add(itemId);
            continue;
        }

        // 2. Check age rating
        const age = (item.itemAgeRating || '');
        if (age.toLowerCase().includes(query) && !addedTexts.has('age:' + age.toLowerCase())) {
            matchesByType.age.push({ type: 'age', text: age });
            addedTexts.add('age:' + age.toLowerCase());
            addedItemIds.add(itemId);
            continue;
        }

        // 3. Check scale
        const scale = (item.itemScale || '');
        if (scale.toLowerCase().includes(query) && !addedTexts.has('scale:' + scale.toLowerCase())) {
            matchesByType.scale.push({ type: 'scale', text: scale });
            addedTexts.add('scale:' + scale.toLowerCase());
            addedItemIds.add(itemId);
            continue;
        }

        // 4. Check category
        const cat = (item.itemCategory || '');
        if (cat.toLowerCase().includes(query) && !addedTexts.has('cat:' + cat.toLowerCase())) {
            matchesByType.category.push({ type: 'category', text: cat });
            addedTexts.add('cat:' + cat.toLowerCase());
            addedItemIds.add(itemId);
            continue;
        }

        // 5. Check name
        const name = (item.itemName || '');
        if (name.toLowerCase().includes(query)) {
            matchesByType.name.push({ type: 'name', text: name });
            addedItemIds.add(itemId);
        }

        // Limit total results to 10
        const totalCount = Object.values(matchesByType).flat().length;
        if (totalCount >= 10) break;
    }

    // Merge in priority order
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
    listSearchSuggestions.innerHTML = '';

    matches.forEach(match => {
        const div = document.createElement('div');
        div.className = 'search-suggestion-item';

        // Use ICONS mapping
        div.innerHTML = `<span class="search-suggestion-icon">${ICONS[match.type] || ''}</span> ${match.text}`;

        div.onclick = () => {
            // Braced types logic
            const bracedTypes = ['tag', 'age', 'category', 'scale'];

            if (bracedTypes.includes(match.type)) {
                // Automatically apply braces for these types
                listSearchInput.value = `{${match.text}}`;
            } else {
                listSearchInput.value = match.text;
            }

            handleSearch();
            listSearchSuggestions.innerHTML = '';
        };

        listSearchSuggestions.appendChild(div);
    });
}

// --- UPDATED SEARCH WITH SORTING ---
let isAscending = false; // Default to High to Low (Newest first)

function handleSearch() {
    const query = listSearchInput.value.toLowerCase().trim();
    let filtered = [];

    if (!query) {
        filtered = [...allFetchedItems];
    } else {
        const regex = /\{([^}]+)\}|(\S+)/g;
        const required = [];
        const excluded = [];
        let match;

        while ((match = regex.exec(query)) !== null) {
            const term = (match[1] || match[2]).toLowerCase();
            if (term.startsWith('-') && term.length > 1) {
                excluded.push(term.substring(1));
            } else {
                required.push(term);
            }
        }

        filtered = allFetchedItems.filter(itemObj => {
            const item = itemObj.data;
            const combinedText = [
                item.itemName,
                item.itemCategory,
                item.itemScale,
                (item.itemAgeRating || ''),
                ...(item.tags || [])
            ].join(' | ').toLowerCase();

            const hasExcluded = excluded.some(kw => combinedText.includes(kw));
            if (hasExcluded) return false;

            if (required.length === 0) return true;
            return required.every(kw => combinedText.includes(kw));
        });
    }

    currentPage = 1; // Reset to first page on new search
    renderFilteredItems(sortItems(filtered));
}

const sortSelect = document.getElementById('sortSelect');
if (sortSelect) {
    sortSelect.addEventListener('change', handleSearch);
}

// --- HELPER: SORTING ---
function sortItems(items) {
    const sortType = document.getElementById('sortSelect')?.value || 'date';

    return items.sort((a, b) => {
        let valA, valB;
        const dataA = a.data;
        const dataB = b.data;

        if (sortType === 'alpha') {
            valA = (dataA.itemName || "").toLowerCase();
            valB = (dataB.itemName || "").toLowerCase();
            return isAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }

        if (sortType === 'date') {
            // Sort by itemReleaseDate
            valA = new Date(dataA.itemReleaseDate || 0).getTime();
            valB = new Date(dataB.itemReleaseDate || 0).getTime();
            return isAscending ? valA - valB : valB - valA;
        }

        return 0;
    });
}

window.toggleSortDirection = function () {
    isAscending = !isAscending;
    const btn = document.getElementById('sortDirBtn');
    const icon = btn.querySelector('i');

    if (isAscending) {
        // Low to High (A-Z / Oldest First)
        icon.className = 'bi bi-sort-down';
    } else {
        // High to Low (Z-A / Newest First)
        icon.className = 'bi bi-sort-up';
    }

    handleSearch();
};

document.getElementById('sortSelect')?.addEventListener('change', handleSearch);

if (listSearchInput) {
    listSearchInput.addEventListener('input', () => {
        updateSearchSuggestions();
        handleSearch();
    });
}

document.addEventListener('click', (e) => {
    if (listSearchInput && !listSearchInput.contains(e.target)) listSearchSuggestions.innerHTML = '';
});

// = = = = ACTIONS = = = =

function goBackToPrevious() {
    if (document.referrer && !document.referrer.includes(window.location.search)) {
        window.location.href = document.referrer;
    } else {
        window.location.href = "../profile.html";
    }
}

async function removeItemFromList(itemId) {
    if (!confirm("Remove this item from the list?")) return;
    try {
        // Update items array directly on the list document
        await listRef.update({
            items: firebase.firestore.FieldValue.arrayRemove(itemId)
        });
        allFetchedItems = allFetchedItems.filter(i => i.id !== itemId);
        handleSearch();
    } catch (e) { alert(e.message); }
}

if (deleteListBtn) {
    deleteListBtn.onclick = async () => {
        if (confirm("Delete this list?")) {
            // Delete the list document directly
            await listRef.delete();

            // Sync: Remove from denormalized_data/lists
            try {
                await db.collection('denormalized_data').doc('lists').update({
                    [`${listOwnerId}.${listId}`]: firebase.firestore.FieldValue.delete()
                });
            } catch (err) {
                console.error("Error syncing delete to denormalized data:", err);
            }

            goBackToPrevious();
        }
    };
}

if (listSettingsBtn) {
    listSettingsBtn.onclick = () => {
        editListNameInput.value = listData.name || "";

        // Restore Privacy
        const privacyRadio = document.querySelector(`input[name="editPrivacy"][value="${listType}"]`);
        if (privacyRadio) privacyRadio.checked = true;

        // Restore Mode
        const currentMode = listData.mode || 'default';
        const modeRadio = document.querySelector(`input[name="editMode"][value="${currentMode}"]`);
        if (modeRadio) modeRadio.checked = true;

        // Restore Query & Logic
        const liveQueryGroup = document.getElementById('liveQueryGroup');
        liveQueryGroup.style.display = currentMode === 'live' ? 'block' : 'none';
        document.getElementById('editLiveQuery').value = listData.liveQuery || "";

        const currentLogic = listData.liveLogic || 'AND';
        const logicRadio = document.querySelector(`input[name="editLiveLogic"][value="${currentLogic}"]`);
        if (logicRadio) logicRadio.checked = true;

        editListModal.style.display = 'flex';
    };
}

if (closeEditModalBtn) closeEditModalBtn.onclick = () => editListModal.style.display = 'none';

if (saveListChangesBtn) {
    saveListChangesBtn.onclick = async () => {
        const newName = editListNameInput.value.trim();
        const newPrivacy = document.querySelector('input[name="editPrivacy"]:checked')?.value;
        const newMode = document.querySelector('input[name="editMode"]:checked')?.value;
        const newQuery = document.getElementById('editLiveQuery').value.trim();
        const newLogic = document.querySelector('input[name="editLiveLogic"]:checked')?.value;

        if (!newName || !newPrivacy) return;

        try {
            saveListChangesBtn.disabled = true;
            saveListChangesBtn.textContent = "Saving...";

            const updateData = {
                name: newName,
                mode: newMode,
                liveQuery: newMode === 'live' ? newQuery : (listData.liveQuery || ""),
                liveLogic: newMode === 'live' ? newLogic : (listData.liveLogic || "AND"),
                items: newMode === 'live' ? [] : (listData.items || []),
                privacy: newPrivacy,
                userId: listOwnerId,
                createdAt: listData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
                id: listId
            };

            if (newPrivacy !== listType) {
                // Migration Logic
                const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

                if (newPrivacy === 'public') {
                    // Private -> Public: Move to lists/{listId}
                    const publicRef = db.collection('lists').doc(listId);

                    // 1. Write to Public Collection
                    await publicRef.set(updateData);

                    // 2. Remove from Private Collection
                    const privateRef = db.collection('artifacts').doc(appId)
                        .collection('user_profiles').doc(listOwnerId)
                        .collection('lists').doc(listId);
                    await privateRef.delete();

                    window.location.href = `?list=${listId}&type=public`;
                } else {
                    // Public -> Private: Move to user_profiles/{userId}/lists/{listId}
                    const privateRef = db.collection('artifacts').doc(appId)
                        .collection('user_profiles').doc(listOwnerId)
                        .collection('lists').doc(listId);

                    // 1. Write to Private Collection
                    await privateRef.set(updateData);

                    // 2. Remove from Public Collection
                    await listRef.delete();

                    window.location.href = `?list=${listId}&type=private`;
                }
            } else {
                // Same privacy, just update the document directly
                await listRef.update({
                    name: newName,
                    mode: newMode,
                    liveQuery: updateData.liveQuery,
                    liveLogic: updateData.liveLogic,
                    items: updateData.items
                });
                location.reload();
            }

            // Sync to denormalized_data/lists
            try {
                await db.collection('denormalized_data').doc('lists').set({
                    [listOwnerId]: {
                        [listId]: {
                            name: newName,
                            mode: newMode,
                            privacy: newPrivacy,
                            createdAt: listData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
                            liveLogic: newMode === 'live' ? (updateData.liveLogic || "AND") : "AND",
                            liveQuery: newMode === 'live' ? (updateData.liveQuery || "") : ""
                        }
                    }
                }, { merge: true });
            } catch (err) {
                console.error("Error syncing update to denormalized data:", err);
            }
        } catch (e) {
            alert("Save failed: " + e.message);
        } finally {
            saveListChangesBtn.disabled = false;
            saveListChangesBtn.textContent = "Save Changes";
        }
    };
}

// --- SHARE BUTTON LOGIC ---
if (shareListBtn) {
    shareListBtn.onclick = async () => {
        try {
            // Copy current URL to clipboard
            await navigator.clipboard.writeText(window.location.href);

            // Visual feedback
            const originalText = shareListBtn.innerHTML;
            shareListBtn.innerHTML = '<i class="bi bi-check2"></i> Copied!';
            shareListBtn.classList.add('btn-success'); // Optional: Add a success color if your CSS supports it

            setTimeout(() => {
                shareListBtn.innerHTML = originalText;
                shareListBtn.classList.remove('btn-success');
            }, 2000);
        } catch (err) {
            console.error('Failed to copy: ', err);
            alert("Failed to copy URL to clipboard.");
        }
    };
}

// = = = = ROULETTE = = = =
const rouletteModal = document.getElementById('rouletteModal');
const openRouletteBtn = document.getElementById('openRouletteBtn');
const closeRouletteModal = document.getElementById('closeRouletteModal');
const rollBtn = document.getElementById('rollBtn');
const rouletteTrack = document.getElementById('rouletteTrack');
const winnerDisplay = document.getElementById('winnerDisplay');

let winningItemId = null;

if (openRouletteBtn) {
    openRouletteBtn.onclick = () => {
        if (allFetchedItems.length === 0) return alert("No items to roll!");
        winnerDisplay.textContent = "";
        winningItemId = null;
        rollBtn.textContent = "Spin!";
        rollBtn.disabled = false;
        rouletteTrack.style.transition = "none";
        rouletteTrack.style.transform = "translateX(0px)";
        setupRouletteTrack();
        rouletteModal.style.display = 'flex';
    };
}

if (closeRouletteModal) closeRouletteModal.onclick = () => rouletteModal.style.display = 'none';

function setupRouletteTrack() {
    rouletteTrack.innerHTML = '';
    const itemsToDisplay = [...allFetchedItems];
    const shuffled = itemsToDisplay.sort(() => 0.5 - Math.random());
    for (let i = 0; i < 15; i++) {
        shuffled.forEach(item => {
            const div = document.createElement('div');
            div.className = 'roulette-item';
            div.setAttribute('data-id', item.id);
            const imgUrl = (item.data.itemImageUrls && item.data.itemImageUrls[0]?.url) || DEFAULT_IMAGE_URL;
            div.innerHTML = `<img src="${imgUrl}"><p>${item.data.itemName || 'Unnamed'}</p>`;
            rouletteTrack.appendChild(div);
        });
    }
}

if (rollBtn) {
    rollBtn.onclick = () => {
        if (winningItemId) {
            window.location.href = `../items/?id=${winningItemId}`;
            return;
        }
        const itemWidth = 120;
        const totalItems = rouletteTrack.children.length;
        const visibleWidth = document.querySelector('.roulette-container').offsetWidth;
        const minIndex = Math.floor(totalItems * 0.8);
        const maxIndex = totalItems - 10;
        const winningIndex = Math.floor(Math.random() * (maxIndex - minIndex)) + minIndex;
        const stopPosition = (winningIndex * itemWidth) - (visibleWidth / 2) + (itemWidth / 2);
        rouletteTrack.style.transition = "transform 8s cubic-bezier(0.1, 0, 0.1, 1)";
        rouletteTrack.style.transform = `translateX(-${stopPosition}px)`;
        rollBtn.disabled = true;
        rollBtn.textContent = "Rolling...";
        setTimeout(() => {
            const winningElement = rouletteTrack.children[winningIndex];
            const itemName = winningElement.querySelector('p').textContent;
            winningItemId = winningElement.getAttribute('data-id');
            winnerDisplay.innerHTML = `âœ¨ Winner: ${itemName} âœ¨`;
            rollBtn.disabled = false;
            rollBtn.textContent = "Go to";
            winningElement.style.outline = "3px solid var(--accent-clr)";
            winningElement.style.background = "rgba(255,255,255,0.1)";
        }, 10000);
    };
}

// Show/Hide query field based on radio selection
editModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        liveQueryGroup.style.display = e.target.value === 'live' ? 'block' : 'none';
    });
});

function filterItemsByQuery(items, query, logic = 'AND') {
    if (!query) return items;

    const regex = /\{([^}]+)\}|(\S+)/g;
    const requiredKeywords = [];
    const excludedKeywords = [];
    let match;

    while ((match = regex.exec(query.toLowerCase())) !== null) {
        const term = (match[1] || match[2]);
        if (term.startsWith('-') && term.length > 1) {
            // Remove the minus sign and add to exclusions
            excludedKeywords.push(term.substring(1));
        } else {
            requiredKeywords.push(term);
        }
    }

    return items.filter(itemObj => {
        const item = itemObj.data;
        const combinedText = [
            item.itemName,
            item.itemCategory,
            item.itemScale,
            item.itemAgeRating,
            ...(item.tags || [])
        ].join(' ').toLowerCase();

        // 1. Check exclusions first: If any excluded keyword is found, discard immediately
        const hasExcluded = excludedKeywords.some(kw => combinedText.includes(kw));
        if (hasExcluded) return false;

        // 2. If no required keywords were typed (only exclusions), keep the item
        if (requiredKeywords.length === 0) return true;

        // 3. Apply standard AND/OR logic for required keywords
        return logic === 'OR'
            ? requiredKeywords.some(kw => combinedText.includes(kw))
            : requiredKeywords.every(kw => combinedText.includes(kw));
    });
}

//-------------------LIST BIO---------------------//

// Toggle Edit Mode
if (editBioBtn) {
    editBioBtn.onclick = () => {
        listBioInput.value = listData.description || "";
        bioDisplayGroup.style.display = 'none';
        bioEditGroup.style.display = 'block';
    };
}

// Cancel Edit
if (cancelBioBtn) {
    cancelBioBtn.onclick = () => {
        bioDisplayGroup.style.display = 'block';
        bioEditGroup.style.display = 'none';
    };
}

// Save Bio to Firestore
if (saveBioBtn) {
    saveBioBtn.onclick = async () => {
        const newBio = listBioInput.value.trim();
        if (newBio.length > 1000) return alert("Maximum 1000 characters allowed.");

        try {
            saveBioBtn.disabled = true;
            saveBioBtn.textContent = "Saving...";

            await listRef.update({ [`${listId}.description`]: newBio });

            listData.description = newBio;
            listBioText.textContent = newBio || "No description yet.";

            bioDisplayGroup.style.display = 'block';
            bioEditGroup.style.display = 'none';
        } catch (e) {
            alert("Error saving: " + e.message);
        } finally {
            saveBioBtn.disabled = false;
            saveBioBtn.textContent = "Save";
        }
    };
}

// Function to handle the auto-scaling
function autoScaleBio() {
    listBioInput.style.height = 'auto'; // Reset height to recalculate
    listBioInput.style.height = listBioInput.scrollHeight + 'px';
}

// 1. Scale when the user types
listBioInput.addEventListener('input', autoScaleBio);

// 2. Scale when the Edit button is first clicked
if (editBioBtn) {
    editBioBtn.onclick = () => {
        listBioInput.value = listData.description || "";
        bioDisplayGroup.style.display = 'none';
        bioEditGroup.style.display = 'block';

        // Use setTimeout to ensure the element is visible before calculating height
        setTimeout(autoScaleBio, 0);
    };
}

// Add these to your DOM elements section at the top


/**
 * Logic to handle favorite status and button visibility
 */
async function checkFavoriteStatus(currentUserId) {
    // 1. Hide if logged out or if the current user is the owner
    if (!currentUserId || currentUserId === listOwnerId) {
        favoriteListBtn.style.display = 'none';
        return;
    }

    try {
        const userDoc = await db.collection('artifacts').doc('default-app-id')
            .collection('user_profiles').doc(currentUserId).get();

        const favorites = userDoc.data()?.favoriteLists || [];
        isFavorited = favorites.includes(listId); // listId is defined from URL params

        updateFavButtonUI();
        favoriteListBtn.style.display = 'inline-block';
    } catch (err) {
        console.error("Error checking favorites:", err);
        favoriteListBtn.style.display = 'none';
    }
}

function updateFavButtonUI() {
    if (isFavorited) {
        favIcon.className = 'bi bi-star-fill';
        favIcon.style.color = '';
        favText.textContent = '';
    } else {
        favIcon.className = 'bi bi-star';
        favIcon.style.color = '';
        favText.textContent = '';
    }
}

// Add the click listener
if (favoriteListBtn) {
    favoriteListBtn.onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const userRef = db.collection('artifacts').doc('default-app-id')
            .collection('user_profiles').doc(user.uid);

        try {
            if (isFavorited) {
                await userRef.update({
                    favoriteLists: firebase.firestore.FieldValue.arrayRemove(listId)
                });
                isFavorited = false;
            } else {
                await userRef.update({
                    favoriteLists: firebase.firestore.FieldValue.arrayUnion(listId)
                });
                isFavorited = true;
            }
            updateFavButtonUI();
        } catch (err) {
            console.error("Error updating favorites:", err);
        }
    };
}

// =====================================
// COMMENTS
// =====================================

async function loadComments() {
    if (!commentsList || !listRef) return;
    commentsList.innerHTML = '';

    try {
        const snapshot = await listRef.collection('comments').orderBy('createdAt', 'desc').limit(20).get(); // Limit 20 for now
        if (snapshot.empty) {
            commentsList.innerHTML = '<p style="text-align:center; color:#888;">No comments yet.</p>';
            return;
        }

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const el = await createCommentElement(doc.id, data.userId, data.text, formatTime(data.createdAt));
            commentsList.appendChild(el);
        }
    } catch (err) {
        console.error("Error loading comments:", err);
        commentsList.innerHTML = '<p style="color:red;">Error loading comments.</p>';
    }
}

// Global cache for usernames
const usernameCache = {};

async function getUploaderUsername(userId) {
    if (!userId) return "Unknown user";
    if (usernameCache[userId]) return usernameCache[userId];

    try {
        const profileRef = db.collection('artifacts').doc('default-app-id').collection('user_profiles').doc(userId);
        const snap = await profileRef.get();
        const username = snap.exists && snap.data().username ? snap.data().username : "Unknown user";
        usernameCache[userId] = username;
        return username;
    } catch (err) {
        return "Unknown user";
    }
}

function formatTime(timestamp) {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate();
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function createCommentElement(commentId, userId, text, timeStr) {
    const div = document.createElement('div');
    div.className = 'comment';

    const username = await getUploaderUsername(userId);
    const linkedText = linkify(text);

    let deleteBtnHtml = '';
    const currentUser = auth.currentUser;
    // Allow delete if: (1) Creator of comment OR (2) Owner of the list OR (3) Admin/Mod
    const isAdminOrMod = ['admin', 'mod'].includes(currentUserRole);
    if (currentUser && (currentUser.uid === userId || currentUser.uid === listOwnerId || isAdminOrMod)) {
        deleteBtnHtml = `<button class="delete-comment-btn" data-id="${commentId}" title="Delete comment">&times;</button>`;
    }

    div.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:5px;">
          ${deleteBtnHtml}
          <a href="../user/?uid=${userId}" class="comment-author" style="text-decoration: underline;">${username}</a>
        </div>
        <div style="font-size:0.8em; color:#888;">${timeStr}</div>
      </div>
      <div class="comment-text">${linkedText}</div>
    `;

    const delBtn = div.querySelector('.delete-comment-btn');
    if (delBtn) {
        delBtn.onclick = async () => {
            if (!confirm('Delete comment?')) return;
            try {
                await listRef.collection('comments').doc(commentId).delete();
                div.remove();
            } catch (e) { alert(e.message); }
        };
    }

    return div;
}

function linkify(text) {
    const urlPattern = /(\b(https?:\/\/|www\.)[^\s]+\b)/g;
    return text.replace(urlPattern, (url) => {
        let fullUrl = url;
        if (url.startsWith('www.')) fullUrl = 'http://' + url;
        return `<a href="${fullUrl}" target="_blank" style="color:var(--accent-clr);">${url}</a>`;
    });
}

if (postCommentBtn) {
    postCommentBtn.onclick = async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        const user = auth.currentUser;
        if (!user) return;

        try {
            postCommentBtn.disabled = true;
            postCommentBtn.textContent = 'Posting...';
            commentMessage.textContent = '';

            const docRef = await listRef.collection('comments').add({
                listId: listId, // Associate comment with this list
                userId: user.uid,
                text: text,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            commentInput.value = '';
            // Prepend locally
            const newEl = await createCommentElement(docRef.id, user.uid, text, 'Just now');
            if (commentsList.children.length === 1 && commentsList.children[0].textContent === 'No comments yet.') {
                commentsList.innerHTML = '';
            }
            commentsList.prepend(newEl);

        } catch (e) {
            commentMessage.textContent = "Error: " + e.message;
            commentMessage.style.color = 'red';
        } finally {
            postCommentBtn.disabled = false;
            postCommentBtn.textContent = 'Post Comment';
        }
    };
}
