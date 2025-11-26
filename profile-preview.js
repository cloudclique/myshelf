import { auth, db } from './firebase-config.js';

const profilePreviewContainer = document.getElementById('profilePreview');
const PREVIEW_LIMIT = 4;

function getUserIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('uid');
}

async function loadProfilePreview() {
    const userId = getUserIdFromUrl();
    if (!userId || !profilePreviewContainer) return;

    const appId = 'default-app-id';
    const galleryRef = db.collection('artifacts').doc(appId).collection('gallery');

    try {
        const snapshot = await galleryRef
            .where('uploaderId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(PREVIEW_LIMIT)
            .get();

        if (snapshot.empty) {
            profilePreviewContainer.innerHTML = '<p>No images yet.</p>';
            return;
        }

        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Render images
        profilePreviewContainer.innerHTML = '';
        items.forEach(item => {
            const img = document.createElement('img');
            img.src = item.url;
            img.className = 'preview-img';
            img.loading = 'lazy';
            img.onclick = () => openLightbox(item);
            profilePreviewContainer.appendChild(img);
        });

        // View More button
        const btn = document.createElement('button');
        btn.textContent = 'View More';
        btn.className = 'action-btn';
        btn.onclick = () => window.location.href = `index.html?uid=${userId}`;
        profilePreviewContainer.appendChild(btn);

    } catch (err) {
        console.error("Failed to load gallery preview:", err);
        profilePreviewContainer.innerHTML = `<p>Error loading images.</p>`;
    }
}

// Simple lightbox
function openLightbox(item) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.onclick = () => document.body.removeChild(overlay);

    const img = document.createElement('img');
    img.src = item.url;
    img.className = 'lightbox-img';
    overlay.appendChild(img);

    // Delete button if authorized
    auth.onAuthStateChanged(async user => {
        if (!user) return;
        const userDoc = await db.collection('artifacts').doc('default-app-id')
            .collection('user_profiles').doc(user.uid).get();
        const role = userDoc.data()?.role || 'none';
        if (user.uid === item.uploaderId || ['admin', 'mod'].includes(role)) {
            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.className = 'delete-btn';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!confirm('Delete this image?')) return;
                await db.collection('artifacts').doc('default-app-id')
                    .collection('gallery').doc(item.id).delete();
                document.body.removeChild(overlay);
                loadProfilePreview();
            };
            overlay.appendChild(delBtn);
        }
    });

    document.body.appendChild(overlay);
}

// Initialize
loadProfilePreview();

