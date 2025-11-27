import { auth, db, collectionName } from '../firebase-config.js';
import { populateDropdown, AGERATING_OPTIONS, CATEGORY_OPTIONS, SCALE_OPTIONS, toBase64 } from './utils.js';

// --- 1. Constants & DOM ---
const itemsCollectionName = collectionName;
let currentUserId = null;
let currentUserName = null;

// NEW: Constants for multi-image upload
const MAX_IMAGE_COUNT = 6;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file



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

const importMfcBtn = document.getElementById('importMfcBtn');
const mfcImportFile = document.getElementById('mfcImportFile');
const importStatus = document.getElementById('importStatus');

// NEW: Container for image previews
const imagePreviewsContainer = document.getElementById('imagePreviewsContainer');
// NEW: State to hold selected files for upload
let selectedImageFiles = [];

// Confirmation Modal Elements
const confirmationModal = document.getElementById('confirmationModal');
const modalMessage = document.getElementById('modalMessage');
const modalYesBtn = document.getElementById('modalYesBtn');
const modalNoBtn = document.getElementById('modalNoBtn');

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

// --- 4. Multi-Image Upload & Preview Logic ---

/**
 * Uploads a single image file to ImgBB and returns the URL and delete_url.
 * @param {File} file The file object to upload.
 * @returns {Promise<{url: string, deleteUrl: string}>} The direct URL and delete URL of the uploaded image.
 */
async function uploadImageToImgbb(file) {
    if (!file) return null;

    if (file.size > MAX_FILE_SIZE) throw new Error("Image file too large (max 5MB).");

    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(IMGBB_UPLOAD_URL, {
        method: 'POST',
        body: formData
    });

    const result = await response.json();

    if (!result.success) {
        throw new Error(result.error?.message || "Failed to upload image to ImgBB");
    }
    
    // MODIFIED: Return an object with both the URL and the delete_url
    return {
        url: result.data.url, 
        deleteUrl: result.data.delete_url
    };
}

/**
 * Handles the selection of multiple image files, performing validation.
 */
function handleImageFileChange(e) {
    const files = Array.from(e.target.files);
    selectedImageFiles = []; // Reset selected files

    if (files.length === 0) {
        updateImagePreviews(selectedImageFiles);
        return;
    }

    if (files.length > MAX_IMAGE_COUNT) {
        uploadStatus.textContent = `Error: Cannot upload more than ${MAX_IMAGE_COUNT} images.`;
        uploadStatus.className = 'form-message error-message';
        e.target.value = ''; // Clear file input
        updateImagePreviews(selectedImageFiles); // Call to reset
        return;
    }

    for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
            uploadStatus.textContent = `Error: Image file too large (max 5MB each).`;
            uploadStatus.className = 'form-message error-message';
            e.target.value = ''; // Clear file input
            selectedImageFiles = [];
            updateImagePreviews(selectedImageFiles); // Call to reset
            return;
        }
        selectedImageFiles.push(file);
    }
    
    // This is the successful path
    updateImagePreviews(selectedImageFiles);

    uploadStatus.textContent = `Selected ${selectedImageFiles.length} image(s). Click an image to set its order.`;
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

        // Use the same classes as item-details.js for consistency and assumed shared CSS
        div.className = `image-preview-item new-image ${isPrimary ? 'primary-image-preview' : ''}`;
        
        div.innerHTML = `
            <img src="${URL.createObjectURL(file)}" alt="New Image ${index + 1}" class="image-preview">
            <span class="new-tag">NEW</span>
            <button type="button" class="remove-new-file-btn" data-index="${index}" title="Remove New File">&times;</button>
            ${isPrimary 
                ? '<span class="primary-tag">Primary</span>'
                : `<button type="button" class="set-primary-btn action-btn secondary-btn" data-index="${index}">Set as Primary</button>`
            }
        `;
        imagePreviewsContainer.appendChild(div);
    });

    // NEW: Add listeners for removing NEW files
    document.querySelectorAll('.remove-new-file-btn').forEach(button => {
        button.addEventListener('click', function() {
            const indexToRemove = parseInt(this.dataset.index, 10);
            
            // Remove the file from the selected files array
            selectedImageFiles.splice(indexToRemove, 1);
            
            updateImagePreviews(selectedImageFiles);
            uploadStatus.textContent = `Image removed. Total selected: ${selectedImageFiles.length}.`;
            uploadStatus.className = 'form-message info-message';
        });
    });

    // NEW: Add listeners for setting images as primary
    document.querySelectorAll('.set-primary-btn').forEach(button => {
        button.addEventListener('click', function() {
            const indexToMove = parseInt(this.dataset.index, 10);
            
            // Get the file object
            const fileObject = selectedImageFiles[indexToMove];
            
            // Remove it from its current position
            selectedImageFiles.splice(indexToMove, 1);
            
            // Insert it at the start of the array
            selectedImageFiles.unshift(fileObject);
            
            // Re-render the previews to update UI and buttons
            updateImagePreviews(selectedImageFiles);
            uploadStatus.textContent = 'Primary image set. Click "Add Item" to upload.';
            uploadStatus.className = 'form-message info-message';
        });
    });

    // Ensure itemImageFile.required is set correctly based on current selection
    itemImageFile.required = files.length === 0;
}

// Attach the new handler
if (itemImageFile) {
    itemImageFile.addEventListener('change', handleImageFileChange);
}


// --- 5. Manual Upload Form Submission ---
addItemForm.onsubmit = async (e) => {
    e.preventDefault();

    if (!currentUserId) {
        uploadStatus.textContent = "You must be logged in to add an item.";
        uploadStatus.className = 'form-message error-message';
        return;
    }

    // Check the actual state array, which is updated by the preview/remove functions
    if (selectedImageFiles.length === 0) {
        uploadStatus.textContent = "Please select at least one image.";
        uploadStatus.className = 'form-message error-message';
        return;
    }
    
    uploadButton.disabled = true;
    uploadStatus.textContent = "Starting upload...";
    uploadStatus.className = 'form-message';

    const itemData = {
        uploaderId: currentUserId,
        uploaderName: currentUserName,
        itemName: itemNameInput.value,
        itemAgeRating: itemAgeRatingInput.value,
        itemCategory: itemCategoryInput.value,
        itemReleaseDate: itemReleaseDateInput.value,
        itemScale: itemScaleInput.value,
        // *** MODIFIED LINE START ***
        // Replace '?' globally with ',' before splitting the tags
        tags: itemTagsInput.value.replace(/\?/g, ',').split(',').map(tag => tag.trim()).filter(tag => tag),
        // *** MODIFIED LINE END ***
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // MODIFIED: uploadedImageObjects now stores the full image objects
    let uploadedImageObjects = [];

    try {
        // Multi-image upload logic
        uploadStatus.textContent = `Uploading ${selectedImageFiles.length} image(s) to ImgBB...`;
        
        // The array is already correctly ordered by the user interaction
        const uploadPromises = selectedImageFiles.map(file => uploadImageToImgbb(file));
        uploadedImageObjects = await Promise.all(uploadPromises);
        
        // Store the array of image objects
        itemData.itemImageUrls = uploadedImageObjects;

        const docRef = await db.collection(itemsCollectionName).add(itemData);

        uploadStatus.textContent = "Item uploaded successfully!";
        uploadStatus.className = 'form-message success-message';
        
        // Navigate to the new item's page
        setTimeout(() => {
            window.location.href = `item-details.html?id=${docRef.id}`;
        }, 1000);

        // Reset form state (only if not navigating)
        // addItemForm.reset();
        // selectedImageFiles = [];
        // updateImagePreviews([]); // Clear previews

    } catch (e) {
        console.error(e);
        uploadStatus.textContent = `Upload failed: ${e.message}`;
        uploadStatus.className = 'form-message error-message';
    } finally {
        uploadButton.disabled = false;
    }
};

// --- 6. CSV Import (Modified to use modal) ---
function parseMfcCsv(csvText) {
    const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length) lines.shift(); // remove header
    const COL_TITLE = 1, COL_ROOT = 2, COL_CATEGORY = 3, COL_RELEASE_DATE = 4,
          COL_PRICE = 5, COL_SCALE = 6, COL_BARCODE = 7, COL_STATUS = 8, COL_COUNT = 9;

    return lines.map(line => {
        const values = line.substring(1, line.length - 1).split('","');
        if (values.length < COL_COUNT + 1) return null;

        const barcode = values[COL_BARCODE].trim();
        const docId = (barcode && barcode !== '0') 
            ? `IMP-${barcode}`
            : `IMPC-${values[COL_TITLE].trim().replace(/[^a-zA-Z0-9]/g,'').substring(0,15)}-${Math.random().toString(36).substring(2,8)}`;

        return {
            id: docId,
            data: {
                uploaderId: currentUserId,
                uploaderName: currentUserName,
                itemName: values[COL_TITLE].trim(),
                itemRoot: values[COL_ROOT].trim(),
                itemCategory: values[COL_CATEGORY].trim(),
                itemReleaseDate: values[COL_RELEASE_DATE].trim(),
                itemPrice: parseFloat(values[COL_PRICE].trim()) || 0,
                itemScale: values[COL_SCALE].trim(),
                itemStatus: values[COL_STATUS].trim(),
                itemCount: parseInt(values[COL_COUNT].trim()) || 1,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }
        };
    }).filter(Boolean);
}

async function batchUploadItems(items, itemsCollectionName, importStatusElement) {
    const BATCH_SIZE = 490;
    const VALID_STATUSES = ['Owned','Wished','Ordered'];
    const batchPromises = [];
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const userCollectionRef = db.collection('artifacts')
                                .doc(appId)
                                .collection('user_profiles')
                                .doc(currentUserId)
                                .collection('items');

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batchItems = items.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const item of batchItems) {
            const publicDocRef = db.collection(itemsCollectionName).doc(item.id);

            try {
                const docSnap = await publicDocRef.get();
                if (!docSnap.exists || docSnap.data().uploaderId === currentUserId) {
                    batch.set(publicDocRef, item.data);
                } else {
                    console.warn(`Skipping ${item.id}: not uploader`);
                }

                if (item.data.itemStatus && VALID_STATUSES.includes(item.data.itemStatus)) {
                    const linkDocRef = userCollectionRef.doc(item.id);
                    batch.set(linkDocRef, { 
                        itemId: item.id, 
                        status: item.data.itemStatus, 
                        linkedAt: firebase.firestore.FieldValue.serverTimestamp() 
                    });
                }
            } catch (err) {
                console.error(`Error processing item ${item.id}:`, err);
            }
        }

        batchPromises.push(batch.commit());
        importStatusElement.textContent = `Processing batch ${batchPromises.length}... Total items staged: ${Math.min(i + BATCH_SIZE, items.length)}`;
    }

    await Promise.all(batchPromises);
    return items.length;
}

if (importMfcBtn) {
    importMfcBtn.onclick = () => mfcImportFile.click();

    mfcImportFile.onchange = async (e) => {
        if (!auth.currentUser) {
            importStatus.textContent = "Error: Login required.";
            importStatus.className = 'form-message error-message';
            return;
        }

        const file = e.target.files[0];
        if (!file) return;

        importStatus.textContent = `Processing ${file.name}...`;
        importStatus.className = 'form-message';

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const csvText = event.target.result;
                importStatus.textContent = "Parsing CSV...";
                const items = parseMfcCsv(csvText);

                if (items.length === 0) {
                    importStatus.textContent = "No valid items found to import.";
                    importStatus.className = 'form-message info-message';
                    mfcImportFile.value = '';
                    return;
                }
                
                showConfirmationModal(
                    `Found ${items.length} valid items to import. Are you sure you want to perform this batch upload to the database?`,
                    async () => {
                        importStatus.textContent = `Uploading ${items.length} items...`;
                        try {
                            const count = await batchUploadItems(items, itemsCollectionName, importStatus);

                            importStatus.textContent = `Success! Uploaded ${count} items.`;
                            importStatus.className = 'form-message success-message';
                        } catch (err) {
                            console.error(err);
                            importStatus.textContent = `Import failed: ${err.message}`;
                            importStatus.className = 'form-message error-message';
                        } finally {
                            mfcImportFile.value = '';
                        }
                    },
                    `Import ${items.length} Items` 
                );

            } catch (err) {
                console.error(err);
                importStatus.textContent = `Import failed: ${err.message}`;
                importStatus.className = 'form-message error-message';
                mfcImportFile.value = '';
            }
        };

        reader.onerror = (err) => {
            console.error(err);
            importStatus.textContent = "Error reading file.";
            importStatus.className = 'form-message error-message';
            mfcImportFile.value = '';
        };

        reader.readAsText(file);
    };
}