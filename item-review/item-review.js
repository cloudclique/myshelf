import { auth, db, collectionName } from '../firebase-config.js';

const reviewGrid = document.getElementById('reviewGrid');
const loadingStatus = document.getElementById('loadingStatus');
const itemsCollection = collectionName; // 'items'
const reviewCollection = 'item-review';

let currentUserRole = 'user';

// Modal Elements
const confirmationModal = document.getElementById('confirmationModal');
const modalMessage = document.getElementById('modalMessage');
const modalYesBtn = document.getElementById('modalYesBtn');
const modalNoBtn = document.getElementById('modalNoBtn');

function showConfirmationModal(message, onYes) {
    modalMessage.textContent = message;
    confirmationModal.style.display = 'flex';

    // Clone to remove old listeners
    const newYes = modalYesBtn.cloneNode(true);
    const newNo = modalNoBtn.cloneNode(true);
    modalYesBtn.replaceWith(newYes);
    modalNoBtn.replaceWith(newNo);

    newYes.onclick = () => {
        confirmationModal.style.display = 'none';
        onYes();
    };
    newNo.onclick = () => {
        confirmationModal.style.display = 'none';
    };
}

// 1. Check Permissions
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = '../login';
        return;
    }

    loadingStatus.textContent = 'Verifying permissions...';

    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const profileDoc = await db.collection('artifacts').doc(appId).collection('user_profiles').doc(user.uid).get();
        currentUserRole = profileDoc.exists ? (profileDoc.data().role || 'user') : 'user';

        if (!['admin', 'mod'].includes(currentUserRole)) {
            loadingStatus.textContent = 'Access Denied. You do not have permission to view this page.';
            reviewGrid.innerHTML = '';
            setTimeout(() => { window.location.href = '../index.html'; }, 2000);
            return;
        }

        fetchPendingItems();

    } catch (e) {
        console.error(e);
        loadingStatus.textContent = 'Error verifying permissions.';
    }
});

// 2. Fetch Pending Items
async function fetchPendingItems() {
    loadingStatus.textContent = 'Loading pending submissions...';
    reviewGrid.innerHTML = '';

    try {
        const snapshot = await db.collection(reviewCollection).orderBy('createdAt', 'desc').get();

        if (snapshot.empty) {
            loadingStatus.textContent = 'No pending items to review.';
            return;
        }

        loadingStatus.textContent = '';
        snapshot.forEach(doc => {
            renderReviewCard(doc);
        });

    } catch (e) {
        console.error(e);
        loadingStatus.textContent = 'Error loading items: ' + e.message;
    }
}

// 3. Render Card
// 3. Render Card (List View Styled)
function renderReviewCard(doc) {
    // Force list view on the grid
    reviewGrid.classList.add('list-view');

    const item = doc.data();
    const card = document.createElement('div');
    card.className = 'item-card'; // This class combined with .list-view parent handles the layout
    card.id = `card-${doc.id}`;

    const imageUrl = (item.itemImageUrls && item.itemImageUrls.length > 0)
        ? item.itemImageUrls[0].url
        : '../placeholder.png'; // Make sure placeholder path is correct relative to this file

    // 1. Image Wrapper
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'item-image-wrapper';
    imageWrapper.innerHTML = `
        <img src="${imageUrl}" alt="${item.itemName}" class="item-image">
        <div class="draft-overlay">PENDING</div>
        ${item.isDraft ? '<div class="draft-overlay" style="top: 35px; background: #6c757d;">DRAFT</div>' : ''}
    `;

    // 2. Info Wrapper
    const info = document.createElement('div');
    info.className = 'item-info';

    // Title
    const title = document.createElement('h3');
    title.className = 'item-title';
    title.textContent = item.itemName;
    info.appendChild(title);

    // List View Columns
    const extraCols = document.createElement('div');
    extraCols.className = 'list-view-columns';

    // Column 1: Uploader Info
    const col1 = document.createElement('div');
    col1.className = 'col-group';
    col1.innerHTML = `
        <div class="main-val"><strong><i class="bi bi-person-circle"></i></strong> <span>${item.uploaderName || 'Unknown'}</span></div>
        <div class="sub-val"><i class="bi bi-clock"></i> ${new Date(item.createdAt?.seconds * 1000).toLocaleDateString()}</div>
    `;

    // Column 2: Item Details
    const col2 = document.createElement('div');
    col2.className = 'col-group';
    col2.innerHTML = `
        <div class="main-val"><strong>Cat:</strong> <span>${item.itemCategory || '-'}</span></div>
        <div class="sub-val"><strong>Scale:</strong> ${item.itemScale || '-'}</div>
    `;

    // Column 3: Actions
    const col3 = document.createElement('div');
    col3.className = 'col-group';
    col3.style.display = 'flex';
    col3.style.gap = '5px';
    col3.style.alignItems = 'center';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'primary-btn approve-btn';
    approveBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
    approveBtn.title = 'Approve';
    approveBtn.style.padding = '5px 10px';

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'secondary-btn reject-btn';
    rejectBtn.style.background = '#d9534f';
    rejectBtn.style.borderColor = '#d43f3a';
    rejectBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
    rejectBtn.title = 'Reject';
    rejectBtn.style.padding = '5px 10px';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'text-btn view-data-btn';
    viewBtn.innerHTML = '<i class="bi bi-eye"></i>';
    viewBtn.title = 'View Data';
    viewBtn.style.padding = '5px 10px';

    col3.appendChild(approveBtn);
    col3.appendChild(rejectBtn);
    col3.appendChild(viewBtn);

    extraCols.appendChild(col1);
    extraCols.appendChild(col2);
    extraCols.appendChild(col3);

    info.appendChild(extraCols);

    // Bind Events
    // Make card clickable to view details
    // using window.location.href mimic
    card.style.cursor = 'pointer';
    card.onclick = (e) => {
        // Prevent if clicking buttons
        if (e.target.closest('button')) return;
        window.location.href = `../items/?id=${doc.id}&collection=item-review`;
    };

    approveBtn.onclick = (e) => { e.stopPropagation(); handleApprove(doc); };
    rejectBtn.onclick = (e) => { e.stopPropagation(); handleReject(doc.id); };

    // Update View Button to also go to details page (or keep as JSON dump? User asked for link. Let's make it link.)
    viewBtn.onclick = (e) => {
        e.stopPropagation();
        window.location.href = `../items/?id=${doc.id}&collection=item-review`;
    };

    card.appendChild(imageWrapper);
    card.appendChild(info);

    reviewGrid.appendChild(card);
}

// 4. Actions
async function handleApprove(doc) {
    showConfirmationModal(`Approve "${doc.data().itemName}" and publish to live?`, async () => {
        try {
            const data = doc.data();
            // Remove from review
            await db.collection(reviewCollection).doc(doc.id).delete();

            // Add to items (let Firestore generate new ID, or reuse? Reuse is better to avoid dupe uploads if we want, but these are different collections so separate IDs is fine. Actually, reusing ID is safer if we want to trace.)
            // Let's rely on add() to generate a fresh ID for the public collection to avoid any collisions or weird state.
            await db.collection(itemsCollection).add({
                ...data,
                approvedBy: auth.currentUser.uid,
                approvedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Remove card
            const card = document.getElementById(`card-${doc.id}`);
            if (card) card.remove();

            if (reviewGrid.children.length === 0) {
                loadingStatus.textContent = 'No pending items to review.';
            }

        } catch (e) {
            console.error(e);
            alert("Error approving item: " + e.message);
        }
    });
}

async function handleReject(docId) {
    showConfirmationModal("Reject and delete this submission? This cannot be undone.", async () => {
        try {
            await db.collection(reviewCollection).doc(docId).delete();

            // Remove card
            const card = document.getElementById(`card-${docId}`);
            if (card) card.remove();

            if (reviewGrid.children.length === 0) {
                loadingStatus.textContent = 'No pending items to review.';
            }

        } catch (e) {
            console.error(e);
            alert("Error rejecting item: " + e.message);
        }
    });
}
