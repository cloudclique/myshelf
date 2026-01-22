import { auth, db, collectionName } from '../firebase-config.js';
import { populateDropdown, AGERATING_OPTIONS, CATEGORY_OPTIONS, SCALE_OPTIONS, toBase64, processImageForUpload } from '../utils.js';

// --- 1. Constants & DOM ---
const itemsCollectionName = collectionName;
let currentUserId = null;
let currentUserName = null;

const MAX_IMAGE_COUNT = 9;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const headerTools = document.getElementById('headerTools');
const addItemForm = document.getElementById('addItemForm');
const itemImageFile = document.getElementById('itemImageFile');
const uploadStatus = document.getElementById('uploadStatus');
const uploadButton = document.getElementById('uploadButton');
const itemNameInput = document.getElementById('itemName');
const itemAgeRatingInput = document.getElementById('itemAgeRating');
const itemCategoryInput = document.getElementById('itemCategory');
const itemReleaseDateInput = document.getElementById('itemReleaseDate');
const itemScaleInput = document.getElementById('itemScale');
const itemTagsInput = document.getElementById('tags');
const itemDraftInput = document.getElementById('itemDraft');

const importMfcBtn = document.getElementById('importMfcBtn');
const mfcImportFile = document.getElementById('mfcImportFile');
const importStatus = document.getElementById('importStatus');

const imagePreviewsContainer = document.getElementById('imagePreviewsContainer');

let selectedImageFiles = [];

// Confirmation Modal Elements
const confirmationModal = document.getElementById('confirmationModal');
const modalMessage = document.getElementById('modalMessage');
const modalYesBtn = document.getElementById('modalYesBtn');
const modalNoBtn = document.getElementById('modalNoBtn');

const thumbnailInput = document.getElementById('thumbnailInput');
const thumbnailTrigger = document.getElementById('thumbnailTrigger');
const cropperModal = document.getElementById('cropperModal');
const cropCanvas = document.getElementById('cropCanvas');
const cropContainer = document.getElementById('cropContainer');
const zoomSlider = document.getElementById('zoomSlider');
const saveCropBtn = document.getElementById('saveCropBtn');
const cancelCropBtn = document.getElementById('cancelCropBtn');

// State for Cropper
let cropperImg = new Image();
let currentScale = 1;
let currentPos = { x: 0, y: 0 };
let isDragging = false;
let startDragPos = { x: 0, y: 0 };

// --- NEW: Modal Handlers ---

function showConfirmationModal(message, onYes, yesText = 'Yes') {
    if (!confirmationModal || !modalMessage || !modalYesBtn || !modalNoBtn) {
        if (confirm(message)) {
            onYes();
        }
        return;
    }

    modalMessage.textContent = message;
    confirmationModal.style.display = 'block';

    modalYesBtn.textContent = yesText;
    modalNoBtn.textContent = 'No';

    modalYesBtn.replaceWith(modalYesBtn.cloneNode(true));
    modalNoBtn.replaceWith(modalNoBtn.cloneNode(true));

    const newModalYesBtn = document.getElementById('modalYesBtn');
    const newModalNoBtn = document.getElementById('modalNoBtn');

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

// --- 2. Firestore Helpers ---
function getUserCollectionRef(db, userId) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return db.collection('artifacts').doc(appId).collection('user_profiles').doc(userId).collection('items');
}

async function fetchUserProfile(userId) {
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const profileRef = db.collection('artifacts').doc(appId)
            .collection('user_profiles').doc(userId);
        const profileSnap = await profileRef.get();
        return (profileSnap.exists && profileSnap.data().username) ? profileSnap.data().username : "Anonymous";
    } catch (e) {
        console.error("Error fetching user profile:", e);
        return "Anonymous";
    }
}

// --- 3. Auth Setup ---
populateDropdown('itemCategory', CATEGORY_OPTIONS);
populateDropdown('itemAgeRating', AGERATING_OPTIONS);
populateDropdown('itemScale', SCALE_OPTIONS);

auth.onAuthStateChanged(async (user) => {
    headerTools.innerHTML = '';
    if (user) {
        currentUserId = user.uid;
        currentUserName = await fetchUserProfile(currentUserId);

        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'logoutBtn';
        logoutBtn.className = 'logout-btn';
        logoutBtn.textContent = 'Logout';
        logoutBtn.onclick = () => auth.signOut();
        headerTools.appendChild(logoutBtn);
    } else {
        currentUserId = null;
        currentUserName = null;
        headerTools.innerHTML = '<p class="login-prompt">Please log in to manage your collection.</p>';
    }

    [addItemForm, importMfcBtn].forEach(form => { if (form) form.disabled = !user; });
});

// convertFileToWebp removed - using processImageForUpload from utils.js

async function checkUserRole(userId) {
    if (!userId) return 'user';
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const profileRef = db.collection('artifacts').doc(appId).collection('user_profiles').doc(userId);
        const snap = await profileRef.get();
        if (snap.exists) return snap.data().role || 'user';
        return 'user';
    } catch (error) {
        console.error("Error fetching user role:", error);
        return 'user';
    }
}


// --- 4. Multi-Image Upload & Preview Logic ---
// CHANGED: Use the Cloudflare Worker proxy URL instead of the direct imgBB API with the exposed key.
const IMGBB_UPLOAD_URL = 'https://imgbbapi.stanislav-zhukov.workers.dev/';

/**
 * @param {File} file The file object to upload.
 * @returns {Promise<{url: string, deleteUrl: string}>} The direct URL and delete URL of the uploaded image.
 */
async function uploadImageToImgbb(file) {
    if (!file) return null;

    if (file.size > MAX_FILE_SIZE) throw new Error("Image file too large (max 5MB).");

    // 🔥 Resize and convert to WebP before uploading
    const webpFile = await processImageForUpload(file);

    const formData = new FormData();
    // The Cloudflare Worker is expected to receive 'image' in the POST body, 
    // which it then forwards to the real ImgBB API.
    formData.append('image', webpFile);

    // CHANGED: fetch call uses the new IMGBB_UPLOAD_URL (the Worker proxy)
    const response = await fetch(IMGBB_UPLOAD_URL, {
        method: 'POST',
        body: formData
    });

    const result = await response.json();

    if (!result.success) {
        // The worker should return the error structure from ImgBB.
        const errorMessage = result.error?.message || `Failed to upload image. Status: ${response.status}`;
        throw new Error(errorMessage);
    }

    return {
        url: result.data.url,
        deleteUrl: result.data.delete_url
    };
}

// --- NEW: Thumbnail & Cropper Logic ---

// 1. Trigger Hidden Input
if (thumbnailTrigger) {
    thumbnailTrigger.onclick = () => thumbnailInput.click();
}

// 2. Handle File Selection for Thumbnail
if (thumbnailInput) {
    thumbnailInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            cropperImg = new Image();
            cropperImg.onload = () => {
                openCropperModal();
            };
            cropperImg.src = evt.target.result;
        };
        reader.readAsDataURL(file);
        // Reset input so same file can be selected again if needed
        e.target.value = '';
    };
}

function openCropperModal() {
    cropperModal.style.display = 'block';

    const containerSize = 300;
    const cropSize = 95;

    const imgW = cropperImg.width;
    const imgH = cropperImg.height;

    let fitScale;

    // Portrait → fit crop WIDTH
    // Landscape / square → fit crop HEIGHT
    if (imgH > imgW) {
        fitScale = cropSize / imgW;
    } else {
        fitScale = cropSize / imgH;
    }

    currentScale = fitScale;

    zoomSlider.min = fitScale;        // never allow smaller than crop
    zoomSlider.max = fitScale * 3;
    zoomSlider.step = 0.001;
    zoomSlider.value = fitScale;

    // Center image inside 300x300 canvas
    currentPos = {
        x: (containerSize - imgW * currentScale) / 2,
        y: (containerSize - imgH * currentScale) / 2
    };

    drawCropper();
}



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

function drawCropper() {
    const ctx = cropCanvas.getContext('2d');
    // Set canvas to container size
    cropCanvas.width = 300;
    cropCanvas.height = 300;

    ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.drawImage(
        cropperImg,
        currentPos.x,
        currentPos.y,
        cropperImg.width * currentScale,
        cropperImg.height * currentScale
    );
    clampImagePosition();
}

// --- 3. Dragging Logic (Mouse & Touch) ---

const startDragging = (clientX, clientY) => {
    isDragging = true;
    startDragPos = { x: clientX - currentPos.x, y: clientY - currentPos.y };
    clampImagePosition();
};

const moveDragging = (clientX, clientY) => {
    if (!isDragging) return;
    currentPos.x = clientX - startDragPos.x;
    currentPos.y = clientY - startDragPos.y;

    drawCropper();
};

const stopDragging = () => {
    isDragging = false;
    clampImagePosition();
};

if (cropContainer) {
    // Mouse Events
    cropContainer.onmousedown = (e) => startDragging(e.clientX, e.clientY);
    window.onmousemove = (e) => moveDragging(e.clientX, e.clientY);
    window.onmouseup = stopDragging;

    // Touch Events
    cropContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            // Prevent scrolling while dragging inside the cropper
            e.preventDefault();
            startDragging(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches.length === 1) {
            e.preventDefault(); // Prevent page bounce/scroll
            moveDragging(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: false });

    window.addEventListener('touchend', stopDragging);
}

// 4. Zoom Logic
if (zoomSlider) {
    zoomSlider.oninput = (e) => {
        const oldScale = currentScale;
        currentScale = parseFloat(e.target.value);

        // Zoom towards center
        const containerSize = 300;
        const centerX = containerSize / 2;
        const centerY = containerSize / 2;

        // Math to keep image centered while zooming
        currentPos.x = centerX - (centerX - currentPos.x) * (currentScale / oldScale);
        currentPos.y = centerY - (centerY - currentPos.y) * (currentScale / oldScale);

        drawCropper();
    };
}

// 5. Save & Cut Logic (The 95x95 Requirement)
if (saveCropBtn) {
    saveCropBtn.onclick = () => {
        clampImagePosition();
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = 95;
        outputCanvas.height = 95;
        const outCtx = outputCanvas.getContext('2d');

        // Logic to extract exactly what is inside the 95x95 center box
        // The container is 300x300. The box is centered (102.5, 102.5 to 197.5, 197.5)
        // However, we can simply map the canvas coordinates relative to the center.

        const containerSize = 300;
        const boxSize = 95;
        const boxOffset = (containerSize - boxSize) / 2; // 102.5

        // We draw the image onto the small canvas, offset by the box position
        outCtx.drawImage(
            cropperImg,
            currentPos.x - boxOffset, // Shift image left by box margin
            currentPos.y - boxOffset, // Shift image up by box margin
            cropperImg.width * currentScale,
            cropperImg.height * currentScale
        );

        outputCanvas.toBlob((blob) => {
            if (!blob) return;

            // Create a File object
            const thumbFile = new File([blob], "thumbnail_95x95.webp", { type: "image/webp" });

            // Mark it specifically so we know it's the thumbnail
            thumbFile.isThumbnail = true;

            // Remove existing thumbnail if present (check index 0)
            if (selectedImageFiles.length > 0 && selectedImageFiles[0].isThumbnail) {
                selectedImageFiles.shift();
            }

            // Insert at Index 0
            selectedImageFiles.unshift(thumbFile);

            updateImagePreviews(selectedImageFiles);

            // Update UI trigger to show success
            thumbnailTrigger.innerHTML = `
                <img src="${URL.createObjectURL(thumbFile)}" style="width:95px; height:95px; border-radius:4px;">
                <span class="thumb-label" style="color: #4caf50;">Thumbnail Set</span>
            `;

            cropperModal.style.display = 'none';
        }, 'image/webp', 1.0);
    };
}

if (cancelCropBtn) {
    cancelCropBtn.onclick = () => {
        cropperModal.style.display = 'none';
        thumbnailInput.value = '';
    };
}
/**
 * Handles the selection of multiple image files, performing validation.
 */
/**
 * Handles the selection of standard image files.
 * Preserves the thumbnail at index 0 if it exists.
 */
function handleImageFileChange(e) {
    const newFiles = Array.from(e.target.files);

    // Check if we have an existing thumbnail
    const existingThumbnail = (selectedImageFiles.length > 0 && selectedImageFiles[0].isThumbnail)
        ? selectedImageFiles[0]
        : null;

    // Reset array but keep thumbnail if it exists
    selectedImageFiles = existingThumbnail ? [existingThumbnail] : [];

    if (newFiles.length === 0) {
        updateImagePreviews(selectedImageFiles);
        return;
    }

    const availableSlots = MAX_IMAGE_COUNT - selectedImageFiles.length;

    if (newFiles.length > availableSlots) {
        uploadStatus.textContent = `Error: Limit reached. You can only add ${availableSlots} more image(s).`;
        uploadStatus.className = 'form-message error-message';
        e.target.value = '';
        updateImagePreviews(selectedImageFiles);
        return;
    }

    for (const file of newFiles) {
        if (file.size > MAX_FILE_SIZE) {
            uploadStatus.textContent = `Error: Image file too large (max 5MB each).`;
            uploadStatus.className = 'form-message error-message';
            e.target.value = '';
            // Reset to just thumbnail
            selectedImageFiles = existingThumbnail ? [existingThumbnail] : [];
            updateImagePreviews(selectedImageFiles);
            return;
        }
        selectedImageFiles.push(file);
    }

    updateImagePreviews(selectedImageFiles);

    uploadStatus.textContent = `Selected ${selectedImageFiles.length} image(s) total.`;
    uploadStatus.className = 'form-message info-message';
}

/**
 * Displays local previews of the selected image files, and enables reordering/removal.
 * @param {File[]} files The array of selected File objects.
 */
function updateImagePreviews(files) {
    if (!imagePreviewsContainer) return;

    imagePreviewsContainer.innerHTML = '';

    files.forEach((file, index) => {
        const div = document.createElement('div');
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

        // Use the same classes as item-details.js for consistency and assumed shared CSS
        div.className += ` image-preview-item new-image ${isPrimary ? 'primary-image-preview' : ''}`;

        div.innerHTML = `
            <img src="${URL.createObjectURL(file)}" alt="New Image ${index + 1}" class="image-preview">
            <span class="new-tag">NEW</span>
            <button type="button" class="remove-new-file-btn" data-index="${index}" title="Remove New File">&times;</button>
            ${isPrimary ? '<span class="primary-tag">Thumbnail</span>' : ''}
        `;
        imagePreviewsContainer.appendChild(div);
    });

    // NEW: Add listeners for removing NEW files
    document.querySelectorAll('.remove-new-file-btn').forEach(button => {
        button.addEventListener('click', function () {
            const indexToRemove = parseInt(this.dataset.index, 10);

            // Remove the file from the selected files array
            selectedImageFiles.splice(indexToRemove, 1);

            updateImagePreviews(selectedImageFiles);
            uploadStatus.textContent = `Image removed. Total selected: ${selectedImageFiles.length}.`;
            uploadStatus.className = 'form-message info-message';
        });
    });

    // NEW: Add drag-and-drop listeners for reordering
    setupDragAndDrop();

    // Ensure itemImageFile.required is set correctly based on current selection
    itemImageFile.required = files.length === 0;
}

// NEW: Drag-and-drop functionality for reordering images in add-item
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
                const draggedItem = selectedImageFiles[draggedIndex];
                selectedImageFiles.splice(draggedIndex, 1);
                selectedImageFiles.splice(dropIndex, 0, draggedItem);

                // Re-render
                updateImagePreviews(selectedImageFiles);
                uploadStatus.textContent = 'Image order changed. Click "Add Item" to upload.';
                uploadStatus.className = 'form-message info-message';
            }

            return false;
        });
    });
}

// Attach the new handler
if (itemImageFile) {
    itemImageFile.addEventListener('change', handleImageFileChange);
}

// --- New Helper: Check for similar items (Jaccard Similarity) ---
function tokenize(text) {
    if (!text) return new Set();
    const stopWords = new Set(["the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "with", "by", "ver", "version", "edition"]);
    return new Set(
        text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '') // Keep alphanumeric and spaces
            .split(/\s+/)
            .filter(w => w.length > 1 && !stopWords.has(w))
    );
}

// Jaccard Index = (Intersection Size) / (Union Size)
function calculateJaccardScore(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

// -------- SIMILAR ITEM CHECK --------
async function findSimilarItems(newTitle, category, scale) {
    // 1. Tokenize input
    const newTokens = tokenize(newTitle);
    if (newTokens.size === 0) return [];

    try {
        // 2. Optimized Query: Filter by Category and Scale to limit reads
        // Use a limit to prevent fetching huge collections if category is generic
        let query = db.collection(itemsCollectionName)
            .where('itemCategory', '==', category)
            .orderBy('createdAt', 'desc')
            .limit(500); // Check last 500 items in this category

        // Optional: Refine by scale if it's specific
        if (scale && scale !== 'Other' && scale !== 'Non-Scale') {
            query = query.where('itemScale', '==', scale);
        }

        const snapshot = await query.get();
        const matches = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            const existingTokens = tokenize(data.itemName);

            const score = calculateJaccardScore(newTokens, existingTokens);

            // Threshold: 0.5 means 50% of the union of words are shared.
            // e.g. "Rem Re:Zero Figure" (3) vs "Rem Figure" (2). Union=3, Intersect=2. Score=0.66. Match.
            if (score >= 0.75) {
                matches.push({
                    id: doc.id,
                    itemName: data.itemName,
                    thumb: (data.itemImageUrls && data.itemImageUrls.length > 0)
                        ? data.itemImageUrls[0].url
                        : "../placeholder.png",
                    score: score
                });
            }
        });

        // Sort by highest score
        return matches.sort((a, b) => b.score - a.score);

    } catch (e) {
        console.error("Duplicate check failed:", e);
        // On error, we assume no duplicates to allow user to proceed
        return [];
    }
}



// --- Modified Form Submission to use HTML in Modal ---
addItemForm.onsubmit = async (e) => {
    e.preventDefault();

    if (!currentUserId) {
        uploadStatus.textContent = "You must be logged in to add an item.";
        uploadStatus.className = 'form-message error-message';
        return;
    }

    if (selectedImageFiles.length === 0) {
        uploadStatus.textContent = "Please select at least one image.";
        uploadStatus.className = 'form-message error-message';
        return;
    }

    const title = itemNameInput.value.trim();
    const category = itemCategoryInput.value;
    const scale = itemScaleInput.value;

    uploadButton.disabled = true;
    uploadStatus.textContent = "Checking for duplicates...";

    const similarItems = await findSimilarItems(title, category, scale);

    if (similarItems.length > 0) {
        // Build the HTML for the matches
        const listHtml = similarItems.map(item => `
            <div class="similar-item-row">
                <img src="${item.thumb}" class="similar-item-thumb" alt="existing item">
                <span class="similar-item-name">${item.itemName}</span>
            </div>
        `).join('');

        const fullMessageHtml = `
            <div style="margin-bottom: 15px; font-weight: bold; color: #d9534f;">
                Found ${similarItems.length} similar entries:
            </div>
            <div style="max-height: 200px; overflow-y: auto; margin-bottom: 15px;">
                ${listHtml}
            </div>
            <p>Do you still want to proceed with uploading this as a new entry?</p>
        `;

        // Temporarily change modal behavior to handle HTML
        const originalMessage = modalMessage.textContent;
        modalMessage.innerHTML = fullMessageHtml;
        confirmationModal.style.display = 'flex';
        modalYesBtn.textContent = "Yes, Upload Anyway";
        modalNoBtn.textContent = "No, Cancel";

        // Re-bind buttons (cleaning up old listeners)
        modalYesBtn.replaceWith(modalYesBtn.cloneNode(true));
        modalNoBtn.replaceWith(modalNoBtn.cloneNode(true));
        const newYes = document.getElementById('modalYesBtn');
        const newNo = document.getElementById('modalNoBtn');

        newYes.onclick = () => {
            closeConfirmationModal();
            proceedWithUpload();
        };
        newNo.onclick = () => {
            closeConfirmationModal();
            uploadButton.disabled = false;
        };
    } else {
        await proceedWithUpload();
    }
};

// 2. Extracted Upload Logic
// --- 3. ShelfBug Notification Helper ---
async function sendShelfBugNotification(userId, itemTitle, itemId) {
    const botId = 'shelf_bug_bot';
    const chatId = [userId, botId].sort().join('_');
    const chatRef = db.collection('artifacts').doc(typeof __app_id !== 'undefined' ? __app_id : 'default-app-id').collection('chats').doc(chatId);

    // Construct the custom review link
    // We use a relative path assuming the user is in /add-item/ or similar depth, 
    // but chat usually opens in /chat/ or overlay. 
    // The message is stored in DB, so let's use a path that works generally or absolute path if possible.
    // ..items/ matches the user request pattern.
    const reviewLink = `../items/?id=${itemId}&collection=item-review`;
    const messageText = `Your item "${itemTitle}" has been submitted for review!\n\nYou can view its status here:\n[View Pending Item](${reviewLink})`;

    const timestamp = firebase.firestore.FieldValue.serverTimestamp();

    try {
        // 1. Add message
        await chatRef.collection('messages').add({
            senderId: botId,
            text: messageText,
            timestamp: timestamp,
            imageUrls: []
        });

        // 2. Update chat metadata
        await chatRef.set({
            lastMessage: `Item "${itemTitle}" submitted for review.`,
            lastSent: timestamp,
            lastSenderId: botId,
            users: [userId, botId],
            unreadCount: {
                [userId]: firebase.firestore.FieldValue.increment(1)
            }
        }, { merge: true });

        console.log("ShelfBug notification sent.");
    } catch (e) {
        console.error("Failed to send ShelfBug notification:", e);
    }
}

async function proceedWithUpload() {
    uploadButton.disabled = true;
    uploadStatus.textContent = "Starting upload...";
    uploadStatus.className = 'form-message';

    // Generate a new ID for the item
    const newItemId = db.collection('items').doc().id;

    const itemData = {
        itemId: newItemId, // Ensure ID is part of the object
        uploaderId: currentUserId,
        uploaderName: currentUserName,
        itemName: itemNameInput.value,
        itemAgeRating: itemAgeRatingInput.value,
        itemCategory: itemCategoryInput.value,
        itemReleaseDate: itemReleaseDateInput.value,
        itemScale: itemScaleInput.value,
        tags: itemTagsInput.value.replace(/\?/g, ',').split(',').map(tag => tag.trim()).filter(tag => tag),
        isDraft: itemDraftInput ? itemDraftInput.checked : false,
        createdAt: new Date()
    };

    try {
        const userRole = await checkUserRole(currentUserId);
        const isStaff = ['admin', 'mod'].includes(userRole);

        // Handle images
        uploadStatus.textContent = `Uploading ${selectedImageFiles.length} image(s)...`;
        const uploadPromises = selectedImageFiles.map(file => uploadImageToImgbb(file));
        const uploadedImageObjects = await Promise.all(uploadPromises);
        itemData.itemImageUrls = uploadedImageObjects;

        if (!isStaff) {
            // Non-staff: Review Queue
            await db.collection('item-review').doc(newItemId).set(itemData);
            sendShelfBugNotification(currentUserId, itemData.itemName, newItemId);

            uploadStatus.textContent = "Item submitted for review! Check your messages.";
            uploadStatus.className = 'form-message success-message';
            setTimeout(() => { window.location.href = `../index.html`; }, 2000);
            return;
        }

        // Staff: Write directly to items collection
        await db.collection('items').doc(newItemId).set(itemData);

        // Update denormalized data (Staff direct upload)
        await db.collection('denormalized_data').doc('items').set({
            [newItemId]: {
                itemName: itemData.itemName,
                itemAgeRating: itemData.itemAgeRating,
                itemCategory: itemData.itemCategory,
                itemScale: itemData.itemScale,
                isDraft: itemData.isDraft,
                createdAt: itemData.createdAt,
                thumbnail: (itemData.itemImageUrls && itemData.itemImageUrls[0]) ? itemData.itemImageUrls[0].url : "",
                tags: itemData.tags || []
            }
        }, { merge: true });

        uploadStatus.textContent = "Item uploaded successfully!";
        uploadStatus.className = 'form-message success-message';
        setTimeout(() => {
            window.location.href = `../items/?id=${newItemId}`;
        }, 1000);

    } catch (e) {
        console.error(e);
        uploadStatus.textContent = `Upload failed: ${e.message}`;
        uploadStatus.className = 'form-message error-message';
        uploadButton.disabled = false;
    }
}