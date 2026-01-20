import { auth, db } from '../firebase-config.js';

const TOP_USERS = 10;

const searchForm = document.getElementById("searchForm");
const searchQuery = document.getElementById("searchQuery");
const searchResults = document.getElementById("searchResults");
const searchMessage = document.getElementById("searchMessage");
const pinnedContainer = document.getElementById("pinnedUser");
const headerTools = document.getElementById("headerTools");

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Local Cache Helpers ---
const USERS_COLLECTION = 'users';
// Using the worker URL with /search endpoint
const SEARCH_ENDPOINT = 'https://imgbbapi.stanislav-zhukov.workers.dev/search';

/**
 * Generic function to query Typesense via Cloudflare Proxy
 */
async function queryTypesense(collection, params) {
    try {
        const response = await fetch(SEARCH_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: collection,
                ...params
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Search failed: ${response.status} ${errText}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Typesense Query Error:", error);
        return { hits: [], found: 0 };
    }
}

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
 * Fetch top users using Typesense
 */
async function fetchTopUsers(limitCount = 10) {
    const result = await queryTypesense(USERS_COLLECTION, {
        q: '*',
        sort_by: 'itemsOwned:desc',
        per_page: limitCount
    });

    // Map hits to user objects
    // Note: Typesense 'document' field contains the indexed data.
    // We assume the indexed data has the same fields as Firestore: username, uid, itemsOwned, profilePic (or equivalent)
    return result.hits.map(hit => ({
        ...hit.document,
        // Ensure UID is present (it might be 'id' in typesense or 'uid')
        uid: hit.document.uid || hit.document.id
    }));
}

/**
 * Search users using Typesense
 */
async function searchUsers(query) {
    const result = await queryTypesense(USERS_COLLECTION, {
        q: query,
        query_by: 'username,uid', // Search by username and UID
        per_page: 50 // reasonable limit
    });

    return result.hits.map(hit => ({
        ...hit.document,
        uid: hit.document.uid || hit.document.id
    }));
}

/**
 * Create a user card (WITH PROFILE PICTURE)
 */
function createUserCard(user, container, isPinned = false) {
    const link = document.createElement("a");
    link.href = `../?uid=${user.uid}`;
    link.className = "user-card-link";

    const card = document.createElement("div");
    card.className = "user-card";
    if (isPinned) card.classList.add("pinned-user");

    // Handle createdAt: Firestore Timestamp vs Typesense (likely number or string)
    let createdAtDisplay = "Unknown";
    if (user.createdAt) {
        // If it's a Firestore timestamp object (seconds)
        if (typeof user.createdAt === 'object' && user.createdAt.seconds) {
            createdAtDisplay = new Date(user.createdAt.seconds * 1000).toLocaleDateString();
        }
        // If it's a number (timestamp)
        else if (typeof user.createdAt === 'number') {
            createdAtDisplay = new Date(user.createdAt).toLocaleDateString(); // check if ms or sec? usually fetch returns ms if date.now(), but firestore is sec.
            // If the number is small (e.g. 1700000000), it's seconds. If huge, ms.
            // Simple heuristic:
            if (user.createdAt < 10000000000) { // < 10 billion, likely seconds (valid until year 2286)
                createdAtDisplay = new Date(user.createdAt * 1000).toLocaleDateString();
            } else {
                createdAtDisplay = new Date(user.createdAt).toLocaleDateString();
            }
        }
        // If string
        else if (typeof user.createdAt === 'string') {
            createdAtDisplay = new Date(user.createdAt).toLocaleDateString();
        }
    }

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
            <p><strong>Joined:</strong> ${createdAtDisplay}</p>
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
        // We can keep using Firestore for the CURRENT user's profile to ensure it's fresh/permissioned,
        // OR use Typesense. Firestore is safer for "My Profile" to avoid sync delays.
        // Keeping Firestore logic for pinned user as it's just one doc read.
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
        // Use Typesense fetch
        const topUsers = await fetchTopUsers(TOP_USERS + 1); // Fetch slightly more to handle exclusion

        const filtered = excludeUid
            ? topUsers.filter(u => u.uid !== excludeUid)
            : topUsers;

        const sorted = filtered.slice(0, TOP_USERS);

        if (sorted.length === 0) {
            searchMessage.textContent = "No users found.";
            searchResults.innerHTML = ""; // Clear skeletons
            return;
        }

        searchMessage.textContent = `Top ${TOP_USERS} users with the most owned items:`;

        searchResults.innerHTML = "";
        sorted.forEach(user => createUserCard(user, searchResults));
    } catch (error) {
        console.error(error);
        searchMessage.textContent = "An error occurred while loading top users.";
        searchResults.innerHTML = "";
    }
}

/**
 * Search users
 */
searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputRaw = searchQuery.value.trim();

    if (!inputRaw) return;

    renderSkeletonProfiles(searchResults, 3);
    searchMessage.textContent = "Searching...";
    searchMessage.classList.remove("hidden");

    try {
        // Use Typesense search
        const users = await searchUsers(inputRaw);

        if (users.length === 0) {
            searchMessage.textContent = `No user found matching "${inputRaw}".`;
            searchResults.innerHTML = "";
            return;
        }

        // Check for exact UID match if applicable (Typesense relevance usually puts exact match first, 
        // but we can manually check if it looks like a UID and is in the list)

        searchMessage.textContent = `${users.length} user(s) found.`;
        searchResults.innerHTML = "";
        users.forEach(user => createUserCard(user, searchResults));
    } catch (error) {
        console.error("Search error:", error);
        searchMessage.textContent = "An error occurred during search.";
        searchResults.innerHTML = "";
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

/**
 * Page Init
 */
auth.onAuthStateChanged(async (user) => {
    updateLoginButton(user);

    // Parallelize loading pinned user and top users
    const pinnedPromise = user ? showPinnedUser(user.uid) : Promise.resolve(null);
    const topUsersPromise = showTopUsers(user ? user.uid : null);

    // Initial load doesn't need to await everything sequentially
    const pinnedUid = await pinnedPromise;
    // showTopUsers already handles its own internal loading and excludes the pinned user if needed
});


