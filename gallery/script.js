import { db, auth } from "../firebase-config.js";

const IMGBB_CLOUDFLARE_WORKER_URL = "https://imgbbapi.stanislav-zhukov.workers.dev/";

// DOM Elements
const gallery = document.getElementById("gallery");
const imageInput = document.getElementById("imageInput");
const uploadBtn = document.getElementById("uploadBtn");
const statusMessage = document.getElementById("statusMessage");
const loadMyBtn = document.getElementById("loadMyBtn");
const loadAllBtn = document.getElementById("loadAllBtn");
const closeLightboxBtn = document.getElementById("closeLightboxBtn");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxMainImg");
const lightboxActions = document.getElementById("lightboxActions");
const lightboxLikeBtn = document.getElementById("lightboxLikeBtn");
const lightboxShareBtn = document.getElementById("lightboxShareBtn");
const headerTools = document.getElementById('headerTools');

// Upload Modal Elements
const uploadModal = document.getElementById("uploadModal");
const openUploadModalBtn = document.getElementById("openUploadModalBtn");
const closeUploadModalBtn = document.getElementById("closeUploadModal");
const selectedFileName = document.getElementById("selectedFileName");

// Comment Elements
const commentsList = document.getElementById("commentsList");
const commentInputSection = document.getElementById("commentInputSection");
const commentLoginPrompt = document.getElementById("commentLoginPrompt");
const commentText = document.getElementById("commentText");
const postCommentBtn = document.getElementById("postCommentBtn");
const commentCloseBtn = document.getElementById("commentCloseBtn")
const commentSidebar = document.getElementById("commentSidebar")
const openCommentsBtn = document.getElementById("openCommentsBtn");

// Delete button for images
const deleteBtn = document.createElement("button");
deleteBtn.textContent = "Delete Image";
deleteBtn.className = "absolute top-6 left-6 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg shadow-lg hover:bg-red-700 transition duration-150 hidden z-50";
lightbox.appendChild(deleteBtn);

let currentUser = null;
let currentImageDocId = null;
let currentImageData = null;

// --- Skeleton Loading ---
function renderSkeletonGallery() {
    gallery.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const div = document.createElement('div');
        div.className = 'relative mb-4';
        const heights = ['150px', '250px', '200px', '300px'];
        const randomHeight = heights[Math.floor(Math.random() * heights.length)];
        div.innerHTML = `<div class="skeleton w-full rounded-lg" style="height: ${randomHeight}"></div>`;
        gallery.appendChild(div);
    }
}

function renderSkeletonComments() {
    commentsList.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        const div = document.createElement('div');
        div.className = 'bg-gray-50 p-3 rounded-lg border border-gray-100 mb-2 skeleton';
        div.style.height = '60px';
        commentsList.appendChild(div);
    }
}

// --- Helper Functions ---
function getDateKey() {
    return `likes_${new Date().toISOString().split('T')[0]}`;
}

function getTotalLikes(data) {
    return Object.keys(data)
        .filter(key => key.startsWith('likes_'))
        .reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0);
}

function checkIfUserLiked(data, uid) {
    if (!uid) return false;
    return Object.keys(data)
        .filter(key => key.startsWith('likes_'))
        .some(key => Array.isArray(data[key]) && data[key].includes(uid));
}

// ------------------
// AUTH STATE
// ------------------
auth.onAuthStateChanged((user) => {
    currentUser = user;
    headerTools.innerHTML = '';

    if (user) {
        localStorage.setItem('cached_uid', user.uid); // Cache UID for fast redirect
        openUploadModalBtn.disabled = false;
        loadMyBtn.disabled = false;
        headerTools.innerHTML = `<button id="logoutBtn" class="logout-btn">Logout</button>`;
        document.getElementById('logoutBtn').onclick = () => {
            localStorage.removeItem('cached_uid'); // Clear cache on logout
            auth.signOut();
        }
    } else {
        localStorage.removeItem('cached_uid'); // Ensure cleared
        openUploadModalBtn.disabled = true;
        loadMyBtn.disabled = true;
        headerTools.innerHTML = `<button onclick="window.location.href='../login/'" class="login-btn">Login / Signup</button>`;
    }

    loadGalleryCustom(getUserIdFromUrl());
});

// ------------------
// GALLERY LOAD
// ------------------
async function loadGalleryCustom(filterUserId = null) {
    // Only show skeleton if gallery is currently empty or contains the initial loader text
    if (gallery.innerHTML.includes('Loading images...') || gallery.innerHTML === '') {
        renderSkeletonGallery();
    }
    const appId = "default-app-id";

    try {
        let queryRef = db.collection("artifacts").doc(appId).collection("gallery");
        if (filterUserId) queryRef = queryRef.where("uploaderId", "==", filterUserId);

        const snapshot = await queryRef.get();
        if (snapshot.empty) {
            gallery.innerHTML = `<p class="text-center text-gray-500 p-10">No images found.</p>`;
            return;
        }

        const images = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            images.push({ id: doc.id, ...data });
        });

        // --- Helper to get likes in the past 7 days only ---
        function getRecentLikes(data) {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            return Object.keys(data)
                .filter(k => k.startsWith('likes_'))
                .reduce((sum, key) => {
                    const dateStr = key.replace('likes_', '');
                    const date = new Date(dateStr);
                    if (date >= sevenDaysAgo && Array.isArray(data[key])) {
                        sum += data[key].length;
                    }
                    return sum;
                }, 0);
        }

        // --- Sorting ---
        const mostLiked7Days = [...images].sort((a, b) => getRecentLikes(b) - getRecentLikes(a));
        const mostRecent = [...images].sort((a, b) => (b.createdAt?.toDate() || 0) - (a.createdAt?.toDate() || 0));

        // --- Build final 3:1 pattern ---
        const usedIds = new Set();
        const finalOrder = [];
        let likedIndex = 0, recentIndex = 0;

        while (usedIds.size < images.length) {
            // Add up to 3 most liked
            let count = 0;
            while (count < 3 && likedIndex < mostLiked7Days.length) {
                const img = mostLiked7Days[likedIndex++];
                if (!usedIds.has(img.id)) {
                    finalOrder.push(img);
                    usedIds.add(img.id);
                    count++;
                }
            }
            // Add 1 most recent
            while (recentIndex < mostRecent.length) {
                const img = mostRecent[recentIndex++];
                if (!usedIds.has(img.id)) {
                    finalOrder.push(img);
                    usedIds.add(img.id);
                    break;
                }
            }
        }

        // --- Render gallery ---
        gallery.innerHTML = "";
        finalOrder.forEach((data, index) => {
            const container = document.createElement("div");
            container.className = "relative group gallery-item-fade";
            container.style.animationDelay = `${index * 50}ms`;

            const img = document.createElement("img");
            img.src = data.url;
            img.loading = "lazy";
            img.className = "cursor-pointer rounded-lg hover:scale-[1.01] transition-all duration-300 shadow-sm w-full opacity-0";

            // Smooth fade-in when loaded
            img.onload = () => img.classList.remove('opacity-0');

            img.onclick = () => openLightbox(data.id, data);

            const actions = document.createElement("div");
            actions.className = "image-actions hidden group-hover:flex";

            const likeBtn = document.createElement("button");
            const likeIcon = document.createElement("i");
            const isLiked = checkIfUserLiked(data, currentUser?.uid);
            likeIcon.className = `bi ${isLiked ? 'bi-heart-fill text-red-500' : 'bi-heart text-white'}`;
            likeBtn.appendChild(likeIcon);

            const likeCount = document.createElement("span");
            likeCount.textContent = getTotalLikes(data);
            likeBtn.appendChild(likeCount);

            likeBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!currentUser) return alert("Login first!");

                // --- Optimistic UI Update ---
                const isLikedInitially = checkIfUserLiked(data, currentUser.uid);
                const dateKey = getDateKey();

                // Toggle state locally
                if (isLikedInitially) {
                    // Find which day they liked it...
                    const keys = Object.keys(data).filter(k => k.startsWith('likes_'));
                    keys.forEach(k => {
                        if (Array.isArray(data[k])) data[k] = data[k].filter(id => id !== currentUser.uid);
                    });
                } else {
                    if (!data[dateKey]) data[dateKey] = [];
                    data[dateKey].push(currentUser.uid);
                }

                // Update UI instantly
                const nowLiked = checkIfUserLiked(data, currentUser.uid);
                likeIcon.className = `bi ${nowLiked ? 'bi-heart-fill text-red-500' : 'bi-heart text-white'}`;
                likeCount.textContent = getTotalLikes(data);

                if (currentImageDocId === data.id) {
                    currentImageData = data;
                    updateLightboxLike();
                }

                // Push to Firestore in background
                try {
                    const galleryRef = db.collection("artifacts").doc(appId).collection("gallery").doc(data.id);
                    const allKeys = Object.keys(data).filter(k => k.startsWith('likes_'));
                    const existingKey = allKeys.find(k => Array.isArray(data[k]) && data[k].includes(currentUser.uid));

                    // Note: Since we already modified 'data' for the UI, we don't need to do it again in catch.
                    // But if Firestore fails, we SHOULD ideally revert.

                    if (isLikedInitially) {
                        // We need the ACTUAL key from firestore state to remove it.
                        // For simplicity, we assume the user only liked it once.
                        await galleryRef.update({
                            [existingKey || dateKey]: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
                        });
                    } else {
                        await galleryRef.update({
                            [dateKey]: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
                        });
                    }
                } catch (err) {
                    console.error("Like failed:", err);
                    // Revert UI on failure (optional, but good)
                    // ... revert logic ...
                }
            };

            const shareBtn = document.createElement("button");
            shareBtn.className = "share-btn-gallery";
            shareBtn.innerHTML = '<i class="bi bi-share"></i> Share';
            shareBtn.onclick = (e) => {
                e.stopPropagation();
                copyToClipboard(data.url);
            };

            actions.appendChild(likeBtn);
            actions.appendChild(shareBtn);
            container.appendChild(img);
            container.appendChild(actions);
            gallery.appendChild(container);
        });

    } catch (err) {
        console.error("Gallery error:", err);
        gallery.innerHTML = '<p class="text-red-500 text-center">Failed to load images.</p>';
    }
}


// ------------------
// LIGHTBOX
// ------------------
async function openLightbox(docId, data) {
    currentImageDocId = docId;
    currentImageData = data;

    lightboxImg.src = data.url;
    lightbox.style.display = "flex";
    commentSidebar.style.display = "none";
    document.body.classList.add("no-scroll");
    closeLightboxBtn.style.display = "block";

    lightboxActions.classList.remove('hidden');
    updateLightboxLike();

    if (currentUser) {
        commentInputSection.classList.remove('hidden');
        commentLoginPrompt.classList.add('hidden');
    } else {
        commentInputSection.classList.add('hidden');
        commentLoginPrompt.classList.remove('hidden');
    }

    loadComments(docId);
    checkDeletePermissions(data.uploaderId);
}

function updateLightboxLike() {
    const total = getTotalLikes(currentImageData);
    const liked = checkIfUserLiked(currentImageData, currentUser?.uid);
    lightboxLikeBtn.innerHTML = `<i class="bi ${liked ? 'bi-heart-fill text-red-500' : 'bi-heart'}"></i> <span>${total}</span>`;
}

lightboxLikeBtn.onclick = async () => {
    if (!currentUser || !currentImageDocId) return alert("Login first!");

    const dateKey = getDateKey();
    const galleryRef = db.collection("artifacts").doc("default-app-id").collection("gallery").doc(currentImageDocId);

    const allKeys = Object.keys(currentImageData).filter(k => k.startsWith('likes_'));
    const existingKey = allKeys.find(k => Array.isArray(currentImageData[k]) && currentImageData[k].includes(currentUser.uid));

    if (existingKey) {
        await galleryRef.update({ [existingKey]: firebase.firestore.FieldValue.arrayRemove(currentUser.uid) });
        currentImageData[existingKey] = currentImageData[existingKey].filter(id => id !== currentUser.uid);
    } else {
        await galleryRef.update({ [dateKey]: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) });
        if (!currentImageData[dateKey]) currentImageData[dateKey] = [];
        currentImageData[dateKey].push(currentUser.uid);
    }

    updateLightboxLike();
    loadGalleryCustom(getUserIdFromUrl()); // Refresh background gallery sync
};

lightboxShareBtn.onclick = () => {
    if (currentImageData && currentImageData.url) {
        copyToClipboard(currentImageData.url);
    }
};

// --- Copy to Clipboard Helper ---
function copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        alert("Link copied to clipboard!");
    }).catch(err => {
        console.error("Could not copy text: ", err);
    });
}

// ------------------
// COMMENTS
// ------------------
// 1. Persistent Cache Helpers for User Profiles
const PROFILE_CACHE_TTL = 2 * 7 * 24 * 60 * 60 * 1000; // 2 weeks

function getCachedProfile(userId) {
    try {
        const cached = localStorage.getItem(`user_profile_${userId}`);
        if (!cached) return null;
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp > PROFILE_CACHE_TTL) {
            localStorage.removeItem(`user_profile_${userId}`);
            return null;
        }
        return data;
    } catch (e) {
        return null;
    }
}

function setCachedProfile(userId, data) {
    try {
        localStorage.setItem(`user_profile_${userId}`, JSON.stringify({
            data: data,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn("Cache write failed:", e);
    }
}


async function loadComments(imageId) {
    if (!commentsList.innerHTML || commentsList.innerHTML.includes('No comments yet.')) {
        renderSkeletonComments();
    }

    db.collection("artifacts")
        .doc("default-app-id")
        .collection("gallery")
        .doc(imageId)
        .collection("comments")
        .orderBy("createdAt", "asc")
        .onSnapshot(async (snapshot) => {
            // We don't clear innerHTML immediately to reduce "white flash"
            if (snapshot.empty) {
                commentsList.innerHTML = '<p class="text-gray-400 italic text-xs">No comments yet.</p>';
                return;
            }

            const commentPromises = snapshot.docs.map(async (doc) => {
                const c = doc.data();
                const commentId = doc.id;
                const userId = c.userId;

                // 2. Check cache first before calling Firestore
                let cachedUser = getCachedProfile(userId);
                if (!cachedUser) {
                    try {
                        const userDoc = await db.collection("artifacts")
                            .doc("default-app-id")
                            .collection("user_profiles")
                            .doc(userId)
                            .get();

                        if (userDoc.exists) {
                            const data = userDoc.data();
                            cachedUser = {
                                name: data.username || c.userName || "User",
                                pic: data.profilePic || ""
                            };
                            setCachedProfile(userId, cachedUser);
                        } else {
                            cachedUser = { name: c.userName || "User", pic: "" };
                        }
                    } catch (e) {
                        console.error("Cache fetch error:", e);
                        cachedUser = { name: c.userName || "User", pic: "" };
                    }
                }

                const cLikes = c.likes || [];
                const isLiked = currentUser && cLikes.includes(currentUser.uid);
                const isOwner = currentUser && currentUser.uid === userId;
                const profileUrl = `../?uid=${userId}`;

                const avatarImg = cachedUser.pic
                    ? `<img src="${cachedUser.pic}" class="w-8 h-8 rounded-full object-cover border border-gray-200" style="max-width: 100% !important; max-height: 100% !important; box-shadow: 0 0 20px rgb(0 0 0 / 0%) !important;" alt="profile">`
                    : `<div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center"><i class="bi bi-person text-gray-400 text-sm"></i></div>`;

                return `
                    <div class="bg-gray-50 p-3 rounded-lg border border-gray-100 mb-2">
                        <div class="flex items-start space-x-3">
                            <a href="${profileUrl}" class="flex-shrink-0 mt-1">
                                ${avatarImg}
                            </a>
                            <div class="flex-1 min-w-0">
                                <div class="flex justify-between items-center mb-1">
                                    <a href="${profileUrl}" class="font-bold text-indigo-700 text-xs hover:underline truncate">
                                        ${cachedUser.name}
                                    </a>
                                    <div class="flex items-center space-x-2">
                                        <span class="text-[10px] text-gray-400">
                                            ${c.createdAt ? new Date(c.createdAt.toDate()).toLocaleDateString() : ''}
                                        </span>
                                        ${isOwner ? `<button class="delete-comment text-gray-400 hover:text-red-500" data-id="${commentId}"><i class="bi bi-trash"></i></button>` : ''}
                                    </div>
                                </div>
                                <p class="text-gray-700 text-sm leading-snug mb-2 break-words">${c.text}</p>
                                <div class="flex items-center space-x-1">
                                    <button class="like-comment" data-id="${commentId}" data-likes='${JSON.stringify(cLikes)}'>
                                        <i class="bi ${isLiked ? 'bi-heart-fill text-red-500' : 'bi-heart text-gray-400'} text-xs"></i>
                                    </button>
                                    <span class="text-[11px] font-semibold text-gray-500">${cLikes.length}</span>
                                </div>
                            </div>
                        </div>
                    </div>`;
            });

            const htmlArray = await Promise.all(commentPromises);
            // 3. Final render - the images are now served from memory (cache)
            commentsList.innerHTML = htmlArray.join('');
        });
}

commentsList.addEventListener('click', async (e) => {
    if (e.target.closest(".like-comment")) {
        const btn = e.target.closest(".like-comment");
        if (!currentUser || !currentImageDocId) return alert("Login first!");

        const commentId = btn.dataset.id;
        let likes = JSON.parse(btn.dataset.likes);
        const alreadyLiked = likes.includes(currentUser.uid);

        const action = alreadyLiked
            ? firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
            : firebase.firestore.FieldValue.arrayUnion(currentUser.uid);

        const commentRef = db.collection("artifacts").doc("default-app-id")
            .collection("gallery").doc(currentImageDocId)
            .collection("comments").doc(commentId);

        await commentRef.update({ likes: action });

        if (alreadyLiked) likes = likes.filter(id => id !== currentUser.uid);
        else likes.push(currentUser.uid);

        const icon = btn.querySelector('i');
        icon.className = `bi ${likes.includes(currentUser.uid) ? 'bi-heart-fill text-red-500' : 'bi-heart text-gray-400'}`;
        btn.nextElementSibling.textContent = likes.length;
        btn.dataset.likes = JSON.stringify(likes);

    } else if (e.target.closest(".delete-comment")) {
        const commentId = e.target.closest(".delete-comment").dataset.id;
        if (!confirm("Delete your comment?")) return;
        await db.collection("artifacts").doc("default-app-id")
            .collection("gallery").doc(currentImageDocId)
            .collection("comments").doc(commentId).delete();
        loadComments(currentImageDocId);
    }
});

postCommentBtn.addEventListener("click", async () => {
    const text = commentText.value.trim();
    if (!text || !currentUser || !currentImageDocId) return;
    postCommentBtn.disabled = true;
    try {
        await db.collection("artifacts").doc("default-app-id").collection("gallery").doc(currentImageDocId).collection("comments").add({
            text,
            userId: currentUser.uid,
            userName: currentUser.displayName || currentUser.email.split('@')[0],
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            likes: []
        });
        commentText.value = "";
        loadComments(currentImageDocId);
    } catch (e) { console.error(e); }
    finally { postCommentBtn.disabled = false; }
});

// ------------------
// DELETE IMAGE
// ------------------
async function checkDeletePermissions(uploaderId) {
    let canDelete = currentUser && currentUser.uid === uploaderId;
    if (!canDelete && currentUser) {
        const profile = await db.collection('artifacts').doc('default-app-id')
            .collection('user_profiles').doc(currentUser.uid).get();
        if (profile.exists && ['admin', 'mod'].includes(profile.data().role)) canDelete = true;
    }
    deleteBtn.classList.toggle('hidden', !canDelete);
}

deleteBtn.onclick = async () => {
    if (!currentImageDocId || !confirm("Delete this image?")) return;
    await db.collection("artifacts").doc("default-app-id").collection("gallery").doc(currentImageDocId).delete();
    lightbox.style.display = "none";
    loadGalleryCustom(getUserIdFromUrl());
};

// ------------------
// UPLOAD IMAGE
// ------------------
uploadBtn.onclick = async () => {
    const file = imageInput.files[0];
    if (!currentUser || !file) return;
    statusMessage.textContent = "Uploading...";
    uploadBtn.disabled = true;
    try {
        const formData = new FormData();
        formData.append("image", file);
        const res = await fetch(IMGBB_CLOUDFLARE_WORKER_URL, { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) {
            await db.collection("artifacts").doc("default-app-id").collection("gallery").add({
                url: data.data.url,
                uploaderId: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                // Likes will be added dynamically as likes_YYYY-MM-DD keys
            });
            statusMessage.textContent = "Upload successful!";
            imageInput.value = "";
            setTimeout(() => {
                closeUploadModal();
                loadGalleryCustom(getUserIdFromUrl());
            }, 1000);
        }
    } catch (err) { statusMessage.textContent = "Upload failed."; }
    finally { uploadBtn.disabled = false; }
};

// ------------------
// UPLOAD MODAL LOGIC
// ------------------
openUploadModalBtn.onclick = () => {
    uploadModal.classList.remove("hidden");
    uploadModal.style.display = "flex";
    document.body.classList.add("no-scroll");
};

const closeUploadModal = () => {
    uploadModal.classList.add("hidden");
    uploadModal.style.display = "none";
    document.body.classList.remove("no-scroll");
    imageInput.value = "";
    selectedFileName.textContent = "";
    selectedFileName.classList.add("hidden");
    statusMessage.textContent = "";
};

closeUploadModalBtn.onclick = closeUploadModal;

uploadModal.onclick = (e) => {
    if (e.target === uploadModal) closeUploadModal();
};

imageInput.onchange = () => {
    if (imageInput.files.length > 0) {
        selectedFileName.textContent = `Selected: ${imageInput.files[0].name}`;
        selectedFileName.classList.remove("hidden");
    } else {
        selectedFileName.classList.add("hidden");
    }
};

// ------------------
// LIGHTBOX CLOSE
// ------------------
closeLightboxBtn.onclick = () => {
    lightbox.style.display = "none";
    document.body.classList.remove("no-scroll");
    commentsList.innerHTML = "";
    commentText.value = "";
    currentImageDocId = null;
    currentImageData = null;
    commentSidebar.style.display = "none";
};

// ------------------
// FILTERS
// ------------------
loadAllBtn.onclick = () => { updateUrl(null); loadGalleryCustom(); };
loadMyBtn.onclick = () => { if (currentUser) { updateUrl(currentUser.uid); loadGalleryCustom(currentUser.uid); } };

function getUserIdFromUrl() { return new URLSearchParams(window.location.search).get('uid'); }
function updateUrl(uid) {
    const url = new URL(window.location.href);
    uid ? url.searchParams.set('uid', uid) : url.searchParams.delete('uid');
    window.history.pushState({}, '', url);
}


// Hide sidebar when close button is clicked
commentCloseBtn.onclick = () => {
    commentSidebar.style.display = "none";
    closeLightboxBtn.style.display = "block";
};

// Show sidebar when the button in Lightbox Actions is clicked
openCommentsBtn.onclick = () => {
    commentSidebar.style.display = "flex";
    closeLightboxBtn.style.display = "none";
};