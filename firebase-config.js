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


