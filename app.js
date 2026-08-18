// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyD90WyMrs-VMPFcCA5QOQ3tMEoqLM2phmg",
    authDomain: "file-system-f2378.firebaseapp.com",
    projectId: "file-system-f2378",
    storageBucket: "file-system-f2378.firebasestorage.app",
    messagingSenderId: "1021373403179",
    appId: "1:1021373403179:web:20f4fcf163f58bc80eda6e",
    measurementId: "G-WBN6J0Q03C"
};

// Initialize Firebase
let auth = null;
let db = null;
const FIRESTORE_CHUNK_SIZE = 700 * 1024;
let uploadQueue = [];
let uploadQueueIndex = 0;
let uploadedDirectoryName = "";

console.log("app.js loaded");

try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    console.log("✅ Firebase connected (Option 2 Mode)");
} catch (initError) {
    console.error("Firebase initialization failed:", initError);
}

function setButtonLoading(button, isLoading, label) {
    if (!button) return;
    if (isLoading) {
        button.dataset.originalContent = button.innerHTML;
        button.disabled = true;
        button.classList.add("is-loading");
        button.setAttribute("aria-busy", "true");
        button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${label}</span>`;
        return;
    }
    button.disabled = false;
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
    if (button.dataset.originalContent) button.innerHTML = button.dataset.originalContent;
}

function setAuthLoading(isLoading, activeButton, label) {
    const loginButton = document.getElementById("loginButton");
    const signupButton = document.getElementById("signupButton");
    [loginButton, signupButton].forEach((button) => {
        if (!button) return;
        if (button === activeButton) setButtonLoading(button, isLoading, label);
        else button.disabled = isLoading;
    });
}

function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    button.setAttribute("aria-label", `${isHidden ? "Hide" : "Show"} ${inputId === "password" ? "password" : "secret key"}`);
    button.setAttribute("aria-pressed", String(isHidden));
    button.innerHTML = isHidden
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m3 3 18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17.6 17.6 0 0 1-3.2 3.8M6.1 6.1A17.8 17.8 0 0 0 2.5 12S6 18 12 18c1.4 0 2.7-.3 3.8-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
}

function getFriendlyAuthError(error, action) {
    const code = error?.code || "";
    const messages = {
        "auth/invalid-email": "Enter a valid email address.",
        "auth/missing-email": "Enter your email address to continue.",
        "auth/missing-password": "Enter your password to continue.",
        "auth/weak-password": "Choose a stronger password with at least 6 characters.",
        "auth/email-already-in-use": "An account already exists for this email. Try signing in instead.",
        "auth/invalid-credential": "The email address or password is incorrect.",
        "auth/user-not-found": "The email address or password is incorrect.",
        "auth/wrong-password": "The email address or password is incorrect.",
        "auth/user-disabled": "This account has been disabled. Please contact support.",
        "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
        "auth/network-request-failed": "We could not reach the service. Check your internet connection and try again."
    };
    return messages[code] || (action === "signup" ? "We could not create your account. Please try again." : "We could not sign you in. Please try again.");
}

function getFriendlyUploadError(error) {
    if (error?.code === "resource-exhausted") return "This file is too large for the available Firestore quota. Try a smaller file.";
    if (error?.code === "permission-denied") return "Firestore security rules need updating before encrypted file chunks can be saved.";
    return "The file could not be encrypted and saved. Please try again.";
}

function getFriendlyFileActionError(error, action) {
    const code = error?.code || "";
    if (code === "permission-denied") {
        return "Firestore security rules are blocking this action. Publish the updated rules for file chunks.";
    }
    if (error?.message?.includes("chunks are missing")) {
        return "This encrypted file is incomplete and cannot be recovered.";
    }
    if (error?.message?.includes("data is missing")) {
        return "This file uses an older storage format that is no longer available.";
    }
    if (action === "delete") return "The file could not be deleted. Please try again.";
    return "Decryption failed. Check your secret key and try again.";
}

async function handlePasswordReset() {
    const email = document.getElementById("resetEmail").value.trim();
    const button = document.getElementById("resetButton");
    const msg = document.getElementById("message");
    setButtonLoading(button, true, "Sending reset link");

    try {
        await auth.sendPasswordResetEmail(email);
        msg.style.color = "#1f7a5c";
        msg.innerText = "If an account uses this email, a password reset link has been sent.";
    } catch (error) {
        msg.style.color = "#bd3f4b";
        if (error.code === "auth/invalid-email" || error.code === "auth/missing-email") {
            msg.innerText = "Enter a valid email address to receive a reset link.";
        } else if (error.code === "auth/network-request-failed") {
            msg.innerText = "We could not reach the service. Check your internet connection and try again.";
        } else if (error.code === "auth/too-many-requests") {
            msg.innerText = "Too many attempts. Please wait a moment and try again.";
        } else {
            msg.innerText = "We could not send the reset link. Please try again.";
        }
    } finally {
        setButtonLoading(button, false);
    }
}

function formatStoredAt(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== "function") return "just now";
    return new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(timestamp.toDate());
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function deriveKeyFromPassword(password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode("secure-salt"), iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
}

async function wrapKeyWithPassword(keyBytes, password) {
    const wrappingKey = await deriveKeyFromPassword(password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedBytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, keyBytes);
    return {
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(wrappedBytes))
    };
}

async function unwrapKeyWithPassword(wrappedKey, password) {
    if (!wrappedKey?.iv || !wrappedKey?.data) throw new Error("Missing wrapped key data.");
    const wrappingKey = await deriveKeyFromPassword(password);
    const iv = base64ToBytes(wrappedKey.iv);
    const data = base64ToBytes(wrappedKey.data);
    const unwrappedBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wrappingKey, data);
    return new Uint8Array(unwrappedBytes);
}

function getStoredFolders() {
    try {
        const raw = localStorage.getItem("secureVaultFolders");
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveStoredFolders(folders) {
    localStorage.setItem("secureVaultFolders", JSON.stringify(folders));
}

function getUnlockedFolders() {
    try {
        const raw = localStorage.getItem("secureUnlockedFolders");
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveUnlockedFolders(folderNames) {
    localStorage.setItem("secureUnlockedFolders", JSON.stringify(folderNames));
}

function lockFolder(folderName) {
    if (!folderName) return;
    unlockedFolders = unlockedFolders.filter((name) => name !== folderName);
    saveUnlockedFolders(unlockedFolders);
}

function loadStoredFolders() {
    const folderSelect = document.getElementById("folderSelect");
    const folderManagementList = document.getElementById("folderManagementList");
    const storedFolders = getStoredFolders();

    if (folderSelect) {
        folderSelect.innerHTML = '<option value="">No folder</option>';
        storedFolders.forEach((folder) => {
            const option = document.createElement("option");
            option.value = folder.name;
            option.textContent = folder.name;
            folderSelect.appendChild(option);
        });
    }

    if (folderManagementList) {
        if (!storedFolders.length) {
            folderManagementList.innerHTML = '<div class="empty-state"><p>No folders yet.</p></div>';
            return;
        }
        folderManagementList.innerHTML = storedFolders.map((folder) => `
            <div class="folder-item">
                <strong>${escapeHtml(folder.name)}</strong>
                <div class="folder-actions">
                    <button class="btn btn-primary" type="button" onclick="openFolderUnlockDialog('${encodeURIComponent(folder.name)}')">Unlock</button>
                    <button class="btn btn-warning" type="button" onclick="openFolderResetDialog('${encodeURIComponent(folder.name)}')" ${folder.recoveryPassword ? "" : "disabled title='No folder recovery key configured'"}>Reset</button>
                    <button class="btn btn-delete" type="button" onclick="deleteFolder('${encodeURIComponent(folder.name)}')">Delete</button>
                </div>
            </div>
        `).join("");
    }
}

async function deleteFolder(encodedFolderName) {
    const folderName = decodeURIComponent(encodedFolderName);
    if (!folderName) {
        showToast("Folder not found.", "error");
        return;
    }

    if (!confirm(`Delete folder "${folderName}" and ALL files inside it? This will permanently remove the folder and every file it contains from your vault. This action cannot be undone.`)) {
        return;
    }

    try {
        // Permanently delete all files (and their encrypted chunks) that belong to this folder.
        const user = auth.currentUser;
        if (user) {
            const snapshot = await db.collection("files")
                .where("ownerID", "==", user.uid)
                .where("folderName", "==", folderName)
                .get();

            let batch = db.batch();
            let operations = 0;
            const commits = [];

            for (const doc of snapshot.docs) {
                const fileRef = db.collection("files").doc(doc.id);
                await deleteFileChunks(fileRef);
                batch.delete(fileRef);
                operations += 1;
                if (operations === 450) {
                    commits.push(batch.commit());
                    batch = db.batch();
                    operations = 0;
                }
            }
            if (operations > 0) commits.push(batch.commit());
            await Promise.all(commits);
        }
    } catch (error) {
        console.error("[SecureVault] Folder deletion failed", error);
        showToast("The folder could not be deleted. Please try again.", "error");
        return;
    }

    const storedFolders = getStoredFolders();
    const remaining = storedFolders.filter((item) => item.name !== folderName);
    saveStoredFolders(remaining);
    lockFolder(folderName);
    if (activeFolderView === folderName) {
        activeFolderView = null;
    }

    loadStoredFolders();
    refreshVault();
    showToast(`Folder "${folderName}" and all files inside it were permanently removed from your vault.`, "success");
}

function createFolder() {
    const folderName = document.getElementById("folderName")?.value?.trim();
    const folderPassword = document.getElementById("folderPasswordCreate")?.value?.trim();
    const folderRecoveryPassword = document.getElementById("folderRecoveryPassword")?.value?.trim();
    if (!folderName || !folderPassword) {
        showToast("Enter both a folder name and folder password.", "error");
        return;
    }
    const folders = getStoredFolders();
    const existing = folders.find((folder) => folder.name === folderName);
    if (existing) {
        if (existing.password !== btoa(folderPassword)) {
            showToast("A folder with that name already exists. Use a different name.", "error");
            return;
        }
        showToast("Folder already exists. Select it when uploading a file.", "success");
    } else {
        const folderData = {
            name: folderName,
            password: btoa(folderPassword)
        };
        if (folderRecoveryPassword) {
            folderData.recoveryPassword = btoa(folderRecoveryPassword);
        }
        folders.push(folderData);
        saveStoredFolders(folders);
        showToast("Folder is ready. Select it when uploading a file.", "success");
    }

    document.getElementById("folderName").value = "";
    document.getElementById("folderPasswordCreate").value = "";
    document.getElementById("folderRecoveryPassword").value = "";
    loadStoredFolders();
}

async function deleteFileChunks(fileRef) {
    const chunks = await fileRef.collection("chunks")
        .where("ownerID", "==", auth.currentUser.uid)
        .get();
    let batch = db.batch();
    let operations = 0;
    const commits = [];

    chunks.forEach((chunk) => {
        batch.delete(chunk.ref);
        operations += 1;
        if (operations === 450) {
            commits.push(batch.commit());
            batch = db.batch();
            operations = 0;
        }
    });
    if (operations > 0) commits.push(batch.commit());
    await Promise.all(commits);
}

let pendingDecryption = null;
let pendingDeletion = null;
let pendingUnlockFolder = null;
let pendingResetFolder = null;
let pendingResetFile = null;
let unlockedFolders = [];
let activeFolderView = null;
let vaultUnsubscribe = null;

function refreshVault() {
    if (vaultUnsubscribe) {
        vaultUnsubscribe();
        vaultUnsubscribe = null;
    }
    loadVault();
}

function openFolderUnlockDialog(encodedFolderName) {
    pendingUnlockFolder = encodedFolderName;
    const folderName = decodeURIComponent(encodedFolderName);
    const modal = document.getElementById("folderUnlockModal");
    const folderTitle = document.getElementById("folderUnlockName");
    const passwordInput = document.getElementById("folderUnlockPassword");
    if (!modal || !folderTitle || !passwordInput) return;

    folderTitle.textContent = folderName;
    passwordInput.value = "";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    window.setTimeout(() => passwordInput.focus(), 50);
}

function closeFolderUnlockDialog() {
    const modal = document.getElementById("folderUnlockModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    pendingUnlockFolder = null;
}

function clearFolderView() {
    activeFolderView = null;
    refreshVault();
}

function openFolderView(encodedFolderName) {
    activeFolderView = decodeURIComponent(encodedFolderName);
    refreshVault();
}

async function submitFolderUnlock() {
    const passwordInput = document.getElementById("folderUnlockPassword");
    const password = passwordInput?.value?.trim() || "";
    if (!pendingUnlockFolder) return;
    if (!password) {
        showToast("Enter the folder password to unlock it.", "error");
        return;
    }

    const folderName = decodeURIComponent(pendingUnlockFolder);
    const storedFolder = getStoredFolders().find((folder) => folder.name === folderName);
    const encodedEntry = btoa(password);
    let passwordMatches = false;
    let recoveryMatches = false;

    if (storedFolder) {
        passwordMatches = storedFolder.password === encodedEntry;
        recoveryMatches = storedFolder.recoveryPassword && storedFolder.recoveryPassword === encodedEntry;
    }

    if (!passwordMatches && !recoveryMatches) {
        const querySnapshot = await db.collection("files")
            .where("ownerID", "==", auth.currentUser.uid)
            .where("folderName", "==", folderName)
            .limit(1)
            .get();
        querySnapshot.forEach((doc) => {
            const file = doc.data();
            if (file.folderPassword === encodedEntry) {
                passwordMatches = true;
            }
        });
    }

    if (!passwordMatches && !recoveryMatches) {
        showToast("Folder password is incorrect.", "error");
        return;
    }

    if (!unlockedFolders.includes(folderName)) {
        unlockedFolders.push(folderName);
        saveUnlockedFolders(unlockedFolders);
    }

    activeFolderView = folderName;
    showToast(`Folder "${folderName}" is unlocked${recoveryMatches ? " with recovery key" : ""}.`, "success");
    closeFolderUnlockDialog();
    loadStoredFolders();
    refreshVault();
}

function openFolderResetDialog(encodedFolderName) {
    pendingResetFolder = encodedFolderName;
    const folderName = decodeURIComponent(encodedFolderName);
    const modal = document.getElementById("folderResetModal");
    const folderTitle = document.getElementById("folderResetName");
    const recoveryInput = document.getElementById("folderResetRecoveryPassword");
    const newPasswordInput = document.getElementById("folderResetNewPassword");
    const confirmPasswordInput = document.getElementById("folderResetConfirmPassword");
    const recoveredPasswordSection = document.getElementById("recoveredFolderPasswordSection");
    const recoveredPasswordInput = document.getElementById("recoveredFolderPassword");
    if (!modal || !folderTitle || !recoveryInput || !newPasswordInput || !confirmPasswordInput) return;

    folderTitle.textContent = folderName;
    recoveryInput.value = "";
    newPasswordInput.value = "";
    confirmPasswordInput.value = "";
    if (recoveredPasswordSection) recoveredPasswordSection.hidden = true;
    if (recoveredPasswordInput) {
        recoveredPasswordInput.value = "";
        recoveredPasswordInput.type = "password";
    }
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    window.setTimeout(() => recoveryInput.focus(), 50);
}

function closeFolderResetDialog() {
    const modal = document.getElementById("folderResetModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    pendingResetFolder = null;
}

async function saveEncryptedChunks(fileRef, combined) {
    const chunkCount = Math.ceil(combined.byteLength / FIRESTORE_CHUNK_SIZE);
    const concurrency = 4;
    for (let startIndex = 0; startIndex < chunkCount; startIndex += concurrency) {
        const writes = [];
        for (let index = startIndex; index < Math.min(startIndex + concurrency, chunkCount); index++) {
            const chunk = combined.slice(index * FIRESTORE_CHUNK_SIZE, (index + 1) * FIRESTORE_CHUNK_SIZE);
            writes.push(fileRef.collection("chunks").doc(String(index).padStart(6, "0")).set({
                data: bytesToBase64(chunk),
                ownerID: auth.currentUser.uid
            }));
        }
        await Promise.all(writes);
    }
    return chunkCount;
}

function revealFolderPassword() {
    const recoveryPassword = document.getElementById("folderResetRecoveryPassword")?.value?.trim() || "";
    const recoveredPasswordSection = document.getElementById("recoveredFolderPasswordSection");
    const recoveredPasswordInput = document.getElementById("recoveredFolderPassword");
    if (!pendingResetFolder || !recoveryPassword) {
        showToast("Enter the folder recovery key first.", "error");
        return;
    }

    const folderName = decodeURIComponent(pendingResetFolder);
    const storedFolder = getStoredFolders().find((folder) => folder.name === folderName);
    if (!storedFolder?.password || !storedFolder.recoveryPassword) {
        showToast("Folder recovery information is unavailable.", "error");
        return;
    }
    if (storedFolder.recoveryPassword !== btoa(recoveryPassword)) {
        showToast("Folder recovery key is incorrect.", "error");
        return;
    }

    try {
        recoveredPasswordInput.value = atob(storedFolder.password);
        recoveredPasswordSection.hidden = false;
        showToast("Your current folder password has been revealed.", "success");
    } catch (error) {
        console.error("[SecureVault] Folder password recovery failed", error);
        showToast("The folder password could not be revealed.", "error");
    }
}

async function submitFolderReset() {
    const recoveryInput = document.getElementById("folderResetRecoveryPassword");
    const newPasswordInput = document.getElementById("folderResetNewPassword");
    const confirmPasswordInput = document.getElementById("folderResetConfirmPassword");
    const recoveryPassword = recoveryInput?.value?.trim() || "";
    const newPassword = newPasswordInput?.value?.trim() || "";
    const confirmPassword = confirmPasswordInput?.value?.trim() || "";

    if (!pendingResetFolder) return;
    if (!recoveryPassword || !newPassword || !confirmPassword) {
        showToast("Fill in all fields to reset the folder password.", "error");
        return;
    }
    if (newPassword !== confirmPassword) {
        showToast("The new passwords do not match.", "error");
        return;
    }

    const folderName = decodeURIComponent(pendingResetFolder);
    const folders = getStoredFolders();
    const storedFolder = folders.find((folder) => folder.name === folderName);
    if (!storedFolder || !storedFolder.recoveryPassword) {
        showToast("Folder recovery information is unavailable.", "error");
        return;
    }

    if (storedFolder.recoveryPassword !== btoa(recoveryPassword)) {
        showToast("Folder recovery key is incorrect.", "error");
        return;
    }

    storedFolder.password = btoa(newPassword);
    saveStoredFolders(folders);
    if (!unlockedFolders.includes(folderName)) {
        unlockedFolders.push(folderName);
        saveUnlockedFolders(unlockedFolders);
    }

    try {
        const snapshot = await db.collection("files")
            .where("ownerID", "==", auth.currentUser.uid)
            .where("folderName", "==", folderName)
            .get();

        let batch = db.batch();
        let operations = 0;
        const commits = [];

        snapshot.forEach((doc) => {
            const file = doc.data();
            if (file.folderPassword) {
                batch.update(doc.ref, { folderPassword: btoa(newPassword) });
                operations += 1;
                if (operations === 450) {
                    commits.push(batch.commit());
                    batch = db.batch();
                    operations = 0;
                }
            }
        });

        if (operations > 0) commits.push(batch.commit());
        await Promise.all(commits);
    } catch (error) {
        console.error("[SecureVault] Folder reset update failed", error);
        showToast("Folder password was reset locally, but files could not be updated.", "warning");
        closeFolderResetDialog();
        loadStoredFolders();
        refreshVault();
        return;
    }

    closeFolderResetDialog();
    loadStoredFolders();
    refreshVault();
    showToast(`Folder "${folderName}" password has been reset.`, "success");
}

function openFileResetDialog(docId) {
    pendingResetFile = docId;
    const modal = document.getElementById("fileResetModal");
    const recoveryInput = document.getElementById("fileResetRecoveryPassword");
    const newPasswordInput = document.getElementById("fileResetNewPassword");
    const confirmPasswordInput = document.getElementById("fileResetConfirmPassword");
    const newRecoveryInput = document.getElementById("fileResetNewRecoveryPassword");
    const recoveredSecretSection = document.getElementById("recoveredSecretSection");
    const recoveredSecretInput = document.getElementById("recoveredSecretKey");
    const legacyNotice = document.getElementById("legacyRecoveryNotice");
    const revealButton = document.getElementById("revealFileKeyButton");
    if (!modal || !recoveryInput || !newPasswordInput || !confirmPasswordInput || !newRecoveryInput) return;

    recoveryInput.value = "";
    newPasswordInput.value = "";
    confirmPasswordInput.value = "";
    newRecoveryInput.value = "";
    if (recoveredSecretSection) recoveredSecretSection.hidden = true;
    if (recoveredSecretInput) {
        recoveredSecretInput.value = "";
        recoveredSecretInput.type = "password";
    }
    if (legacyNotice) legacyNotice.hidden = true;
    if (revealButton) revealButton.hidden = false;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    db.collection("files").doc(docId).get().then((fileDoc) => {
        if (!fileDoc.exists) return;
        const isLegacyRecovery = !fileDoc.data().wrappedOriginalSecret;
        if (legacyNotice) {
            legacyNotice.hidden = !isLegacyRecovery;
            if (isLegacyRecovery) {
                legacyNotice.textContent = "This older file does not contain a recoverable copy of its original secret key. Use your recovery key to set a new secret key below; that replacement key will be recoverable in future.";
            }
        }
        if (revealButton) revealButton.hidden = isLegacyRecovery;
    }).catch((error) => console.warn("[SecureVault] Could not check legacy recovery status", error));
    window.setTimeout(() => recoveryInput.focus(), 50);
}

function generateStrongKey(length = 32) {
    const characterSets = [
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "abcdefghijklmnopqrstuvwxyz",
        "0123456789",
        "!@#$%^&*-_=+"
    ];
    const characters = characterSets.join("");
    const randomIndex = (limit) => {
        const maxUnbiasedValue = Math.floor(0x100000000 / limit) * limit;
        const randomValue = new Uint32Array(1);
        do {
            crypto.getRandomValues(randomValue);
        } while (randomValue[0] >= maxUnbiasedValue);
        return randomValue[0] % limit;
    };

    const keyCharacters = characterSets.map((set) => set[randomIndex(set.length)]);
    while (keyCharacters.length < length) {
        keyCharacters.push(characters[randomIndex(characters.length)]);
    }

    for (let index = keyCharacters.length - 1; index > 0; index -= 1) {
        const swapIndex = randomIndex(index + 1);
        [keyCharacters[index], keyCharacters[swapIndex]] = [keyCharacters[swapIndex], keyCharacters[index]];
    }
    return keyCharacters.join("");
}

function hasSelectedUploadFile() {
    return (document.getElementById("fileInput")?.files?.length || 0) > 0
        || (document.getElementById("folderInput")?.files?.length || 0) > 0;
}

function formatFileSize(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
}

function updateFolderUploadSummary() {
    const folderInput = document.getElementById("folderInput");
    const summary = document.getElementById("folderUploadSummary");
    if (!folderInput || !summary) return;
    const files = [...folderInput.files];
    if (!files.length) {
        summary.hidden = true;
        summary.textContent = "";
        return;
    }
    const rootFolderName = files[0].webkitRelativePath.split("/")[0] || "Selected folder";
    const totalSize = files.reduce((total, file) => total + file.size, 0);
    summary.textContent = `${rootFolderName}: ${files.length} file${files.length === 1 ? "" : "s"} · ${formatFileSize(totalSize)} · including nested folders`;
    summary.hidden = false;
}

function fillSelectedFolderPassword() {
    const folderSelect = document.getElementById("folderSelect");
    const folderPasswordInput = document.getElementById("folderPassword");
    const selectedFolderName = folderSelect?.value || "";
    if (!folderPasswordInput || folderPasswordInput.value || !selectedFolderName) return;

    const selectedFolder = getStoredFolders().find((folder) => folder.name === selectedFolderName);
    if (!selectedFolder?.password) return;

    try {
        folderPasswordInput.value = atob(selectedFolder.password);
    } catch (error) {
        console.warn("[SecureVault] Could not fill the selected folder password", error);
    }
}

function generateSecretFileKey() {
    if (!hasSelectedUploadFile()) {
        showToast("Choose a file before generating a secret key.", "error");
        return;
    }
    const secretKeyInput = document.getElementById("encryptionPassword");
    const recoveryKeyInput = document.getElementById("recoveryPassword");
    if (!secretKeyInput) return;

    let secretKey = generateStrongKey();
    while (secretKey === recoveryKeyInput?.value) secretKey = generateStrongKey();
    secretKeyInput.value = secretKey;
    secretKeyInput.dataset.autoGenerated = "true";
    showToast("A strong secret key has been generated.", "success");
}

function generateRecoveryFileKey() {
    if (!hasSelectedUploadFile()) {
        showToast("Choose a file before generating a recovery key.", "error");
        return;
    }
    const secretKeyInput = document.getElementById("encryptionPassword");
    const recoveryKeyInput = document.getElementById("recoveryPassword");
    if (!recoveryKeyInput) return;

    let recoveryKey = generateStrongKey();
    while (recoveryKey === secretKeyInput?.value) recoveryKey = generateStrongKey();
    recoveryKeyInput.value = recoveryKey;
    recoveryKeyInput.dataset.autoGenerated = "true";
    showToast("A separate strong recovery key has been generated.", "success");
}

function generateFolderPassword() {
    const folderPasswordInput = document.getElementById("folderPasswordCreate");
    const folderRecoveryInput = document.getElementById("folderRecoveryPassword");
    if (!folderPasswordInput) return;

    let folderPassword = generateStrongKey();
    while (folderPassword === folderRecoveryInput?.value) folderPassword = generateStrongKey();
    folderPasswordInput.value = folderPassword;
    folderPasswordInput.dataset.autoGenerated = "true";
    showToast("A strong folder password has been generated.", "success");
}

function generateFolderRecoveryKey() {
    const folderPasswordInput = document.getElementById("folderPasswordCreate");
    const folderRecoveryInput = document.getElementById("folderRecoveryPassword");
    if (!folderRecoveryInput) return;

    let folderRecoveryKey = generateStrongKey();
    while (folderRecoveryKey === folderPasswordInput?.value) folderRecoveryKey = generateStrongKey();
    folderRecoveryInput.value = folderRecoveryKey;
    folderRecoveryInput.dataset.autoGenerated = "true";
    folderRecoveryInput.select();
    showToast("A separate strong folder recovery key has been generated.", "success");
}

function replaceAutoGeneratedKeyOnTyping(event) {
    const keyInput = event.currentTarget;
    if (!event.isTrusted || keyInput.dataset.autoGenerated !== "true") return;

    const typedText = event.inputType?.startsWith("insert") ? (event.data || "") : "";
    keyInput.value = typedText;
    delete keyInput.dataset.autoGenerated;
}

function openRecoveryFromDecrypt() {
    if (!pendingDecryption?.docId) return;
    const docId = pendingDecryption.docId;
    closeDecryptDialog();
    openFileResetDialog(docId);
}

async function revealOriginalSecretKey() {
    if (!pendingResetFile) return;
    const recoveryInput = document.getElementById("fileResetRecoveryPassword");
    const revealButton = document.getElementById("revealFileKeyButton");
    const recoveredSecretSection = document.getElementById("recoveredSecretSection");
    const recoveredSecretInput = document.getElementById("recoveredSecretKey");
    const recoveryPassword = recoveryInput?.value || "";

    if (!recoveryPassword) {
        showToast("Enter the recovery key first.", "error");
        return;
    }

    setButtonLoading(revealButton, true, "Recovering key");
    try {
        const fileDoc = await db.collection("files").doc(pendingResetFile).get();
        if (!fileDoc.exists) throw new Error("File not found.");
        const fileData = fileDoc.data();
        if (!fileData.wrappedOriginalSecret) {
            throw new Error("This file was created before original-key recovery was available. You can still set a new secret key below.");
        }
        const secretBytes = await unwrapKeyWithPassword(fileData.wrappedOriginalSecret, recoveryPassword);
        if (recoveredSecretInput) {
            recoveredSecretInput.value = new TextDecoder().decode(secretBytes);
            recoveredSecretSection.hidden = false;
        }
        showToast("Your current secret key has been recovered.", "success");
    } catch (error) {
        console.error("[SecureVault] Original secret-key recovery failed", error);
        showToast(error.message || "The recovery key could not reveal this secret key.", "error");
    } finally {
        setButtonLoading(revealButton, false);
    }
}

function closeFileResetDialog() {
    const modal = document.getElementById("fileResetModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    pendingResetFile = null;
}

async function submitFileReset() {
    const recoveryInput = document.getElementById("fileResetRecoveryPassword");
    const newPasswordInput = document.getElementById("fileResetNewPassword");
    const confirmPasswordInput = document.getElementById("fileResetConfirmPassword");
    const newRecoveryInput = document.getElementById("fileResetNewRecoveryPassword");
    const recoveryPassword = recoveryInput?.value || "";
    const newPassword = newPasswordInput?.value || "";
    const confirmPassword = confirmPasswordInput?.value || "";
    const newRecoveryPassword = newRecoveryInput?.value || "";
    const confirmButton = document.getElementById("fileResetConfirmButton");

    if (!pendingResetFile) return;
    if (!recoveryPassword || !newPassword || !confirmPassword) {
        showToast("Fill in all required fields to reset the file secret key.", "error");
        return;
    }
    if (newPassword !== confirmPassword) {
        showToast("The new secret keys do not match.", "error");
        return;
    }

    setButtonLoading(confirmButton, true, "Saving new key");
    try {
        const docRef = db.collection("files").doc(pendingResetFile);
        const fileDoc = await docRef.get();
        if (!fileDoc.exists) throw new Error("File not found.");
        const fileData = fileDoc.data();

        if (fileData.folderName && fileData.folderPassword) {
            const storedFolder = getStoredFolders().find((folder) => folder.name === fileData.folderName);
            const folderAccess = unlockedFolders.includes(fileData.folderName)
                || (storedFolder && storedFolder.password === fileData.folderPassword);
            if (!folderAccess) {
                throw new Error("You must unlock the containing folder before resetting this file.");
            }
        }

        if (!fileData.wrappedRecoveryKey) {
            throw new Error("This file does not have a recovery key configured.");
        }

        const fileKey = await unwrapKeyWithPassword(fileData.wrappedRecoveryKey, recoveryPassword);
        const newWrappedFileKey = await wrapKeyWithPassword(fileKey, newPassword);
        const updatePayload = { wrappedFileKey: newWrappedFileKey };
        const recoveryKeyToKeep = newRecoveryPassword || recoveryPassword;
        updatePayload.wrappedOriginalSecret = await wrapKeyWithPassword(
            new TextEncoder().encode(newPassword), recoveryKeyToKeep
        );
        if (newRecoveryPassword) {
            updatePayload.wrappedRecoveryKey = await wrapKeyWithPassword(fileKey, newRecoveryPassword);
        }

        await docRef.update(updatePayload);
        closeFileResetDialog();
        showToast("A new secret key has been saved. Use it for future downloads.", "success");
    } catch (error) {
        console.error("[SecureVault] File reset failed", error);
        showToast(error.message || "Could not reset the file secret key.", "error");
    } finally {
        setButtonLoading(confirmButton, false);
    }
}

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `app-toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4500);
}

function openKeyBackupDialog() {
    const secretKey = document.getElementById("encryptionPassword")?.value || "";
    if (!secretKey) {
        showToast("Enter or generate a secret key before creating a backup.", "error");
        return;
    }
    document.getElementById("keyBackupPassword").value = "";
    document.getElementById("keyBackupPasswordConfirm").value = "";
    const modal = document.getElementById("keyBackupModal");
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    window.setTimeout(() => document.getElementById("keyBackupPassword")?.focus(), 50);
}

function closeKeyBackupDialog() {
    const modal = document.getElementById("keyBackupModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
}

async function downloadEncryptedKeyBackup() {
    const secretKey = document.getElementById("encryptionPassword")?.value || "";
    const recoveryKey = document.getElementById("recoveryPassword")?.value || "";
    const backupPassword = document.getElementById("keyBackupPassword")?.value || "";
    const confirmation = document.getElementById("keyBackupPasswordConfirm")?.value || "";
    if (!secretKey || !backupPassword) {
        showToast("Enter the secret key and a backup password.", "error");
        return;
    }
    if (backupPassword !== confirmation) {
        showToast("The backup passwords do not match.", "error");
        return;
    }
    try {
        const backup = {
            version: 1,
            createdAt: new Date().toISOString(),
            encryptedKeys: await wrapKeyWithPassword(
                new TextEncoder().encode(JSON.stringify({ secretKey, recoveryKey })),
                backupPassword
            )
        };
        const backupUrl = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = backupUrl;
        link.download = "securevault-encrypted-key-backup.json";
        link.click();
        URL.revokeObjectURL(backupUrl);
        closeKeyBackupDialog();
        showToast("Encrypted key backup downloaded. Keep its backup password safe.", "success");
    } catch (error) {
        console.error("[SecureVault] Key backup failed", error);
        showToast("The encrypted key backup could not be created.", "error");
    }
}

function openDecryptDialog(docId, button) {
    const modal = document.getElementById("decryptModal");
    const form = document.getElementById("decryptForm");
    if (!modal || !form) return;
    pendingDecryption = { docId, button };
    form.reset();
    const recoverButton = document.getElementById("recoverFileKeyButton");
    if (recoverButton) recoverButton.hidden = true;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    db.collection("files").doc(docId).get().then((fileDoc) => {
        if (fileDoc.exists && recoverButton) {
            recoverButton.hidden = !fileDoc.data().wrappedRecoveryKey;
        }
    }).catch((error) => console.warn("[SecureVault] Could not check recovery-key availability", error));
    window.setTimeout(() => document.getElementById("decryptPassword")?.focus(), 50);
}

function closeDecryptDialog() {
    const modal = document.getElementById("decryptModal");
    if (!modal || document.getElementById("decryptConfirmButton")?.disabled) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    pendingDecryption = null;
}

function openDeleteDialog(docId, button) {
    const modal = document.getElementById("deleteModal");
    if (!modal) return;
    pendingDeletion = { docId, button };
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    window.setTimeout(() => document.getElementById("cancelDeleteButton")?.focus(), 50);
}

function closeDeleteDialog() {
    const modal = document.getElementById("deleteModal");
    if (!modal || document.getElementById("deleteConfirmButton")?.disabled) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    pendingDeletion = null;
}

async function deleteStoredFile() {
    if (!pendingDeletion) return;
    const { docId, button } = pendingDeletion;
    const confirmButton = document.getElementById("deleteConfirmButton");
    const cancelButton = document.getElementById("cancelDeleteButton");
    setButtonLoading(button, true, "Deleting");
    setButtonLoading(confirmButton, true, "Deleting");
    cancelButton.disabled = true;

    try {
        const fileRef = db.collection("files").doc(docId);
        const fileDoc = await fileRef.get();
        if (!fileDoc.exists) throw new Error("File not found.");
        await deleteFileChunks(fileRef);
        await fileRef.delete();
        document.getElementById("deleteModal").classList.remove("is-open");
        document.getElementById("deleteModal").setAttribute("aria-hidden", "true");
        pendingDeletion = null;
        showToast("The encrypted file has been removed from your vault.", "success");
    } catch (error) {
        console.error("[SecureVault] File deletion failed", error);
        showToast(getFriendlyFileActionError(error, "delete"), "error");
    } finally {
        setButtonLoading(button, false);
        setButtonLoading(confirmButton, false);
        cancelButton.disabled = false;
    }
}

console.log("✅ Firebase connected (Option 2 Mode)");

// --- AUTH LOGIC ---
async function handleSignUp() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const msg = document.getElementById('message');
    const button = document.getElementById('signupButton');
    setAuthLoading(true, button, "Creating account");
    try {
        await auth.createUserWithEmailAndPassword(email, password);
        msg.style.color = "#1f7a5c";
        msg.innerText = "Account created. Opening your vault…";
        setTimeout(() => { window.location.href = "dashboard.html"; }, 1500);
    } catch (error) {
        msg.style.color = "#bd3f4b";
        msg.innerText = getFriendlyAuthError(error, "signup");
        setAuthLoading(false, button);
    }
}

async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const msg = document.getElementById('message');
    const button = document.getElementById('loginButton');
    if (!auth) {
        msg.style.color = "#bd3f4b";
        msg.innerText = "Authentication is unavailable right now. Check the console for details.";
        return;
    }
    setAuthLoading(true, button, "Signing in");
    try {
        await auth.signInWithEmailAndPassword(email, password);
        window.location.href = "dashboard.html";
    } catch (error) {
        msg.style.color = "#bd3f4b";
        msg.innerText = getFriendlyAuthError(error, "login");
        setAuthLoading(false, button);
    }
}

async function handleLogout() {
    const button = document.getElementById('logoutButton');
    setButtonLoading(button, true, "Signing out");
    try {
        await auth.signOut();
        window.location.href = "auth.html";
    } catch (error) {
        console.error(error);
        setButtonLoading(button, false);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const loginButton = document.getElementById("loginButton");
    if (loginButton) loginButton.addEventListener("click", handleLogin);
    const signupButton = document.getElementById("signupButton");
    if (signupButton) signupButton.addEventListener("click", handleSignUp);
    ["encryptionPassword", "recoveryPassword"].forEach((inputId) => {
        const keyInput = document.getElementById(inputId);
        if (!keyInput) return;
        keyInput.addEventListener("input", replaceAutoGeneratedKeyOnTyping);
    });
    const secretKeyInput = document.getElementById("encryptionPassword");
    const recoveryKeyInput = document.getElementById("recoveryPassword");
    secretKeyInput?.addEventListener("focus", () => {
        if (hasSelectedUploadFile() && (!secretKeyInput.value || secretKeyInput.dataset.autoGenerated === "true")) {
            generateSecretFileKey();
        }
    });
    recoveryKeyInput?.addEventListener("focus", () => {
        if (hasSelectedUploadFile() && (!recoveryKeyInput.value || recoveryKeyInput.dataset.autoGenerated === "true")) {
            generateRecoveryFileKey();
        }
    });
    ["folderPasswordCreate", "folderRecoveryPassword"].forEach((inputId) => {
        const keyInput = document.getElementById(inputId);
        if (!keyInput) return;
        keyInput.addEventListener("input", replaceAutoGeneratedKeyOnTyping);
    });
    const folderPasswordInput = document.getElementById("folderPasswordCreate");
    const folderRecoveryInput = document.getElementById("folderRecoveryPassword");
    folderPasswordInput?.addEventListener("focus", () => {
        if (!folderPasswordInput.value || folderPasswordInput.dataset.autoGenerated === "true") {
            generateFolderPassword();
        }
    });
    folderRecoveryInput?.addEventListener("focus", () => {
        if (!folderRecoveryInput.value || folderRecoveryInput.dataset.autoGenerated === "true") {
            generateFolderRecoveryKey();
        }
    });
    document.getElementById("folderPassword")?.addEventListener("focus", fillSelectedFolderPassword);
    document.getElementById("folderInput")?.addEventListener("change", updateFolderUploadSummary);
});

// --- ENCRYPTION AND CLOUD STORAGE ENGINE ---
async function encryptAndUpload() {
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');
    const password = document.getElementById('encryptionPassword').value;
    const recoveryPassword = document.getElementById('recoveryPassword')?.value || "";
    let folderName = document.getElementById('folderSelect')?.value || "";
    let folderPassword = document.getElementById('folderPassword')?.value?.trim() || "";
    const status = document.getElementById('uploadStatus');
    const uploadButton = document.getElementById('uploadButton');
    let fileRef = null;
    let metadataSaved = false;

    const isNewUpload = uploadQueue.length === 0;
    if (isNewUpload && (((fileInput?.files?.length || 0) + (folderInput?.files?.length || 0) === 0) || !password)) {
        showToast("Choose a file or folder and enter a secret key to continue.", "error");
        return;
    }
    if (isNewUpload) {
        uploadQueue = [...(fileInput?.files || []), ...(folderInput?.files || [])];
        uploadQueueIndex = 0;
        uploadedDirectoryName = folderInput?.files?.[0]?.webkitRelativePath?.split("/")[0] || "";
    }
    if (uploadQueue.length === 0 || !password) {
        showToast("Choose a file or folder and enter a secret key to continue.", "error");
        uploadQueue = [];
        return;
    }
    const file = uploadQueue[uploadQueueIndex];
    if (!folderName && uploadedDirectoryName) folderName = uploadedDirectoryName;
    console.info("[SecureVault] Encryption engine initialized", {
        algorithm: "AES-GCM",
        keyDerivation: "PBKDF2",
        iterations: 100000
    });
    if (isNewUpload) {
        setButtonLoading(uploadButton, true, "Encrypting and saving");
        fileInput.disabled = true;
        if (folderInput) folderInput.disabled = true;
        document.getElementById('encryptionPassword').disabled = true;
    }
    status.textContent = "Encrypting your file securely…";

    try {
        // 1. Read file as ArrayBuffer
        const fileData = await file.arrayBuffer();
        const enc = new TextEncoder();

        // 2. Generate a random content key and wrap it with the main and optional recovery password.
        const fileKeyBytes = crypto.getRandomValues(new Uint8Array(32));
        const contentKey = await crypto.subtle.importKey(
            "raw", fileKeyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]
        );
        console.info("[SecureVault] PBKDF2 key derivation complete", { iterations: 100000, hash: "SHA-256" });

        // 3. Encrypt the file content with the random file key.
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encryptedContent = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv }, contentKey, fileData
        );
        console.info("[SecureVault] AES-GCM encryption successful", { ivBytes: iv.length });
        status.textContent = "Saving encrypted file securely…";

        // 4. Combine the IV and encrypted bytes for storage.
        const combined = new Uint8Array(iv.length + encryptedContent.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encryptedContent), iv.length);

        // 5. Store encrypted bytes in Firestore-sized chunks before creating vault metadata.
        fileRef = db.collection("files").doc();
        const chunkCount = await saveEncryptedChunks(fileRef, combined);

        if (folderName && !folderPassword) {
            const storedFolder = getStoredFolders().find((folder) => folder.name === folderName);
            if (storedFolder) {
                folderPassword = atob(storedFolder.password);
            }
        }

        if (!folderName) {
            folderPassword = "";
        }

        const wrappedMainKey = await wrapKeyWithPassword(fileKeyBytes, password);
        const metadata = {
            ownerID: auth.currentUser.uid,
            fileName: file.webkitRelativePath
                ? file.webkitRelativePath.split("/").slice(1).join("/")
                : file.name,
            chunkCount: chunkCount,
            cipherVersion: 2,
            wrappedFileKey: wrappedMainKey,
            uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (folderName) {
            metadata.folderName = folderName;
            if (folderPassword) {
                metadata.folderPassword = btoa(folderPassword);
            }
        }

        if (recoveryPassword) {
            metadata.wrappedRecoveryKey = await wrapKeyWithPassword(fileKeyBytes, recoveryPassword);
            metadata.wrappedOriginalSecret = await wrapKeyWithPassword(
                new TextEncoder().encode(password), recoveryPassword
            );
        }

        await fileRef.set(metadata);
        metadataSaved = true;
        console.info("[SecureVault] Cloud sync complete", { fileName: file.name });

        uploadQueueIndex += 1;
        if (uploadQueueIndex < uploadQueue.length) {
            status.textContent = `Saved ${uploadQueueIndex} of ${uploadQueue.length} files. Continuing…`;
            await encryptAndUpload();
            return;
        }

        status.textContent = "";
        const uploadedItemCount = uploadQueue.length;
        showToast(`${uploadedItemCount} item${uploadedItemCount === 1 ? "" : "s"} encrypted and saved to the vault.`, "success");
        fileInput.value = "";
        if (folderInput) folderInput.value = "";
        const folderUploadSummary = document.getElementById("folderUploadSummary");
        if (folderUploadSummary) folderUploadSummary.hidden = true;
        document.getElementById('encryptionPassword').value = "";
        document.getElementById('recoveryPassword').value = "";
        document.getElementById('folderPassword').value = "";
        uploadQueue = [];
        uploadQueueIndex = 0;
        uploadedDirectoryName = "";
        
    } catch (error) {
        console.error(error);
        uploadQueue = [];
        uploadQueueIndex = 0;
        uploadedDirectoryName = "";
        if (fileRef && !metadataSaved) {
            try {
                await deleteFileChunks(fileRef);
            } catch (cleanupError) {
                console.warn("[SecureVault] Could not clean up incomplete file chunks", cleanupError);
            }
        }
        status.textContent = "";
        showToast(getFriendlyUploadError(error), "error");
    } finally {
        if (isNewUpload) {
            setButtonLoading(uploadButton, false);
            fileInput.disabled = false;
            if (folderInput) folderInput.disabled = false;
            document.getElementById('encryptionPassword').disabled = false;
        }
    }
}

// --- VAULT LOADING LOGIC ---
function isLockedFolder(folderName, storedFolder, files) {
    if (folderName === "No folder") return false;
    const hasFolderProtection = !!(storedFolder?.password || files.some(({ file }) => !!file.folderPassword));
    if (!hasFolderProtection) return false;
    if (!storedFolder?.password) return true;
    return !unlockedFolders.includes(folderName);
}

function loadVault() {
    const user = auth.currentUser;
    const fileContainer = document.getElementById('fileContainer');
    if (!user || !fileContainer) return;

    if (vaultUnsubscribe) {
        vaultUnsubscribe();
        vaultUnsubscribe = null;
    }

    vaultUnsubscribe = db.collection("files").where("ownerID", "==", user.uid)
      .onSnapshot((snapshot) => {
          const groupedFiles = {};

          snapshot.forEach((doc) => {
              const file = doc.data();
              const folderName = file.folderName || "No folder";
              if (!groupedFiles[folderName]) groupedFiles[folderName] = [];
              groupedFiles[folderName].push({ doc, file });
          });

          const orderedGroups = Object.entries(groupedFiles).sort(([a], [b]) => {
              if (a === "No folder") return 1;
              if (b === "No folder") return -1;
              return a.localeCompare(b);
          });

          if (!orderedGroups.length) {
              fileContainer.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"/></svg></span><h3>Your vault is empty</h3><p>Encrypted files you save will appear here.</p></div>';
              return;
          }

          const activeView = activeFolderView;
          if (activeView) {
              const activeGroup = orderedGroups.find(([folderName]) => folderName === activeView);
              if (!activeGroup) {
                  fileContainer.innerHTML = '<div class="empty-state"><h3>Folder unavailable</h3><p>The selected folder could not be found.</p></div>';
                  return;
              }
              const [folderName, files] = activeGroup;
              const storedFolder = getStoredFolders().find((folder) => folder.name === folderName);
              const locked = isLockedFolder(folderName, storedFolder, files);
              if (locked) {
                  fileContainer.innerHTML = '<div class="empty-state"><h3>Folder locked</h3><p>This folder is still locked. Enter its password or recovery key again to continue.</p></div>';
                  return;
              }
              fileContainer.innerHTML = `
                  <div class="folder-view-banner mb-4">
                      <div class="folder-view-title">Viewing folder: ${escapeHtml(folderName)}</div>
                      <div class="folder-view-actions">
                          <button type="button" class="btn btn-quiet" onclick="clearFolderView()">Back to full vault</button>
                          ${storedFolder?.recoveryPassword ? `<button type="button" class="btn btn-warning" onclick="openFolderResetDialog('${encodeURIComponent(folderName)}')">Reset password</button>` : ""}
                          <button type="button" class="btn btn-delete" onclick="deleteFolder('${encodeURIComponent(folderName)}')">Delete folder</button>
                      </div>
                  </div>
                  <div class="folder-group">
                      <div class="folder-group-header">${escapeHtml(folderName)} <span class="folder-badge">${files.length} file${files.length === 1 ? "" : "s"}</span></div>
                      <div class="folder-group-files">
                          ${files.map(({ doc, file }) => `
                              <div class="list-group-item d-flex justify-content-between align-items-center file-item shadow-sm mb-2">
                                  <div>
                                      <h6 class="mb-0 text-primary">${escapeHtml(file.fileName)}</h6>
                                      <small class="text-muted">Encrypted and saved ${formatStoredAt(file.uploadedAt)}</small>
                                      ${file.wrappedRecoveryKey ? '<small class="text-muted d-block">Recovery key available for this file.</small>' : ''}
                                  </div>
                                  <div class="file-actions">
                                      <button onclick="openDecryptDialog('${doc.id}', this)" class="btn btn-sm btn-success">Decrypt & Download</button>
                                      ${file.wrappedRecoveryKey ? `<button onclick="openFileResetDialog('${doc.id}')" class="btn btn-sm btn-warning">Recover key</button>` : ``}
                                      <button onclick="openDeleteDialog('${doc.id}', this)" class="btn btn-sm btn-delete">Delete</button>
                                  </div>
                              </div>
                          `).join("")}
                      </div>
                  </div>
              `;
              return;
          }

fileContainer.innerHTML = orderedGroups.map(([folderName, files]) => {
              const storedFolder = folderName !== "No folder" ? getStoredFolders().find((folder) => folder.name === folderName) : null;
              const isLocked = isLockedFolder(folderName, storedFolder, files);
              const deleteButton = folderName !== "No folder"
                  ? `<button class="btn btn-sm btn-delete" type="button" onclick="deleteFolder('${encodeURIComponent(folderName)}')">Delete folder</button>`
                  : "";
              return `
              <div class="folder-group">
                  <div class="folder-group-header">
                      <span>${escapeHtml(folderName)}${folderName !== "No folder" ? ` <span class="folder-badge">${files.length} file${files.length === 1 ? "" : "s"}</span>` : ""}</span>
                      ${deleteButton}
                  </div>
                  ${isLocked ? `
                      <div class="folder-locked">
                          <p>Folder is locked. Enter the folder password to view files.</p>
                          <button class="btn btn-sm btn-primary" type="button" onclick="openFolderUnlockDialog('${encodeURIComponent(folderName)}')">Unlock folder</button>
                          ${storedFolder?.recoveryPassword ? `<button class="btn btn-sm btn-warning" type="button" onclick="openFolderResetDialog('${encodeURIComponent(folderName)}')">Reset password</button>` : ""}
                      </div>
                  ` : `
                      <div class="folder-locked">
                          <p>Folder is unlocked. Open it to view files.</p>
                          <button class="btn btn-sm btn-primary" type="button" onclick="openFolderView('${encodeURIComponent(folderName)}')">Open folder</button>
                          ${storedFolder?.recoveryPassword ? `<button class="btn btn-sm btn-warning" type="button" onclick="openFolderResetDialog('${encodeURIComponent(folderName)}')">Reset password</button>` : ""}
                      </div>
                  `}
              </div>
          `;
          }).join("");
      }, (error) => {
          console.error(error);
          fileContainer.innerHTML = '<div class="empty-state"><h3>We could not load your vault</h3><p>Please refresh the page and try again.</p></div>';
      });
}

// --- STATE LISTENER ---
auth.onAuthStateChanged((user) => {
    const isDashboard = window.location.pathname.includes("dashboard.html");
    if (user) {
        if (isDashboard) {
            unlockedFolders = getUnlockedFolders();
            document.getElementById('userEmail').innerText = user.email;
            loadStoredFolders();
            loadVault();
        }
    } else if (isDashboard) {
        window.location.href = "auth.html";
    }
});

// --- THE DECRYPTION ENGINE ---
async function decryptAndDownload() {
    if (!pendingDecryption) return;
    const password = document.getElementById("decryptPassword").value;
    if (!password) return;

    const { docId, button } = pendingDecryption;
    const confirmButton = document.getElementById("decryptConfirmButton");
    const cancelButton = document.getElementById("cancelDecryptButton");
    const folderPasswordInput = document.getElementById("decryptFolderPassword");
    const folderPassword = folderPasswordInput?.value?.trim() || "";
    setButtonLoading(button, true, "Decrypting");
    setButtonLoading(confirmButton, true, "Decrypting");
    cancelButton.disabled = true;

    try {
        // 1. Get the encrypted file metadata from Firestore.
        const doc = await db.collection("files").doc(docId).get();
        if (!doc.exists) throw new Error("File not found!");
        
        const fileData = doc.data();
        const fileName = fileData.fileName;

        // 1. If the file belongs to a folder with a password, verify folder access.
        if (fileData.folderName && fileData.folderPassword) {
            const folderPasswordInput = document.getElementById("decryptFolderPassword");
            let folderPassword = folderPasswordInput?.value?.trim() || "";
            if (!folderPassword) {
                const storedFolder = getStoredFolders().find((folder) => folder.name === fileData.folderName);
                if (storedFolder) {
                    folderPassword = atob(storedFolder.password);
                }
            }
            if (fileData.folderPassword !== btoa(folderPassword)) {
                throw new Error("Folder password is incorrect.");
            }
        }

        // 2. Reassemble encrypted bytes from Firestore chunks.
        let bytes;
        if (fileData.chunkCount) {
            const chunksSnapshot = await doc.ref.collection("chunks")
                .where("ownerID", "==", auth.currentUser.uid)
                .orderBy(firebase.firestore.FieldPath.documentId())
                .get();
            if (chunksSnapshot.size !== fileData.chunkCount) {
                throw new Error("One or more encrypted file chunks are missing.");
            }
            const chunks = [];
            let totalLength = 0;
            chunksSnapshot.forEach((chunkDoc) => {
                const binary = atob(chunkDoc.data().data);
                const chunk = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) chunk[i] = binary.charCodeAt(i);
                chunks.push(chunk);
                totalLength += chunk.length;
            });
            bytes = new Uint8Array(totalLength);
            let offset = 0;
            chunks.forEach((chunk) => {
                bytes.set(chunk, offset);
                offset += chunk.length;
            });
        } else if (fileData.fileData) {
            // Backward compatibility for small legacy files saved before Cloud Storage was added.
            const binaryString = atob(fileData.fileData);
            bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
        } else {
            throw new Error("The encrypted file data is missing.");
        }

        // 3. Extract the IV (first 12 bytes) and the Content
        const iv = bytes.slice(0, 12);
        const encryptedContent = bytes.slice(12);

        let fileKey = null;
        let usedRecoveryKey = false;
        if (fileData.folderPassword) {
            const folderPasswordMatches = fileData.folderPassword === btoa(folderPassword);
            if (!folderPasswordMatches) {
                throw new Error("Folder password is incorrect.");
            }
        }

        if (fileData.cipherVersion === 2) {
            try {
                fileKey = await unwrapKeyWithPassword(fileData.wrappedFileKey, password);
            } catch (mainKeyError) {
                if (fileData.wrappedRecoveryKey) {
                    try {
                        fileKey = await unwrapKeyWithPassword(fileData.wrappedRecoveryKey, password);
                        usedRecoveryKey = true;
                    } catch (recoveryKeyError) {
                        throw new Error("Wrong secret key or recovery key.");
                    }
                } else {
                    throw new Error("Wrong secret key.");
                }
            }
        } else {
            const enc = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey(
                "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
            );
            fileKey = await crypto.subtle.deriveKey(
                { name: "PBKDF2", salt: enc.encode("secure-salt"), iterations: 100000, hash: "SHA-256" },
                keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
            );
        }

        const contentKey = fileKey instanceof Uint8Array
            ? await crypto.subtle.importKey(
                "raw", fileKey,
                { name: "AES-GCM" }, false, ["decrypt"]
            )
            : fileKey;

        // Report-only integrity check: this changes a local copy, never the Firestore file.
        const tamperedContent = encryptedContent.slice();
        tamperedContent[0] ^= 1;
        try {
            await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, contentKey, tamperedContent);
            console.error("[SecureVault] Tamper-detection test: UNEXPECTED SUCCESS — modified ciphertext was accepted.");
        } catch (tamperError) {
            console.warn("[SecureVault] Tamper-detection test: FAILED — modified ciphertext rejected as expected.");
        }

        // 5. Decrypt the data
        const decryptedContent = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv }, contentKey, encryptedContent
        );

        // 6. Create a download link and click it automatically
        const blob = new Blob([decryptedContent]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "Decrypted_" + fileName;
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        document.getElementById("decryptModal").classList.remove("is-open");
        document.getElementById("decryptModal").setAttribute("aria-hidden", "true");
        if (fileData.folderName) {
            lockFolder(fileData.folderName);
            if (activeFolderView === fileData.folderName) {
                activeFolderView = null;
            }
            loadStoredFolders();
        }
        pendingDecryption = null;
        showToast(
            usedRecoveryKey
                ? "Your recovery key worked. Use ‘Recover key’ to save a new secret key."
                : "Your file has been decrypted and is downloading.",
            "success"
        );
        refreshVault();

    } catch (error) {
        console.error("[SecureVault] Decryption failed", error);
        showToast(getFriendlyFileActionError(error, "decrypt"), "error");
    } finally {
        setButtonLoading(button, false);
        setButtonLoading(confirmButton, false);
        cancelButton.disabled = false;
    }
}

