import { auth, db } from '../firebase-config.js';

const TOP_USERS = 10;

const searchForm = document.getElementById("searchForm");
const searchQuery = document.getElementById("searchQuery");
const searchResults = document.getElementById("searchResults");
const searchMessage = document.getElementById("searchMessage");
const pinnedContainer = document.getElementById("pinnedUser");
const headerTools = document.getElementById("headerTools");

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

/**
 * Fetch all user profiles from Firestore
 */
async function fetchAllUserProfiles() {
    try {
        const profilesRef = db.collection('artifacts')
            .doc(appId)
            .collection('user_profiles');

        const snap = await profilesRef.get();
        return snap.docs.map(doc => ({ ...doc.data(), uid: doc.id }));
    } catch (e) {
        console.error("Error fetching all user profiles:", e);
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
            <p><strong>UID:</strong> <span class="text-xs break-all">${user.uid}</span></p>
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
    try {
        const allProfiles = await fetchAllUserProfiles();
        const currentUser = allProfiles.find(u => u.uid === currentUserUid);

        pinnedContainer.innerHTML = "";

        if (!currentUser) {
            pinnedContainer.innerHTML = "<p>No logged-in user found.</p>";
            return null;
        }

        createUserCard(currentUser, pinnedContainer, true);
        return currentUser.uid;
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
    searchResults.innerHTML = "";
    searchMessage.textContent = "Loading top users...";
    searchMessage.classList.remove("hidden");

    try {
        const allProfiles = await fetchAllUserProfiles();

        const filtered = excludeUid
            ? allProfiles.filter(u => u.uid !== excludeUid)
            : allProfiles;

        const sorted = filtered
            .map(u => ({ ...u, ownedCount: u.itemsOwned || 0 }))
            .sort((a, b) => b.ownedCount - a.ownedCount)
            .slice(0, TOP_USERS);

        if (sorted.length === 0) {
            searchMessage.textContent = "No users found.";
            return;
        }

        searchMessage.textContent = `Top ${TOP_USERS} users with the most owned items:`;

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
    searchResults.innerHTML = "";
    searchMessage.textContent = "Searching...";
    searchMessage.classList.remove("hidden");

    try {
        const allProfiles = await fetchAllUserProfiles();

        const uidMatch = allProfiles.find(p => p.uid === inputRaw);
        if (uidMatch) {
            searchMessage.textContent = "1 user found.";
            createUserCard(uidMatch, searchResults);
            return;
        }

        const usernameMatches = allProfiles.filter(p =>
            p.username && p.username.toLowerCase().includes(input)
        );

        if (usernameMatches.length === 0) {
            searchMessage.textContent = `No user found matching "${inputRaw}".`;
            return;
        }

        searchMessage.textContent = `${usernameMatches.length} user(s) found.`;
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

/**
 * Page Init
 */
auth.onAuthStateChanged(async (user) => {
    updateLoginButton(user);

    let pinnedUid = null;

    if (user) {
        pinnedUid = await showPinnedUser(user.uid);
    } else {
        pinnedContainer.innerHTML = "<p>No logged-in user.</p>";
    }

    showTopUsers(pinnedUid);
    setupHeaderLogoRedirect();
});


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