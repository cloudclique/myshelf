// --- 1. Firebase Configuration and Initialization ---

const firebaseConfig = {
    apiKey: "AIzaSyDzVVtxCN1xvAZGZYG-Ydke08SYZEYNIlc",
    authDomain: "my-gk-collection.firebaseapp.com",
    databaseURL: "https://my-gk-collection-default-rtdb.firebaseio.com",
    projectId: "my-gk-collection",
    storageBucket: "my-gk-collection.firebasestorage.app",
    messagingSenderId: "880192992279",
    appId: "1:880192992279:web:53c9e9e8992699a254d852"
};

const app = firebase.initializeApp(firebaseConfig);
const db = app.firestore();

// --- Firestore Persistence ---
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("Firestore persistence failed: Multiple tabs open.");
    } else if (err.code == 'unimplemented') {
        console.warn("Firestore persistence is not supported by this browser.");
    }
});

const auth = app.auth();
const collectionName = "items";

// --- Notifications Helper ---
function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
}

async function showBrowserNotification(title, body, clickUrl = null, icon = null) {
    if (Notification.permission === "granted") {
        const n = new Notification(title, {
            body: body,
            icon: icon || '/myshelf_logo_favicon_color.ico'
        });
        if (clickUrl) {
            n.onclick = () => {
                window.focus();
                window.location.href = clickUrl;
            };
        }
    }
}

// Helper to get profile info for notifications (Cached for 2 weeks)
const CACHE_TTL = 2 * 7 * 24 * 60 * 60 * 1000;
async function getSenderName(uid) {
    if (uid === 'shelf_bug_bot') return "ShelfBug";
    const cacheKey = `notification_sender_${uid}`;
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const { name, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL) return name;
        }
    } catch (e) { }

    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const snap = await db.collection('artifacts').doc(appId).collection('user_profiles').doc(uid).get();
        const name = snap.exists ? (snap.data().username || "Someone") : "Someone";

        try {
            localStorage.setItem(cacheKey, JSON.stringify({ name, timestamp: Date.now() }));
        } catch (e) { }

        return name;
    } catch (e) {
        return "Someone";
    }
}


// Export services and constants
export { app, auth, db, collectionName };

// --- Global Message Notification Listener ---
const lastUnreadCounts = new Map();
let isInitialSnapshot = true;

auth.onAuthStateChanged(user => {
    if (user) {
        requestNotificationPermission(); // Ask on any page if logged in

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

        // Listen to all chats where the user is a participant
        db.collection('artifacts').doc(appId).collection('chats')
            .where('users', 'array-contains', user.uid)
            .onSnapshot(snapshot => {
                let totalUnread = 0;

                snapshot.forEach(doc => {
                    const data = doc.data();
                    const chatId = doc.id;
                    const count = data.unreadCount?.[user.uid] || 0;
                    totalUnread += count;

                    // Notification Logic
                    const prevCount = lastUnreadCounts.has(chatId) ? lastUnreadCounts.get(chatId) : null;

                    // NEVER notify if I am the sender
                    if (data.lastSenderId === user.uid) {
                        lastUnreadCounts.set(chatId, count);
                        return;
                    }

                    if (!isInitialSnapshot && prevCount !== null && count > prevCount) {
                        // Check if we are currently looking at this chat on the messenger page
                        const isMessengerPage = window.location.pathname.includes('/chat/');
                        const params = new URLSearchParams(window.location.search);
                        const activeChatId = params.get('chat');

                        // If not on messenger OR looking at a different chat, notify
                        if (!isMessengerPage || activeChatId !== data.lastSenderId) {
                            getSenderName(data.lastSenderId).then(name => {
                                const chatUrl = `${window.location.origin}/chat/?chat=${data.lastSenderId}`;
                                showBrowserNotification(`New message from ${name}`, data.lastMessage || "Sent an image", chatUrl);
                            });
                        }
                    }
                    lastUnreadCounts.set(chatId, count);
                });

                isInitialSnapshot = false;

                const hasUnread = totalUnread > 0;

                // Helper to update the icon (handles delayed header loading)
                const updateIcon = () => {
                    const chatIcon = document.getElementById('headerChatIcon');
                    const badge = document.getElementById('globalUnreadBadge');
                    const isChatPage = window.location.pathname.includes('/chat/');

                    if (chatIcon) {
                        if (hasUnread && !isChatPage) {
                            chatIcon.classList.add('new-message');
                            if (!badge && totalUnread > 0) {
                                // Add badge if missing
                                const newBadge = document.createElement('span');
                                newBadge.id = 'globalUnreadBadge';
                                newBadge.className = 'unread-badge';
                                newBadge.style.position = 'absolute';
                                newBadge.style.top = '-8px';
                                newBadge.style.right = '-8px';
                                newBadge.textContent = totalUnread;
                                chatIcon.parentElement.style.position = 'relative';
                                chatIcon.parentElement.appendChild(newBadge);
                            } else if (badge) {
                                badge.textContent = totalUnread;
                            }
                        } else {
                            chatIcon.classList.remove('new-message');
                            if (badge) badge.remove();
                        }
                    }
                };

                // Run immediately and then a few times to account for the header's fetch delay
                updateIcon();
                const retryInterval = setInterval(updateIcon, 500);
                setTimeout(() => clearInterval(retryInterval), 5000); // Stop retrying after 5 seconds

            }, error => {
                console.error("Global message listener error:", error);
            });
    }
});

// --- Global Header Logic for Admin/Mod ---
// This runs on every page that imports firebase-config.js
auth.onAuthStateChanged((user) => {
    if (!user) return;

    const pollForHeader = async (attempts = 0) => {
        const reviewLink = document.getElementById('headerReviewLink');
        if (reviewLink) {
            try {
                const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
                const profileDoc = await db.collection('artifacts').doc(appId).collection('user_profiles').doc(user.uid).get();
                const role = profileDoc.exists ? (profileDoc.data().role || 'user') : 'user';

                if (['admin', 'mod'].includes(role)) {
                    reviewLink.style.display = 'inline-block';
                }
            } catch (e) {
                console.error("Error checking permissions for header:", e);
            }
            return;
        }

        // Retry every 500ms, up to 20 times (10 seconds)
        if (attempts < 20) {
            setTimeout(() => pollForHeader(attempts + 1), 500);
        }
    };

    pollForHeader();
});



