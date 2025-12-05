import { db, auth, storage } from "./firebase-config.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js";

// DOM Elements
const gallery = document.getElementById("gallery");
const imageInput = document.getElementById("imageInput");
const uploadBtn = document.getElementById("uploadBtn");
const statusMessage = document.getElementById("statusMessage");
const loadMyBtn = document.getElementById("loadMyBtn");
const loadAllBtn = document.getElementById("loadAllBtn");
const closeLightboxBtn = document.getElementById("closeLightboxBtn");
const lightbox = document.getElementById("lightbox");
const lightboxImg = lightbox.querySelector("img");
const headerTools = document.getElementById('headerTools');

// Delete button inside lightbox
const deleteBtn = document.createElement("button");
deleteBtn.textContent = "Delete Image";
deleteBtn.className = "absolute top-20 right-4 px-3 py-1 bg-red-600 text-white font-semibold rounded-lg shadow-lg hover:bg-red-700 transition hidden";
lightbox.appendChild(deleteBtn);

let currentUserId = null;
let currentUser = null;
let currentImageDocId = null;
let currentImageUploaderId = null;

uploadBtn.disabled = true;
loadMyBtn.disabled = true;

// --------------------------------------------------
// URL Helpers
// --------------------------------------------------

function getUserIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('uid');
}

function updateUrl(userId) {
    const url = new URL(window.location.href);
    if (userId) url.searchParams.set('uid', userId);
    else url.searchParams.delete('uid');
    window.history.pushState({}, '', url);
}

// --------------------------------------------------
// Convert file → WebP Blob
// --------------------------------------------------

async function fileToWebPBlob(file, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);

                canvas.toBlob(
                    (blob) => resolve(blob),
                    "image/webp",
                    quality
                );
            };

            img.onerror = reject;
            img.src = reader.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// --------------------------------------------------
// Auth Handling
// --------------------------------------------------

auth.onAuthStateChanged((user) => {
    currentUser = user;
    headerTools.innerHTML = "";

    if (user) {
        uploadBtn.disabled = false;
        loadMyBtn.disabled = false;
        currentUserId = user.uid;

        headerTools.innerHTML = `<button id="logoutBtn" class="logout-btn">Logout</button>`;
        document.getElementById("logoutBtn").onclick = () => auth.signOut();

    } else {
        uploadBtn.disabled = true;
        loadMyBtn.disabled = true;

        currentUserId = null;
        headerTools.innerHTML = `<button onclick="window.location.href='../login/'" class="login-btn">Login / Signup</button>`;
    }

    loadGallery(getUserIdFromUrl());
});

// --------------------------------------------------
// Load Gallery
// --------------------------------------------------

async function loadGallery(filterUserId = null) {
    gallery.innerHTML = '<p class="main-column">Loading images...</p>';
    statusMessage.textContent = "";

    const appId = "default-app-id";

    try {
        let queryRef = db.collection("artifacts")
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
            gallery.innerHTML = `<p class="text-center text-gray-500 p-10">No images found.</p>`;
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const img = document.createElement("img");
            img.src = data.url;
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
                        const userDoc = await db.collection("artifacts")
                            .doc(appId)
                            .collection("user_profiles")
                            .doc(currentUser.uid)
                            .get();

                        if (userDoc.exists && ["admin", "mod"].includes(userDoc.data().role)) {
                            canDelete = true;
                        }
                    }
                }

                deleteBtn.classList.toggle("hidden", !canDelete);
            });

            gallery.appendChild(img);
        });

    } catch (err) {
        console.error("Gallery error:", err);
        gallery.innerHTML = `<p class="text-center text-red-500 p-10">Error: ${err.message}</p>`;
    }
}

// --------------------------------------------------
// UPLOAD IMAGE (Now using Firebase Storage)
// --------------------------------------------------

uploadBtn.addEventListener("click", async () => {
    if (!currentUser) {
        statusMessage.textContent = "Please sign in.";
        statusMessage.style.color = "red";
        return;
    }

    const file = imageInput.files[0];
    if (!file) {
        statusMessage.textContent = "Please select an image.";
        statusMessage.style.color = "red";
        return;
    }

    statusMessage.textContent = "Converting to WebP...";
    uploadBtn.disabled = true;

    try {
        // Convert to WebP
        const webpBlob = await fileToWebPBlob(file);

        statusMessage.textContent = "Uploading image...";

        // Upload to Firebase Storage
        const filename = `gallery/${currentUser.uid}_${Date.now()}.webp`;
        const fileRef = ref(storage, filename);

        await uploadBytes(fileRef, webpBlob);

        // Get the download URL
        const downloadUrl = await getDownloadURL(fileRef);

        // Save to Firestore
        await db.collection("artifacts")
            .doc("default-app-id")
            .collection("gallery")
            .add({
                url: downloadUrl,
                uploaderId: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            });

        statusMessage.textContent = "Upload complete!";
        statusMessage.style.color = "green";

        imageInput.value = "";
        loadGallery(getUserIdFromUrl());

    } catch (err) {
        console.error(err);
        statusMessage.textContent = "Upload failed.";
        statusMessage.style.color = "red";
    }

    uploadBtn.disabled = false;
});

// --------------------------------------------------
// Delete Image
// --------------------------------------------------

deleteBtn.addEventListener("click", async () => {
    if (!currentImageDocId) return;

    if (!confirm("Delete this image?")) return;

    try {
        await db.collection("artifacts")
            .doc("default-app-id")
            .collection("gallery")
            .doc(currentImageDocId)
            .delete();

        statusMessage.textContent = "Image deleted.";
        statusMessage.style.color = "green";

        lightbox.style.display = "none";
        loadGallery(getUserIdFromUrl());

    } catch (err) {
        statusMessage.textContent = "Deletion failed.";
        statusMessage.style.color = "red";
    }
});

// --------------------------------------------------
// Lightbox Logic
// --------------------------------------------------

closeLightboxBtn.addEventListener("click", () => {
    lightbox.style.display = "none";
    lightboxImg.src = "";
    deleteBtn.classList.add("hidden");
});

lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
        lightbox.style.display = "none";
        lightboxImg.src = "";
        deleteBtn.classList.add("hidden");
    }
});

// --------------------------------------------------
// Filter buttons
// --------------------------------------------------

loadAllBtn.addEventListener("click", () => {
    updateUrl(null);
    loadGallery();
});

loadMyBtn.addEventListener("click", () => {
    if (!currentUser) {
        statusMessage.textContent = "Please sign in.";
        statusMessage.style.color = "red";
        return;
    }
    updateUrl(currentUser.uid);
    loadGallery(currentUser.uid);
});
