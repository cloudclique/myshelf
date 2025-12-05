import { db, auth, storage } from "./firebase-config.js";

// DOM Elements
const gallery = document.getElementById("gallery");
const imageInput = document.getElementById("imageInput");
const uploadBtn = document.getElementById("uploadBtn");
const statusMessage = document.getElementById("statusMessage");
const loadMyBtn = document.getElementById("loadMyBtn");
const loadAllBtn = document.getElementById("loadAllBtn");
const shareIdContainer = document.getElementById("shareId");
const currentUserIdDisplay = document.getElementById("currentUserIdDisplay");
const copyIdBtn = document.getElementById("copyIdBtn");
const closeLightboxBtn = document.getElementById("closeLightboxBtn");
const lightbox = document.getElementById("lightbox");
const lightboxImg = lightbox.querySelector("img");

// --- NEW: Auth Button Reference ---
const authBtn = document.getElementById("authBtn"); 

// Create delete button in lightbox
const deleteBtn = document.createElement("button");
deleteBtn.textContent = "Delete Image";
deleteBtn.className = "absolute top-20 right-4 px-3 py-1 bg-red-600 text-white font-semibold rounded-lg shadow-lg hover:bg-red-700 transition duration-150 hidden";
lightbox.appendChild(deleteBtn);

// Track current user
let currentUser = null;
let currentImageDocId = null;
let currentImageUploaderId = null;

uploadBtn.disabled = true;
loadMyBtn.disabled = true;

// -------------------
// Utility Functions
// -------------------

function getUserIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('uid');
}

function updateUrl(userId) {
    const url = new URL(window.location.href);
    if (userId) {
        url.searchParams.set('uid', userId);
    } else {
        url.searchParams.delete('uid');
    }
    window.history.pushState({}, '', url);
}

// -------------------
// Auth check and setup
// -------------------
auth.onAuthStateChanged((user) => {
    currentUser = user;
    
    if (user) {
        uploadBtn.disabled = false;
        loadMyBtn.disabled = false;

        currentUserIdDisplay.textContent = user.uid;
        shareIdContainer.classList.remove('hidden');

        if(authBtn) {
            authBtn.textContent = "Logout";
            authBtn.onclick = () => {
                auth.signOut().then(() => {
                    window.location.reload();
                });
            };
        }

    } else {
        statusMessage.textContent = "You must be signed in to upload or filter by your images.";
        uploadBtn.disabled = true;
        loadMyBtn.disabled = true;
        shareIdContainer.classList.add('hidden');

        if(authBtn) {
            authBtn.textContent = "Login";
            authBtn.onclick = () => {
                window.location.href = 'login.html'; 
            };
        }
    }

    loadGallery(getUserIdFromUrl());
});


async function loadGallery(filterUserId = null) {
    gallery.innerHTML = '<p class="main-column">Loading images...</p>';
    statusMessage.textContent = "";

    const appId = "default-app-id"; 

    try {
        let queryRef = db
            .collection("artifacts")
            .doc(appId)
            .collection("gallery")
            .orderBy("createdAt", "desc");

        if (filterUserId) {
            queryRef = queryRef.where("uploaderId", "==", filterUserId);
            statusMessage.textContent = `uploaded by user ID: ${filterUserId}`;
            statusMessage.style.color = "#059669"; 
        } else {
            statusMessage.textContent = "Showing all community images.";
            statusMessage.style.color = "#4b5563"; 
        }

        const snapshot = await queryRef.get();
        gallery.innerHTML = ""; 

        if (snapshot.empty) {
            gallery.innerHTML = `<p class="text-center text-gray-500 p-10">No images found for this filter.</p>`;
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const img = document.createElement("img");
            img.src = data.url;
            img.alt = "Community Image";
            img.loading = "lazy";

            img.addEventListener("click", async () => {
                lightboxImg.src = data.url;
                lightbox.style.display = "flex";

                currentImageDocId = doc.id;
                currentImageUploaderId = data.uploaderId;

                let canDelete = false;

                if (currentUser) {
                    if (currentUser.uid === currentImageUploaderId) {
                        canDelete = true;
                    } 
                    
                    if (!canDelete) {
                        try {
                            const userProfileDoc = await db.collection('artifacts')
                                .doc(appId)
                                .collection('user_profiles')
                                .doc(currentUser.uid)
                                .get();
                            
                            if (userProfileDoc.exists) {
                                const userData = userProfileDoc.data();
                                const role = userData.role; 
                                if (role === 'admin' || role === 'mod') {
                                    canDelete = true;
                                }
                            }
                        } catch (roleErr) {
                            console.error("Error verifying user role:", roleErr);
                        }
                    }
                }
                deleteBtn.classList.toggle('hidden', !canDelete);
            });

            gallery.appendChild(img);
        });
    } catch (err) {
        console.error("Error loading gallery:", err);
        if (err.message.includes("index")) {
             const indexUrl = err.message.match(/https:\/\/[^\s]+/)[0];
             gallery.innerHTML = `<p class="text-center text-red-500 p-10"><strong>Missing Index:</strong> <a href="${indexUrl}" target="_blank" style="text-decoration:underline">Click here to create it.</a></p>`;
        } else {
             gallery.innerHTML = `<p class="text-center text-red-500 p-10">Error loading gallery: ${err.message}</p>`;
        }
    }
}

// -------------------
// Lightbox closing
// -------------------

closeLightboxBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    lightbox.style.display = "none";
    lightboxImg.src = "";
    deleteBtn.classList.add('hidden');
    currentImageDocId = null;
    currentImageUploaderId = null;
});

lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
        lightbox.style.display = "none";
        lightboxImg.src = "";
        deleteBtn.classList.add('hidden');
        currentImageDocId = null;
        currentImageUploaderId = null;
    }
});

// -------------------
// Delete Logic
// -------------------

deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!currentImageDocId) return;

    const confirmation = window.confirm("Are you sure you want to delete this image?");
    if (!confirmation) return;

    try {
        await db
            .collection("artifacts")
            .doc("default-app-id")
            .collection("gallery")
            .doc(currentImageDocId)
            .delete();

        statusMessage.textContent = "Image deleted successfully! Reloading gallery...";
        statusMessage.style.color = "green";

        lightbox.style.display = "none";
        loadGallery(getUserIdFromUrl());
    } catch (err) {
        console.error("Error deleting image:", err);
        statusMessage.textContent = "Error deleting image.";
        statusMessage.style.color = "red";
    }
});

// -------------------
// WEBP Converter
// -------------------

function convertToWebP(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();

        reader.onload = (e) => {
            img.src = e.target.result;
        };

        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);

            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject("WEBP conversion failed");
                },
                "image/webp",
                0.9
            );
        };

        img.onerror = reject;

        reader.readAsDataURL(file);
    });
}

// -------------------
// UPLOAD TO FIREBASE STORAGE (NEW)
// -------------------

uploadBtn.addEventListener("click", async () => {
    if (!currentUser) {
        statusMessage.textContent = "You must be signed in to upload images.";
        statusMessage.style.color = "red";
        return;
    }

    const file = imageInput.files[0];
    if (!file) {
        statusMessage.textContent = "Please select an image.";
        statusMessage.style.color = "red";
        return;
    }

    statusMessage.textContent = "Converting to WEBP...";
    statusMessage.style.color = "black";
    uploadBtn.disabled = true;

    try {
        const webpBlob = await convertToWebP(file);

        const storageRef = storage.ref();
        const fileRef = storageRef.child(
            `gallery/${currentUser.uid}/${Date.now()}.webp`
        );

        statusMessage.textContent = "Uploading to Firebase Storage...";

        await fileRef.put(webpBlob);

        const imageUrl = await fileRef.getDownloadURL();

        const firebaseGlobal = window.firebase;

        await db.collection("artifacts")
            .doc("default-app-id")
            .collection("gallery")
            .add({
                url: imageUrl,
                createdAt: firebaseGlobal.firestore.FieldValue.serverTimestamp(),
                uploaderId: currentUser.uid
            });

        statusMessage.textContent = "Upload successful!";
        statusMessage.style.color = "green";
        imageInput.value = "";

        loadGallery(getUserIdFromUrl());

    } catch (err) {
        console.error(err);
        statusMessage.textContent = "Error uploading image.";
        statusMessage.style.color = "red";
    } finally {
        uploadBtn.disabled = false;
    }
});
