import { auth, db } from '../firebase-config.js';

// --- DOM Elements ---
const usernameForm = document.getElementById('usernameForm');
const usernameInput = document.getElementById('usernameInput');
const usernameMessage = document.getElementById('usernameMessage');
const currentUsernameSpan = document.getElementById('currentUsername');

const currentEmailSpan = document.getElementById('currentEmail');

const passwordForm = document.getElementById('passwordForm');
const oldPasswordInput = document.getElementById('oldPasswordInput');
const passwordInput = document.getElementById('passwordInput');
const passwordMessage = document.getElementById('passwordMessage');

const currentRoleSpan = document.getElementById('currentRole');
const logoutBtn = document.getElementById('logoutBtn');

const profilePicInput = document.getElementById('profilePicInput');
const profilePicPreview = document.getElementById('profilePicPreview');
const profilePicForm = document.getElementById('profilePicForm');
const profilePicMessage = document.getElementById('profilePicMessage');

const allowNsfwCheckbox = document.getElementById('allowNsfwCheckbox');
const allowNsfwMessage = document.getElementById('allowNsfwMessage');

let selectedFile = null;

// --- Helper: Get profile document ref ---
function getProfileRef(userId) {
  const appId = 'default-app-id';
  return db
    .collection('artifacts').doc(appId)
    .collection('user_profiles').doc(userId);
}

// --- Load current user info ---
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = '../login/';
    return;
  }

  const userId = user.uid;
  currentEmailSpan.textContent = user.email || 'Not set';

  try {
    const snap = await getProfileRef(userId).get();
    const data = snap.exists ? snap.data() : {};

    currentUsernameSpan.textContent = data.username || 'Not set';
    currentRoleSpan.textContent = data.role || 'Not set';
    usernameInput.value = '';

    if (data.profilePic) {
      profilePicPreview.src = data.profilePic;
    }

    allowNsfwCheckbox.checked = !!data.allowNSFW;

  } catch (err) {
    console.error("Error fetching user profile:", err);
    currentUsernameSpan.textContent = 'Error loading';
    currentRoleSpan.textContent = 'Error loading';
  }
});

// --- Update username ---
usernameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const newUsername = usernameInput.value.trim();
  if (!newUsername) {
    usernameMessage.textContent = "Username cannot be empty.";
    usernameMessage.className = "form-message error-message";
    return;
  }

  usernameMessage.textContent = "Updating...";
  usernameMessage.className = "form-message";

  try {
    await user.updateProfile({ displayName: newUsername });
    await getProfileRef(user.uid).set({ username: newUsername }, { merge: true });

    // Update denormalized data
    await db.collection('denormalized_data').doc('users').set({
      [user.uid]: { username: newUsername }
    }, { merge: true });

    usernameMessage.textContent = "Username updated successfully!";
    usernameMessage.className = "form-message success-message";
    currentUsernameSpan.textContent = newUsername;
    usernameInput.value = '';
  } catch (err) {
    usernameMessage.textContent = `Error: ${err.message}`;
    usernameMessage.className = "form-message error-message";
  }
});

// --- Update password ---
passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const oldPassword = oldPasswordInput.value.trim();
  const newPassword = passwordInput.value.trim();

  if (!oldPassword) {
    passwordMessage.textContent = "Old password is required.";
    passwordMessage.className = "form-message error-message";
    return;
  }

  if (newPassword.length < 6) {
    passwordMessage.textContent = "New password must be at least 6 characters.";
    passwordMessage.className = "form-message error-message";
    return;
  }

  passwordMessage.textContent = "Verifying and updating...";
  passwordMessage.className = "form-message";

  try {
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, oldPassword);
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(newPassword);

    passwordMessage.textContent = "Password updated successfully!";
    passwordMessage.className = "form-message success-message";

    oldPasswordInput.value = '';
    passwordInput.value = '';
  } catch (err) {
    passwordMessage.textContent = `Error: ${err.message}`;
    passwordMessage.className = "form-message error-message";
  }
});

// --- NEW: ImgBB Upload config ---
const IMGBB_UPLOAD_URL = 'https://imgbbapi.stanislav-zhukov.workers.dev/';

// --- Process Image: Crop to Square + Resize to 70x70 WebP ---
function processProfileImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Target dimensions
      const size = 70;
      canvas.width = size;
      canvas.height = size;

      // Calculate "Center Crop" (Object-Fit: Cover)
      let sourceX = 0, sourceY = 0, sourceWidth = img.width, sourceHeight = img.height;

      const aspect = img.width / img.height;

      if (aspect > 1) {
        // Landscape: Height is the constraint
        sourceHeight = img.height;
        sourceWidth = img.height; // Make it square
        sourceX = (img.width - img.height) / 2;
      } else {
        // Portrait: Width is the constraint
        sourceWidth = img.width;
        sourceHeight = img.width; // Make it square
        sourceY = (img.height - img.width) / 2;
      }

      // Draw cropped image resized to 70x70
      ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size, size);

      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Image processing failed"));
        resolve(blob);
      }, 'image/webp', 0.9);
    };
    img.onerror = reject;
  });
}

// --- Click avatar opens file picker ---
profilePicPreview.addEventListener('click', () => {
  profilePicInput.click();
});

// --- Preview profile picture when selected ---
profilePicInput.addEventListener('change', () => {
  const file = profilePicInput.files[0];
  if (!file) return;
  selectedFile = file;

  profilePicPreview.src = URL.createObjectURL(file);
  profilePicMessage.textContent = "Preview ready. Click 'Save Picture' to upload.";
  profilePicMessage.className = "form-message";
});

// --- Upload profile picture when Save Picture clicked ---
profilePicForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedFile) {
    profilePicMessage.textContent = "Please choose an image first.";
    profilePicMessage.className = "form-message error-message";
    return;
  }

  const user = auth.currentUser;
  if (!user) return;

  profilePicMessage.textContent = "Processing & Uploading...";
  profilePicMessage.className = "form-message";

  try {
    // 1. Process Image (70x70 WebP)
    const processedBlob = await processProfileImage(selectedFile);

    // 2. Upload to ImgBB
    const formData = new FormData();
    formData.append('image', processedBlob, 'profile.webp');

    const response = await fetch(IMGBB_UPLOAD_URL, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || "Upload failed");
    }

    const imageUrl = result.data.url;

    // 3. Save URL to Firestore
    await getProfileRef(user.uid).set({ profilePic: imageUrl }, { merge: true });

    // Update denormalized data
    await db.collection('denormalized_data').doc('users').set({
      [user.uid]: { profilePic: imageUrl }
    }, { merge: true });

    profilePicPreview.src = imageUrl;
    profilePicMessage.textContent = "Profile picture updated!";
    profilePicMessage.className = "form-message success-message";

    selectedFile = null;
    profilePicInput.value = '';
  } catch (err) {
    console.error(err);
    profilePicMessage.textContent = `Error: ${err.message}`;
    profilePicMessage.className = "form-message error-message";
  }
});

// --- Save NSFW preference when toggled ---
allowNsfwCheckbox.addEventListener('change', async () => {
  const user = auth.currentUser;
  if (!user) return;

  allowNsfwMessage.textContent = "Saving...";
  allowNsfwMessage.className = "form-message";

  try {
    await getProfileRef(user.uid).set(
      { allowNSFW: allowNsfwCheckbox.checked },
      { merge: true }
    );

    allowNsfwMessage.textContent = "Saved!";
    allowNsfwMessage.className = "form-message success-message";
  } catch (err) {
    allowNsfwMessage.textContent = `Error: ${err.message}`;
    allowNsfwMessage.className = "form-message error-message";
  }
});

// --- Logout ---
logoutBtn.addEventListener('click', () => {
  auth.signOut().then(() => window.location.href = '../');
});
