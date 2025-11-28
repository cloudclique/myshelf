import { db, auth } from "./firebase-config.js";

// DOM Elements
const gallery = document.getElementById("gallery");
const imageInput = document.getElementById("imageInput");
const uploadBtn = document.getElementById("uploadBtn");
const statusMessage = document.getElementById("statusMessage");
const loadMyBtn = document.getElementById("loadMyBtn");
const loadAllBtn = document.getElementById("loadAllBtn");
const shareIdContainer = document.getElementById("shareId");
const copyIdBtn = document.getElementById("copyIdBtn");
const closeLightboxBtn = document.getElementById("closeLightboxBtn");
const lightbox = document.getElementById("lightbox");
const lightboxImg = lightbox.querySelector("img");
const headerTools = document.getElementById('headerTools');

// Create delete button inside lightbox
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
// Helpers
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
// Convert file → WebP → Base64
// --------------------------------------------------

async function fileToWebPBase64(file, quality = 0.8) {
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

                const webpDataUrl = canvas.toDataURL("image/webp", quality);
                resolve(webpDataUrl.split(",")[1]);
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
            gallery.innerHTML = `<p class="text-center text-gray-500 p-10">No images found for this filter.</p>`;
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
                        const userDoc = await db.collection('artifacts')
                            .doc(appId)
                            .collection('user_profiles')
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
// Upload Image
// --------------------------------------------------

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

    statusMessage.textContent = "Converting to WebP...";
    uploadBtn.disabled = true;

    try {
        const base64 = await fileToWebPBase64(file);

        statusMessage.textContent = "Uploading to server...";

        const response = await fetch("/.netlify/functions/upload-imgbb", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64Image: base64 })
        });

        const data = await response.json();
        if (!data.url) throw new Error("Upload failed");

        const firebaseGlobal = window.firebase;

        await db.collection("artifacts")
            .doc("default-app-id")
            .collection("gallery")
            .add({
                url: data.url,
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
        statusMessage.textContent = "Deletion error.";
        statusMessage.style.color = "red";
    }
});

// Lightbox
closeLightboxBtn.addEventListener("click", () => {
    lightbox.style.display = "none";
    lightboxImg.src = "";
    deleteBtn.classList.add("hidden");
});
lightbox.addEventListener("click", e => {
    if (e.target === lightbox) {
        lightbox.style.display = "none";
        lightboxImg.src = "";
        deleteBtn.classList.add("hidden");
    }
});

// Buttons
loadAllBtn.addEventListener("click", () => { updateUrl(null); loadGallery(); });
loadMyBtn.addEventListener("click", () => {
    if (!currentUser) {
        statusMessage.textContent = "Please sign in.";
        statusMessage.style.color = "red";
        return;
    }
    updateUrl(currentUser.uid);
    loadGallery(currentUser.uid);
});
