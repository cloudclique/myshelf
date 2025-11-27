import { auth, db } from '../firebase-config.js';

// --- DOM Elements ---

const userList = document.getElementById('userList');
const chatHeader = document.getElementById('chatHeader');
const messageList = document.getElementById('messageList');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const headerTools = document.getElementById('headerTools');
// NEW DOM Elements for Image Upload
const imageUpload = document.getElementById('imageUpload');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
// NEW DOM Elements for Lightbox
const lightboxOverlay = document.getElementById('lightboxOverlay');
const lightboxImage = document.getElementById('lightboxImage');


// --- State Variables ---
let currentUserId = null;
let currentChatUserId = null;
let currentChatUsername = null;
let messageListener = null; // To store the Firestore snapshot listener

// --- Constants ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const MAX_IMAGES = 5; // User requested limit

// --- Utility Functions ---

function getChatId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
}

function getChatRef(chatId) {
    return db.collection('artifacts').doc(appId).collection('chats').doc(chatId);
}

function getProfilesRef() {
    return db.collection('artifacts').doc(appId).collection('user_profiles');
}

async function uploadImageToImgBB(file) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('key', IMGBB_API_KEY);

    try {
        const response = await fetch('https://api.imgbb.com/1/upload', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`ImgBB upload failed: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return data.data.url;
    } catch (error) {
        console.error("Error uploading image to ImgBB:", error);
        throw new Error("Image upload service failed.");
    }
}

window.openLightbox = function(url) {
    lightboxImage.src = url;
    lightboxOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

window.closeLightbox = function() {
    lightboxOverlay.classList.remove('active');
    lightboxImage.src = '';
    document.body.style.overflow = '';
}

function renderMessage(message) {
    const isSent = message.senderId === currentUserId;
    const time = message.timestamp 
        ? new Date(message.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Sending...';

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    
    let contentHtml = '';

    if (message.imageUrls && message.imageUrls.length > 0) {
        contentHtml += '<div class="message-images">';
        message.imageUrls.forEach(url => {
            const placeholder = `https://placehold.co/100x100/000000/FFFFFF?text=IMG`;
            contentHtml += `<img src="${url}" data-original-url="${url}" alt="User image" loading="lazy" class="chat-image" onerror="this.onerror=null;this.src='${placeholder}';" style="max-width: 100px; max-height: 100px;">`;
        });
        contentHtml += '</div>';
    }

    if (message.text && message.text.trim().length > 0) {
        const textContent = message.text.split('\n').join('<br>');
        if (message.imageUrls && message.imageUrls.length > 0) {
            contentHtml += `<p style="margin-top: 5px;">${textContent}</p>`;
        } else {
            contentHtml += textContent;
        }
    }
    
    if (contentHtml.length === 0) return;

    messageDiv.innerHTML = `${contentHtml}<span class="message-time">${time}</span>`;
    messageList.prepend(messageDiv);
}

// --- Image Preview Logic ---
imageUpload.onchange = function() {
    imagePreviewContainer.innerHTML = ''; 
    const files = Array.from(imageUpload.files);
    let filesToUse = files;

    if (files.length > MAX_IMAGES) {
        filesToUse = files.slice(0, MAX_IMAGES);
        const dataTransfer = new DataTransfer();
        filesToUse.forEach(file => dataTransfer.items.add(file));
        imageUpload.files = dataTransfer.files;
        console.warn(`You selected ${files.length} images. Only the first ${MAX_IMAGES} will be sent.`);
    }

    filesToUse.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'relative group';
            imgContainer.innerHTML = `
                <img src="${e.target.result}" class="w-16 h-16 object-cover rounded-md border border-gray-300 shadow-sm" alt="Preview ${index + 1}">
                <button data-index="${index}" class="remove-img-btn absolute -top-2 -right-2 bg-red-500 text-white w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold opacity-90 hover:opacity-100 transition">x</button>
            `;
            imagePreviewContainer.appendChild(imgContainer);
        };
        reader.readAsDataURL(file);
    });

    sendMessageBtn.disabled = !(messageInput.value.trim() || imageUpload.files.length > 0);
};

imagePreviewContainer.onclick = function(e) {
    if (e.target.classList.contains('remove-img-btn')) {
        const indexToRemove = parseInt(e.target.dataset.index);
        const files = Array.from(imageUpload.files);
        const dataTransfer = new DataTransfer();
        files.forEach((file, index) => {
            if (index !== indexToRemove) {
                dataTransfer.items.add(file);
            }
        });
        imageUpload.files = dataTransfer.files;
        imageUpload.dispatchEvent(new Event('change')); 
    }
};

messageInput.oninput = function() {
    sendMessageBtn.disabled = !(messageInput.value.trim() || imageUpload.files.length > 0);
};

async function fetchUserContacts() {
    userList.innerHTML = '';
    
    if (!currentUserId) {
        userList.innerHTML = '<p style="padding: 10px;">Please log in to view contacts.</p>';
        return;
    }

    userList.innerHTML = '<p style="padding: 10px;">Loading conversations...</p>';

    try {
        const chatsRef = db.collection('artifacts').doc(appId).collection('chats');
        const chatsSnap = await chatsRef.where('users', 'array-contains', currentUserId).get();
        
        if (chatsSnap.empty) {
            userList.innerHTML = '<p style="padding: 10px;">No ongoing conversations. Search for a user to start one!</p>';
            return;
        }

        const contactUids = new Set();
        const chatData = {}; 

        chatsSnap.forEach(doc => {
            const data = doc.data();
            const users = data.users || [];
            const otherUserId = users.find(uid => uid !== currentUserId);
            
            if (otherUserId) {
                contactUids.add(otherUserId);
                const lastMessageText = data.lastMessage || (data.imageUrls?.length ? `[${data.imageUrls.length} image(s) sent]` : 'No recent messages.');
                chatData[otherUserId] = { 
                    lastMessage: lastMessageText, 
                    lastSent: data.lastSent ? data.lastSent.toDate() : new Date(0) 
                };
            }
        });

        const profilesToFetch = Array.from(contactUids);
        if (profilesToFetch.length === 0) {
             userList.innerHTML = '<p style="padding: 10px;">No valid contacts found in chats.</p>';
             return;
        }

        const profileFetches = profilesToFetch.map(async uid => {
            const profileSnap = await getProfilesRef().doc(uid).get();
            if (profileSnap.exists) {
                return { 
                    uid: uid, 
                    username: profileSnap.data().username || `User ID: ${uid.substring(0, 8)}...`,
                    profilePic: profileSnap.data().profilePic || null,
                    ...chatData[uid]
                };
            }
            return null;
        });

        let contacts = (await Promise.all(profileFetches)).filter(Boolean);
        contacts.sort((a, b) => b.lastSent.getTime() - a.lastSent.getTime());

        userList.innerHTML = ''; 
        contacts.forEach(user => {
            const chatItem = document.createElement('div');
            chatItem.className = 'chat-item';
            
            const lastMessageTime = user.lastSent.getTime() === 0 
                                  ? '' 
                                  : user.lastSent.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const profilePicUrl = user.profilePic || 'https://placehold.co/40x40/cccccc/ffffff?text=User';

            chatItem.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="${profilePicUrl}" alt="${user.username}" class="small-user-avatar">
                    <div style="flex: 1;">
                        <div style="font-weight: bold;">${user.username}</div>
                        <div style="font-size: 0.8em; color: #555; display: flex; justify-content: space-between;">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">${user.lastMessage}</span>
                            <span>${lastMessageTime}</span>
                        </div>
                    </div>
                </div>
            `;

            chatItem.onclick = () => startChat(user.uid, user.username);
            userList.appendChild(chatItem);
        });

    } catch (e) {
        console.error("Error fetching contacts:", e);
        userList.innerHTML = '<p style="padding: 10px; color: red;">Failed to load conversations.</p>';
    }
}

function startChat(userId, username) {
    if (messageListener) messageListener();

    currentChatUserId = userId;
    currentChatUsername = username;

    chatHeader.textContent = `Chatting with: ${username}`;
    messageList.innerHTML = '<p style="text-align: center; opacity: 0.6;">Loading messages...</p>';
    messageInput.disabled = false;
    sendMessageBtn.disabled = false;
    
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    Array.from(userList.children).forEach(el => {
        if (el.querySelector('div')?.textContent.includes(username)) { 
            el.classList.add('active');
        }
    });

    listenForMessages(userId);
}

function listenForMessages(targetUserId) {
    const chatId = getChatId(currentUserId, targetUserId);
    const chatDocRef = getChatRef(chatId);

    messageListener = chatDocRef.collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(50) 
        .onSnapshot(snapshot => {
            messageList.innerHTML = '';
            if (snapshot.empty) {
                messageList.innerHTML = `<p style="text-align: center; opacity: 0.6;">Start a conversation with ${currentChatUsername}!</p>`;
                return;
            }
            snapshot.docs.reverse().forEach(doc => {
                 renderMessage(doc.data());
            });
        }, error => {
            console.error("Error listening to messages:", error);
            messageList.innerHTML = `<p style="text-align: center; color: red;">Error loading messages: ${error.message}</p>`;
        });
}

async function sendMessage() {
    const text = messageInput.value.trim();
    const files = Array.from(imageUpload.files);

    if (!currentChatUserId || (!text && files.length === 0)) return;

    messageInput.disabled = true;
    imageUpload.disabled = true;
    sendMessageBtn.disabled = true;

    const originalBtnText = sendMessageBtn.textContent;
    sendMessageBtn.textContent = 'Uploading...';
    
    let imageUrls = [];
    let failedUploads = 0;

    try {
        const uploadPromises = files.map(file => uploadImageToImgBB(file).catch(e => {
            console.error(`Failed to upload file ${file.name}:`, e);
            failedUploads++;
            return null;
        }));
        
        const results = await Promise.all(uploadPromises);
        imageUrls = results.filter(url => url !== null);

        if (files.length > 0 && imageUrls.length === 0) {
            throw new Error("All images failed to upload. Please check your network or API key.");
        }
        
        if (failedUploads > 0) {
            console.warn(`${failedUploads} image(s) failed to upload and were omitted from the message.`);
        }

        const chatId = getChatId(currentUserId, currentChatUserId);
        const chatDocRef = getChatRef(chatId);
        const timestamp = firebase.firestore.FieldValue.serverTimestamp();
        const messageText = text || (imageUrls.length > 0 ? `[${imageUrls.length} image(s) sent]` : '');

        const message = {
            senderId: currentUserId,
            text: messageText,
            timestamp: timestamp,
            ...(imageUrls.length > 0 && { imageUrls: imageUrls }) 
        };

        await chatDocRef.collection('messages').add(message);
        await chatDocRef.set({
            lastMessage: messageText,
            lastSent: timestamp,
            users: [currentUserId, currentChatUserId],
            ...(imageUrls.length > 0 && { imageUrls: imageUrls }) 
        }, { merge: true });

        messageInput.value = '';
        imageUpload.value = null;
        imagePreviewContainer.innerHTML = '';
        fetchUserContacts(); 

    } catch (e) {
        console.error("Error sending message:", e);
        const errorMessage = e.message || "Failed to send message. Check console for details.";
        const alertModal = document.createElement('div');
        alertModal.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 20px; background: white; border: 2px solid #f44336; z-index: 1000; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
        alertModal.innerHTML = `<p style="color: #f44336; font-weight: bold;">Error Sending Message</p><p>${errorMessage}</p><button onclick="this.parentNode.remove()" style="margin-top: 10px; padding: 5px 10px; background-color: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>`;
        document.body.appendChild(alertModal);
        
    } finally {
        sendMessageBtn.textContent = originalBtnText;
        messageInput.disabled = false;
        imageUpload.disabled = false;
        sendMessageBtn.disabled = !(messageInput.value.trim() || imageUpload.files.length > 0);
    }
}

// --- Event Listeners ---
sendMessageBtn.onclick = sendMessage;
messageInput.onkeypress = (e) => {
    if (e.key === 'Enter' && !(messageInput.disabled || sendMessageBtn.disabled)) sendMessage();
};

messageList.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') {
        const url = e.target.getAttribute('data-original-url');
        if (url) openLightbox(url);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightboxOverlay.classList.contains('active')) {
        closeLightbox();
    }
});

auth.onAuthStateChanged(async (user) => {
    headerTools.innerHTML = '';

    if (user) {
        currentUserId = user.uid;
        headerTools.innerHTML = `<button id="logoutBtn" class="logout-btn">Logout</button>`;
        document.getElementById('logoutBtn').onclick = () => auth.signOut().catch(console.error);
        await fetchUserContacts();
        const targetChatUserId = getChatTargetFromUrl();
        if (targetChatUserId) {
            setTimeout(async () => {
                const username = await fetchUsername(targetChatUserId);
                startChat(targetChatUserId, username);
            }, 300);
        }
    } else {
        currentUserId = null;
        if (messageListener) messageListener();
        currentChatUserId = null;
        headerTools.innerHTML = `<button id="loginBtn" class="login-btn">Login/Register</button>`;
        document.getElementById('loginBtn').onclick = () => window.location.href = '../login';
        userList.innerHTML = '<p style="padding: 10px;">Please log in to use the messenger.</p>';
        chatHeader.textContent = 'Select a user to start chatting';
        messageList.innerHTML = '';
        messageInput.disabled = true;
        sendMessageBtn.disabled = true;
        imageUpload.disabled = true;
        imagePreviewContainer.innerHTML = '';
    }
});

function getChatTargetFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('chat');
}

async function fetchUsername(uid) {
    const snap = await db.collection('artifacts').doc(appId)
        .collection('user_profiles')
        .doc(uid)
        .get();
    return snap.exists ? (snap.data().username || "User") : "User";
}
