// firebase-config.js

const firebaseConfig = {
    apiKey: "AIzaSyDzVVtxCN1xvAZGZYG-Ydke08SYZEYNIlc",
    authDomain: "my-gk-collection.firebaseapp.com",
    databaseURL: "https://my-gk-collection-default-rtdb.firebaseio.com",
    projectId: "my-gk-collection",
    storageBucket: "my-gk-collection.appspot.com",
    messagingSenderId: "880192992279",
    appId: "1:880192992279:web:53c9e9e8992699a254d852"
};

const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

export { app, auth, db, storage };
