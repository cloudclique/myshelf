import { auth, db } from '../firebase-config.js';

const latestAdditionsGrid = document.getElementById('latestAdditionsGrid');
const headerTools = document.getElementById('headerTools');

// --- Skeleton Loading ---
// --- Global State ---
let loadedItems = [];
let loadedLists = [];
let loadedImagesOTW = [];
let currentNsfwAllowed = false;
let canManageHomeLists = false;

// --- Skeleton Loading ---
function renderSkeletons() {
    if (!latestAdditionsGrid) return;

    const skeletonHTML = `
        <div class="item-card skeleton">
            <div class="item-image-wrapper"></div>
            <div class="item-info">
                <h3>Loading...</h3>
                <span>&nbsp;</span>
            </div>
        </div>
    `;

    // Create 36 skeleton cards
    latestAdditionsGrid.innerHTML = new Array(32).fill(skeletonHTML).join('');
}

// Initial render of skeletons
renderSkeletons();

// --- Auth & Header Tools ---
// --- Auth & Header Tools ---
import { userState, onAuthReady } from '../firebase-config.js';

function handleAuthUpdate(state) {
    const user = state.isLoggedIn ? { uid: state.uid } : null;
    updateHeaderAuthButton(user);

    if (state.isLoggedIn) {
        currentNsfwAllowed = state.allowNSFW;

        // Admin/Mod Check
        if (['admin', 'mod'].includes(state.role)) {
            canManageHomeLists = true;
            // Show Import Button
            const importBtn = document.getElementById('importListBtn');
            if (importBtn) importBtn.style.display = 'inline-block';
            // Show Image Import Button
            const importImgBtn = document.getElementById('importImageBtn');
            if (importImgBtn) importImgBtn.style.display = 'inline-block';
        } else {
            canManageHomeLists = false;
            const importBtn = document.getElementById('importListBtn');
            if (importBtn) importBtn.style.display = 'none';
            const importImgBtn = document.getElementById('importImageBtn');
            if (importImgBtn) importImgBtn.style.display = 'none';
        }
    } else {
        currentNsfwAllowed = false;
        canManageHomeLists = false;

        // Hide admin tools
        const importBtn = document.getElementById('importListBtn');
        if (importBtn) importBtn.style.display = 'none';
        const importImgBtn = document.getElementById('importImageBtn');
        if (importImgBtn) importImgBtn.style.display = 'none';
    }

    // Re-render if we already have items loaded (to apply NSFW blur or Context Menus)
    if (loadedItems.length > 0) renderItems(loadedItems);
    if (loadedLists.length > 0) renderLists(loadedLists);
    if (loadedImagesOTW.length > 0) renderImagesOTW(loadedImagesOTW);
}

// Initial Sync
onAuthReady(handleAuthUpdate);

// Listen for updates
window.addEventListener('shelf-auth-updated', (e) => {
    handleAuthUpdate(e.detail);
});

function updateHeaderAuthButton(user) {
    // headerTools might be null if script runs before DOM (but module script defers)
    // However, the element is in the initial HTML, so it should be there.
    const tools = document.getElementById('headerTools');
    if (!tools) return;

    tools.innerHTML = '';

    const btn = document.createElement('button');
    if (user) {
        btn.className = 'logout-btn';
        btn.innerHTML = '<i class="bi bi-box-arrow-right"></i> Logout';
        btn.onclick = async () => {
            try {
                await auth.signOut();
                window.location.reload();
            } catch (err) { console.error('Logout error:', err); }
        };
    } else {
        btn.className = 'login-btn';
        btn.textContent = 'Login';
        btn.onclick = () => { window.location.href = '../login/'; };
    }
    tools.appendChild(btn);
}

// --- Data Handling ---
const CACHE_KEY = 'home_data_cache';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCachedData() {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp > CACHE_TTL) {
            localStorage.removeItem(CACHE_KEY);
            return null;
        }
        return data;
    } catch (e) {
        console.error("Cache parse error:", e);
        return null;
    }
}

function setCachedData(data) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) {
        console.warn("Storage full?", e);
    }
}

async function initializeHome() {
    renderSkeletons();

    let homeData = getCachedData();

    if (!homeData) {
        try {
            const doc = await db.collection('artifacts').doc('home').get();
            if (doc.exists) {
                homeData = doc.data();
                if (homeData) {
                    // Ensure we have the arrays even if empty to avoid undefined checks later
                    homeData.items = homeData.items || [];
                    homeData.lists = homeData.lists || [];
                    homeData.imagesOTW = homeData.imagesOTW || [];
                    setCachedData(homeData);
                }
            } else {
                console.warn("Home artifact not found.");
            }
        } catch (err) {
            console.error("Error fetching home data:", err);
            const status = document.getElementById('loadingStatus');
            if (status) status.textContent = "Error loading content.";
        }
    }

    if (homeData) {
        renderItems(homeData.items || []);
        renderLists(homeData.lists || []);
        renderImagesOTW(homeData.imagesOTW || []);
    } else {
        const status = document.getElementById('loadingStatus');
        if (status) status.textContent = "No content available.";
        if (latestAdditionsGrid) latestAdditionsGrid.innerHTML = '';
    }
}

// --- Rendering ---
function renderItems(items) {
    if (!latestAdditionsGrid) return;

    // Store for re-rendering on auth change
    loadedItems = items;

    latestAdditionsGrid.innerHTML = '';

    if (!items || !items.length) {
        latestAdditionsGrid.innerHTML = '<p>No items found.</p>';
        return;
    }

    // Sort by createdAt desc to ensure "latest"
    items.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
    });

    // Limit to 32
    const displayItems = items.slice(0, 32);

    displayItems.forEach(item => {
        const card = document.createElement('a');
        card.href = `../items/?id=${item.itemId}`;
        card.className = 'item-card-link';

        const imageSrc = (item.itemImageUrls && item.itemImageUrls[0] && item.itemImageUrls[0].url) || 'https://placehold.co/150x150?text=No+Image';

        // NSFW Logic
        const isNsfw = item.itemAgeRating === '18+';
        const shouldBlur = isNsfw && !currentNsfwAllowed;

        const blurClass = shouldBlur ? 'nsfw-blur' : '';
        const nsfwOverlay = shouldBlur ? '<div class="nsfw-overlay">18+</div>' : '';

        card.innerHTML = `
            <div class="item-card">
                <div class="item-image-wrapper ${blurClass}">
                    <img src="${imageSrc}" alt="${item.itemName}" class="item-image" loading="lazy">
                    ${nsfwOverlay}
                    ${item.isDraft ? '<div class="draft-overlay">Draft</div>' : ''}
                </div>
                <div class="item-info">
                    <h3>${item.itemName}</h3>
                    <span>${item.itemCategory || 'Item'}</span>
                </div>
            </div>
        `;
        latestAdditionsGrid.appendChild(card);
    });
}

// --- HOVER TOOLTIP LOGIC ---
const hoverTooltip = document.createElement('div');
hoverTooltip.className = 'hover-tooltip';
document.body.appendChild(hoverTooltip);
let hoverTimeout = null;

if (latestAdditionsGrid) {
    latestAdditionsGrid.addEventListener('mouseover', (e) => {
        const cardLink = e.target.closest('.item-card-link');
        if (!cardLink) return;

        const itemName = cardLink.querySelector('h3')?.textContent || 'No Title';
        const displayTitle = itemName.length > 50 ? itemName.substring(0, 50) + '...' : itemName;

        hoverTimeout = setTimeout(() => {
            hoverTooltip.textContent = displayTitle;
            hoverTooltip.classList.add('visible');
        }, 400);
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
}


function renderLists(lists) {
    const listGrid = document.getElementById('publicListsGrid');
    if (!listGrid) return;

    listGrid.innerHTML = '';
    if (!lists || !lists.length) {
        listGrid.innerHTML = '<p>No featured lists.</p>';
        return;
    }

    loadedLists = lists;

    lists.forEach(list => {
        if (!list.id) return;

        const card = document.createElement('a');
        card.href = `../lists/?list=${list.id}&type=public`; // Assuming public
        card.className = 'item-card-link';

        const listIconClass = list.mode === 'live' ? 'bi-journal-code' : 'bi-journal-bookmark-fill';

        card.innerHTML = `
            <div class="list-card">
                 <div class="list-image-wrapper">
                    <div class="list-stack-effect">
                         <i class="bi ${listIconClass}" style="font-size: 2rem; color: var(--accent-clr);"></i>
                    </div>
                </div>
                <div class="list-info">
                    <h3>${list.name || 'Untitled List'}</h3>
                    <span>${list.items ? list.items.length : 0} Items</span>
                </div>
            </div>
         `;

        // Attach Context Menu if Admin/Mod
        if (canManageHomeLists) {
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e.pageX, e.pageY, list.id);
            });
        }

        listGrid.appendChild(card);
    });
}

function showContextMenu(x, y, listId) {
    // Remove existing menu if any
    hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'custom-context-menu';
    menu.innerHTML = `
        <ul>
            <li id="ctx-replace">Replace List</li>
            <li id="ctx-remove" style="color: var(--logout-color);">Remove List</li>
        </ul>
    `;
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;

    document.body.appendChild(menu);

    // Add listeners
    document.getElementById('ctx-replace').onclick = () => replaceListInHome(listId);
    document.getElementById('ctx-remove').onclick = () => removeListFromHome(listId);

    // Close on click elsewhere
    const closeMenu = () => {
        hideContextMenu();
        document.removeEventListener('click', closeMenu);
    };
    // Timeout to avoid immediate trigger
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function showImageContextMenu(x, y, imageId) {
    hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'custom-context-menu';
    menu.innerHTML = `
        <ul>
            <li id="ctx-img-replace">Replace Image</li>
            <li id="ctx-img-remove" style="color: var(--logout-color);">Remove Image</li>
        </ul>
    `;
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;

    document.body.appendChild(menu);

    document.getElementById('ctx-img-replace').onclick = () => replaceImageInHome(imageId);
    document.getElementById('ctx-img-remove').onclick = () => removeImageFromHome(imageId);

    const closeMenu = () => {
        hideContextMenu();
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function hideContextMenu() {
    const existing = document.querySelector('.custom-context-menu');
    if (existing) existing.remove();
}

async function removeListFromHome(listId) {
    if (!canManageHomeLists) {
        alert("Unauthorized.");
        return;
    }
    if (!confirm("Are you sure you want to remove this list from the Home page?")) return;

    try {
        const homeDocRef = db.collection('artifacts').doc('home');
        const doc = await homeDocRef.get();
        if (!doc.exists) return;

        const data = doc.data();
        const updatedLists = (data.lists || []).filter(l => l.id !== listId);

        await homeDocRef.update({ lists: updatedLists });

        // Update Cache & Reload
        localStorage.removeItem(CACHE_KEY);
        // Optimistic update
        renderLists(updatedLists);
        alert("List removed.");
    } catch (err) {
        console.error("Error removing list:", err);
        alert("Error removing list");
    }
}

async function replaceListInHome(oldListId) {
    if (!canManageHomeLists) {
        alert("Unauthorized.");
        return;
    }
    const newListId = prompt("Enter the new List ID to replace with:");
    if (!newListId || newListId.trim() === "") return;

    try {
        // 1. Fetch new list data
        const listDoc = await db.collection('lists').doc(newListId).get();
        if (!listDoc.exists) {
            alert("New List ID not found.");
            return;
        }
        const listData = listDoc.data();
        const listSummary = {
            id: newListId,
            name: listData.name || "Untitled List",
            mode: listData.mode || 'private',
            items: listData.items || []
        };

        // 2. Update home artifact
        const homeDocRef = db.collection('artifacts').doc('home');
        const doc = await homeDocRef.get();
        if (!doc.exists) return;

        const data = doc.data();
        const lists = data.lists || [];
        const index = lists.findIndex(l => l.id === oldListId);

        if (index === -1) {
            alert("Old list not found in data (maybe already removed?).");
            return;
        }

        lists[index] = listSummary; // Replace

        await homeDocRef.update({ lists: lists });

        // Update Cache & Reload
        localStorage.removeItem(CACHE_KEY);
        renderLists(lists); // Optimistic
        alert("List replaced successfully.");

    } catch (err) {
        console.error("Error replacing list:", err);
        alert("Error replacing list");
    }
}

// Initial Load
initializeHome();

// --- Import List Logic ---
const importListBtn = document.getElementById('importListBtn');
if (importListBtn) {
    importListBtn.addEventListener('click', async () => {
        if (!canManageHomeLists) {
            alert("Unauthorized.");
            return;
        }
        const listId = prompt("Enter the List ID to import:");

        if (!listId || listId.trim() === "") {
            return; // Cancelled
        }

        importListBtn.disabled = true;
        importListBtn.textContent = "Importing...";

        try {
            // 1. Fetch the list
            const listDoc = await db.collection('lists').doc(listId).get();
            if (!listDoc.exists) {
                alert("List not found in database.");
                importListBtn.disabled = false;
                importListBtn.textContent = "Import";
                return;
            }

            const listData = listDoc.data();

            // Minimal data to save to artifacts/home lists array
            const listSummary = {
                id: listId,
                name: listData.name || "Untitled List",
                mode: listData.mode || 'private',
                items: listData.items || []
            };

            // 2. Add to artifacts/home
            await db.collection('artifacts').doc('home').update({
                lists: firebase.firestore.FieldValue.arrayUnion(listSummary)
            });

            alert(`List "${listSummary.name}" imported successfully!`);

            // Clear cache to force reload
            localStorage.removeItem(CACHE_KEY);

            // Reload to see changes
            window.location.reload();

        } catch (error) {
            console.error("Error importing list:", error);
            alert("Error importing list: " + error.message);
            importListBtn.disabled = false;
            importListBtn.textContent = "Import";
        }
    });
}





// --- Lightbox Logic ---
const lightbox = document.createElement('div');
lightbox.className = 'lightbox';
lightbox.innerHTML = '<img class="lightbox-content" src="" alt="Lightbox Image">';
document.body.appendChild(lightbox);

const lightboxImg = lightbox.querySelector('.lightbox-content');

lightbox.addEventListener('click', () => {
    lightbox.classList.remove('visible');
});


function openLightbox(url) {
    console.log("Opening lightbox for:", url);
    lightboxImg.src = url;
    lightbox.classList.add('visible');
}

// --- Images OTW Logic ---
function renderImagesOTW(images) {
    const grid = document.getElementById('imagesOTWGrid');
    if (!grid) return;

    grid.innerHTML = '';

    loadedImagesOTW = images;

    images.forEach(img => {
        const card = document.createElement('div');
        card.className = 'otw-card';
        card.innerHTML = `<img src="${img.url}" alt="Image">`;

        // Click to open lightbox
        const imgEl = card.querySelector('img');
        imgEl.onclick = () => {
            console.log("Image clicked:", img.url);
            openLightbox(img.url);
        };

        if (canManageHomeLists) {
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showImageContextMenu(e.pageX, e.pageY, img.id);
            });
        }
        grid.appendChild(card);
    });
}

const importImageBtn = document.getElementById('importImageBtn');
if (importImageBtn) {
    importImageBtn.addEventListener('click', async () => {
        if (!canManageHomeLists) {
            alert("Unauthorized.");
            return;
        }

        const url = prompt("Enter Image URL:");
        if (!url || url.trim() === "") return;

        const imgData = {
            id: Date.now().toString(), // Simple ID
            url: url.trim()
        };

        try {
            await db.collection('artifacts').doc('home').update({
                imagesOTW: firebase.firestore.FieldValue.arrayUnion(imgData)
            });

            localStorage.removeItem(CACHE_KEY);
            window.location.reload();
        } catch (error) {
            console.error(error);
            alert("Error adding image.");
        }
    });
}

async function removeImageFromHome(imageId) {
    if (!canManageHomeLists) return;
    if (!confirm("Remove this image?")) return;

    try {
        const homeRef = db.collection('artifacts').doc('home');
        const doc = await homeRef.get();
        if (!doc.exists) return;

        const data = doc.data();
        const updated = (data.imagesOTW || []).filter(img => img.id !== imageId);

        await homeRef.update({ imagesOTW: updated });
        localStorage.removeItem(CACHE_KEY);
        // Optimistic
        renderImagesOTW(updated);

    } catch (err) { console.error(err); alert("Error"); }
}

async function replaceImageInHome(imageId) {
    if (!canManageHomeLists) return;

    const newUrl = prompt("Enter new Image URL:");
    if (!newUrl) return;

    try {
        const homeRef = db.collection('artifacts').doc('home');
        const doc = await homeRef.get();
        if (!doc.exists) return;

        const data = doc.data();
        const images = data.imagesOTW || [];
        const index = images.findIndex(img => img.id === imageId);

        if (index > -1) {
            images[index].url = newUrl;
            await homeRef.update({ imagesOTW: images });
            localStorage.removeItem(CACHE_KEY);
            renderImagesOTW(images);
        }

    } catch (err) { console.error(err); alert("Error"); }
}
