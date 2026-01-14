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
const auth = app.auth();
const collectionName = "items";

// Export services and constants
export { app, auth, db, collectionName };

// --- Global Message Notification Listener ---
auth.onAuthStateChanged(user => {
    if (user) {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

        // Listen to all chats where the user is a participant
        db.collection('artifacts').doc(appId).collection('chats')
            .where('users', 'array-contains', user.uid)
            .onSnapshot(snapshot => {
                let totalUnread = 0;
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const count = data.unreadCount?.[user.uid] || 0;
                    totalUnread += count;
                });

                const hasUnread = totalUnread > 0;

                // Helper to update the icon (handles delayed header loading)
                const updateIcon = () => {
                    const chatIcon = document.getElementById('headerChatIcon');
                    if (chatIcon) {
                        if (hasUnread) {
                            chatIcon.classList.add('new-message');
                        } else {
                            chatIcon.classList.remove('new-message');
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


