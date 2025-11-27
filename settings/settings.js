import { auth, db } from '../firebase-config.js';

// --- DOM Elements ---
const usernameForm = document.getElementById('usernameForm');
const usernameInput = document.getElementById('usernameInput');
const usernameMessage = document.getElementById('usernameMessage');
const currentUsernameSpan = document.getElementById('currentUsername');

const emailForm = document.getElementById('emailForm');
const emailInput = document.getElementById('emailInput');
const emailMessage = document.getElementById('emailMessage');
const currentEmailSpan = document.getElementById('currentEmail');

const passwordForm = document.getElementById('passwordForm');
const passwordInput = document.getElementById('passwordInput');
const passwordMessage = document.getElementById('passwordMessage');

const currentRoleSpan = document.getElementById('currentRole');
const logoutBtn = document.getElementById('logoutBtn');

// Profile picture
const profilePicInput = document.getElementById('profilePicInput');
const profilePicPreview = document.getElementById('profilePicPreview');
const profilePicForm = document.getElementById('profilePicForm');
const profilePicMessage = document.getElementById('profilePicMessage');

let selectedFile = null;

// --- Helper: Get profile document ref ---
function getProfileRef(userId) {
  const appId = 'default-app-id';
  return db
    .collection('artifacts').doc(appId)
    .collection('user_profiles').doc(userId);
}

// --- Convert file → Base64 ---
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Load current user info ---
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = '../login/';
    return;
  }

  const userId = user.uid;

  currentEmailSpan.textContent = user.email || 'Not set';
  emailInput.value = '';

  try {
    const snap = await getProfileRef(userId).get();
    const data = snap.exists ? snap.data() : {};

    currentUsernameSpan.textContent = data.username || 'Not set';
    currentRoleSpan.textContent = data.role || 'Not set';
    usernameInput.value = '';

    if (data.profilePic) {
      profilePicPreview.src = data.profilePic;
    }
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

    usernameMessage.textContent = "Username updated successfully!";
    usernameMessage.className = "form-message success-message";
    currentUsernameSpan.textContent = newUsername;
    usernameInput.value = '';
  } catch (err) {
    usernameMessage.textContent = `Error: ${err.message}`;
    usernameMessage.className = "form-message error-message";
  }
});

// --- Update email ---
emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const newEmail = emailInput.value.trim();
  if (!newEmail) {
    emailMessage.textContent = "Email cannot be empty.";
    emailMessage.className = "form-message error-message";
    return;
  }

  emailMessage.textContent = "Updating...";
  emailMessage.className = "form-message";

  try {
    await user.updateEmail(newEmail);
    emailMessage.textContent = "Email updated successfully!";
    emailMessage.className = "form-message success-message";

    currentEmailSpan.textContent = newEmail;
    emailInput.value = '';
  } catch (err) {
    emailMessage.textContent = `Error: ${err.message}`;
    emailMessage.className = "form-message error-message";
  }
});

// --- Update password ---
passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const newPassword = passwordInput.value.trim();
  if (newPassword.length < 6) {
    passwordMessage.textContent = "Password must be at least 6 characters.";
    passwordMessage.className = "form-message error-message";
    return;
  }

  passwordMessage.textContent = "Updating...";
  passwordMessage.className = "form-message";

  try {
    await user.updatePassword(newPassword);
    passwordMessage.textContent = "Password updated!";
    passwordMessage.className = "form-message success-message";
    passwordInput.value = '';
  } catch (err) {
    passwordMessage.textContent = `Error: ${err.message}`;
    passwordMessage.className = "form-message error-message";
  }
});

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

  profilePicMessage.textContent = "Uploading...";
  profilePicMessage.className = "form-message";

  try {
    const base64 = await fileToBase64(selectedFile);
    await getProfileRef(user.uid).set({ profilePic: base64 }, { merge: true });

    profilePicPreview.src = base64;
    profilePicMessage.textContent = "Profile picture updated!";
    profilePicMessage.className = "form-message success-message";

    selectedFile = null;
    profilePicInput.value = '';
  } catch (err) {
    profilePicMessage.textContent = `Error: ${err.message}`;
    profilePicMessage.className = "form-message error-message";
  }
});

// --- Logout ---
logoutBtn.addEventListener('click', () => {
  auth.signOut().then(() => window.location.href = '../');
});
