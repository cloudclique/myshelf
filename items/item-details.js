import { auth, db, collectionName } from '../firebase-config.js';
import { populateDropdown, AGERATING_OPTIONS, CATEGORY_OPTIONS, SCALE_OPTIONS } from '../utils.js';

// --- Constants ---
const VERTICAL_ALIGN_OPTIONS = ['top', 'center', 'bottom'];
const HORIZONTAL_ALIGN_OPTIONS = ['left', 'center', 'right'];
const MAX_IMAGE_COUNT = 6; // NEW: Max number of images allowed
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file



// --- DOM Elements ---
const itemNamePlaceholder = document.getElementById('itemNamePlaceholder');
const itemNamePlaceholderTitle = document.getElementById('itemNamePlaceholderTitle');
const itemDetailsContent = document.getElementById('itemDetailsContent');
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
const statusToggleBtn = document.getElementById('statusToggleBtn');
const editTitleInput = document.getElementById('editTitle');
const editAgeRatingSelect = document.getElementById('editAgeRating');
const editCategorySelect = document.getElementById('editCategory');
const editReleaseDateInput = document.getElementById('editReleaseDate');
const editScaleSelect = document.getElementById('editScale');
const editTagsInput = document.getElementById('editTags');
const editImageAlignVerSelect = document.getElementById('editImageAlignVer'); 
const editImageAlignHorSelect = document.getElementById('editImageAlignHor'); 
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

let itemId = null;
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
    confirmationModal.style.display = 'block';

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
        editModal.style.display = 'block';
    }
}

function closeEditModal() {
    if (editModal) {
        editModal.style.display = 'none';
    }
}


// --- Helpers ---
async function updateProfileCounters(userId) {
    const userItemsRef = getUserCollectionRef(db, userId);
    const profileRef = db.collection('artifacts').doc('default-app-id').collection('user_profiles').doc(userId);

    try {
        const snapshot = await userItemsRef.get();
        let itemsOwned = 0, itemsWished = 0, itemsOrdered = 0;

        snapshot.forEach(doc => {
            const status = doc.data().status;
            if (status === 'Owned') itemsOwned++;
            else if (status === 'Wished') itemsWished++;
            else if (status === 'Ordered') itemsOrdered++;
        });

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


    // Pagination Event Listeners
    if (nextCommentsBtn) nextCommentsBtn.addEventListener('click', () => changeCommentPage(1));
    if (prevCommentsBtn) prevCommentsBtn.addEventListener('click', () => changeCommentPage(-1));

    auth.onAuthStateChanged((user) => {
        fetchItemDetails(itemId);
        setupAuthUI(user);
        renderComments(itemId); 
        renderShops(itemId);
    });

    if (submitCommentBtn) submitCommentBtn.addEventListener('click', postComment);
    if (submitShopBtn) submitShopBtn.addEventListener('click', postShop);
});

// --- Image Upload (ImgBB Integration) ---
/**
 * Uploads a single image file to ImgBB.
 * @param {File} imageFile The image file to upload.
 * @returns {Promise<{url: string, deleteUrl: string}>} Object containing the URL and delete URL.
 */
async function uploadImageToImgBB(imageFile) {
    const formData = new FormData();
    formData.append("image", imageFile);

    try {
        const response = await fetch(IMGBB_UPLOAD_URL, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData.error && errorData.error.message) {
                    errorMessage = errorData.error.message;
                }
            } catch (e) { }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        // MODIFIED: Return an object with both the URL and the delete_url
        return {
            url: data.data.url, 
            deleteUrl: data.data.delete_url
        };

    } catch (error) {
        console.error("Error uploading to ImgBB:", error);
        throw new Error("Failed to upload image to hosting service: " + error.message);
    }
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

        // Add a button to remove existing images
        div.innerHTML = `
            <img src="${imgObj.url}" alt="Existing Image ${index + 1}" class="image-preview ${isPrimary ? 'primary-image-preview' : ''}">
            <button type="button" class="remove-image-btn" data-index="${index}" title="Remove Image">&times;</button>
            ${isPrimary 
                ? '<span class="primary-tag">Primary</span>'
                : `<button type="button" class="set-primary-btn action-btn secondary-btn" data-index="${index}">Set as Primary</button>`
            }
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
        button.addEventListener('click', function() {
            const indexToRemove = parseInt(this.dataset.index, 10);
            
            // Remove the image object from the list of current images
            // The deleteUrl is still inside the object, which is now discarded from the array.
            // Full ImgBB deletion logic would require calling the deleteUrl here or on save.
            currentItemImageUrls.splice(indexToRemove, 1);
            
            updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
            editMessage.textContent = 'Existing image marked for removal (will be removed on save).';
            editMessage.className = 'form-message info-message';
        });
    });
    
    // Add listeners for removing NEW files
    document.querySelectorAll('.remove-new-file-btn').forEach(button => {
        button.addEventListener('click', function() {
            const indexToRemove = parseInt(this.dataset.index, 10);
            
            // Remove the file from the selected files array
            selectedImageFiles.splice(indexToRemove, 1);
            
            updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
            editMessage.textContent = `New image removed from selection. Total new: ${selectedImageFiles.length}.`;
            editMessage.className = 'form-message info-message';
        });
    });


    // NEW: Add listeners for setting existing images as primary
    document.querySelectorAll('.set-primary-btn').forEach(button => {
        button.addEventListener('click', function() {
            const indexToMove = parseInt(this.dataset.index, 10);
            
            // Get the image object
            const imageObject = currentItemImageUrls[indexToMove];
            
            // Remove it from its current position
            currentItemImageUrls.splice(indexToMove, 1);
            
            // Insert it at the start of the array
            currentItemImageUrls.unshift(imageObject);
            
            // Re-render the previews to update UI and buttons
            updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
            editMessage.textContent = 'Primary image set. Save to confirm change.';
            editMessage.className = 'form-message info-message';
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

// --- Fetch and Render Item ---
async function fetchItemDetails(id) {
    try {
        const docRef = db.collection('items').doc(id);
        const itemDoc = await docRef.get();
        if (!itemDoc.exists) {
            itemDetailsContent.innerHTML = `<p class="error-message">Item with ID: ${id} not found.</p>`;
            return;
        }

        const itemData = itemDoc.data();
        itemData.id = itemDoc.id;
        applyShopPermissions(itemData);
        
        // MODIFIED: Store the array of image objects or convert legacy URLs to objects
        currentItemImageUrls = Array.isArray(itemData.itemImageUrls) && itemData.itemImageUrls.length > 0
            ? itemData.itemImageUrls
            : [itemData.itemImageUrl, itemData.itemImageBase64, itemData.itemImage]
              .filter(url => url) // Filter out null/undefined
              .map(url => typeof url === 'string' ? { url: url } : url) // Convert legacy string URLs to {url: string} object
              .filter(obj => obj && obj.url); // Ensure we only keep valid objects


        let userStatus = null;
        let canEdit = false;

        if (auth.currentUser) {
            const userId = auth.currentUser.uid;
            const userStatusDocRef = getUserCollectionRef(db, userId).doc(id);
            const userStatusSnap = await userStatusDocRef.get();           
            if (userStatusSnap.exists) userStatus = userStatusSnap.data().status;
            updateStatusSelection(userStatus);

            const userRole = await checkUserPermissions(userId);
            const isUploader = userId === itemData.uploaderId;
            const isAdminOrMod = userRole === 'admin' || userRole === 'mod';
            canEdit = isUploader || isAdminOrMod;
        }

        renderItemDetails(itemData, userStatus);

        if (canEdit) {
            editToggleBtn.style.display = 'inline-block';
            editToggleBtn.onclick = toggleEditForm;
            setupEditForm(itemData);
            setupDeleteButton(itemData.id);
        } else {
            editToggleBtn.style.display = 'none';
            deleteContainer.innerHTML = ''; // Ensure delete button is hidden if no permission
        }
    } catch (error) {
        itemDetailsContent.innerHTML = `<p class="error-message">Error fetching details: ${error.message}</p>`;
        console.error(error);
    }
}

// MODIFIED: Render image gallery instead of single image
function renderItemDetails(item, userStatus) {
    const titleText = item.itemName || 'Untitled Item';
    itemNamePlaceholder.textContent = titleText;
    itemNamePlaceholderTitle.textContent = titleText;

    const displayStatus = userStatus || 'N/A';
    
    // Extract only URLs for display
    const imageUrls = currentItemImageUrls.map(img => img.url); 
    const fallbackImage = 'https://placehold.co/400x400/333333/eeeeee?text=No+Image';
    const primaryImage = imageUrls[0] || fallbackImage;

    // Build the gallery HTML
    let galleryHtml = `<img src="${primaryImage}" class="item-image-large" id="mainGalleryImage" data-index="0">`;
    if (imageUrls.length > 1) {
        galleryHtml += `<div class="thumbnail-gallery-row">`;
        imageUrls.forEach((url, index) => {
            galleryHtml += `<img src="${url}" class="item-thumbnail ${index === 0 ? 'selected-thumbnail' : ''}" data-index="${index}" onclick="changeMainImage(this)">`;
        });
        galleryHtml += `</div>`;
    }

    itemDetailsContent.innerHTML = `
        <div class="image-gallery-container" id="imageGalleryContainer">
            ${galleryHtml}
        </div>
        <div class="item-metadata">
            <p style="margin-bottom:20px;">
                <span class="status-badge status-${displayStatus.toLowerCase().replace('/', '-')}">${displayStatus}</span>
            </p>
            <div class="two-column-row">
                <div><span class="info-label">Category:</span><span class="info-value">${item.itemCategory || 'N/A'}</span></div>
                <div><span class="info-label">Scale:</span><span class="info-value">${item.itemScale || 'N/A'}</span></div>
                <div><span class="info-label">Age Rating:</span><span class="info-value">${item.itemAgeRating || 'N/A'}</span></div>
                <div><span class="info-label">Release Date:</span><span class="info-value">${item.itemReleaseDate || 'N/A'}</span></div>
                <div>
                    <span class="info-label">Uploader:</span>
                    <span id="uploaderName" class="info-value">Loading...</span>
                </div>
                <div><span class="info-label">Item ID:</span><span class="info-value">${item.id}</span></div>
            </div>
            
        </div>
    `;

    tagsBox.innerHTML = `
        <div><span class="info-label">Tags:</span><span class="tags">${(item.tags && item.tags.join(', ')) || 'None'}</span></div>
    `;

    // Thumbnail click handler
    window.changeMainImage = (thumbnail) => {
        const mainImage = document.getElementById('mainGalleryImage');
        if (mainImage) {
            mainImage.src = thumbnail.src;
            mainImage.dataset.index = thumbnail.dataset.index; // update index for lightbox
            document.querySelectorAll('.item-thumbnail').forEach(t => t.classList.remove('selected-thumbnail'));
            thumbnail.classList.add('selected-thumbnail');
        }
    };

    // Main image click to open lightbox
    const mainImage = document.getElementById('mainGalleryImage');
    if (mainImage) {
        mainImage.onclick = () => {
            const index = parseInt(mainImage.dataset.index || 0, 10);
            openLightbox(index); // open at currently selected image
        };
    }

    // Uploader name
    const uploaderId = item.uploaderId;
    const uploaderEl = document.getElementById("uploaderName");

    if (!uploaderId) {
        if (uploaderEl) uploaderEl.textContent = "Unknown user";
    } else {
        getUploaderUsername(uploaderId).then(name => {
            if (uploaderEl) {
                const profileLink = document.createElement('a');
                profileLink.href = `../user/?uid=${uploaderId}`;
                profileLink.textContent = name;
                profileLink.className = 'info-value-link';
                uploaderEl.innerHTML = '';
                uploaderEl.appendChild(profileLink);
            }
        }).catch(error => {
            console.error("Error fetching uploader name:", error);
            if (uploaderEl) uploaderEl.textContent = "Error loading user";
        });
    }

    if (statusToggleBtn && !auth.currentUser) statusToggleBtn.disabled = true;
    else if (statusToggleBtn) statusToggleBtn.disabled = false;

}

// --- Edit Form ---
function toggleEditForm() {
    // MODIFIED: Use the modal functions
    if (editModal.style.display === 'block') {
        closeEditModal();
        editToggleBtn.textContent = '✏️';
    } else {
        // Re-setup form content before showing modal to ensure fresh data
        fetchItemDetails(itemId).then(() => {
             // setupEditForm is called inside fetchItemDetails for re-setup
             showEditModal();
             editToggleBtn.textContent = '✏️';
        });
    }
}

// MODIFIED: setupEditForm to initialize multi-image context
function setupEditForm(item) {
    populateDropdown('editCategory', CATEGORY_OPTIONS, item.itemCategory);
    populateDropdown('editAgeRating', AGERATING_OPTIONS, item.itemAgeRating);
    populateDropdown('editScale', SCALE_OPTIONS, item.itemScale);
    populateDropdown('editImageAlignVer', VERTICAL_ALIGN_OPTIONS, item['img-align-ver']);
    populateDropdown('editImageAlignHor', HORIZONTAL_ALIGN_OPTIONS, item['img-align-hor']);

    editTitleInput.value = item.itemName || '';
    editReleaseDateInput.value = item.itemReleaseDate || '';
    editTagsInput.value = (item.tags && item.tags.join(', ')) || '';

    // Clear file input and temporary file object array
    if (editImageInput) editImageInput.value = '';
    selectedImageFiles = [];

    // Update the edit previews with current URLs (which are now objects)
    updateEditImagePreviews(currentItemImageUrls, selectedImageFiles);
    
    // Clear message from previous attempts
    editMessage.textContent = '';
    editMessage.className = 'form-message';
}

// MODIFIED: Edit form submit handler for multiple images and modal closure
editItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!auth.currentUser || !itemId) return;

    editMessage.textContent = 'Saving...';
    editMessage.className = 'form-message';

    const userId = auth.currentUser.uid;
    const itemDoc = await db.collection('items').doc(itemId).get();
    const itemData = itemDoc.data();
    const userRole = await checkUserPermissions(userId);
    const isUploader = userId === itemData.uploaderId;
    const isAdminOrMod = userRole === 'admin' || userRole === 'mod';

    if (!(isUploader || isAdminOrMod)) {
        editMessage.textContent = "Permission denied.";
        editMessage.className = 'form-message error-message';
        return;
    }

    const updatedData = {
        itemName: editTitleInput.value,
        itemCategory: editCategorySelect.value,
        itemAgeRating: editAgeRatingSelect.value,
        itemScale: editScaleSelect.value,
        itemReleaseDate: editReleaseDateInput.value,
        // *** MODIFIED LINE START ***
        // Replace '?' globally with ',' before splitting the tags
        tags: editTagsInput.value.replace(/\?/g, ',').split(',').map(tag => tag.trim()).filter(tag => tag.length > 0),
        // *** MODIFIED LINE END ***
        'img-align-ver': editImageAlignVerSelect.value,
        'img-align-hor': editImageAlignHorSelect.value,
        lastEdited: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // --- NEW: Multi-Image Upload Logic ---
    // currentItemImageUrls already contains the non-removed image objects and is correctly ordered.
    let retainedImageObjects = currentItemImageUrls; 
    
    if (selectedImageFiles.length > 0) {
        editMessage.textContent = `Uploading ${selectedImageFiles.length} image(s) to ImgBB...`;
        editMessage.className = 'form-message';
        
        try {
            // uploadPromises now return image objects {url, deleteUrl}
            const uploadPromises = selectedImageFiles.map(file => uploadImageToImgBB(file));
            const uploadedImageObjects = await Promise.all(uploadPromises);
            
            // Append newly uploaded objects to the existing/retained objects
            retainedImageObjects = [...retainedImageObjects, ...uploadedImageObjects];

            // Clear the file input and temporary file object array after successful upload
            editImageInput.value = ''; 
            selectedImageFiles = []; 
        } catch (error) {
            editMessage.textContent = `Image upload failed: ${error.message}`;
            editMessage.className = 'form-message error-message';
            return; // Stop the save process
        }
    }
    
    // Check total count before saving (This check is redundant if done in handleImageFileChange, but kept as a final safeguard)
    if (retainedImageObjects.length > MAX_IMAGE_COUNT) {
        editMessage.textContent = `Error: Total images (existing + new) exceeds maximum of ${MAX_IMAGE_COUNT}. Please remove some.`;
        editMessage.className = 'form-message error-message';
        return;
    }

    // Save the new array of image objects. 
    updatedData.itemImageUrls = retainedImageObjects;

    // Explicitly clean up legacy single-image fields
    if (itemData.itemImageUrl) updatedData.itemImageUrl = firebase.firestore.FieldValue.delete();
    if (itemData.itemImageBase64) updatedData.itemImageBase64 = firebase.firestore.FieldValue.delete();
    if (itemData.itemImage) updatedData.itemImage = firebase.firestore.FieldValue.delete();

    // --- END NEW: Multi-Image Upload Logic ---

    try {
        await db.collection('items').doc(itemId).set(updatedData, { merge: true });

        editMessage.textContent = "Details updated successfully! Closing in 1 second...";
        editMessage.className = 'form-message success-message';
        
        // Update the current state for subsequent display/edits
        currentItemImageUrls = retainedImageObjects;
        
        // NEW: Close the modal and refresh details
        setTimeout(() => {
            closeEditModal();
            editToggleBtn.textContent = '✏️';
            fetchItemDetails(itemId);
        }, 100);

    } catch (error) {
        editMessage.textContent = `Error saving edits: ${error.message}`;
        editMessage.className = 'form-message error-message';
    }
});


// --- Delete (Uses Modal) ---
function setupDeleteButton(id) {
    // MODIFIED: The structure in HTML for deleteContainer is now simpler and in the title bar
    deleteContainer.innerHTML = `
        <button id="deleteBtn" class="item-manage-btn" title="Delete Item Permanently">🗑️</button>
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
    if (!auth.currentUser) {
        authMessage.textContent = "You must be logged in.";
        authMessage.className = 'form-message error-message';
        return;
    }

    try {
        const userId = auth.currentUser.uid;
        const itemDoc = await db.collection('items').doc(itemId).get();
        const itemData = itemDoc.data();
        const userRole = await checkUserPermissions(userId);
        const isUploader = userId === itemData.uploaderId;
        const isAdminOrMod = userRole === 'admin' || userRole === 'mod';

        if (!(isUploader || isAdminOrMod)) {
            authMessage.textContent = "Permission denied.";
            authMessage.className = 'form-message error-message';
            return;
        }

        await db.collection('items').doc(itemId).delete();
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
    statusMessage.textContent = `Saving status...`;
    statusMessage.className = 'form-message';

    const userItemDocRef = getUserCollectionRef(db, userId).doc(itemId);

    try {
        await userItemDocRef.set({
            itemId: itemId,
            status: newStatus,
            addedDate: firebase.firestore.FieldValue.serverTimestamp()
        });

        await updateProfileCounters(userId);

        statusMessage.textContent = 'Status saved.';
        statusMessage.className = 'form-message success-message';
        fetchItemDetails(itemId);
    } catch (error) {
        statusMessage.textContent = `Error: ${error.message}`;
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
    const userItemDocRef = getUserCollectionRef(db, userId).doc(itemId);
    try {
        const statusSnap = await userItemDocRef.get();
        if (!statusSnap.exists) {
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
                await userItemDocRef.delete();
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

// --- Comments ---
function getCommentsRef(itemId, startAfterDoc = null) {
    let query = db.collection('items').doc(itemId)
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
        const docRef = await db.collection('items').doc(itemId)
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
            await db.collection('items').doc(itemId)
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

async function deleteCommentByElement(commentEl, commentId) {
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


function linkify(text) {
    const urlPattern = /(\b(https?:\/\/|www\.)[^\s]+\b)/g;

    return text.replace(urlPattern, function(url) {
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



function updateStatusSelection(userStatus) {
    const statusButtons = document.querySelectorAll('.status-btn');
    statusButtons.forEach(btn => {
        btn.classList.remove('selected-status');
    });
    
    const radioInputs = document.querySelectorAll('input[name="collectionStatus"]');
    radioInputs.forEach(input => {
        input.checked = false;
    });

    if (userStatus) {
        const radioInput = document.querySelector(`input[name="collectionStatus"][value="${userStatus}"]`);
        
        if (radioInput) {
            radioInput.checked = true;
            
            const label = document.querySelector(`label[for="${radioInput.id}"]`);
            if (label) {
                label.classList.add('selected-status');
            }
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
                        deleteButtonEl.textContent = '×';
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
                        deleteButtonEl.textContent = '×';
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
                    deleteButtonEl.textContent = '×';
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

window.attachLightboxToThumbnails = function() {
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
            <span style="font-size:0.7em; color:#888; float:right;">${timestamp}</span>
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
    const isAdminOrModOrShop = ['admin','mod','shop'].includes(currentUserRole);

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
                    <span style="font-size:0.7em; color:#888; float:right;">${timestamp}</span>
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
                        deleteButtonEl.textContent = '×';
                    }
                    return;
                }

                const shopData = shopSnap.data();
                const userRole = await checkUserPermissions(userId);
                const isCreator = userId === shopData.userId;
                const isAdminOrModOrShop =
                    ['admin','mod','shop'].includes(userRole);

                if (!(isCreator || isAdminOrModOrShop)) {
                    ShopMessage.textContent =
                        "Permission denied.";
                    ShopMessage.className = 'form-message error-message';
                    if (deleteButtonEl) {
                        deleteButtonEl.disabled = false;
                        deleteButtonEl.textContent = '×';
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
                    deleteButtonEl.textContent = '×';
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
