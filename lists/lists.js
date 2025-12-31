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

// ---------- STATE ----------
let listRef = null;
let listData = null;
let listOwnerId = null;
let isNsfwAllowed = false;
let allFetchedItems = []; 
const DEFAULT_IMAGE_URL = 'https://placehold.co/150x150/444/eee?text=No+Image';


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

function setupHeaderLogoRedirect() {
    const logo = document.querySelector('.header-logo');
    if (!logo) return;
    logo.style.cursor = 'pointer';
    logo.onclick = () => {
        const currentUser = auth.currentUser;
        if (!currentUser) { 
            alert("You must be logged in to view your profile."); 
            return; 
        }
        window.location.href = `../user/?uid=${currentUser.uid}`;
    };
}

// =====================================
// AUTH & INITIALIZATION
// =====================================
auth.onAuthStateChanged(async (user) => {
    updateHeaderAuthButton(user);
    setupHeaderLogoRedirect();

    if (user) {
        try {
            const profileDoc = await db.collection('artifacts').doc('default-app-id').collection('user_profiles').doc(user.uid).get();
            isNsfwAllowed = profileDoc.data()?.allowNSFW === true;
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
            listRef = db.collection('public_lists').doc(listId);
        } else {
            listRef = db.collection('artifacts').doc('default-app-id')
                        .collection('user_profiles').doc(currentUserId)
                        .collection('lists').doc(listId);
        }

        const listSnap = await listRef.get();
        if (!listSnap.exists) {
            listTitle.textContent = "List Not Found";
            return;
        }

        listData = listSnap.data();
        listOwnerId = listData.userId;
        listTitle.textContent = listData.name || 'Unnamed List';

        if (currentUserId === listOwnerId) {
            if (listSettingsBtn) listSettingsBtn.style.display = 'inline-block';
            if (deleteListBtn) deleteListBtn.style.display = 'inline-block';
        }

        // --- LIVE SYNC LOGIC ---
        if (listData.mode === 'live') {
            // 1. Get every item in the DB
            const allSnap = await db.collection('items').get();
            const allItems = allSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
            
            // 2. Determine which items SHOULD be in the list based on query
            const matchedItems = filterItemsByQuery(allItems, listData.liveQuery, listData.liveLogic || 'AND');
            const matchedIds = matchedItems.map(item => item.id);

            // 3. Compare with current saved items array
            const currentIds = listData.items || [];
            const isDifferent = JSON.stringify(matchedIds.sort()) !== JSON.stringify(currentIds.sort());

            if (isDifferent && currentUserId === listOwnerId) {
                // Update the database to reflect the new state
                await listRef.update({ items: matchedIds });
                listData.items = matchedIds; // Update local state
            }
            
            allFetchedItems = matchedItems;
            renderFilteredItems(allFetchedItems);
        } else {
            // Default mode: just load what is already there
            await fetchAllItems(listData.items || []);
            renderFilteredItems(allFetchedItems);
        }

    } catch (error) {
        console.error("Sync Error:", error);
        if (listTitle) listTitle.textContent = "Error Loading List";
    } finally {
        if (listLoader) listLoader.style.display = 'none';
    }
}

async function fetchAllItems(itemIds) {
    allFetchedItems = [];
    const promises = itemIds.map(id => db.collection('items').doc(id).get());
    const snapshots = await Promise.all(promises);
    
    snapshots.forEach(snap => {
        if (snap.exists) {
            allFetchedItems.push({ id: snap.id, data: snap.data() });
        }
    });
}

// =====================================
// RENDERING & SEARCH LOGIC
// =====================================

function renderFilteredItems(items) {
    if (!itemsGrid) return;
    itemsGrid.innerHTML = '';
    if (items.length === 0) {
        itemsGrid.innerHTML = '<p>No items match your search.</p>';
        return;
    }

    items.forEach(itemObj => {
        itemsGrid.appendChild(createItemCard(itemObj.id, itemObj.data));
    });
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
    img.src = (item.itemImageUrls && item.itemImageUrls[0]?.url) || DEFAULT_IMAGE_URL;
    img.className = 'item-image';
    
    const hor = (item['img-align-hor'] || 'center').toLowerCase();
    const ver = (item['img-align-ver'] || 'center').toLowerCase();
    img.classList.add(`img-align-hor-${hor}`, `img-align-ver-${ver}`);

    imageWrapper.appendChild(img);

    if (shouldBlur) {
        const badge = document.createElement('div');
        badge.className = 'nsfw-overlay';
        badge.textContent = '18+';
        imageWrapper.appendChild(badge);
    }

    if (auth.currentUser?.uid === listOwnerId) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '✕';
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
        // Exact Regex from search.js
        const regex = /\{([^}]+)\}|(\S+)/g;
        const keywords = [];
        let match;

        while ((match = regex.exec(query)) !== null) {
            keywords.push((match[1] || match[2]).toLowerCase());
        }

        filtered = allFetchedItems.filter(itemObj => {
            const item = itemObj.data;
            const name = (item.itemName || '').toLowerCase();
            const tags = (item.tags || []).map(t => t.toLowerCase());
            const category = (item.itemCategory || '').toLowerCase();
            const scale = (item.itemScale || '').toLowerCase();
            const age = (item.itemAgeRating || '').toLowerCase();

            // Prevention of "word bleeding"
            const combinedText = [name, category, scale, age, ...tags].join(' | ');

            return keywords.every(kw => combinedText.includes(kw));
        });
    }

    // Apply sorting to the final results
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

window.toggleSortDirection = function() {
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
    if(!confirm("Remove this item from the list?")) return;
    try {
        await listRef.update({ items: firebase.firestore.FieldValue.arrayRemove(itemId) });
        allFetchedItems = allFetchedItems.filter(i => i.id !== itemId);
        handleSearch(); 
    } catch (e) { alert(e.message); }
}

if (deleteListBtn) {
    deleteListBtn.onclick = async () => {
        if(confirm("Delete this list?")) {
            await listRef.delete();
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
            const updatePayload = {
                name: newName,
                mode: newMode,
                liveQuery: newMode === 'live' ? newQuery : (listData.liveQuery || ""),
                liveLogic: newMode === 'live' ? newLogic : (listData.liveLogic || "AND")
            };

            // If switching to Live, we force a sync by clearing items so loadList catches it
            if (newMode === 'live') {
                updatePayload.items = []; 
            }

            if (newPrivacy !== listType) {
                const newPath = newPrivacy === 'public' 
                    ? db.collection('public_lists').doc(listId)
                    : db.collection('artifacts').doc('default-app-id').collection('user_profiles').doc(auth.currentUser.uid).collection('lists').doc(listId);
                
                await newPath.set({ ...listData, ...updatePayload, privacy: newPrivacy });
                await listRef.delete();
                window.location.href = `?list=${listId}&type=${newPrivacy}`;
            } else {
                await listRef.update(updatePayload);
                location.reload();
            }
        } catch (e) {
            alert("Save failed: " + e.message);
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
            winnerDisplay.innerHTML = `✨ Winner: ${itemName} ✨`;
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
    const keywords = [];
    let match;
    while ((match = regex.exec(query.toLowerCase())) !== null) {
        keywords.push((match[1] || match[2]));
    }

    return items.filter(itemObj => {
        const item = itemObj.data;
        const combinedText = [
            item.itemName, 
            item.itemCategory, 
            item.itemScale, 
            ...(item.tags || [])
        ].join(' ').toLowerCase();

        return logic === 'OR' 
            ? keywords.some(kw => combinedText.includes(kw))
            : keywords.every(kw => combinedText.includes(kw));
    });
}

