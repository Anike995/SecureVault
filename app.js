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
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

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

let pendingDecryption = null;

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `app-toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4500);
}

function openDecryptDialog(docId, button) {
    const modal = document.getElementById("decryptModal");
    const form = document.getElementById("decryptForm");
    if (!modal || !form) return;
    pendingDecryption = { docId, button };
    form.reset();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    window.setTimeout(() => document.getElementById("decryptPassword")?.focus(), 50);
}

function closeDecryptDialog() {
    const modal = document.getElementById("decryptModal");
    if (!modal || document.getElementById("decryptConfirmButton")?.disabled) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    pendingDecryption = null;
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

// --- THE ENCRYPTION ENGINE (OPTION 2: NO STORAGE NEEDED) ---
async function encryptAndUpload() {
    const fileInput = document.getElementById('fileInput');
    const password = document.getElementById('encryptionPassword').value;
    const status = document.getElementById('uploadStatus');
    const uploadButton = document.getElementById('uploadButton');

    if (fileInput.files.length === 0 || !password) {
        showToast("Choose a file and enter a secret key to continue.", "error");
        return;
    }

    const file = fileInput.files[0];
    setButtonLoading(uploadButton, true, "Encrypting and saving");
    fileInput.disabled = true;
    document.getElementById('encryptionPassword').disabled = true;
    status.textContent = "Encrypting your file securely…";

    try {
        // 1. Read file as ArrayBuffer
        const fileData = await file.arrayBuffer();
        const enc = new TextEncoder();

        // 2. Generate Key
        const keyMaterial = await crypto.subtle.importKey(
            "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
        );
        const key = await crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: enc.encode("secure-salt"), iterations: 100000, hash: "SHA-256" },
            keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
        );

        // 3. Encrypt
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encryptedContent = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv }, key, fileData
        );

        // 4. Convert to Base64 String (To store in Database as text)
        const combined = new Uint8Array(iv.length + encryptedContent.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encryptedContent), iv.length);
        
        // Convert binary to string safely
        let binary = '';
        const bytes = new Uint8Array(combined);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        // 5. Save directly to Firestore
        await db.collection("files").add({
            ownerID: auth.currentUser.uid,
            fileName: file.name,
            fileData: base64Data, // This is the actual encrypted file content
            uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        status.textContent = "";
        showToast("Your file has been encrypted and saved to the vault.", "success");
        fileInput.value = "";
        document.getElementById('encryptionPassword').value = "";
        
    } catch (error) {
        console.error(error);
        status.textContent = "";
        showToast(`The file could not be saved: ${error.message}`, "error");
    } finally {
        setButtonLoading(uploadButton, false);
        fileInput.disabled = false;
        document.getElementById('encryptionPassword').disabled = false;
    }
}

// --- VAULT LOADING LOGIC ---
function loadVault() {
    const user = auth.currentUser;
    const fileContainer = document.getElementById('fileContainer');
    if (!user || !fileContainer) return;

    db.collection("files").where("ownerID", "==", user.uid)
      .onSnapshot((snapshot) => {
          if (snapshot.empty) {
              fileContainer.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"/></svg></span><h3>Your vault is empty</h3><p>Encrypted files you save will appear here.</p></div>';
              return;
          }
          fileContainer.innerHTML = "";
          snapshot.forEach((doc) => {
              const file = doc.data();
              fileContainer.innerHTML += `
                  <div class="list-group-item d-flex justify-content-between align-items-center file-item shadow-sm mb-2">
                      <div>
                          <h6 class="mb-0 text-primary">${file.fileName}</h6>
                          <small class="text-muted">Encrypted and saved ${formatStoredAt(file.uploadedAt)}</small>
                      </div>
                      <button onclick="openDecryptDialog('${doc.id}', this)" class="btn btn-sm btn-success">Decrypt & Download</button>
                  </div>
              `;
          });
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
            document.getElementById('userEmail').innerText = user.email;
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
    setButtonLoading(button, true, "Decrypting");
    setButtonLoading(confirmButton, true, "Decrypting");
    cancelButton.disabled = true;

    try {
        // 1. Get the encrypted data from Firestore
        const doc = await db.collection("files").doc(docId).get();
        if (!doc.exists) throw new Error("File not found!");
        
        const fileData = doc.data();
        const base64Data = fileData.fileData;
        const fileName = fileData.fileName;

        // 2. Convert Base64 back to Binary
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // 3. Extract the IV (first 12 bytes) and the Content
        const iv = bytes.slice(0, 12);
        const encryptedContent = bytes.slice(12);

        // 4. Regenerate the Key using the password provided
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
        );
        const key = await crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: enc.encode("secure-salt"), iterations: 100000, hash: "SHA-256" },
            keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
        );

        // 5. Decrypt the data
        const decryptedContent = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv }, key, encryptedContent
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
        pendingDecryption = null;
        showToast("Your file has been decrypted and is downloading.", "success");

    } catch (error) {
        console.error(error);
        showToast("Decryption failed. Check your secret key and try again.", "error");
    } finally {
        setButtonLoading(button, false);
        setButtonLoading(confirmButton, false);
        cancelButton.disabled = false;
    }
}
