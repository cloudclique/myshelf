import { auth, db } from '../firebase-config.js';
// import {Messimages} from '../utils.js'; // REMOVED: Key is now in Cloudflare Worker

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
let contactsListener = null; // To store the contacts list listener

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

async function processImage(file, maxSizeMB = 1) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();

        reader.onload = (e) => {
            img.src = e.target.result;
        };
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            const MAX_DIMENSION = 1920; // optional max width/height

            // maintain aspect ratio, resize if needed
            if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
                width = width * ratio;
                height = height * ratio;
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to WebP and compress to fit maxSizeMB
            let quality = 0.92; // start with high quality
            function attemptExport() {
                canvas.toBlob(
                    (blob) => {
                        if (blob.size / 1024 / 1024 > maxSizeMB && quality > 0.1) {
                            quality -= 0.05;
                            attemptExport();
                        } else {
                            resolve(blob);
                        }
                    },
                    'image/webp',
                    quality
                );
            }
            attemptExport();
        };
        img.onerror = reject;
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// --- MODIFIED: UPLOAD FUNCTION NOW TARGETS CLOUDFLARE WORKER ---
async function uploadImageToImgBB(file) {
    try {
        const processedBlob = await processImage(file, 1); // 1MB max
        const formData = new FormData();

        // Append the processed image. The Worker will add the API key.
        formData.append('image', processedBlob, file.name.replace(/\.\w+$/, '.webp'));

        // REMOVED: formData.append('key', Messimages);

        // Fetch the Cloudflare Worker endpoint (adjust URL if needed)
        const response = await fetch('https://imgbbapi.stanislav-zhukov.workers.dev/', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            // Attempt to parse the error response from the worker/ImgBB
            let errorData;
            try {
                errorData = await response.json();
            } catch (e) {
                // If it's not JSON, use status text
                throw new Error(`Upload failed: ${response.statusText}`);
            }
            // Use the error message from the proxied ImgBB response
            throw new Error(`Upload failed: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        // The worker proxies the result, so we still expect data.data.url
        return data.data.url;
    } catch (error) {
        console.error("Error uploading image:", error);
        throw new Error("Image upload service failed. Check network or Cloudflare Worker setup.");
    }
}
// -----------------------------------------------------------------


window.openLightbox = function (url) {
    lightboxImage.src = url;
    lightboxOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

window.closeLightbox = function () {
    lightboxOverlay.classList.remove('active');
    lightboxImage.src = '';
    document.body.style.overflow = '';
}

function renderMessage(message, docId = null) {
    const isSent = message.senderId === currentUserId;
    const time = message.timestamp
        ? new Date(message.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Sending...';

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    messageDiv.style.position = 'relative'; // For menu positioning

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

    messageDiv.innerHTML = `
        ${contentHtml}
        <span class="message-time">${time}</span>
        ${isSent ? '<button class="message-menu-btn"><i class="bi bi-three-dots"></i></button>' : ''}
    `;

    if (isSent && docId) {
        const menuBtn = messageDiv.querySelector('.message-menu-btn');
        menuBtn.style.position = 'absolute';
        menuBtn.style.top = '4px';
        menuBtn.style.left = '-25px';
        menuBtn.style.border = 'none';
        menuBtn.style.background = 'transparent';
        menuBtn.style.cursor = 'pointer';
        menuBtn.style.fontSize = '20px';
        menuBtn.style.lineHeight = '1'; // horizontal dots
        menuBtn.style.color = "#1f1f1fff";

        const menu = document.createElement('div');
        menu.className = 'message-context-menu';
        menu.style.position = 'absolute';
        menu.style.top = '26px';
        menu.style.left = '-30px';
        menu.style.background = '#242424ff';
        menu.style.border = 'none';
        menu.style.padding = '4px 0';
        menu.style.borderRadius = '15px';
        menu.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
        menu.style.display = 'none';
        menu.style.zIndex = 10;
        menu.innerHTML = `<div class="menu-item" style="padding: 4px 12px; cursor: pointer;">Delete</div>`;
        messageDiv.appendChild(menu);

        menuBtn.onclick = (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        };

        // Hide menu when clicking elsewhere
        document.addEventListener('click', () => {
            menu.style.display = 'none';
        });

        // Delete message immediately on click and update lastMessage
        menu.querySelector('.menu-item').onclick = async () => {
            try {
                const chatId = getChatId(currentUserId, currentChatUserId);
                const chatRef = getChatRef(chatId);

                // Delete the message from Firestore
                await chatRef.collection('messages').doc(docId).delete();
                messageDiv.remove();

                // Recompute the last message for the chat
                const messagesSnap = await chatRef.collection('messages')
                    .orderBy('timestamp', 'desc')
                    .limit(1)
                    .get();

                if (!messagesSnap.empty) {
                    const lastMsg = messagesSnap.docs[0].data();
                    await chatRef.set({
                        lastMessage: lastMsg.text || (lastMsg.imageUrls?.length ? `[${lastMsg.imageUrls.length} image(s) sent]` : ''),
                        lastSent: lastMsg.timestamp || firebase.firestore.FieldValue.serverTimestamp(),
                        users: [currentUserId, currentChatUserId],
                        ...(lastMsg.imageUrls?.length > 0 && { imageUrls: lastMsg.imageUrls })
                    }, { merge: true });
                } else {
                    // If no messages left, clear lastMessage
                    await chatRef.set({
                        lastMessage: '',
                        lastSent: firebase.firestore.FieldValue.serverTimestamp(),
                        users: [currentUserId, currentChatUserId],
                        imageUrls: []
                    }, { merge: true });
                }

                // Refresh the contact list
                fetchUserContacts();

            } catch (err) {
                console.error("Failed to delete message:", err);
            }
        };
    }

    messageList.prepend(messageDiv);
}

// --- Image Preview Logic ---
imageUpload.onchange = function () {
    imagePreviewContainer.innerHTML = '';
    const files = Array.from(imageUpload.files);
    let filesToUse = files;

    if (files.length > MAX_IMAGES) {
        filesToUse = files.slice(0, MAX_IMAGES);
        // Reset the file input to only include the first MAX_IMAGES
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

imagePreviewContainer.onclick = function (e) {
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
        imageUpload.dispatchEvent(new Event('change')); // Trigger change to update previews/button state
    }
};

messageInput.oninput = function () {
    sendMessageBtn.disabled = !(messageInput.value.trim() || imageUpload.files.length > 0);
};

async function fetchUserContacts() {
    if (!currentUserId) return;
    if (contactsListener) contactsListener();

    try {
        const chatsRef = db
            .collection('artifacts')
            .doc(appId)
            .collection('chats');

        contactsListener = chatsRef
            .where('users', 'array-contains', currentUserId)
            .onSnapshot(async (chatsSnap) => {
                // Build data FIRST (no DOM touching yet)
                const contactUids = new Set();
                const chatData = {};

                chatsSnap.forEach(doc => {
                    const data = doc.data();
                    const otherUserId = data.users?.find(uid => uid !== currentUserId);
                    if (!otherUserId) return;

                    contactUids.add(otherUserId);
                    chatData[otherUserId] = {
                        lastMessage:
                            data.lastMessage ||
                            (data.imageUrls?.length
                                ? `[${data.imageUrls.length} image(s) sent]`
                                : ''),
                        lastSent: data.lastSent
                            ? data.lastSent.toDate()
                            : new Date(0),
                        unreadCount: data.unreadCount?.[currentUserId] || 0
                    };
                });

                if (contactUids.size === 0) {
                    if (userList.children.length === 0) {
                        userList.innerHTML = '<p style="padding:10px;">No conversations yet.</p>';
                    }
                    return;
                }

                // Fetch profiles in parallel... 
                // To avoid flickering, we still fetch profiles, but maybe we can cache them.
                // For now, let's keep it simple.
                renderContacts(contactUids, chatData);
            }, err => {
                console.error('Contacts listener error:', err);
            });
    } catch (err) {
        console.error('Failed to setup contacts listener:', err);
    }
}

async function renderContacts(contactUids, chatData) {
    try {
        const profiles = await Promise.all(
            [...contactUids].map(async uid => {
                const snap = await getProfilesRef().doc(uid).get();
                if (!snap.exists) return null;

                return {
                    uid,
                    username: snap.data().username || `User ${uid.slice(0, 6)}`,
                    profilePic: snap.data().profilePic || 'https://placehold.co/40x40',
                    ...chatData[uid]
                };
            })
        );

        const contacts = profiles
            .filter(Boolean)
            .sort((a, b) => b.lastSent.getTime() - a.lastSent.getTime());

        const fragment = document.createDocumentFragment();

        contacts.forEach(user => {
            const item = document.createElement('div');
            item.className = 'chat-item';
            if (currentChatUserId === user.uid) item.classList.add('active');

            const lastTime = user.lastSent.getTime() === 0
                ? ''
                : user.lastSent.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            item.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px">
                    <img src="${user.profilePic}" class="small-user-avatar" loading="lazy">
                    <div style="flex:1">
                        <div class="chat-item-header">
                            <div style="font-weight:bold">${user.username}</div>
                            ${user.unreadCount > 0 ? `<span class="unread-badge">${user.unreadCount}</span>` : ''}
                        </div>
                        <div style="font-size:.8em;color:#555;display:flex;justify-content:space-between">
                            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:75%">
                                ${user.lastMessage}
                            </span>
                            <span>${lastTime}</span>
                        </div>
                    </div>
                </div>
            `;

            item.onclick = () => startChat(user.uid, user.username);
            fragment.appendChild(item);
        });

        userList.replaceChildren(fragment);
    } catch (err) {
        console.error('Failed to render contacts:', err);
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

    // Highlight the active chat item
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    Array.from(userList.children).forEach(el => {
        // This is a crude way to check, relying on the username in the inner HTML
        if (el.querySelector('div')?.textContent.includes(username)) {
            el.classList.add('active');
        }
    });

    listenForMessages(userId);

    // Mark as seen and reset unread count
    const chatId = getChatId(currentUserId, userId);
    getChatRef(chatId).set({
        lastSeenBy: {
            [currentUserId]: firebase.firestore.FieldValue.serverTimestamp()
        },
        unreadCount: {
            [currentUserId]: 0
        }
    }, { merge: true }).catch(console.error);

    handleLayout();
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
            // Reverse to display chronologically from bottom up (since we are using flex-direction: column-reverse)
            snapshot.docs.reverse().forEach(doc => {
                renderMessage(doc.data(), doc.id); // pass doc.id for deletion
            });

            // Mark as seen and reset unread count when new messages arrive while in chat
            chatDocRef.set({
                lastSeenBy: {
                    [currentUserId]: firebase.firestore.FieldValue.serverTimestamp()
                },
                unreadCount: {
                    [currentUserId]: 0
                }
            }, { merge: true }).catch(console.error);
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
        // Upload all images concurrently
        const uploadPromises = files.map(file => uploadImageToImgBB(file).catch(e => {
            console.error(`Failed to upload file ${file.name}:`, e);
            failedUploads++;
            return null; // Return null for failed uploads
        }));

        const results = await Promise.all(uploadPromises);
        imageUrls = results.filter(url => url !== null); // Filter out failed uploads

        if (files.length > 0 && imageUrls.length === 0) {
            // If the user only sent images and all of them failed
            throw new Error("All images failed to upload. Please check your network or Worker endpoint.");
        }

        if (failedUploads > 0) {
            console.warn(`${failedUploads} image(s) failed to upload and were omitted from the message.`);
        }

        const chatId = getChatId(currentUserId, currentChatUserId);
        const chatDocRef = getChatRef(chatId);
        // Use firebase.firestore.FieldValue.serverTimestamp() for reliable time
        const timestamp = firebase.firestore.FieldValue.serverTimestamp();
        // Determine message text content
        const messageText = text || (imageUrls.length > 0 ? `[${imageUrls.length} image(s) sent]` : '');

        const message = {
            senderId: currentUserId,
            text: messageText,
            timestamp: timestamp,
            // Only include imageUrls if there are any successful uploads
            ...(imageUrls.length > 0 && { imageUrls: imageUrls })
        };

        // 1. Add the message to the chat's message collection
        await chatDocRef.collection('messages').add(message);

        // 2. Update the parent chat document with the last message summary
        await chatDocRef.set({
            lastMessage: messageText,
            lastSent: timestamp,
            lastSenderId: currentUserId,
            users: [currentUserId, currentChatUserId],
            lastSeenBy: {
                [currentUserId]: timestamp
            },
            unreadCount: {
                [currentChatUserId]: firebase.firestore.FieldValue.increment(1)
            },
            // Update last image data for contact list preview (optional, but good)
            ...(imageUrls.length > 0 && { imageUrls: imageUrls })
        }, { merge: true });

        // Clear input fields and reset state
        messageInput.value = '';
        imageUpload.value = null; // Clear file input
        imagePreviewContainer.innerHTML = '';
        fetchUserContacts(); // Refresh contact list to show the new message

    } catch (e) {
        console.error("Error sending message:", e);
        const errorMessage = e.message || "Failed to send message. Check console for details.";
        // Simple error modal for user feedback
        const alertModal = document.createElement('div');
        alertModal.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 20px; background: white; border: 2px solid #f44336; z-index: 1000; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
        alertModal.innerHTML = `<p style="color: #f44336; font-weight: bold;">Error Sending Message</p><p>${errorMessage}</p><button onclick="this.parentNode.remove()" style="margin-top: 10px; padding: 5px 10px; background-color: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>`;
        document.body.appendChild(alertModal);

    } finally {
        sendMessageBtn.textContent = originalBtnText;
        messageInput.disabled = false;
        imageUpload.disabled = false;
        // Re-check button state based on current input values
        sendMessageBtn.disabled = !(messageInput.value.trim() || imageUpload.files.length > 0);
    }
}

// --- Event Listeners ---
sendMessageBtn.onclick = sendMessage;
messageInput.onkeypress = (e) => {
    if (e.key === 'Enter' && !(messageInput.disabled || sendMessageBtn.disabled)) sendMessage();
};

// Event listener for opening the lightbox when clicking an image
messageList.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') {
        const url = e.target.getAttribute('data-original-url');
        if (url) openLightbox(url);
    }
});

// Event listener for closing the lightbox with the Escape key
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
        // Handle direct chat link from URL parameter
        const targetChatUserId = getChatTargetFromUrl();
        if (targetChatUserId) {
            setTimeout(async () => {
                const username = await fetchUsername(targetChatUserId);
                startChat(targetChatUserId, username);
            }, 300); // Small delay to ensure contacts are loaded first
        }
    } else {
        // User is logged out
        currentUserId = null;
        if (messageListener) messageListener();
        if (contactsListener) contactsListener();
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
    setupHeaderLogoRedirect();
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

// --- Redirect to the logged-in user's profile when clicking the header logo ---
function setupHeaderLogoRedirect() {
    const logo = document.querySelector('.header-logo');
    if (!logo) return;

    logo.style.cursor = 'pointer';
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

function handleLayout() {
    const chatArea = document.getElementById('chatArea');
    const userList = document.getElementById('userList');
    const sidebar = document.querySelector('.sidebar');
    const backBtn = document.getElementById('backBtn');

    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // If we are currently chatting with someone, keep the chat open
        if (currentChatUserId) {
            sidebar.style.display = 'none';
            userList.style.display = 'none';
            chatArea.style.display = 'flex';
        } else {
            // Otherwise, show the contact list
            sidebar.style.display = 'flex';
            userList.style.display = 'flex';
            chatArea.style.display = 'none';
        }

        // Back button functionality
        if (backBtn) {
            backBtn.onclick = () => {
                currentChatUserId = null; // Clear state so layout knows we're back at list
                chatArea.style.display = 'none';
                userList.style.display = 'flex';
                sidebar.style.display = 'flex';
                // Remove active class from list items
                document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
            };
        }
    } else {
        // DESKTOP STATE: Always show both
        sidebar.style.display = 'flex';
        userList.style.display = 'flex';
        chatArea.style.display = 'flex';

        if (backBtn) backBtn.onclick = null;
    }
}

// Run on load
handleLayout();

// Run on resize
window.addEventListener('resize', handleLayout);
