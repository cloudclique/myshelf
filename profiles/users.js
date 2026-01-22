import { auth, db } from '../firebase-config.js';

const TOP_USERS = 10;

const searchForm = document.getElementById("searchForm");
const searchQuery = document.getElementById("searchQuery");
const searchResults = document.getElementById("searchResults");
const searchMessage = document.getElementById("searchMessage");
const pinnedContainer = document.getElementById("pinnedUser");
const headerTools = document.getElementById("headerTools");

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Local Cache
let allGlobalUsers = [];
let dataLoaded = false;

// --- DATA FETCHING ---

async function fetchGlobalUsers() {
    if (dataLoaded) return;
    try {
        const doc = await db.collection('denormalized_data').doc('users').get();
        if (doc.exists) {
            const data = doc.data();
            // Convert map to array { uid, ...data }
            allGlobalUsers = Object.entries(data).map(([uid, userData]) => ({
                uid,
                ...userData
            }));
        } else {
            console.warn("denormalized_data/users document not found.");
            allGlobalUsers = [];
        }
        dataLoaded = true;
    } catch (e) {
        console.error("Error fetching global users:", e);
        allGlobalUsers = [];
    }
}


// --- SKELETON LOADERS ---

function renderSkeletonProfiles(container, count = 1) {
    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
        const div = document.createElement("div");
        div.className = "user-card";
        div.style.pointerEvents = "none";
        div.innerHTML = `
            <div class="user-card-left">
                <div class="skeleton user-avatar"></div>
            </div>
            <div class="user-card-body">
                <div class="skeleton skeleton-text" style="width: 120px; margin: 5px 0 10px 0;"></div>
                <div class="skeleton skeleton-text short" style="margin: 5px 0;"></div>
                <div class="skeleton skeleton-text short" style="margin: 5px 0;"></div>
            </div>
        `;
        container.appendChild(div);
    }
}


// --- CREATE CARD ---

function createUserCard(user, container, isPinned = false) {
    const link = document.createElement("a");
    link.href = `../?uid=${user.uid}`;
    link.className = "user-card-link";

    const card = document.createElement("div");
    card.className = "user-card";
    if (isPinned) card.classList.add("pinned-user");

    // Handle createdAt
    let createdAtDisplay = "Unknown";
    if (user.createdAt) {
        if (typeof user.createdAt === 'object' && user.createdAt.seconds) {
            // Firestore Timestamp
            createdAtDisplay = new Date(user.createdAt.seconds * 1000).toLocaleDateString();
        } else if (typeof user.createdAt === 'number') {
            // Milliseconds or Seconds
            if (user.createdAt < 10000000000) createdAtDisplay = new Date(user.createdAt * 1000).toLocaleDateString();
            else createdAtDisplay = new Date(user.createdAt).toLocaleDateString();
        } else if (typeof user.createdAt === 'string') {
            createdAtDisplay = new Date(user.createdAt).toLocaleDateString();
        }
    }

    const ownedCount = user.itemsOwned || 0;

    const profilePic = user.profilePic
        ? user.profilePic
        : "https://placehold.co/40x40/cccccc/ffffff?text=User";

    card.innerHTML = `
        <div class="user-card-left">
            <img src="${profilePic}" alt="No PFP" class="user-avatar">
        </div>

        <div class="user-card-body">
            <p class="username">
                <strong>${user.username || "Unknown User"}${isPinned ? " (You)" : ""}</strong>
            </p>
            <p class="user-uid"><strong>UID:</strong> <span class="text-xs break-all">${user.uid}</span></p>
            <p><strong>Joined:</strong> ${createdAtDisplay}</p>
            <p><strong>Owned Items:</strong> ${ownedCount}</p>
        </div>
    `;

    link.appendChild(card);
    container.appendChild(link);
}


// --- LOGIC: PINNED USER ---

async function showPinnedUser(currentUserUid) {
    if (!currentUserUid) {
        pinnedContainer.innerHTML = "<p>No logged-in user.</p>";
        return null;
    }

    renderSkeletonProfiles(pinnedContainer, 1);
    try {
        // We can check allGlobalUsers first if loaded, but for "My Profile" standard direct fetch is often safer for immediate updates
        // However, if we want strict denormalized consistency, we can find in array.
        // Let's stick to direct fetch for the pinned user to ensure it's up-to-date (e.g. if they just changed PFP)
        const profileDoc = await db.collection('artifacts')
            .doc(appId)
            .collection('user_profiles')
            .doc(currentUserUid)
            .get();

        pinnedContainer.innerHTML = "";

        if (!profileDoc.exists) {
            pinnedContainer.innerHTML = "<p>Profile not found.</p>";
            return null;
        }

        const userData = { ...profileDoc.data(), uid: profileDoc.id };
        createUserCard(userData, pinnedContainer, true);
        return userData.uid;
    } catch (e) {
        console.error("Error showing pinned user:", e);
        pinnedContainer.innerHTML = "<p>Error loading your profile.</p>";
        return null;
    }
}


// --- LOGIC: TOP USERS ---

async function showTopUsers(excludeUid = null) {
    renderSkeletonProfiles(searchResults, 5);
    searchMessage.textContent = "Loading top users...";
    searchMessage.classList.remove("hidden");

    await fetchGlobalUsers(); // Ensure data is loaded

    if (allGlobalUsers.length === 0) {
        searchMessage.textContent = "No users found.";
        searchResults.innerHTML = "";
        return;
    }

    // Sort by itemsOwned desc
    const sorted = [...allGlobalUsers].sort((a, b) => (b.itemsOwned || 0) - (a.itemsOwned || 0));

    // Filter
    const filtered = excludeUid
        ? sorted.filter(u => u.uid !== excludeUid)
        : sorted;

    const top = filtered.slice(0, TOP_USERS);

    searchMessage.textContent = `Top ${TOP_USERS} users with the most owned items:`;
    searchResults.innerHTML = "";

    top.forEach(user => createUserCard(user, searchResults));
}


// --- SEARCH HANDLING ---

searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputRaw = searchQuery.value.trim().toLowerCase();

    if (!inputRaw) return;

    renderSkeletonProfiles(searchResults, 3);
    searchMessage.textContent = "Searching...";
    searchMessage.classList.remove("hidden");

    await fetchGlobalUsers();

    if (allGlobalUsers.length === 0) {
        searchMessage.textContent = "No users found in database.";
        searchResults.innerHTML = "";
        return;
    }

    // Client-side search
    const results = allGlobalUsers.filter(u => {
        const name = (u.username || "").toLowerCase();
        const uid = (u.uid || "").toLowerCase();
        return name.includes(inputRaw) || uid === inputRaw;
    });

    if (results.length === 0) {
        searchMessage.textContent = `No user found matching "${inputRaw}".`;
        searchResults.innerHTML = "";
        return;
    }

    searchMessage.textContent = `${results.length} user(s) found.`;
    searchResults.innerHTML = "";

    // Sort relevance? Exact match first?
    // Sort by length of match or something simple, or just itemsOwned
    results.sort((a, b) => (b.itemsOwned || 0) - (a.itemsOwned || 0));

    // Limit if too many?
    const limitedResults = results.slice(0, 50);

    limitedResults.forEach(user => createUserCard(user, searchResults));
});


// --- AUTH & INIT ---

function updateLoginButton(user) {
    if (!headerTools) return;
    headerTools.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = user ? "logout-btn" : "login-btn";
    if (user) {
        btn.textContent = "Logout";
        btn.onclick = async () => { try { await auth.signOut(); } catch (err) { console.error(err); } };
    } else {
        btn.textContent = "Login";
        btn.onclick = () => window.location.href = "../login/";
    }
    headerTools.appendChild(btn);
}

auth.onAuthStateChanged(async (user) => {
    updateLoginButton(user);
    const pinnedPromise = user ? showPinnedUser(user.uid) : Promise.resolve(null);
    // Load top users
    const [pinnedUid] = await Promise.all([pinnedPromise]);
    await showTopUsers(pinnedUid);
});
