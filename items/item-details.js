import { auth, db, collectionName } from '../firebase-config.js';
import { populateDropdown, AGERATING_OPTIONS, CATEGORY_OPTIONS, SCALE_OPTIONS, processImageForUpload } from '../utils.js';

// --- Constants ---

const MAX_IMAGE_COUNT = 9; // NEW: Max number of images allowed
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file


// --- Constants for Lists ---
const LISTS_PER_PAGE = 6;
let allPublicListsForThisItem = [];
let listsCurrentPage = 1;
let currentPrivateData = {};
let loadedItemData = null; // NEW: Cache to store item data for status updates
let activeDocRef = null; // Store reference for updates (Related Items etc)



// New Cropper DOM
const thumbnailInput = document.getElementById('editThumbnailInput');
const thumbnailTrigger = document.getElementById('editThumbnailTrigger');
const cropperModal = document.getElementById('cropperModal');
const cropCanvas = document.getElementById('cropCanvas');
const zoomSlider = document.getElementById('zoomSlider');
const saveCropBtn = document.getElementById('saveCropBtn');
const cancelCropBtn = document.getElementById('cancelCropBtn');

// --- DOM Elements ---
const listModal = document.getElementById('listModal');
const closeListModalBtn = document.getElementById('closeListModal');
const addToListToggleBtn = document.getElementById('addToListToggleBtn');
const createNewListBtn = document.getElementById('createNewListBtn');
const addToListBtn = document.getElementById('addToListBtn');
const existingListsDropdown = document.getElementById('existingListsDropdown');
const listMessage = document.getElementById('listMessage');

// NEW: Tag Edit Modal Elements
const tagEditModal = document.getElementById('tagEditModal');
const closeTagEditModalBtn = document.getElementById('closeTagEditModal');
const tagEditInput = document.getElementById('tagEditInput');
const saveTagsBtn = document.getElementById('saveTagsBtn');
const tagEditMessage = document.getElementById('tagEditMessage');

const itemNamePlaceholder = document.getElementById('itemNamePlaceholder');
const itemNamePlaceholderTitle = document.getElementById('itemNamePlaceholderTitle');
const itemDetailsContent = document.getElementById('itemDetailsContent');
const nsfwCover = document.getElementById('nsfw-cover');
const tagsBox = document.getElementById('tagsBox');
const deleteContainer = document.getElementById('deleteContainer');
const authMessage = document.getElementById('authMessage');
const collectionStatusForm = document.getElementById('collectionStatusForm');
// NEW: Reference to the modal container and close button
const editModal = document.getElementById('editModal');
const closeEditModalBtn = document.getElementById('closeEditModal');
const editItemForm = document.getElementById('editItemForm');
const editMessage = document.getElementById('editMessage');
const statusMessage = document.getElementById('statusMessage');
const editToggleBtn = document.getElementById('editToggleBtn');
const reuploadBtn = document.getElementById('reuploadBtn');
const statusToggleBtn = document.getElementById('statusToggleBtn');
const editTitleInput = document.getElementById('editTitle');
const editAgeRatingSelect = document.getElementById('editAgeRating');
const editCategorySelect = document.getElementById('editCategory');
const editReleaseDateInput = document.getElementById('editReleaseDate');
const editScaleSelect = document.getElementById('editScale');
// REMOVED: editTagsInput
// NEW: Draft Checkbox
const editDraftInput = document.getElementById('editItemDraft');

const editImageInput = document.getElementById('editImage');
// REMOVED: editImagePreview
// NEW: Container for edit image previews
const editImageUploadsContainer = document.getElementById('editImageUploadsContainer');

const commentsList = document.getElementById('commentsList');
const commentInput = document.getElementById('commentInput');
const submitCommentBtn = document.getElementById('submitCommentBtn');
const commentMessage = document.getElementById('commentMessage');

const ShopList = document.getElementById('ShopList');
const ShopInput = document.getElementById('ShopInput');
const submitShopBtn = document.getElementById('submitShopBtn');
const ShopMessage = document.getElementById('ShopMessage');

// Pagination DOM Elements and State
const prevCommentsBtn = document.getElementById('prevCommentsBtn');
const nextCommentsBtn = document.getElementById('nextCommentsBtn');
const commentPageStatus = document.getElementById('commentPageStatus');

// Confirmation Modal Elements
const confirmationModal = document.getElementById('confirmationModal');
const modalMessage = document.getElementById('modalMessage');
const modalYesBtn = document.getElementById('modalYesBtn');
const modalNoBtn = document.getElementById('modalNoBtn');

// New State
let selectedThumbnailFile = null; // Holds the 95x95 Blob
let cropperImg = new Image();
let currentScale = 1;
let currentPos = { x: 0, y: 0 };
let isDragging = false;
let startDrag = { x: 0, y: 0 };

let itemId = null;
let targetCollection = 'items';
// MODIFIED: Store an array of File objects for new uploads
let selectedImageFiles = [];
// NEW: Store the existing image objects {url: string, deleteUrl: string} for display/edit context
let currentItemImageUrls = [];
const usernameCache = {};

// --- Pagination State for Comments ---
const COMMENTS_PER_PAGE = 8;
let commentsCurrentPage = 1;
const pageCursors = [null];

// --- Modal Handlers (Confirmation Modal logic omitted for brevity) ---
function showConfirmationModal(message, onYes, yesText = 'Yes') {
    if (!confirmationModal || !modalMessage || !modalYesBtn || !modalNoBtn) {
        if (confirm(message)) {
            onYes();
        }
        return;
    }

    modalMessage.textContent = message;
    confirmationModal.style.display = 'flex';

    modalYesBtn.textContent = yesText;
    modalNoBtn.textContent = 'No';

    const newModalYesBtn = modalYesBtn.cloneNode(true);
    const newModalNoBtn = modalNoBtn.cloneNode(true);
    modalYesBtn.replaceWith(newModalYesBtn);
    modalNoBtn.replaceWith(newModalNoBtn);

    newModalYesBtn.onclick = () => {
        closeConfirmationModal();
        onYes();
    };
    newModalNoBtn.onclick = closeConfirmationModal;
}

function closeConfirmationModal() {
    if (confirmationModal) {
        confirmationModal.style.display = 'none';
    }
}

// NEW: Edit Modal Handlers
function showEditModal() {
    if (editModal) {
        editModal.style.display = 'flex';
    }
}

function closeEditModal() {
    if (editModal) {
        editModal.style.display = 'none';
    }
}

// NEW: Tag Edit Modal Functions
function openTagEditModal(currentTags) {
    if (tagEditModal) {
        // Sort tags alphabetically for easier editing, case-insensitive
        const sortedTags = currentTags ? [...currentTags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })) : [];
        tagEditInput.value = sortedTags.join(', ');
        tagEditMessage.textContent = '';
        tagEditModal.style.display = 'flex';
    }
}

function closeTagEditModal() {
    if (tagEditModal) {
        tagEditModal.style.display = 'none';
    }
}

async function saveTags() {
    if (!itemId || !activeDocRef) return;

    tagEditMessage.textContent = 'Saving...';
    tagEditMessage.className = 'form-message';

    const tagsString = tagEditInput.value.trim();
    const newTags = tagsString ? tagsString.replace(/\?/g, ',').split(',').map(tag => tag.trim()).filter(tag => tag !== '') : [];
    newTags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    try {
        const isSharded = activeDocRef.path.includes('items-');

        if (isSharded) {
            // Sharded Update: Atomic read-modify-write required (using transaction for safety)
            await db.runTransaction(async (transaction) => {
                const shardDoc = await transaction.get(activeDocRef);
                if (!shardDoc.exists) throw "Shard missing";

                const items = shardDoc.data().items || [];
                const index = items.findIndex(i => i.itemId === itemId);

                if (index === -1) throw "Item missing in shard during update";

                // Update only the tags in the array
                items[index].tags = newTags;
                transaction.update(activeDocRef, { items: items });
            });
        } else {
            // Legacy/Review Collection Update
            await activeDocRef.update({
                tags: newTags
            });
        }

        // Fan out the tag updates across the platform (profiles + public lists)
        await fanOutItemUpdates(itemId, { tags: newTags });

        tagEditMessage.textContent = 'Tags updated and synced!';
        tagEditMessage.className = 'form-message success-message';

        setTimeout(() => {
            closeTagEditModal();
            fetchItemDetails(itemId); // Refresh UI
        }, 800);

    } catch (error) {
        console.error("Error updating tags:", error);
        tagEditMessage.textContent = 'Error updating tags: ' + error.message;
        tagEditMessage.className = 'form-message error-message';
    }
}

// --- Cropper Logic ---
thumbnailTrigger.onclick = () => thumbnailInput.click();

thumbnailInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        cropperImg.onload = () => {
            cropperModal.style.display = 'block';
            resetCropper();
        };
        cropperImg.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

/**
 * Converts any image File into a WebP Blob via canvas.
 * Same as implemented in add-item.js
 */
/**
 * Converts any image File into a WebP Blob via canvas.
 * Same as implemented in add-item.js
 */
// convertFileToWebp removed - using processImageForUpload from utils.js

function clampImagePosition() {
    const containerSize = 300;
    const cropSize = 95;

    const cropLeft = (containerSize - cropSize) / 2;
    const cropTop = cropLeft;
    const cropRight = cropLeft + cropSize;
    const cropBottom = cropTop + cropSize;

    const imgW = cropperImg.width * currentScale;
    const imgH = cropperImg.height * currentScale;

    // Clamp X
    if (currentPos.x > cropLeft) {
        currentPos.x = cropLeft;
    }
    if (currentPos.x + imgW < cropRight) {
        currentPos.x = cropRight - imgW;
    }

    // Clamp Y
    if (currentPos.y > cropTop) {
        currentPos.y = cropTop;
    }
    if (currentPos.y + imgH < cropBottom) {
        currentPos.y = cropBottom - imgH;
    }
}


function resetCropper() {
    const containerSize = 300;
    const cropSize = 95;

    const imgW = cropperImg.width;
    const imgH = cropperImg.height;

    let fitScale;

    // Portrait â†’ fit crop WIDTH
    // Landscape / square â†’ fit crop HEIGHT
    if (imgH > imgW) {
        fitScale = cropSize / imgW;
    } else {
        fitScale = cropSize / imgH;
    }

    currentScale = fitScale;

    zoomSlider.min = fitScale;
    zoomSlider.max = fitScale * 5;
    zoomSlider.step = 0.001;
    zoomSlider.value = fitScale;

    // Center image inside the 300x300 canvas
    currentPos = {
        x: (containerSize - imgW * currentScale) / 2,
        y: (containerSize - imgH * currentScale) / 2
    };

    drawCropper();
}



// --- Interaction Logic (Mouse + Touch) ---

const startInteraction = (clientX, clientY) => {
    isDragging = true;
    startDrag = { x: clientX - currentPos.x, y: clientY - currentPos.y };
    cropCanvas.style.cursor = 'grabbing';
};

const moveInteraction = (clientX, clientY) => {
    if (!isDragging) return;
    currentPos.x = clientX - startDrag.x;
    currentPos.y = clientY - startDrag.y;
    drawCropper();
};

const stopInteraction = () => {
    isDragging = false;
    cropCanvas.style.cursor = 'grab';
};

// Mouse Listeners
cropCanvas.addEventListener('mousedown', (e) => startInteraction(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => moveInteraction(e.clientX, e.clientY));
window.addEventListener('mouseup', stopInteraction);

// Touch Listeners
cropCanvas.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startInteraction(touch.clientX, touch.clientY);
    e.preventDefault(); // Prevent scrolling while cropping
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    moveInteraction(touch.clientX, touch.clientY);
}, { passive: false });

window.addEventListener('touchend', stopInteraction);

function drawCropper() {
    clampImagePosition(); // Clamp BEFORE drawing to prevent "snapping" lag
    const ctx = cropCanvas.getContext('2d');
    cropCanvas.width = 300;
    cropCanvas.height = 300;
    ctx.clearRect(0, 0, 300, 300);
    ctx.drawImage(cropperImg, currentPos.x, currentPos.y, cropperImg.width * currentScale, cropperImg.height * currentScale);
}

// Zoom Listener
zoomSlider.oninput = (e) => {
    const oldScale = currentScale;
    currentScale = Math.max(parseFloat(e.target.value), parseFloat(zoomSlider.min));

    const centerX = 150;
    const centerY = 150;

    // Adjust position to zoom toward the center
    currentPos.x = centerX - (centerX - currentPos.x) * (currentScale / oldScale);
    currentPos.y = centerY - (centerY - currentPos.y) * (currentScale / oldScale);

    drawCropper();
};


// Save the 95x95 cut
saveCropBtn.onclick = () => {
    clampImagePosition();
    const outCanvas = document.createElement('canvas');
    outCanvas.width = 95; outCanvas.height = 95;
    const outCtx = outCanvas.getContext('2d');
    const offset = (300 - 95) / 2; // Offset to match the visual frame
    outCtx.drawImage(cropperImg, currentPos.x - offset, currentPos.y - offset, cropperImg.width * currentScale, cropperImg.height * currentScale);

    outCanvas.toBlob((blob) => {
        selectedThumbnailFile = new File([blob], "thumb.webp", { type: "image/webp" });
        thumbnailTrigger.innerHTML = `<img src="${URL.createObjectURL(blob)}" style="width:100%; height:100%; object-fit:cover;">`;
        cropperModal.style.display = 'none';
        updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
    }, 'image/webp');
};

cancelCropBtn.onclick = () => { cropperModal.style.display = 'none'; };

// --- Helpers ---
async function updateProfileCounters(userId) {
    const userItemsRef = getUserCollectionRef(db, userId);
    const profileRef = db.collection('artifacts').doc('default-app-id').collection('user_profiles').doc(userId);

    try {
        const itemsDoc = await userItemsRef.doc('items').get();
        let itemsOwned = 0, itemsWished = 0, itemsOrdered = 0;

        if (itemsDoc.exists) {
            const itemsMap = itemsDoc.data();
            Object.values(itemsMap).forEach(item => {
                const status = item.status;
                if (status === 'Owned') itemsOwned++;
                else if (status === 'Wished') itemsWished++;
                else if (status === 'Ordered') itemsOrdered++;
            });
        }

        await profileRef.update({
            itemsOwned,
            itemsWished,
            itemsOrdered
        });
    } catch (error) {
        console.error("Error updating profile counters:", error);
    }
}

function getUserCollectionRef(db, userId) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return db.collection('artifacts').doc(appId).collection('user_profiles').doc(userId).collection('items');
}

async function checkUserPermissions(userId) {
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const profileRef = db.collection('artifacts').doc(appId).collection('user_profiles').doc(userId);
        const snap = await profileRef.get();
        if (snap.exists) return snap.data().role || 'user';

        const fallbackRef = db.collection('userProfiles').doc(userId);
        const fallbackSnap = await fallbackRef.get();
        if (fallbackSnap.exists) return fallbackSnap.data().role || 'user';
        return 'user';
    } catch (error) {
        console.error("Error fetching user role:", error);
        return 'user';
    }
}

async function getUploaderUsername(userId) {
    if (!userId) return "Unknown user";
    if (usernameCache[userId]) return usernameCache[userId];

    try {
        const profileRef = db
            .collection('artifacts').doc('default-app-id')
            .collection('user_profiles').doc(userId);

        const snap = await profileRef.get();
        const username = snap.exists && snap.data().username ? snap.data().username : "Unknown user";
        usernameCache[userId] = username;
        return username;
    } catch (err) {
        console.error("Error fetching username:", err);
        return "Unknown user";
    }
}


// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    itemId = params.get('id');
    const colParam = params.get('collection');
    if (colParam) targetCollection = colParam;

    if (!itemId) {
        itemDetailsContent.innerHTML = '<p class="error-message">Error: Item ID not found in URL.</p>';
        return;
    }

    if (statusToggleBtn) statusToggleBtn.addEventListener('click', toggleStatusForm);
    const removeBtn = document.getElementById('removeStatusBtn');
    if (removeBtn) removeBtn.addEventListener('click', (e) => { e.preventDefault(); handleRemoveStatus(); });

    // Keep listener for file input change
    if (editImageInput) editImageInput.addEventListener('change', handleImageFileChange);

    // NEW: Edit Modal Close Listener
    if (closeEditModalBtn) closeEditModalBtn.addEventListener('click', closeEditModal);
    window.addEventListener('click', (event) => {
        if (event.target === editModal) {
            closeEditModal();
        }
    });

    if (addRelatedBtn) addRelatedBtn.addEventListener('click', handleAddRelated);

    // NEW: Tag Edit Listeners
    if (closeTagEditModalBtn) closeTagEditModalBtn.addEventListener('click', closeTagEditModal);
    if (saveTagsBtn) saveTagsBtn.addEventListener('click', saveTags);
    window.addEventListener('click', (event) => {
        if (event.target === tagEditModal) closeTagEditModal();
    });

    // Pagination Event Listeners
    if (nextCommentsBtn) nextCommentsBtn.addEventListener('click', () => changeCommentPage(1));
    if (prevCommentsBtn) prevCommentsBtn.addEventListener('click', () => changeCommentPage(-1));

    auth.onAuthStateChanged((user) => {
        // Initial render of skeleton before everything starts
        renderItemSkeleton();

        // Start fetch
        fetchItemDetails(itemId);
        setupAuthUI(user);
        renderComments(itemId);
        renderShops(itemId);
    });

    if (submitCommentBtn) submitCommentBtn.addEventListener('click', postComment);
    if (submitShopBtn) submitShopBtn.addEventListener('click', postShop);
});

// --- Image Upload ---
// MODIFIED: Use the Cloudflare Worker URL
const IMGBB_UPLOAD_URL = `https://imgbbapi.stanislav-zhukov.workers.dev/`;

/**
 * Converts an image File to a WebP Blob.
 * @param {File} file
 * @returns {Promise<Blob>} A WebP blob.
 */
// convertImageToWebP removed - using processImageForUpload from utils.js

/**
 * Uploads a single image file after converting it to WebP.
 * @param {File} imageFile The image file to upload.
 * @returns {Promise<{url: string, deleteUrl: string}>}
 */
async function uploadImageToImgBB(file) {
    if (!file) return null;
    if (file.size > MAX_FILE_SIZE) throw new Error("Image file too large (max 5MB).");

    // ðŸ”¥ Resize and convert to WebP before uploading (Matching add-item.js)
    const webpFile = await processImageForUpload(file);

    const formData = new FormData();
    formData.append('image', webpFile);

    const response = await fetch(IMGBB_UPLOAD_URL, {
        method: 'POST',
        body: formData
    });

    const result = await response.json();
    if (!result.success) {
        throw new Error(result.error?.message || "Upload failed");
    }

    return {
        url: result.data.url,
        deleteUrl: result.data.delete_url
    };
}


// MODIFIED: Function to handle multiple file inputs (up to 6)
function handleImageFileChange(e) {
    // Get all files, not just the first one
    const files = Array.from(e.target.files);
    selectedImageFiles = []; // Reset selected files

    if (files.length === 0) {
        // No files selected, show existing images in preview
        updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
        return;
    }

    // The total count check should include existing images
    const totalPotentialImages = currentItemImageUrls.length + files.length;

    if (totalPotentialImages > MAX_IMAGE_COUNT) {
        editMessage.textContent = `Error: Cannot have more than ${MAX_IMAGE_COUNT} images total (existing ${currentItemImageUrls.length} + new ${files.length}).`;
        editMessage.className = 'form-message error-message';
        e.target.value = ''; // Clear file input
        updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
        return;
    }

    for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
            editMessage.textContent = `Error: Image file too large (max 5MB each).`;
            editMessage.className = 'form-message error-message';
            e.target.value = ''; // Clear file input
            selectedImageFiles = [];
            updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
            return;
        }
        selectedImageFiles.push(file);
    }

    // Update the visual previews
    updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);

    editMessage.textContent = `Selected ${selectedImageFiles.length} new image(s). They will be uploaded on save.`;
    editMessage.className = 'form-message info-message';
}


// NEW: Function to display image previews in the edit form
function updateEditImagePreviews(existingImageObjects, newFiles) {
    if (!editImageUploadsContainer) return;

    editImageUploadsContainer.innerHTML = '';

    // 1. Display existing images
    existingImageObjects.forEach((imgObj, index) => {
        const div = document.createElement('div');
        div.className = 'image-preview-item';

        // Determine if this is the primary image (slot 0)
        const isPrimary = index === 0;

        // Only images after index 0 are draggable
        if (!isPrimary) {
            div.draggable = true;
            div.dataset.index = index;
            div.classList.add('draggable-image');
        } else {
            div.classList.add('locked-thumbnail');
        }

        // Add a button to remove existing images
        div.innerHTML = `
            <img src="${imgObj.url}" alt="Existing Image ${index + 1}" class="image-preview ${isPrimary ? 'primary-image-preview' : ''}">
            <button type="button" class="remove-image-btn" data-index="${index}" title="Remove Image">&times;</button>
            ${isPrimary ? '<span class="primary-tag">Thumbnail</span>' : ''}
        `;
        editImageUploadsContainer.appendChild(div);
    });

    // 2. Display new file previews
    newFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'image-preview-item new-image';

        // New files cannot be set as primary until they are uploaded (saved)
        div.innerHTML = `
            <img src="${URL.createObjectURL(file)}" alt="New Image ${index + 1}" class="image-preview">
            <span class="new-tag">NEW</span>
            <button type="button" class="remove-new-file-btn" data-index="${index}" title="Remove New File">&times;</button>
        `;
        editImageUploadsContainer.appendChild(div);
    });

    // Add listeners for removing existing images
    document.querySelectorAll('.remove-image-btn').forEach(button => {
        button.addEventListener('click', function () {
            const indexToRemove = parseInt(this.dataset.index, 10);

            // Remove the image object from the list of current images
            // The deleteUrl is still inside the object, which is now discarded from the array.
            currentItemImageUrls.splice(indexToRemove, 1);

            updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
            editMessage.textContent = 'Existing image marked for removal (will be removed on save).';
            editMessage.className = 'form-message info-message';
        });
    });

    // Add listeners for removing NEW files
    document.querySelectorAll('.remove-new-file-btn').forEach(button => {
        button.addEventListener('click', function () {
            const indexToRemove = parseInt(this.dataset.index, 10);

            // Remove the file from the selected files array
            selectedImageFiles.splice(indexToRemove, 1);

            updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
            editMessage.textContent = `New image removed from selection. Total new: ${selectedImageFiles.length}.`;
            editMessage.className = 'form-message info-message';
        });
    });

    // NEW: Add drag-and-drop listeners for reordering (only for existing images, not thumbnail)
    setupDragAndDrop();
}

// NEW: Drag-and-drop functionality for reordering images
function setupDragAndDrop() {
    const draggableItems = document.querySelectorAll('.draggable-image');
    let draggedElement = null;
    let draggedIndex = null;

    draggableItems.forEach(item => {
        item.addEventListener('dragstart', function (e) {
            draggedElement = this;
            draggedIndex = parseInt(this.dataset.index, 10);
            this.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', function () {
            this.style.opacity = '1';
            draggedElement = null;
        });

        item.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            return false;
        });

        item.addEventListener('dragenter', function (e) {
            if (draggedElement && this !== draggedElement) {
                this.classList.add('drag-over');
            }
        });

        item.addEventListener('dragleave', function () {
            this.classList.remove('drag-over');
        });

        item.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();

            this.classList.remove('drag-over');

            if (draggedElement && this !== draggedElement) {
                const dropIndex = parseInt(this.dataset.index, 10);

                // Don't allow dropping into index 0 (thumbnail position)
                if (dropIndex === 0 || draggedIndex === 0) return;

                // Reorder the array
                const draggedItem = currentItemImageUrls[draggedIndex];
                currentItemImageUrls.splice(draggedIndex, 1);
                currentItemImageUrls.splice(dropIndex, 0, draggedItem);

                // Re-render
                updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
                editMessage.textContent = 'Image order changed. Save to confirm.';
                editMessage.className = 'form-message info-message';
            }

            return false;
        });
    });
}


// --- Auth UI ---
function setupAuthUI(user) {
    const isAuth = !!user;
    const headerTools = document.getElementById('headerTools');

    if (isAuth) {
        authMessage.textContent = "You are logged in and can add this item to your profile.";
        authMessage.className = 'form-message success-message';
        if (headerTools) headerTools.innerHTML = `<button id="logoutBtn" class="logout-btn">Logout</button>`;
        if (document.getElementById('logoutBtn')) document.getElementById('logoutBtn').onclick = handleLogout;
    } else {
        authMessage.textContent = "Log in to set your collection status or edit this item.";
        authMessage.className = 'form-message info-message';
        if (headerTools) headerTools.innerHTML = `<button id="loginBtn" class="login-btn">Login</button>`;
        if (document.getElementById('loginBtn')) document.getElementById('loginBtn').onclick = () => { window.location.href = '../login'; };
    }

    // MODIFIED: Hide the toggle button, not the form (the form is in a modal now)
    editToggleBtn.style.display = 'none';
    deleteContainer.innerHTML = '';
}

function handleLogout() {
    auth.signOut().then(() => { window.location.reload(); }).catch(console.error);
}

function toggleStatusForm() {
    if (!auth.currentUser) {
        statusMessage.textContent = "Please log in to update your collection status.";
        statusMessage.className = 'form-message error-message';
        return;
    }
    const isVisible = collectionStatusForm.style.display === 'flex';
    collectionStatusForm.style.display = isVisible ? 'none' : 'flex';
    statusToggleBtn.classList.toggle('active', !isVisible);
    statusMessage.textContent = '';
}


function renderItemSkeleton() {
    // A structure mimicking the item details layout
    itemNamePlaceholder.textContent = '';
    itemNamePlaceholderTitle.textContent = '';

    // Skeleton structure
    const skeletonHTML = `
        <div class="image-gallery-container skeleton-gallery">
            <div class="skeleton" style="width: 100%; height: 0; padding-top: 100%; border-radius: 8px;"></div>
        </div>
        <div class="item-metadata">
            <div class="skeleton" style="width: 80px; height: 24px; border-radius: 20px; margin-bottom: 20px;"></div>
            <div class="two-column-row">
                ${Array(6).fill('<div class="skeleton skeleton-text" style="width: 100%;"></div>').join('')}
            </div>
            <!-- Private data section -->
            <div style="margin-top: 20px;">
                 <div class="skeleton" style="width: 40%; height: 16px; margin-bottom: 15px;"></div>
                 <div class="skeleton" style="width: 100%; height: 60px;"></div>
            </div>
        </div>
    `;

    itemDetailsContent.innerHTML = skeletonHTML;

    // Also clear other dynamic areas
    if (tagsBox) tagsBox.innerHTML = '<div class="skeleton skeleton-text" style="width: 50%;"></div>';
}

async function fetchItemDetails(id) {
    // Render skeleton immediately
    if (Object.keys(usernameCache).length === 0) {
        renderItemSkeleton();
    } else if (!itemDetailsContent.querySelector('.item-metadata')) {
        renderItemSkeleton();
    }

    try {
        let itemData = null;
        let foundInCollection = null;

        // 1. Try 'item-review' (Unsharded, Direct Access)
        if (targetCollection !== 'items') {
            // If URL explicitly says collection=item-review, or default behavior
            const reviewDoc = await db.collection(targetCollection).doc(id).get();
            if (reviewDoc.exists) {
                itemData = reviewDoc.data();
                itemData.id = reviewDoc.id;
                foundInCollection = targetCollection;
                activeDocRef = db.collection(targetCollection).doc(id);
            }
        }

        // 2. If trying for Main 'items', SCAN SHARDS
        if (!itemData && (targetCollection === 'items' || !targetCollection)) {
            // Optimization: Start scanning
            // This can be slow. A better approach would be an Index, but per structure.txt limit:

            let shardId = 1;
            let found = false;

            // Loop until found or reasonable limit (e.g., 20 shards seems safe for now)
            while (!found && shardId < 50) {
                const shardRef = db.collection(`items-${shardId}`).doc('items');
                const shardDoc = await shardRef.get();

                if (!shardDoc.exists) {
                    // End of shards
                    break;
                }

                const itemsArray = shardDoc.data().items || [];
                const match = itemsArray.find(i => i.itemId === id);

                if (match) {
                    itemData = match;
                    itemData.id = match.itemId; // Ensure id prop is set
                    foundInCollection = `items-${shardId}`;
                    activeDocRef = shardRef; // For shard, ref points to the shard doc. Update logic must handle map.
                    found = true;
                }
                shardId++;
            }
        }

        if (!itemData) {
            itemDetailsContent.innerHTML = `<p class="error-message">Item with ID: ${id} not found.</p>`;
            return;
        }

        loadedItemData = itemData; // Cache for other functions

        // --- NSFW CHECK START ---
        // Reuse existing logic, assuming itemData is populated
        const itemAgeRating = itemData.itemAgeRating || '';
        if (itemAgeRating === '18+') {
            let allowNSFW = false;

            // If logged in, check user profile settings
            if (auth.currentUser) {
                const userId = auth.currentUser.uid;
                const profileRef = db.collection('artifacts').doc('default-app-id').collection('user_profiles').doc(userId);
                const profileSnap = await profileRef.get();
                if (profileSnap.exists) {
                    allowNSFW = profileSnap.data().allowNSFW === true;
                }
            }

            // Block access if not allowed (Default for logged-out users)
            if (!allowNSFW) {
                nsfwCover.innerHTML = `
                    <div class="nsfw-blocked-message" style="padding: 40px; text-align: center; background: #222; border: 1px solid #444; height: calc(100% - 65px); width: 100%; position: absolute;">
                        <h2 style="color: #ff4444; margin-bottom: 15px;">NSFW Content Hidden</h2>
                        <p style="color: #ddd; line-height: 1.6;">You must be logged in with NSFW enabled to view this item.</p>
                        <button onclick="window.location.href='../login/'" class="action-btn primary-btn" style="margin-top: 20px;">Login to View</button>
                    </div>
                `;

                itemDetailsContent.innerHTML = '';
                if (tagsBox) tagsBox.innerHTML = '';
                if (deleteContainer) deleteContainer.innerHTML = '';
                if (editToggleBtn) editToggleBtn.style.display = 'none';
                return; // STOP execution here for unauthorized users
            }
        }
        // --- NSFW CHECK END ---

        applyShopPermissions(itemData);

        // Handle image URLs (multi-image support)
        currentItemImageUrls = Array.isArray(itemData.itemImageUrls) && itemData.itemImageUrls.length > 0
            ? itemData.itemImageUrls
            : [itemData.itemImageUrl, itemData.itemImageBase64, itemData.itemImage]
                .filter(url => url)
                .map(url => typeof url === 'string' ? { url: url } : url)
                .filter(obj => obj && obj.url);

        let userStatus = null;
        let canEdit = false;
        let userRole = null; // New variable for scope access
        let privateData = {};

        // Only fetch personal/edit data if a user is actually logged in
        if (auth.currentUser) {
            const userId = auth.currentUser.uid;

            // Check status in User's own aggregated collection (NEW LOGIC)
            // We need to fetch the 'items' doc and check the map for this ID
            const userItemsDoc = await getUserCollectionRef(db, userId).doc('items').get();
            if (userItemsDoc.exists) {
                const map = userItemsDoc.data();
                if (map[id]) {
                    const userData = map[id];
                    userStatus = userData.status;
                    privateData = userData.privateNotes || {};
                    currentPrivateData = privateData;
                }
            }

            updateStatusSelection(userStatus, privateData);

            userRole = await checkUserPermissions(userId);
            const isUploader = userId === itemData.uploaderId;
            const isAdminOrMod = userRole === 'admin' || userRole === 'mod';
            canEdit = isUploader || isAdminOrMod;
        }

        // ALWAYS render the page for safe items (moved outside the auth check)
        renderItemDetails(itemData, userStatus, privateData, canEdit);
        setupRelatedItems(itemData, canEdit);

        // Fetch Public Lists using the data we already have
        fetchAndRenderPublicLists(itemData.id, itemData);

        // Manage Edit/Delete UI visibility
        if (canEdit) {
            editToggleBtn.style.display = 'inline-block';
            editToggleBtn.onclick = toggleEditForm;
            if (reuploadBtn) {
                // Modified: Only show if user is explicitly 'admin'
                if (userRole === 'admin') {
                    reuploadBtn.style.display = 'inline-block';
                    reuploadBtn.onclick = () => {
                        if (confirm("Reprocess all images? This will resize them to max 800px and convert to WebP.")) {
                            window.reuploadResizedImages();
                        }
                    };
                } else {
                    reuploadBtn.style.display = 'none';
                }
            }
            setupEditForm(itemData);
            setupDeleteButton(itemData.id);
        } else {
            editToggleBtn.style.display = 'none';
            if (reuploadBtn) reuploadBtn.style.display = 'none';
            deleteContainer.innerHTML = '';
        }

    } catch (error) {
        itemDetailsContent.innerHTML = `<p class="error-message">Error fetching details: ${error.message}</p>`;
        console.error(error);
    }
}

// MODIFIED: Render image gallery instead of single image
// MODIFIED: Render image gallery and status-correlated private info
function renderItemDetails(item, userStatus, privateData = {}, canEdit = false) {
    const titleText = item.itemName || 'Untitled Item';
    itemNamePlaceholder.textContent = titleText;
    itemNamePlaceholderTitle.textContent = titleText;

    const displayStatus = userStatus || 'N/A';

    // Extract only URLs for display
    const imageUrls = currentItemImageUrls.map(img => img.url);
    const fallbackImage = 'https://placehold.co/400x400/333333/eeeeee?text=No+Image';
    const primaryImage = imageUrls[1] || fallbackImage;

    // Build the gallery HTML
    let galleryHtml = `<img src="${primaryImage}" class="item-image-large" id="mainGalleryImage" data-index="1">`;
    if (imageUrls.length > 1) {
        galleryHtml += `<div class="thumbnail-gallery-row">`;
        imageUrls.forEach((url, index) => {
            if (index === 0) return;
            galleryHtml += `<img src="${url}" class="item-thumbnail ${index === 0 ? 'selected-thumbnail' : ''}" data-index="${index}" onclick="changeMainImage(this)">`;
        });
        galleryHtml += `</div>`;
    }

    // --- NEW: Correlating Private Info Section ---
    let privateInfoHtml = '';
    // Only show if a status is set and there is private data available
    if (userStatus && Object.keys(privateData).length > 0) {
        let fieldsHtml = '';

        // Logic for Owned/Ordered display
        if (userStatus === 'Owned' || userStatus === 'Ordered') {
            fieldsHtml += `
                ${privateData.amount ? `<div><span class="info-label">Amount:</span><span class="info-value">${privateData.amount}</span></div>` : ''}
                ${privateData.price ? `<div><span class="info-label">Price:</span><span class="info-value">${privateData.price}</span></div>` : ''}
                ${privateData.shipping ? `<div><span class="info-label">Shipping:</span><span class="info-value">${privateData.shipping}</span></div>` : ''}
                ${privateData.score ? `<div><span class="info-label">Score:</span><span class="info-value">${privateData.score}/10</span></div>` : ''}
            `;

            if (userStatus === 'Owned') {
                if (privateData.location) {
                    fieldsHtml += `<div>
                    <span class="info-label">Location:</span>
                    <span class="info-value">${privateData.location}</span>
                </div>`;
                }

                if (privateData.store) {
                    fieldsHtml += `<div>
                    <span class="info-label">Store:</span>
                    <span class="info-value">${privateData.store}</span>
                </div>`;
                }

                if (privateData.collectionDate) {
                    fieldsHtml += `<div>
                    <span class="info-label">Collection Date:</span>
                    <span class="info-value">${privateData.collectionDate}</span>
                </div>`;
                }
            }

            if (userStatus === 'Ordered') {
                if (privateData.tracking) {
                    fieldsHtml += `<div>
                    <span class="info-label">Tracking:</span>
                    <span class="info-value">${privateData.tracking}</span>
                </div>`;
                }

                if (privateData.store) {
                    fieldsHtml += `<div>
                    <span class="info-label">Store:</span>
                    <span class="info-value">${privateData.store}</span>
                </div>`;
                }
            }

        } else if (userStatus === 'Wished') {
            fieldsHtml += `
                ${privateData.priority ? `<div><span class="info-label">Priority:</span><span class="info-value">${privateData.priority}/10</span></div>` : ''}
            `;
        }

        privateInfoHtml = `
            <div class="private-metadata-box" style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed #555;">
                <p style="font-size: 0.85em; color: var(--accent-clr); margin-bottom: 10px;">
                    <i class="bi bi-lock-fill"></i> Your Private Details
                </p>
                <div class="two-column-row">
                    ${fieldsHtml}
                </div>
            </div>
        `;
    }

    itemDetailsContent.innerHTML = `
        <div class="image-gallery-container" id="imageGalleryContainer">
            ${galleryHtml}
        </div>
        <div class="item-metadata">
            <p style="margin-bottom:20px;">
                <span class="status-badge status-${displayStatus.toLowerCase().replace('/', '-')}">${displayStatus}</span>
                ${item.isDraft ? '<span class="status-badge status-draft" style="background: #6c757d; color: white; margin-left: 10px;">DRAFT</span>' : ''}
            </p>
            <div class="two-column-row">
                <div><span class="info-label">Category:</span><span class="info-value">${item.itemCategory || 'N/A'}</span></div>
                <div><span class="info-label">Scale:</span><span class="info-value">${item.itemScale || 'N/A'}</span></div>
                <div><span class="info-label">Age Rating:</span><span class="info-value">${item.itemAgeRating || 'N/A'}</span></div>
                <div><span class="info-label">Release Date:</span><span class="info-value">${item.itemReleaseDate || 'N/A'}</span></div>
                <div><span class="info-label">Community Rating:</span><span id="avgRatingValue" class="info-value">Loading...</span></div>
                <div>
                    <span class="info-label">Uploader:</span>
                    <span id="uploaderName" class="info-value">Loading...</span>
                </div>
                <div><span class="info-label">Item ID:</span><span class="info-value">${item.id}</span></div>
            </div>
            ${privateInfoHtml}
        </div>
    `;

    // Trigger average rating fetch
    fetchAndDisplayAverageRating(item.id);

    tagsBox.innerHTML = `
        <div class="tags-header">
            <span class="info-label">Tags:</span>
            ${canEdit ? `<button id="openTagEditBtn" class="tag-edit-btn" title="Edit Tags"><i class="bi bi-pencil-square"></i></button>` : ''}
        </div>
        <div class="tags">${(item.tags && item.tags.join(', ')) || 'None'}</div>
    `;

    if (canEdit && document.getElementById('openTagEditBtn')) {
        document.getElementById('openTagEditBtn').addEventListener('click', () => openTagEditModal(item.tags));
    }

    // Re-attach listeners for gallery
    const mainImage = document.getElementById('mainGalleryImage');
    if (mainImage) {
        mainImage.onclick = () => {
            const index = parseInt(mainImage.dataset.index || 1, 10);
            openLightbox(index);
        };
    }

    // Uploader name logic
    const uploaderId = item.uploaderId;
    const uploaderEl = document.getElementById("uploaderName");
    if (uploaderId && uploaderEl) {
        getUploaderUsername(uploaderId).then(name => {
            const profileLink = document.createElement('a');
            profileLink.href = `../user/?uid=${uploaderId}`;
            profileLink.textContent = name;
            profileLink.className = 'info-value-link';
            uploaderEl.innerHTML = '';
            uploaderEl.appendChild(profileLink);
        });
    }

    if (statusToggleBtn) {
        if (targetCollection === 'item-review') {
            statusToggleBtn.style.display = 'none';
        } else {
            statusToggleBtn.style.display = 'inline-block';
            statusToggleBtn.disabled = !auth.currentUser;
        }
    }

    // Also hide Add to List if in review mode
    if (addToListToggleBtn) {
        if (targetCollection === 'item-review') {
            addToListToggleBtn.style.display = 'none';
        } else {
            addToListToggleBtn.style.display = 'inline-block';
        }
    }
}

// --- Edit Form ---
function toggleEditForm() {
    // MODIFIED: Use the modal functions
    if (editModal.style.display === 'flex') {
        closeEditModal();
        editToggleBtn.innerHTML = '<i class="bi bi-gear-wide-connected"></i>';
    } else {
        // Re-setup form content before showing modal to ensure fresh data
        fetchItemDetails(itemId).then(() => {
            // setupEditForm is called inside fetchItemDetails for re-setup
            showEditModal();
            editToggleBtn.innerHTML = '<i class="bi bi-gear-wide-connected"></i>';
        });
    }
}

// MODIFIED: setupEditForm to initialize multi-image context
function setupEditForm(item) {
    populateDropdown('editCategory', CATEGORY_OPTIONS, item.itemCategory);
    populateDropdown('editAgeRating', AGERATING_OPTIONS, item.itemAgeRating);
    populateDropdown('editScale', SCALE_OPTIONS, item.itemScale);


    editTitleInput.value = item.itemName || '';
    editReleaseDateInput.value = item.itemReleaseDate || '';
    if (editDraftInput) editDraftInput.checked = item.isDraft === true;
    // REMOVED: editTagsInput setup

    // Clear file input and temporary file object array
    if (editImageInput) editImageInput.value = '';
    selectedImageFiles = [];

    // Update the edit previews with current URLs (which are now objects)
    updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);

    // Clear message from previous attempts
    editMessage.textContent = '';
    editMessage.className = 'form-message';
}

// MODIFIED: Edit form submit handler for sharded architecture
editItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!auth.currentUser || !itemId) return;

    editMessage.textContent = 'Saving...';
    editMessage.className = 'form-message';

    const userId = auth.currentUser.uid;

    // 1. Find the item in Shards or Review
    let collectionRef = null;
    let currentItemData = null;
    let foundShardId = null;

    try {
        if (targetCollection !== 'items') {
            const doc = await db.collection(targetCollection).doc(itemId).get();
            if (doc.exists) {
                currentItemData = doc.data();
                collectionRef = db.collection(targetCollection).doc(itemId);
            }
        }

        if (!currentItemData) {
            // Scan shards
            let shardId = 1;
            while (shardId < 50) {
                const shardRef = db.collection(`items-${shardId}`).doc('items');
                const shardDoc = await shardRef.get();
                if (!shardDoc.exists) break;

                const itemsArray = shardDoc.data().items || [];
                const match = itemsArray.find(i => i.itemId === itemId);
                if (match) {
                    currentItemData = match;
                    collectionRef = shardRef; // The shard doc
                    foundShardId = shardId;
                    break;
                }
                shardId++;
            }
        }

        if (!currentItemData) {
            editMessage.textContent = "Error: Item not found.";
            editMessage.className = 'form-message error-message';
            return;
        }

        const userRole = await checkUserPermissions(userId);
        const isUploader = userId === currentItemData.uploaderId;
        const isAdminOrMod = userRole === 'admin' || userRole === 'mod';

        if (!(isUploader || isAdminOrMod)) {
            editMessage.textContent = "Permission denied.";
            editMessage.className = 'form-message error-message';
            return;
        }

        const updatedFields = {
            itemName: editTitleInput.value,
            itemCategory: editCategorySelect.value,
            itemAgeRating: editAgeRatingSelect.value,
            itemScale: editScaleSelect.value,
            itemReleaseDate: editReleaseDateInput.value,
            isDraft: editDraftInput ? editDraftInput.checked : false,
            lastEdited: firebase.firestore.Timestamp.now() // Use helper or Timestamp directly
        };

        // --- Multi-Image Logic ---
        let finalImageObjects = [...currentItemImageUrls];

        // 1. Thumbnail
        if (selectedThumbnailFile) {
            editMessage.textContent = "Uploading new thumbnail...";
            const thumbObject = await uploadImageToImgBB(selectedThumbnailFile);
            finalImageObjects[0] = thumbObject;
            selectedThumbnailFile = null;
        }

        // 2. Additional Images
        if (selectedImageFiles.length > 0) {
            editMessage.textContent = `Uploading ${selectedImageFiles.length} additional image(s)...`;
            const uploadPromises = selectedImageFiles.map(file => uploadImageToImgBB(file));
            const uploadedNewImages = await Promise.all(uploadPromises);
            finalImageObjects = [...finalImageObjects, ...uploadedNewImages];
            editImageInput.value = '';
            selectedImageFiles = [];
        }

        if (finalImageObjects.length > MAX_IMAGE_COUNT) {
            editMessage.textContent = `Error: Too many images.`;
            editMessage.className = 'form-message error-message';
            return;
        }

        updatedFields.itemImageUrls = finalImageObjects;

        // Clean legacy fields if present in object
        delete updatedFields.itemImageUrl;
        delete updatedFields.itemImageBase64;
        delete updatedFields.itemImage;

        // Perform Update
        if (foundShardId) {
            // Sharded Update: Atomic read-modify-write required (using transaction for safety)
            await db.runTransaction(async (transaction) => {
                const shardDoc = await transaction.get(collectionRef);
                if (!shardDoc.exists) throw "Shard missing";

                const items = shardDoc.data().items || [];
                const index = items.findIndex(i => i.itemId === itemId);

                if (index === -1) throw "Item missing in shard during update";

                const mergedItem = { ...items[index], ...updatedFields };
                items[index] = mergedItem;

                transaction.update(collectionRef, { items: items });
            });
        } else {
            // Legacy/Review Collection Update
            await collectionRef.set(updatedFields, { merge: true });
        }


        // --- Fan-Out Update ---
        editMessage.textContent = "Syncing changes to user profiles...";
        await fanOutItemUpdates(itemId, updatedFields);

        editMessage.textContent = "Details updated and synced successfully!";
        editMessage.className = 'form-message success-message';
        editMessage.className = 'form-message success-message';
        currentItemImageUrls = finalImageObjects;

        setTimeout(() => {
            closeEditModal();
            editToggleBtn.innerHTML = '<i class="bi bi-gear-wide-connected"></i>';
            fetchItemDetails(itemId);
        }, 1000);

    } catch (error) {
        console.error(error);
        editMessage.textContent = `Error saving edits: ${error.message}`;
        editMessage.className = 'form-message error-message';
    }
});


// --- Delete (Uses Modal) ---
function setupDeleteButton(id) {
    deleteContainer.innerHTML = `
        <button id="deleteBtn" class="item-manage-btn" title="Delete Item Permanently"><i class="bi bi-trash3-fill"></i></button>
    `;
    document.getElementById('deleteBtn').onclick = () => showConfirmDelete(id);
}

function showConfirmDelete(itemId) {
    showConfirmationModal(
        "Are you sure you want to permanently DELETE this item? This action cannot be undone.",
        () => handleDeleteItem(itemId),
        'DELETE'
    );
}


async function handleDeleteItem(itemId) {
    if (!auth.currentUser) return;

    try {
        const userId = auth.currentUser.uid;

        // Find Item
        let collectionRef = null;
        let foundShardId = null;
        let currentItemData = null;

        if (targetCollection !== 'items') {
            const doc = await db.collection(targetCollection).doc(itemId).get();
            if (doc.exists) {
                currentItemData = doc.data();
                collectionRef = db.collection(targetCollection).doc(itemId);
            }
        }
        if (!currentItemData) {
            let shardId = 1;
            while (shardId < 50) {
                const shardRef = db.collection(`items-${shardId}`).doc('items');
                const shardDoc = await shardRef.get();
                if (shardDoc.exists) {
                    const match = (shardDoc.data().items || []).find(i => i.itemId === itemId);
                    if (match) {
                        currentItemData = match;
                        collectionRef = shardRef;
                        foundShardId = shardId;
                        break;
                    }
                }
                shardId++;
            }
        }

        if (!currentItemData) throw new Error("Item not found");

        const userRole = await checkUserPermissions(userId);
        const isUploader = userId === currentItemData.uploaderId;
        const isAdminOrMod = userRole === 'admin' || userRole === 'mod';

        if (!(isUploader || isAdminOrMod)) throw new Error("Permission denied");

        if (foundShardId) {
            await db.runTransaction(async (transaction) => {
                const shardDoc = await transaction.get(collectionRef);
                const items = shardDoc.data().items || [];
                const newItems = items.filter(i => i.itemId !== itemId);
                transaction.update(collectionRef, { items: newItems });
            });
        } else {
            await collectionRef.delete();
        }

        authMessage.textContent = "Item deleted successfully!";
        authMessage.className = 'form-message success-message';
        setTimeout(() => window.location.href = '../', 1500);
    } catch (error) {
        authMessage.textContent = `Error deleting item: ${error.message}`;
        authMessage.className = 'form-message error-message';
    }
}

// --- Collection Status ---
collectionStatusForm.addEventListener('submit', handleStatusUpdate);

async function handleStatusUpdate(e) {
    e.preventDefault();
    if (!auth.currentUser || !itemId) return;

    const selectedStatus = collectionStatusForm.querySelector('input[name="collectionStatus"]:checked');
    if (!selectedStatus) {
        statusMessage.textContent = "Please select a status.";
        statusMessage.className = 'form-message error-message';
        return;
    }

    const userId = auth.currentUser.uid;
    const newStatus = selectedStatus.value;

    statusMessage.textContent = `Saving...`;
    statusMessage.className = 'form-message';

    try {
        // 1. Fetch current user items (Aggregated Map)
        const userItemsDocRef = getUserCollectionRef(db, userId).doc('items');
        const docSnap = await userItemsDocRef.get();
        let itemsMap = docSnap.exists ? docSnap.data() : {};

        const currentData = itemsMap[itemId] || {};
        let privateData = currentData.privateNotes || {};

        // 2. Fetch Global Item Data for Denormalization
        // 2. Fetch Global Item Data for Denormalization
        // Use cached data from fetchItemDetails instead of refetching (which fails on shards)
        if (!loadedItemData) {
            throw new Error("Item data reference lost. Please refresh the page.");
        }
        const itemData = loadedItemData;

        const denormalizedData = {
            itemName: itemData.itemName,
            itemImageUrls: itemData.itemImageUrls || [],
            itemCategory: itemData.itemCategory || '',
            itemScale: itemData.itemScale || '',
            itemReleaseDate: itemData.itemReleaseDate || '',
            itemAgeRating: itemData.itemAgeRating || '',
            tags: itemData.tags || [],
            isDraft: itemData.isDraft || false
        };

        // 3. Harvest Private Notes from UI
        if (newStatus === 'Owned' || newStatus === 'Ordered') {
            privateData.amount = document.getElementById('privAmount')?.value || '1';
            privateData.price = document.getElementById('privPrice')?.value || '';
            privateData.shipping = document.getElementById('privShipping')?.value || '';
            privateData.score = document.getElementById('privScore')?.value || '';
            privateData.store = document.getElementById('privStore')?.value || '';

            if (newStatus === 'Owned') {
                privateData.location = document.getElementById('privLocation')?.value || '';
                privateData.collectionDate = document.getElementById('privCollectionDate')?.value || '';
            } else {
                privateData.tracking = document.getElementById('privTracking')?.value || '';
            }
        } else if (newStatus === 'Wished') {
            privateData.priority = document.getElementById('privPriority')?.value || '';
            privateData.target = document.getElementById('privTarget')?.value || '';
        }

        // 4. Update Map
        itemsMap[itemId] = {
            ...currentData,
            itemId: itemId,
            status: newStatus,
            updatedAt: firebase.firestore.Timestamp.now(),
            addedDate: currentData.addedDate || firebase.firestore.Timestamp.now(), // Preserve addedDate
            privateNotes: privateData,
            ...denormalizedData
        };

        await userItemsDocRef.set(itemsMap);

        // 5. Update Counters & UI
        await updateProfileCounters(userId);

        // 6. Sync Rating to Global Collection (Only for Owners)
        // User requested: "calculate for the users who own that item"
        if (newStatus === 'Owned' && privateData.score) {
            const scoreVal = parseFloat(privateData.score);
            if (!isNaN(scoreVal)) {
                await saveCommunityRating(itemId, userId, scoreVal);
            } else {
                // Invalid score, remove any existing rating
                await deleteCommunityRating(itemId, userId);
            }
        } else {
            // If not owned (or moved to Wished/Ordered) or no score, ensure no public rating exists
            await deleteCommunityRating(itemId, userId);
        }

        statusMessage.textContent = 'Status saved! Closing...';
        statusMessage.className = 'form-message success-message';
        currentPrivateData = privateData;
        updateStatusSelection(newStatus, privateData);

        // Auto-close logic
        setTimeout(() => {
            collectionStatusForm.style.display = 'none';
            if (statusToggleBtn) statusToggleBtn.classList.remove('active');
            statusMessage.textContent = '';
            fetchItemDetails(itemId);
        }, 800);

    } catch (error) {
        console.error(error);
        statusMessage.textContent = `Failed to update status: ${error.message}`;
        statusMessage.className = 'form-message error-message';
    }
}

async function handleRemoveStatus() {
    if (!auth.currentUser || !itemId) {
        statusMessage.textContent = "You must be logged in and viewing an item.";
        statusMessage.className = 'form-message error-message';
        return;
    }

    const userId = auth.currentUser.uid;
    // Target the 'items' aggregated map
    const userItemsDocRef = getUserCollectionRef(db, userId).doc('items');

    try {
        const docSnap = await userItemsDocRef.get();
        if (!docSnap.exists || !docSnap.data()[itemId]) {
            statusMessage.textContent = "This item is not in your profile.";
            statusMessage.className = 'form-message info-message';
            return;
        }
    } catch (e) {
        statusMessage.textContent = `Error checking item status: ${e.message}`;
        statusMessage.className = 'form-message error-message';
        return;
    }

    showConfirmationModal(
        "Are you sure you want to remove this item from your collection profile?",
        async () => {
            statusMessage.textContent = 'Removing item from profile...';
            statusMessage.className = 'form-message';
            try {
                // Clean up community rating if it exists
                await deleteCommunityRating(itemId, userId);

                // Delete the specific item key from the map
                await userItemsDocRef.update({
                    [itemId]: firebase.firestore.FieldValue.delete()
                });

                await updateProfileCounters(userId);
                statusMessage.textContent = 'Status removed.';
                statusMessage.className = 'form-message success-message';
                fetchItemDetails(itemId);
            } catch (error) {
                statusMessage.textContent = `Error removing item: ${error.message}`;
                statusMessage.className = 'form-message error-message';
            }
        },
        'Remove'
    );
}

// --- Average Rating ---
// --- Average Rating ---
async function fetchAndDisplayAverageRating(itemId) {
    const ratingEl = document.getElementById('avgRatingValue');
    if (!ratingEl) return;

    try {
        // Query the dedicated 'ratings' collection
        const querySnapshot = await db.collection('ratings')
            .where('itemId', '==', itemId)
            .get();

        let totalScore = 0;
        let count = 0;

        querySnapshot.forEach(doc => {
            const data = doc.data();
            const score = parseFloat(data.score);
            if (!isNaN(score) && score > 0) {
                totalScore += score;
                count++;
            }
        });

        if (count > 0) {
            const average = (totalScore / count).toFixed(1);
            ratingEl.textContent = `${average}/10 (${count} user${count === 1 ? '' : 's'})`;
        } else {
            ratingEl.textContent = 'No ratings yet';
        }

    } catch (error) {
        console.error("Error fetching average rating:", error);
        ratingEl.textContent = 'N/A';
    }
}

async function saveCommunityRating(itemId, userId, score) {
    try {
        await db.collection('ratings').doc(`${itemId}_${userId}`).set({
            itemId: itemId,
            userId: userId,
            score: score,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn("Failed to save public rating:", e);
    }
}

async function deleteCommunityRating(itemId, userId) {
    try {
        await db.collection('ratings').doc(`${itemId}_${userId}`).delete();
    } catch (e) {
        console.warn("Failed to delete public rating:", e);
    }
}

// --- Comments ---
function getCommentsRef(itemId, startAfterDoc = null) {
    let query = db.collection(targetCollection).doc(itemId)
        .collection('comments')
        .orderBy('createdAt', 'desc')
        .limit(COMMENTS_PER_PAGE);

    if (startAfterDoc) {
        query = query.startAfter(startAfterDoc);
    }

    return query;
}

function changeCommentPage(direction) {
    if (direction === 1) {
        const nextCursor = pageCursors[commentsCurrentPage];

        if (!nextCursor && commentsCurrentPage !== 0) {
            return;
        }

        commentsCurrentPage++;
        renderComments(itemId);

    } else if (direction === -1) {
        if (commentsCurrentPage > 1) {
            commentsCurrentPage--;
            renderComments(itemId);
        }
    }
}


async function postComment() {
    if (!auth.currentUser || !itemId) {
        commentMessage.textContent = "You must be logged in to comment.";
        commentMessage.className = 'form-message error-message';
        return;
    }

    const text = commentInput.value.trim();
    if (!text) return;

    commentMessage.textContent = 'Posting...';
    commentMessage.className = 'form-message';

    const userId = auth.currentUser.uid;

    try {
        const docRef = await db.collection(targetCollection).doc(itemId)
            .collection('comments').add({
                userId,
                text,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

        commentInput.value = '';

        const commentEl = await createCommentElement(docRef.id, userId, text, 'Just now');
        commentsList.prepend(commentEl);

        commentMessage.textContent = 'Comment posted.';
        commentMessage.className = 'form-message success-message';

    } catch (error) {
        commentMessage.textContent = `Error: ${error.message}`;
        commentMessage.className = 'form-message error-message';
    }
}

async function createCommentElement(commentId, userId, text, timestamp) {
    const commentEl = document.createElement('div');
    commentEl.className = 'comment';
    const linkedText = linkify(text);

    const deleteButtonHtml = `<button class="delete-comment-btn">&times;</button>`;
    commentEl.innerHTML = `
        <div style="position:relative;">
            ${deleteButtonHtml}
            <span class="comment-author">Loading...</span>
            <span style="font-size:0.7em; color:#888; float:right;">${timestamp}</span>
        </div>
        <div class="comment-text">${linkedText}</div>
    `;

    // Fetch and update the username
    const username = await getUploaderUsername(userId);
    const authorEl = commentEl.querySelector('.comment-author');
    authorEl.innerHTML = `<a href="../user/?uid=${userId}">${username}</a>`;

    // Attach delete handler
    commentEl.querySelector('.delete-comment-btn').onclick = async () => {
        const btn = commentEl.querySelector('.delete-comment-btn');
        btn.disabled = true;
        try {
            await db.collection(targetCollection).doc(itemId)
                .collection('comments').doc(commentId).delete();
            commentEl.remove();
            commentMessage.textContent = 'Comment deleted.';
            commentMessage.className = 'form-message success-message';
        } catch (err) {
            btn.disabled = false;
            commentMessage.textContent = `Error deleting comment: ${err.message}`;
            commentMessage.className = 'form-message error-message';
        }
    };

    return commentEl;
}

/*async function deleteCommentByElement(commentEl, commentId) {
    const btn = commentEl.querySelector('.delete-comment-btn');
    btn.disabled = true;

    try {
        await db.collection('items').doc(itemId)
            .collection('comments').doc(commentId).delete();

        commentEl.remove();

        if (commentsCache[commentsCurrentPage]) {
            commentsCache[commentsCurrentPage] = commentsCache[commentsCurrentPage]
                .filter(d => d.id !== commentId);
        }

        commentMessage.textContent = 'Comment deleted.';
        commentMessage.className = 'form-message success-message';
    } catch (error) {
        btn.disabled = false;
        commentMessage.textContent = `Error deleting comment: ${error.message}`;
        commentMessage.className = 'form-message error-message';
    }
}
*/

function linkify(text) {
    const urlPattern = /(\b(https?:\/\/|www\.)[^\s]+\b)/g;

    return text.replace(urlPattern, function (url) {
        let fullUrl = url;

        if (url.startsWith('www.')) {
            fullUrl = 'http://' + url;
        }

        return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
}

// Track loaded comments per page
// --- COMMENTS ---
const commentsCache = {};

async function renderComments(itemId) {
    if (!itemId || !commentsList) return;

    const currentUserId = auth.currentUser ? auth.currentUser.uid : null;
    const currentUserRole = currentUserId ? await checkUserPermissions(currentUserId) : null;
    const isAdminOrMod = currentUserRole === 'admin' || currentUserRole === 'mod';

    const startDoc = pageCursors[commentsCurrentPage - 1];

    try {
        let snapshot;
        if (!commentsCache[commentsCurrentPage]) {
            snapshot = await getCommentsRef(itemId, startDoc).get();
            commentsCache[commentsCurrentPage] = snapshot.docs;
        } else {
            snapshot = { docs: commentsCache[commentsCurrentPage] };
        }

        commentsList.innerHTML = '';

        if (snapshot.docs.length === 0) {
            if (commentsCurrentPage > 1) commentsCurrentPage--;
            commentsList.innerHTML = '<p>No comments yet or end of list reached.</p>';
            return;
        }

        for (const doc of snapshot.docs) {  // use for...of to await username fetching
            const data = doc.data();
            const commentId = doc.id;
            const isCreator = currentUserId && currentUserId === data.userId;
            const canDelete = isCreator || isAdminOrMod;

            const commentEl = document.createElement('div');
            commentEl.className = 'comment';
            const timestamp = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleString() : 'Just now';
            const linkedText = linkify(data.text);
            const deleteButtonHtml = canDelete ?
                `<button class="delete-comment-btn" data-comment-id="${commentId}">&times;</button>` : '';

            // Temporary innerHTML with "Loading..." for username
            commentEl.innerHTML = `
                <div style="position:relative;">
                    ${deleteButtonHtml}
                    <span class="comment-author">Loading...</span>
                    <span style="font-size:0.7em; color:#888; float:right;">${timestamp}</span>
                </div>
                <div class="comment-text">${linkedText}</div>
            `;
            commentsList.appendChild(commentEl);

            // Fetch and update live username
            const username = await getUploaderUsername(data.userId);
            const authorEl = commentEl.querySelector('.comment-author');
            authorEl.innerHTML = `<a href="../user/?uid=${data.userId}">${username}</a>`;

            // Attach delete handler if allowed
            if (canDelete) {
                const btn = commentEl.querySelector('.delete-comment-btn');
                btn.onclick = async () => {
                    btn.disabled = true;
                    try {
                        await db.collection('items').doc(itemId)
                            .collection('comments').doc(commentId).delete();

                        // remove from DOM
                        commentEl.remove();

                        // remove from cache
                        if (commentsCache[commentsCurrentPage]) {
                            commentsCache[commentsCurrentPage] = commentsCache[commentsCurrentPage]
                                .filter(d => d.id !== commentId);
                        }

                        commentMessage.textContent = 'Comment deleted.';
                        commentMessage.className = 'form-message success-message';
                    } catch (error) {
                        btn.disabled = false;
                        commentMessage.textContent = `Error deleting comment: ${error.message}`;
                        commentMessage.className = 'form-message error-message';
                    }
                };
            }
        }

        prevCommentsBtn.disabled = commentsCurrentPage === 1;
        nextCommentsBtn.disabled = !pageCursors[commentsCurrentPage];
        commentPageStatus.textContent = `Page ${commentsCurrentPage}`;

    } catch (error) {
        console.error(error);
        commentsList.innerHTML = `<p class="error-message">Failed to load comments.</p>`;
    }
}



function updateStatusSelection(userStatus, privateData = {}) {
    const statusButtons = document.querySelectorAll('.status-btn');
    statusButtons.forEach(btn => btn.classList.remove('selected-status'));

    const radioInputs = document.querySelectorAll('input[name="collectionStatus"]');
    radioInputs.forEach(input => {
        input.checked = false;
        // Add listener to change fields when user clicks a different status
        input.onclick = () => renderPrivateFields(input.value);
    });

    if (userStatus) {
        const radioInput = document.querySelector(`input[name="collectionStatus"][value="${userStatus}"]`);
        if (radioInput) {
            radioInput.checked = true;
            const label = document.querySelector(`label[for="${radioInput.id}"]`);
            if (label) label.classList.add('selected-status');

            // NEW: Render the fields with existing data on load
            renderPrivateFields(userStatus, privateData);
        }
    }
}

function deleteComment(itemId, commentId, deleteButtonEl) {
    if (!auth.currentUser) {
        commentMessage.textContent = "You must be logged in to delete comments.";
        commentMessage.className = 'form-message error-message';
        return;
    }

    // Disable the button immediately to prevent double-clicks
    if (deleteButtonEl) {
        deleteButtonEl.disabled = true;
        deleteButtonEl.textContent = '...';
    }

    showConfirmationModal(
        "Are you sure you want to delete this comment?",
        async () => {
            commentMessage.textContent = 'Deleting comment...';
            commentMessage.className = 'form-message';

            const userId = auth.currentUser.uid;

            try {
                const commentRef = db.collection('items').doc(itemId)
                    .collection('comments').doc(commentId);
                const commentSnap = await commentRef.get();

                if (!commentSnap.exists) {
                    commentMessage.textContent = "Error: Comment not found.";
                    commentMessage.className = 'form-message error-message';
                    if (deleteButtonEl) {
                        deleteButtonEl.disabled = false;
                        deleteButtonEl.textContent = 'Ã—';
                    }
                    return;
                }

                const commentData = commentSnap.data();
                const userRole = await checkUserPermissions(userId);
                const isCreator = userId === commentData.userId;
                const isAdminOrMod = userRole === 'admin' || userRole === 'mod';

                if (!(isCreator || isAdminOrMod)) {
                    commentMessage.textContent = "Permission denied.";
                    commentMessage.className = 'form-message error-message';
                    if (deleteButtonEl) {
                        deleteButtonEl.disabled = false;
                        deleteButtonEl.textContent = 'Ã—';
                    }
                    return;
                }

                await commentRef.delete();

                // Remove from DOM immediately
                const commentEl = deleteButtonEl.closest('.comment');
                if (commentEl) commentEl.remove();

                commentMessage.textContent = 'Comment deleted successfully.';
                commentMessage.className = 'form-message success-message';

                // Adjust pagination if needed
                if (commentsList.children.length === 0 && commentsCurrentPage > 1) {
                    commentsCurrentPage--;
                    renderComments(itemId);
                }

            } catch (error) {
                console.error("Error deleting comment:", error);
                commentMessage.textContent = `Error: ${error.message}`;
                commentMessage.className = 'form-message error-message';
                if (deleteButtonEl) {
                    deleteButtonEl.disabled = false;
                    deleteButtonEl.textContent = 'Ã—';
                }
            }
        },
        'Delete'
    );
}

// --- Lightbox Logic ---
const lightboxOverlay = document.getElementById('lightboxOverlay');
const lightboxImg = lightboxOverlay.querySelector('.lightbox-image');
const lightboxClose = lightboxOverlay.querySelector('.lightbox-close');
const lightboxPrev = lightboxOverlay.querySelector('.lightbox-prev');
const lightboxNext = lightboxOverlay.querySelector('.lightbox-next');

let currentImageIndex = 0;
let lightboxImages = [];

function openLightbox(index) {
    if (!currentItemImageUrls || currentItemImageUrls.length === 0) return;
    lightboxImages = currentItemImageUrls.map(img => img.url);
    currentImageIndex = index;
    lightboxImg.src = lightboxImages[currentImageIndex];
    lightboxOverlay.style.display = 'flex';
}

lightboxClose.onclick = () => lightboxOverlay.style.display = 'none';
lightboxPrev.onclick = () => {
    currentImageIndex = (currentImageIndex - 1 + lightboxImages.length) % lightboxImages.length;
    lightboxImg.src = lightboxImages[currentImageIndex];
};
lightboxNext.onclick = () => {
    currentImageIndex = (currentImageIndex + 1) % lightboxImages.length;
    lightboxImg.src = lightboxImages[currentImageIndex];
};
lightboxOverlay.onclick = (e) => {
    if (e.target === lightboxOverlay) lightboxOverlay.style.display = 'none';
};

window.attachLightboxToThumbnails = function () {
    document.querySelectorAll('.item-thumbnail').forEach(thumb => {
        thumb.onclick = () => {
            const index = parseInt(thumb.dataset.index, 10);
            openLightbox(index);
        };
    });
};

// Attach to gallery thumbnails dynamically
window.changeMainImage = (thumbnail) => {
    const mainImage = document.getElementById('mainGalleryImage');
    if (!mainImage) return;

    mainImage.src = thumbnail.src;
    document.querySelectorAll('.item-thumbnail').forEach(t => t.classList.remove('selected-thumbnail'));
    thumbnail.classList.add('selected-thumbnail');

    // Open lightbox on main image click
    mainImage.onclick = () => {
        const index = parseInt(thumbnail.dataset.index, 10);
        openLightbox(index);
    };
};


// SHOPS //-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function getShopRef(itemId) {
    return db.collection('items').doc(itemId)
        .collection('shops')
        .orderBy('createdAt', 'desc');
}

async function postShop() {
    if (!auth.currentUser || !itemId) {
        ShopMessage.textContent = "You must be logged in to post.";
        ShopMessage.className = 'form-message error-message';
        return;
    }

    if (window.__canUserCommentShop === false) {
        ShopMessage.textContent = "You are not allowed to post shops.";
        ShopMessage.className = 'form-message error-message';
        return;
    }

    const text = ShopInput.value.trim();
    if (!text) return;

    let url;
    try { url = new URL(text); }
    catch {
        ShopMessage.textContent = "Please enter a valid URL.";
        ShopMessage.className = 'form-message error-message';
        return;
    }

    const domain = url.hostname.replace(/^www\./, '');
    ShopMessage.textContent = 'Posting...';
    ShopMessage.className = 'form-message';

    try {
        const docRef = await db.collection('items').doc(itemId)
            .collection('shops').add({
                userId: auth.currentUser.uid,
                domain,
                url: text,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

        ShopInput.value = '';

        const shopEl = createShopElement(docRef.id, auth.currentUser.uid, domain, text, 'Just now');
        ShopList.prepend(shopEl);

        ShopMessage.textContent = 'Shop posted.';
        ShopMessage.className = 'form-message success-message';

    } catch (error) {
        ShopMessage.textContent = `Error: ${error.message}`;
        ShopMessage.className = 'form-message error-message';
    }
}

function createShopElement(shopId, userId, domain, url, timestamp) {
    const ShopEl = document.createElement('div');
    ShopEl.className = 'shop';

    const deleteButtonHtml = `<button class="delete-shop-btn">&times;</button>`;
    ShopEl.innerHTML = `
        <div style="position:relative;">
            ${deleteButtonHtml}
            <span class="shop-author"></span>
            <span class="shop-timestamp" style="font-size:0.7em; color:#888; float:right;">${timestamp}</span>
        </div>
        <div class="shop-text"><a href="${url}" target="_blank">${domain}</a></div>
    `;

    ShopEl.querySelector('.delete-shop-btn').onclick = async () => {
        const btn = ShopEl.querySelector('.delete-shop-btn');
        btn.disabled = true;
        try {
            await db.collection('items').doc(itemId)
                .collection('shops').doc(shopId).delete();
            ShopEl.remove();
            ShopMessage.textContent = 'Shop deleted.';
            ShopMessage.className = 'form-message success-message';
        } catch (err) {
            btn.disabled = false;
            ShopMessage.textContent = `Error deleting shop: ${err.message}`;
            ShopMessage.className = 'form-message error-message';
        }
    };

    return ShopEl;
}


async function deleteShopByElement(shopEl, shopId) {
    const btn = shopEl.querySelector('.delete-shop-btn');
    btn.disabled = true;

    try {
        await db.collection('items').doc(itemId)
            .collection('shops').doc(shopId).delete();

        shopEl.remove();

        if (shopsCache[itemId]) {
            shopsCache[itemId] = shopsCache[itemId].filter(d => d.id !== shopId);
        }

        ShopMessage.textContent = 'Shop deleted.';
        ShopMessage.className = 'form-message success-message';
    } catch (error) {
        btn.disabled = false;
        ShopMessage.textContent = `Error deleting shop: ${error.message}`;
        ShopMessage.className = 'form-message error-message';
    }
}

const shopsCache = {};

async function renderShops(itemId) {
    if (!itemId || !ShopList) return;

    const currentUserId = auth.currentUser ? auth.currentUser.uid : null;
    const currentUserRole = currentUserId ? await checkUserPermissions(currentUserId) : null;
    const isAdminOrModOrShop = ['admin', 'mod', 'shop'].includes(currentUserRole);

    try {
        let snapshot;
        if (!shopsCache[itemId]) {
            snapshot = await getShopRef(itemId).get();
            shopsCache[itemId] = snapshot.docs;
        } else {
            snapshot = { docs: shopsCache[itemId] };
        }

        ShopList.innerHTML = '';

        if (snapshot.docs.length === 0) {
            ShopList.innerHTML = '<p>No shops linked.</p>';
            return;
        }

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const shopId = doc.id;
            const isCreator = currentUserId && currentUserId === data.userId;
            const canDelete = isCreator || isAdminOrModOrShop;

            const ShopEl = document.createElement('div');
            ShopEl.className = 'shop';
            const timestamp = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleString() : 'Just now';
            const deleteButtonHtml = canDelete ?
                `<button class="delete-shop-btn" data-shop-id="${shopId}">&times;</button>` : '';

            ShopEl.innerHTML = `
                <div style="position:relative;">
                    ${deleteButtonHtml}
                    <span class="shop-author"></span>
                    <span class="shop-timestamp"style="font-size:0.7em; color:#888; float:right;">${timestamp}</span>
                </div>
                <div class="shop-text"><a href="${data.url}" target="_blank">${data.domain}</a></div>
            `;
            ShopList.appendChild(ShopEl);

            if (canDelete) {
                const btn = ShopEl.querySelector('.delete-shop-btn');
                btn.onclick = async () => {
                    btn.disabled = true;
                    try {
                        await db.collection('items').doc(itemId)
                            .collection('shops').doc(shopId).delete();

                        // remove from DOM
                        ShopEl.remove();

                        // remove from cache
                        if (shopsCache[itemId]) {
                            shopsCache[itemId] = shopsCache[itemId].filter(d => d.id !== shopId);
                        }

                        ShopMessage.textContent = 'Shop deleted.';
                        ShopMessage.className = 'form-message success-message';
                    } catch (error) {
                        btn.disabled = false;
                        ShopMessage.textContent = `Error deleting shop: ${error.message}`;
                        ShopMessage.className = 'form-message error-message';
                    }
                };
            }
        });

    } catch (error) {
        console.error(error);
        ShopList.innerHTML = `<p class="error-message">Failed to load shops.</p>`;
    }
}

function deleteShop(itemId, shopId, deleteButtonEl) {
    if (!auth.currentUser) {
        ShopMessage.textContent = "You must be logged in to delete shops.";
        ShopMessage.className = 'form-message error-message';
        return;
    }

    // Disable the button immediately
    if (deleteButtonEl) {
        deleteButtonEl.disabled = true;
        deleteButtonEl.textContent = '...';
    }

    showConfirmationModal(
        "Are you sure you want to remove this shop?",
        async () => {
            ShopMessage.textContent = 'Removing shop...';
            ShopMessage.className = 'form-message';

            const userId = auth.currentUser.uid;

            try {
                const shopRef = db.collection('items').doc(itemId)
                    .collection('shops').doc(shopId);
                const shopSnap = await shopRef.get();

                if (!shopSnap.exists) {
                    ShopMessage.textContent = "Error: Shop not found.";
                    ShopMessage.className = 'form-message error-message';
                    if (deleteButtonEl) {
                        deleteButtonEl.disabled = false;
                        deleteButtonEl.textContent = 'Ã—';
                    }
                    return;
                }

                const shopData = shopSnap.data();
                const userRole = await checkUserPermissions(userId);
                const isCreator = userId === shopData.userId;
                const isAdminOrModOrShop =
                    ['admin', 'mod', 'shop'].includes(userRole);

                if (!(isCreator || isAdminOrModOrShop)) {
                    ShopMessage.textContent =
                        "Permission denied.";
                    ShopMessage.className = 'form-message error-message';
                    if (deleteButtonEl) {
                        deleteButtonEl.disabled = false;
                        deleteButtonEl.textContent = 'Ã—';
                    }
                    return;
                }

                await shopRef.delete();

                // Remove DOM element immediately
                const shopEl = deleteButtonEl.closest('.shop');
                if (shopEl) shopEl.remove();

                ShopMessage.textContent = 'Shop deleted successfully.';
                ShopMessage.className = 'form-message success-message';

                // Refresh list only if empty
                if (ShopList.children.length === 0) {
                    renderShops(itemId);
                }

            } catch (error) {
                console.error("Error deleting shop:", error);
                ShopMessage.textContent = `Error: ${error.message}`;
                ShopMessage.className = 'form-message error-message';
                if (deleteButtonEl) {
                    deleteButtonEl.disabled = false;
                    deleteButtonEl.textContent = 'Ã—';
                }
            }
        },
        'Delete'
    );
}

async function applyShopPermissions(itemData) {
    const shopFormContainer = document.getElementById('shopFormContainer');
    const ShopInput = document.getElementById('ShopInput');
    const postShopBtn = document.getElementById('submitShopBtn');

    if (!shopFormContainer || !ShopInput || !postShopBtn) return;

    // Hide by default
    shopFormContainer.style.display = 'none';

    if (!auth.currentUser) return;

    const currentUserId = auth.currentUser.uid;
    const userRole = await checkUserPermissions(currentUserId);

    const allowedRoles = ['shop', 'admin', 'mod'];
    const isUploader = currentUserId === itemData.uploaderId;
    const canPost = allowedRoles.includes(userRole) || isUploader;

    if (canPost) {
        shopFormContainer.style.display = 'block';
    }

    window.__canUserCommentShop = canPost;
}

// --- Event Listeners ---
addToListToggleBtn.onclick = () => {
    if (!auth.currentUser) {
        alert("Please log in to manage lists.");
        return;
    }
    listModal.style.display = 'flex';
    loadUserLists();
};

closeListModalBtn.onclick = () => listModal.style.display = 'none';

// --- Functions ---

async function loadUserLists() {
    const userId = auth.currentUser.uid;
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    try {
        existingListsDropdown.innerHTML = '<option value="">-- Select a List --</option>';

        // 1. Fetch PRIVATE lists (Profile Map)
        const privateSnap = await db.collection('artifacts').doc(appId)
            .collection('user_profiles').doc(userId)
            .collection('lists').doc('lists').get();

        if (privateSnap.exists) {
            Object.entries(privateSnap.data()).forEach(([id, list]) => {
                existingListsDropdown.innerHTML += `<option value="private|${id}">${list.name} (Private)</option>`;
            });
        }

        // 2. Fetch OWNED public lists from Shards
        const metadataRef = db.collection('artifacts').doc(appId).collection('metadata').doc('lists_sharding');
        const metaSnap = await metadataRef.get();
        let maxShard = metaSnap.exists ? (metaSnap.data().currentShardId || 1) : 5;

        const shardPromises = [];
        for (let i = 1; i <= maxShard; i++) {
            shardPromises.push(db.collection(`lists-${i}`).doc('lists').get());
        }

        const shardSnapshots = await Promise.all(shardPromises);
        shardSnapshots.forEach((doc, index) => {
            if (doc.exists) {
                const shardId = index + 1;
                Object.entries(doc.data()).forEach(([listId, listData]) => {
                    if (listData.userId === userId) {
                        // Store shardId in value for easier updates
                        existingListsDropdown.innerHTML += `<option value="public|${shardId}|${listId}">${listData.name} (Public)</option>`;
                    }
                });
            }
        });

    } catch (error) {
        console.error("Error loading lists:", error);
    }
}

async function addItemToList(combinedValue) {
    if (!combinedValue || !itemId) return;

    const parts = combinedValue.split('|');
    const type = parts[0];
    const userId = auth.currentUser.uid;
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    let listRef;
    let listId;

    if (type === 'public') {
        const shardId = parts[1];
        listId = parts[2];
        listRef = db.collection(`lists-${shardId}`).doc('lists');
    } else {
        listId = parts[1];
        // Private List: List ID is a key in the 'lists' document
        listRef = db.collection('artifacts').doc(appId)
            .collection('user_profiles').doc(userId)
            .collection('lists').doc('lists');
    }

    try {
        // Both public (sharded) and private use map-based updates via dot notation or set with merge
        // To be safe with nested fields, we dot-notation it or set merge
        await listRef.set({
            [listId]: {
                items: firebase.firestore.FieldValue.arrayUnion(itemId),
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }
        }, { merge: true });

        listMessage.textContent = "Item added to list!";
        listMessage.className = "form-message success-message";

        // MODIFIED: Refresh the list display and close modal without reloading
        setTimeout(() => {
            listModal.style.display = 'none';
            listMessage.textContent = "";
            fetchAndRenderPublicLists(itemId); // Refresh the "Public Lists" grid
        }, 1500);
    } catch (error) {
        listMessage.textContent = "Error: " + error.message;
        listMessage.className = "form-message error-message";
    }
}

// --- Event Listeners ---

createNewListBtn.onclick = async () => {
    const nameInput = document.getElementById('newListName');
    const name = nameInput.value.trim();
    const privacySelect = document.querySelector('input[name="listPrivacy"]:checked');
    const privacy = privacySelect ? privacySelect.value : 'public';
    const userId = auth.currentUser.uid;
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    if (!name) {
        listMessage.textContent = "Please enter a name.";
        return;
    }

    try {
        let newListRef;
        let newListId = db.collection('dummy').doc().id; // Generate ID

        if (privacy === 'public') {
            const metadataRef = db.collection('artifacts').doc(appId).collection('metadata').doc('lists_sharding');
            const metaSnap = await metadataRef.get();
            const shardId = metaSnap.exists ? (metaSnap.data().currentShardId || 1) : 1;
            newListRef = db.collection(`lists-${shardId}`).doc('lists');
        } else {
            newListRef = db.collection('artifacts').doc(appId)
                .collection('user_profiles').doc(userId)
                .collection('lists').doc('lists');
        }

        const payload = {
            name: name,
            privacy: privacy,
            mode: 'static',
            items: [itemId],
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            userId: userId,
            id: newListId
        };

        // Create the list in the map
        await newListRef.set({
            [newListId]: payload
        }, { merge: true });

        listMessage.textContent = "List created and item added!";
        listMessage.className = "form-message success-message";

        // MODIFIED: Close modal and refresh UI
        setTimeout(() => {
            listModal.style.display = 'none';
            nameInput.value = '';
            listMessage.textContent = "";
            fetchAndRenderPublicLists(itemId); // Refresh the lists grid
        }, 1500);

    } catch (error) {
        listMessage.textContent = "Error: " + error.message;
        listMessage.className = "form-message error-message";
    }
};

addToListBtn.onclick = () => {
    const selectedValue = existingListsDropdown.value; // This is "type|id"
    if (!selectedValue) {
        listMessage.textContent = "Please select a list.";
        return;
    }
    addItemToList(selectedValue);
};


function itemMatchesLiveQuery(itemData, query, logic = 'AND') {
    if (!query) return false;

    const regex = /\{([^}]+)\}|(\S+)/g;
    const requiredKeywords = [];
    const excludedKeywords = [];
    let match;

    // Separate keywords into required and excluded groups
    while ((match = regex.exec(query.toLowerCase())) !== null) {
        const term = (match[1] || match[2]);
        if (term.startsWith('-') && term.length > 1) {
            excludedKeywords.push(term.substring(1)); // Remove the minus sign
        } else {
            requiredKeywords.push(term);
        }
    }

    const itemTags = Array.isArray(itemData.tags) ? itemData.tags.map(t => t.toLowerCase()) : [];
    const combinedText = [
        (itemData.itemName || ""),
        (itemData.itemCategory || ""),
        (itemData.itemScale || ""),
        ...itemTags
    ].join(' ').toLowerCase();

    // 1. Check Exclusions: If any excluded keyword matches, the item is disqualified
    const isExcluded = excludedKeywords.some(kw => combinedText.includes(kw));
    if (isExcluded) return false;

    // 2. If no required keywords were provided (e.g., query was just "-keyword"), 
    // and it wasn't excluded, then it's a match
    if (requiredKeywords.length === 0) return true;

    // 3. Apply standard AND/OR logic for the remaining required keywords
    if (logic === 'OR') {
        return requiredKeywords.some(kw => combinedText.includes(kw));
    } else {
        return requiredKeywords.every(kw => combinedText.includes(kw));
    }
}


async function fetchAndRenderPublicLists(itemId, providedItemData = null) {
    try {
        let itemData = providedItemData;

        if (!itemData && loadedItemData && (loadedItemData.id === itemId || loadedItemData.itemId === itemId)) {
            itemData = loadedItemData;
        }

        if (!itemData) {
            // Fallback: This might fail for sharded items if not consistent
            const itemDoc = await db.collection(targetCollection).doc(itemId).get();
            if (itemDoc.exists) {
                itemData = itemDoc.data();
            }
        }

        if (!itemData) {
            console.warn("fetchAndRenderPublicLists: itemData could not be retrieved.");
            return;
        }

        // --- NEW: FETCH PUBLIC LISTS FROM SHARDS ---
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const metadataRef = db.collection('artifacts').doc(appId).collection('metadata').doc('lists_sharding');
        const metaSnap = await metadataRef.get();
        let maxShard = metaSnap.exists ? (metaSnap.data().currentShardId || 1) : 5;

        const shardPromises = [];
        for (let i = 1; i <= maxShard; i++) {
            shardPromises.push(db.collection(`lists-${i}`).doc('lists').get());
        }

        const shardSnapshots = await Promise.all(shardPromises);
        let matchedLiveLists = [];
        let staticLists = [];

        shardSnapshots.forEach(doc => {
            if (doc.exists) {
                const listsInShard = doc.data() || {};
                Object.entries(listsInShard).forEach(([listId, listData]) => {
                    const list = { ...listData, id: listId, type: listData.privacy };

                    // 1. Check Static Lists
                    if (list.items && Array.isArray(list.items) && list.items.includes(itemId)) {
                        staticLists.push(list);
                    }

                    // 2. Check Live Lists
                    if (list.mode === 'live' && itemMatchesLiveQuery(itemData, list.liveQuery, list.liveLogic)) {
                        matchedLiveLists.push(list);
                    }
                });
            }
        });

        // Combine them, ensuring uniqueness (Live lists take precedence if duplicates exist)
        const combinedLists = [...matchedLiveLists, ...staticLists];
        const uniqueListsMap = new Map();

        combinedLists.forEach(list => {
            if (!uniqueListsMap.has(list.id)) {
                uniqueListsMap.set(list.id, list);
            }
        });

        allPublicListsForThisItem = Array.from(uniqueListsMap.values());

        // 4. Render as usual
        renderListsPage(1);

    } catch (error) {
        console.error("Error fetching lists:", error);
    }
}

function renderListsPage(page) {
    listsCurrentPage = page;
    const grid = document.getElementById('profileListsGrid');
    const pagination = document.getElementById('listsPagination');
    if (!grid) return;

    grid.innerHTML = '';

    const start = (page - 1) * LISTS_PER_PAGE;
    const end = start + LISTS_PER_PAGE;
    const paginatedLists = allPublicListsForThisItem.slice(start, end);

    if (paginatedLists.length === 0) {
        grid.innerHTML = '<p>This item is not in any public lists yet.</p>';
        if (pagination) pagination.innerHTML = '';
        return;
    }

    paginatedLists.forEach(list => {
        const card = document.createElement('a');
        card.href = `../lists/?list=${list.id}&type=${list.type}`;
        card.className = 'item-card-link';

        card.innerHTML = `
            <div class="list-card">
                <div class="list-image-wrapper">
                    <div class="list-stack-effect">
                         <i class="${list.mode === 'live' ? 'bi bi-journal-code' : 'bi bi-journal-bookmark-fill'}" style="font-size: clamp(1.4rem, 2vw, 1.8rem); color: var(--accent-clr);"></i>
                    </div>
                    ${list.type === 'private' ? '<span class="nsfw-overlay" style="background:rgba(0,0,0,0.5);"><i class="bi bi-lock-fill"></i> Private</span>' : ''}
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
    if (!container) return;

    container.innerHTML = '';
    const totalPages = Math.ceil(allPublicListsForThisItem.length / LISTS_PER_PAGE);

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









const privateFieldsContainer = document.getElementById('privateStatusFields');
const dynamicInputs = document.getElementById('dynamicPrivateInputs');

document.querySelectorAll('input[name="collectionStatus"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const status = e.target.value;
        privateFieldsContainer.style.display = 'block';
        renderPrivateFields(status, currentPrivateData);
    });
});

function renderPrivateFields(status, existingData = {}) {
    const privateFieldsContainer = document.getElementById('privateStatusFields');
    const dynamicInputs = document.getElementById('dynamicPrivateInputs');

    if (!status || status === 'N/A') {
        privateFieldsContainer.style.display = 'none';
        return;
    }

    privateFieldsContainer.style.display = 'block';
    let html = '';

    // These fields are shared between Owned and Ordered so they carry over
    const sharedPurchaseFields = `
        <label>Amount:</label>
        <input type="number" id="privAmount" class="modern_text_field" value="${existingData.amount || '1'}" min="1">
        <label>Price (per item):</label>
        <input type="text" id="privPrice" class="modern_text_field" value="${existingData.price || ''}" placeholder="e.g. $50.00">
        <label>Shipping Cost:</label>
        <input type="text" id="privShipping" class="modern_text_field" value="${existingData.shipping || ''}" placeholder="e.g. $10.00">
        <label>Store Name:</label>
        <input type="text" id="privStore" class="modern_text_field" value="${existingData.store || ''}" placeholder="Where did you buy it?">
        <label>Score:</label>
        <input type="number" id="privScore" class="modern_text_field" value="${existingData.score || ''}" min="1" max="10" placeholder="e.g. 8">
    `;

    if (status === 'Owned') {
        // Now includes Store Name instead of Storage Location
        html = `
            ${sharedPurchaseFields}
            <label>Collection Date:</label>
            <input type="date" id="privCollectionDate" class="modern_text_field" value="${existingData.collectionDate || ''}" placeholder="Collected at">
        `;
    } else if (status === 'Ordered') {
        // Includes shared fields plus the unique Tracking field
        html = `
            ${sharedPurchaseFields}
            <label>Order # / Tracking:</label>
            <input type="text" id="privTracking" class="modern_text_field" value="${existingData.tracking || ''}" placeholder="Tracking number">
        `;
    } else if (status === 'Wished') {
        html = `
            <label>Priority (1-10):</label>
            <div class="star-rating" id="priorityStarRating">
                ${Array.from({ length: 10 }, (_, i) => `<i class="bi bi-star-fill" data-value="${i + 1}"></i>`).join('')}
            </div>
            <input type="hidden" id="privPriority" value="${existingData.priority || ''}">
        `;
    }

    dynamicInputs.innerHTML = html;
    if (status === 'Wished') {
        setupStarRating();
    }
}

// --- Related Items Logic (Fixed) ---

const relatedEditor = document.getElementById('relatedEditor');
const editRelatedBtn = document.getElementById('editRelatedBtn');
const relatedUrlInput = document.getElementById('relatedUrlInput');
const addRelatedBtn = document.getElementById('addRelatedBtn');
const relatedItemsContainer = document.getElementById('relatedItemsContainer');
const relatedMessage = document.getElementById('relatedMessage');

let currentRelatedUrls = [];

// --- Helper: Fetch Item by ID (Cross-Shard) ---
async function fetchItemById(id) {
    if (!id) return null;

    // 1. Try Cache
    if (loadedItemData && loadedItemData.id === id) return loadedItemData;

    // 2. Try 'item-review'
    try {
        const reviewDoc = await db.collection('item-review').doc(id).get();
        if (reviewDoc.exists) {
            const data = reviewDoc.data();
            data.id = reviewDoc.id;
            return data;
        }
    } catch (e) { console.warn("Review lookup failed", e); }

    // 3. Scan Shards (Optimized Limit)
    let shardId = 1;
    while (shardId < 20) {
        try {
            const shardRef = db.collection(`items-${shardId}`).doc('items');
            const shardDoc = await shardRef.get();
            if (!shardDoc.exists) break;

            const items = shardDoc.data().items || [];
            const match = items.find(i => i.itemId === id);
            if (match) {
                match.id = match.itemId;
                return match;
            }
        } catch (e) { break; }
        shardId++;
    }
    return null;
}

function setupRelatedItems(itemData, canEdit) {
    currentRelatedUrls = [...new Set(itemData.relatedUrls || [])];

    if (canEdit && editRelatedBtn) {
        editRelatedBtn.style.display = 'inline-block';
        editRelatedBtn.onclick = () => {
            if (relatedEditor.style.display === 'none') {
                relatedEditor.style.display = 'block';
            } else {
                relatedEditor.style.display = 'none';
            }
        };
    } else {
        if (editRelatedBtn) editRelatedBtn.style.display = 'none';
        if (relatedEditor) relatedEditor.style.display = 'none';
    }

    if (addRelatedBtn) {
        addRelatedBtn.onclick = handleAddRelated;
    }

    renderRelatedItems(currentRelatedUrls);
}

async function renderRelatedItems(urls) {
    if (!relatedItemsContainer) return;

    if (!urls || urls.length === 0) {
        relatedItemsContainer.innerHTML = '<p class="no-data-text">No related items.</p>';
        return;
    }

    relatedItemsContainer.innerHTML = '<p style="font-size:0.8em; color:#888;">Loading details...</p>';

    const cards = [];

    for (const url of urls) {
        let label = "External Link";
        let subLabel = new URL(url).hostname;
        let imgUrl = "https://placehold.co/100?text=Link";
        let isInternal = false;

        try {
            const u = new URL(url, window.location.origin);
            const idParam = u.searchParams.get('id');

            if (idParam) {
                isInternal = true;
                const itemData = await fetchItemById(idParam);
                if (itemData) {
                    label = itemData.itemName || "Unknown Item";
                    subLabel = itemData.itemCategory || "Item";
                    // Handle image array or string
                    if (Array.isArray(itemData.itemImageUrls) && itemData.itemImageUrls.length > 0) {
                        imgUrl = itemData.itemImageUrls[0].url || itemData.itemImageUrls[0];
                    } else if (itemData.itemImageUrl) {
                        imgUrl = itemData.itemImageUrl;
                    }
                } else {
                    label = "Item Not Found";
                    subLabel = `ID: ${idParam}`;
                }
            }
        } catch (e) {
            console.warn("Error parsing URL", e);
        }

        cards.push(`
            <div class="related-card-wrapper">
                <a href="${url}" class="related-item-card" target="${isInternal ? '_self' : '_blank'}">
                    <div class="related-img-container">
                        <img src="${imgUrl}" alt="${label}" onerror="this.src='https://placehold.co/100?text=Error'">
                    </div>
                    <div class="related-info">
                        <span class="related-title" title="${label}">${label}</span>
                        <span class="related-sub" title="${subLabel}">${subLabel}</span>
                    </div>
                </a>
                ${activeDocRef && editRelatedBtn && editRelatedBtn.style.display !== 'none' ?
                `<button class="mini-delete-btn related-del-btn" onclick="handleRemoveRelated('${url}')" title="Remove">&times;</button>`
                : ''}
            </div>
        `);
    }

    relatedItemsContainer.innerHTML = `
        <div class="related-grid">
            ${cards.join('')}
        </div>
    `;
}

async function handleAddRelated() {
    if (!relatedUrlInput || !activeDocRef) return;
    const url = relatedUrlInput.value.trim();
    if (!url) return;

    if (currentRelatedUrls.includes(url)) {
        alert("Link already exists.");
        return;
    }

    relatedMessage.textContent = "Adding...";
    relatedMessage.className = "form-message";

    try {
        const isSharded = activeDocRef.path.includes('items-');

        if (isSharded) {
            const docSnap = await activeDocRef.get();
            let items = docSnap.data().items || [];
            const idx = items.findIndex(i => i.itemId === itemId);
            if (idx !== -1) {
                const item = items[idx];
                const urls = item.relatedUrls || [];
                if (!urls.includes(url)) {
                    urls.push(url);
                    items[idx] = { ...item, relatedUrls: urls };
                    await activeDocRef.update({ items: items });
                }
            }
        } else {
            await activeDocRef.update({
                relatedUrls: firebase.firestore.FieldValue.arrayUnion(url)
            });
        }

        currentRelatedUrls.push(url);
        renderRelatedItems(currentRelatedUrls);
        relatedUrlInput.value = '';
        relatedMessage.textContent = "Added!";
        relatedMessage.className = "form-message success-message";
        setTimeout(() => { relatedMessage.textContent = ''; }, 2000);

    } catch (e) {
        console.error(e);
        relatedMessage.textContent = "Error adding.";
        relatedMessage.className = "form-message error-message";
    }
}

async function handleRemoveRelated(url) {
    if (!activeDocRef) return;
    if (!confirm("Remove link?")) return;

    try {
        const isSharded = activeDocRef.path.includes('items-');

        if (isSharded) {
            const docSnap = await activeDocRef.get();
            let items = docSnap.data().items || [];
            const idx = items.findIndex(i => i.itemId === itemId);
            if (idx !== -1) {
                const item = items[idx];
                let urls = item.relatedUrls || [];
                if (urls.includes(url)) {
                    urls = urls.filter(u => u !== url);
                    items[idx] = { ...item, relatedUrls: urls };
                    await activeDocRef.update({ items: items });
                }
            }
        } else {
            await activeDocRef.update({
                relatedUrls: firebase.firestore.FieldValue.arrayRemove(url)
            });
        }

        currentRelatedUrls = currentRelatedUrls.filter(u => u !== url);
        renderRelatedItems(currentRelatedUrls);

    } catch (e) {
        console.error(e);
        alert("Error removing link");
    }
}




// --- End of File ---

/**
 * Fans out item updates to all user profiles and public lists that contain the item.
 * @param {string} itemId - The ID of the item that was updated.
 * @param {object} updatedFields - The fields that were updated.
 */
async function fanOutItemUpdates(itemId, updatedFields) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    // 1. Update User Profiles denormalized data
    // Optimized to avoid dynamic index requirement for collectionGroup where clause
    try {
        const userItemsSnaps = await db.collectionGroup('items').get();

        const userUpdatePromises = [];
        userItemsSnaps.forEach(doc => {
            const data = doc.data();
            if (data && data[itemId]) {
                const updateObj = {};
                for (const [key, value] of Object.entries(updatedFields)) {
                    updateObj[`${itemId}.${key}`] = value;
                }
                userUpdatePromises.push(doc.ref.update(updateObj));
            }
        });
        await Promise.all(userUpdatePromises);
    } catch (e) {
        console.error("Error fanning out to user profiles:", e);
    }

    // 2. Update Public Lists denormalized data
    try {
        const metadataRef = db.collection('artifacts').doc(appId).collection('metadata').doc('lists_sharding');
        const metaSnap = await metadataRef.get();
        let maxShard = metaSnap.exists ? (metaSnap.data().currentShardId || 1) : 5;

        for (let i = 1; i <= maxShard; i++) {
            const shardRef = db.collection(`lists-${i}`).doc('lists');
            const shardSnap = await shardRef.get();
            if (shardSnap.exists) {
                const listsMap = shardSnap.data();
                let shardNeedsUpdate = false;
                const updatedShardMap = { ...listsMap };

                Object.entries(listsMap).forEach(([listId, listData]) => {
                    if (listData.items && listData.items[itemId]) {
                        updatedShardMap[listId].items[itemId] = {
                            ...listData.items[itemId],
                            ...updatedFields
                        };
                        shardNeedsUpdate = true;
                    }
                });

                if (shardNeedsUpdate) {
                    await shardRef.set(updatedShardMap);
                }
            }
        }
    } catch (e) {
        console.error("Error fanning out to public lists:", e);
    }
}


// --- Rating Helpers ---

function setupStarRating() {
    const starContainer = document.getElementById('priorityStarRating');
    const priorityInput = document.getElementById('privPriority');

    if (!starContainer || !priorityInput) return;

    const stars = starContainer.querySelectorAll('i');

    // Initial highlight
    const initialVal = parseInt(priorityInput.value || 0);
    highlightStars(stars, initialVal);

    stars.forEach(star => {
        star.onmouseover = () => {
            const val = parseInt(star.dataset.value);
            highlightStars(stars, val);
        };

        star.onmouseout = () => {
            const currentVal = parseInt(priorityInput.value || 0);
            highlightStars(stars, currentVal);
        };

        star.onclick = () => {
            const val = parseInt(star.dataset.value);
            priorityInput.value = val;
            highlightStars(stars, val);
        };
    });
}

function highlightStars(stars, value) {
    stars.forEach(star => {
        const starVal = parseInt(star.dataset.value);
        if (starVal <= value) {
            star.style.color = 'gold';
        } else {
            star.style.color = '#ccc';
        }
    });
}

