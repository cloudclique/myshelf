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

// --- NEW: Auth Button Reference ---
const authBtn = document.getElementById("authBtn"); 

// Create delete button in lightbox
const deleteBtn = document.createElement("button");
deleteBtn.textContent = "Delete Image";
deleteBtn.className = "absolute top-20 right-4 px-3 py-1 bg-red-600 text-white font-semibold rounded-lg shadow-lg hover:bg-red-700 transition duration-150 hidden";
lightbox.appendChild(deleteBtn);

// Track current user
let currentUserId = null;
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
    headerTools.innerHTML = '';
    
    if (user) {
        // --- USER IS LOGGED IN ---
        uploadBtn.disabled = false;
        loadMyBtn.disabled = false;
        
        // Display user ID for sharing
        currentUserId = user.uid;
        headerTools.innerHTML = `<button id="logoutBtn" class="logout-btn">Logout</button>`;
        document.getElementById('logoutBtn').onclick = () => auth.signOut();

    } else {
        // --- USER IS LOGGED OUT ---
        uploadBtn.disabled = true;
        loadMyBtn.disabled = true;

        currentUserId = null;
        headerTools.innerHTML = `<button onclick="window.location.href='../login/'" class="login-btn">Login / Signup</button>`;
    }

    // Load gallery after auth state is determined
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
                    // 1. Check Owner
                    if (currentUser.uid === currentImageUploaderId) {
                        canDelete = true;
                    } 
                    
                    // 2. Check Admin/Mod
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
// Event Listeners
// -------------------

loadAllBtn.addEventListener("click", () => {
    updateUrl(null);
    loadGallery();
});

loadMyBtn.addEventListener("click", () => {
    if (!currentUser) {
        statusMessage.textContent = "Please sign in to view only your images.";
        statusMessage.style.color = "red";
        return;
    }
    updateUrl(currentUser.uid);
    loadGallery(currentUser.uid);
});

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
// Upload Logic
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

    statusMessage.textContent = "Uploading...";
    statusMessage.style.color = "black";
    uploadBtn.disabled = true;

    try {
        const formData = new FormData();
        formData.append("image", file);

        const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
            method: "POST",
            body: formData
        });

        const data = await response.json();
        if (!data.success) throw new Error("ImgBB upload failed");

        const imageUrl = data.data.url;
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
