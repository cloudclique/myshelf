import { auth, db } from '../firebase-config.js';

const TOP_USERS = 10;

const searchForm = document.getElementById("searchForm");
const searchQuery = document.getElementById("searchQuery");
const searchResults = document.getElementById("searchResults");
const searchMessage = document.getElementById("searchMessage");
const pinnedContainer = document.getElementById("pinnedUser");
const headerTools = document.getElementById("headerTools");

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Local Cache ---
let cachedProfiles = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

/**
 * Render skeleton loaders for user cards
 */
function renderSkeletonProfiles(container, count = 1) {
    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
        const div = document.createElement("div");
        div.className = "user-card"; // Reusing user-card for basic layout
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

/**
 * Fetch all user profiles from Firestore
 */
async function fetchAllUserProfiles() {
    // Return cache if valid
    if (cachedProfiles && (Date.now() - lastFetchTime < CACHE_DURATION)) {
        return cachedProfiles;
    }

    try {
        const profilesRef = db.collection('artifacts')
            .doc(appId)
            .collection('user_profiles');

        const snap = await profilesRef.get();
        cachedProfiles = snap.docs.map(doc => ({ ...doc.data(), uid: doc.id }));
        lastFetchTime = Date.now();
        return cachedProfiles;
    } catch (e) {
        console.error("Error fetching all user profiles:", e);
        return cachedProfiles || []; // Return stale cache on error if available
    }
}

/**
 * Optimized fetch for top users (Firestore side)
 */
async function fetchTopUsers(limitCount = 10) {
    try {
        const profilesRef = db.collection('artifacts')
            .doc(appId)
            .collection('user_profiles');

        const snap = await profilesRef.orderBy('itemsOwned', 'desc').limit(limitCount + 1).get();
        return snap.docs.map(doc => ({ ...doc.data(), uid: doc.id }));
    } catch (e) {
        console.error("Error fetching top users:", e);
        return [];
    }
}

/**
 * Create a user card (WITH PROFILE PICTURE)
 */
function createUserCard(user, container, isPinned = false) {
    const link = document.createElement("a");
    link.href = `../user/?uid=${user.uid}`;
    link.className = "user-card-link";

    const card = document.createElement("div");
    card.className = "user-card";
    if (isPinned) card.classList.add("pinned-user");

    const createdAt = user.createdAt
        ? new Date(user.createdAt.seconds * 1000).toLocaleDateString()
        : "Unknown";

    const ownedCount = user.itemsOwned || 0;

    // Use user.profilePic (Base64 or URL), else fallback image
    const profilePic = user.profilePic
        ? user.profilePic
        : "https://placehold.co/40x40/cccccc/ffffff?text=User"; // provide an existing placeholder in your project

    card.innerHTML = `
        <div class="user-card-left">
            <img src="${profilePic}" alt="No PFP" class="user-avatar">
        </div>

        <div class="user-card-body">
            <p class="username">
                <strong>${user.username || "Unknown User"}${isPinned ? " (You)" : ""}</strong>
            </p>
            <p class="user-uid"><strong>UID:</strong> <span class="text-xs break-all">${user.uid}</span></p>
            <p><strong>Joined:</strong> ${createdAt}</p>
            <p><strong>Owned Items:</strong> ${ownedCount}</p>
        </div>
    `;

    link.appendChild(card);
    container.appendChild(link);
}

/**
 * Show pinned logged-in user
 */
async function showPinnedUser(currentUserUid) {
    if (!currentUserUid) {
        pinnedContainer.innerHTML = "<p>No logged-in user.</p>";
        return null;
    }

    renderSkeletonProfiles(pinnedContainer, 1);
    try {
        // Fetch only the specific user doc
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

/**
 * Show top 10 users
 */
async function showTopUsers(excludeUid = null) {
    renderSkeletonProfiles(searchResults, 5);
    searchMessage.textContent = "Loading top users...";
    searchMessage.classList.remove("hidden");

    try {
        const topUsers = await fetchTopUsers(TOP_USERS);

        const filtered = excludeUid
            ? topUsers.filter(u => u.uid !== excludeUid)
            : topUsers;

        const sorted = filtered.slice(0, TOP_USERS);

        if (sorted.length === 0) {
            searchMessage.textContent = "No users found.";
            return;
        }

        searchMessage.textContent = `Top ${TOP_USERS} users with the most owned items:`;

        searchResults.innerHTML = "";
        sorted.forEach(user => createUserCard(user, searchResults));
    } catch (error) {
        console.error(error);
        searchMessage.textContent = "An error occurred while loading top users.";
    }
}

/**
 * Search users
 */
searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputRaw = searchQuery.value.trim();

    if (!inputRaw) return;

    const input = inputRaw.toLowerCase();
    renderSkeletonProfiles(searchResults, 3);
    searchMessage.textContent = "Searching...";
    searchMessage.classList.remove("hidden");

    try {
        const allProfiles = await fetchAllUserProfiles();

        const uidMatch = allProfiles.find(p => p.uid === inputRaw);
        if (uidMatch) {
            searchMessage.textContent = "1 user found.";
            searchResults.innerHTML = "";
            createUserCard(uidMatch, searchResults);
            return;
        }

        const usernameMatches = allProfiles.filter(p =>
            p.username && p.username.toLowerCase().includes(input)
        );

        if (usernameMatches.length === 0) {
            searchMessage.textContent = `No user found matching "${inputRaw}".`;
            searchResults.innerHTML = "";
            return;
        }

        searchMessage.textContent = `${usernameMatches.length} user(s) found.`;
        searchResults.innerHTML = "";
        usernameMatches.forEach(user => createUserCard(user, searchResults));
    } catch (error) {
        console.error("Search error:", error);
        searchMessage.textContent = "An error occurred during search.";
    }
});

/**
 * Login / Logout button
 */
function updateLoginButton(user) {
    if (!headerTools) return;

    headerTools.innerHTML = "";

    const btn = document.createElement("button");
    btn.className = user ? "logout-btn" : "login-btn";

    if (user) {
        btn.textContent = "Logout";
        btn.onclick = async () => {
            try {
                await auth.signOut();
            } catch (err) {
                console.error("Logout failed:", err);
            }
        };
    } else {
        btn.textContent = "Login";
        btn.onclick = () => window.location.href = "../login/";
    }

    headerTools.appendChild(btn);
}

// --- Redirect to the logged-in user's profile when clicking the header logo ---
function setupHeaderLogoRedirect() {
    const logo = document.querySelector('.header-logo');
    if (!logo) return;

    logo.style.cursor = 'pointer'; // optional: show pointer on hover
    logo.onclick = () => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            alert("You must be logged in to view your profile.");
            return;
        }
        const userId = currentUser.uid;
        window.location.href = `../user/?uid=${userId}`;
    };
}

/**
 * Page Init
 */
auth.onAuthStateChanged(async (user) => {
    updateLoginButton(user);
    setupHeaderLogoRedirect();

    // Parallelize loading pinned user and top users
    const pinnedPromise = user ? showPinnedUser(user.uid) : Promise.resolve(null);
    const topUsersPromise = showTopUsers(user ? user.uid : null);

    // Initial load doesn't need to await everything sequentially
    const pinnedUid = await pinnedPromise;
    // showTopUsers already handles its own internal loading and excludes the pinned user if needed
});


