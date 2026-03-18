import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBs-_vbConbbVSSqU7HpD6oKiiktnm4doU",
  authDomain: "math-notes-c34ef.firebaseapp.com",
  projectId: "math-notes-c34ef",
  storageBucket: "math-notes-c34ef.firebasestorage.app",
  messagingSenderId: "487708269586",
  appId: "1:487708269586:web:737c463110cba6fcba8ccb",
  measurementId: "G-0X0SFRLH8S"
};

export let app, auth, db, provider;
export let currentUser = null;

export function initFirebase(config) {
    if (!config || !config.apiKey) {
        console.warn("Firebase config not provided.");
        return false;
    }
    app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
    provider = new GoogleAuthProvider();

    getRedirectResult(auth).then((result) => {
        if (result) {
            console.log("Signed in successfully via redirect:", result.user);
        }
    }).catch((error) => {
        console.error("Redirect sign-in error:", error);
    });

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        updateAccountUI(user);
    });
    return true;
}

// Try to auto-initialize if config is hardcoded
if (firebaseConfig.apiKey) {
    initFirebase(firebaseConfig);
}

export async function signIn() {
    if (!auth) {
        alert("Firebase not initialized yet. Please add your config.");
        return;
    }
    try {
        const result = await signInWithPopup(auth, provider);
        console.log("Signed in:", result.user);
    } catch (error) {
        if (error.code === 'auth/popup-blocked' || error.message.includes('popup')) {
            console.log("Popup blocked in app environment, falling back to redirect...");
            try {
                await signInWithRedirect(auth, provider);
            } catch (err) {
                console.error("Redirect sign in failed:", err);
                alert("Redirect Sign in failed: " + err.message);
            }
        } else {
            console.error("Sign in failed:", error);
            alert("Sign in failed: " + error.message);
        }
    }
}

export async function logOut() {
    if (!auth) return;
    try {
        await signOut(auth);
        console.log("Signed out.");
    } catch (error) {
        console.error("Sign out error:", error);
    }
}

function updateAccountUI(user) {
    const btn = document.getElementById('btn-account');
    if (!btn) return;
    
    if (user) {
        btn.innerHTML = `<img src="${user.photoURL}" alt="User" style="width:20px;height:20px;border-radius:50%;" title="${user.displayName}">`;
        btn.classList.add('logged-in');
    } else {
        btn.innerHTML = `<i data-lucide="user-circle"></i>`;
        btn.classList.remove('logged-in');
        if (window.lucide) window.lucide.createIcons();
    }
}

// === CLOUD STORAGE ===
export async function saveToCloud(data, documentId) {
    if (!auth || !currentUser) {
        alert("You must be signed in to save to the cloud.");
        return false;
    }
    
    try {
        const isOwner = currentUser.email === 'kwinten.dco@gmail.com';
        
        // Enforce limits for non-owners
        if (!isOwner) {
            const colRef = collection(db, "users", currentUser.uid, "notebooks");
            const snapshot = await getDocs(colRef);
            
            const existingDocs = snapshot.docs.map(d => d.id);
            const isNewDoc = !documentId || !existingDocs.includes(documentId);
            
            if (isNewDoc && snapshot.size >= 3) {
                alert("Cloud storage limit reached (Max 3 notebooks). Please upgrade to Plus for unlimited storage, or delete an old notebook.");
                return false;
            }
        }

        const id = documentId || Date.now().toString();
        const docRef = doc(db, "users", currentUser.uid, "notebooks", id);
        
        await setDoc(docRef, {
            ...data,
            updatedAt: new Date().toISOString()
        });
        
        console.log("Saved to cloud:", id);
        return id;
    } catch (e) {
        console.error("Cloud save failed:", e);
        alert("Cloud save failed: " + e.message);
        return false;
    }
}

export async function loadFromCloud() {
    // Kept for backward compatibility if open button calls it directly
    const notebooks = await getUserNotebooks();
    if (!notebooks || notebooks.length === 0) return null;
    
    if (notebooks.length > 1) {
        const list = notebooks.map((n, i) => `${i + 1}: ${n.title || 'Untitled'}`).join('\n');
        const choice = prompt(`Select a notebook to load (1-${notebooks.length}):\n${list}`);
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < notebooks.length) {
            return notebooks[idx];
        } else {
            return null;
        }
    }
    
    return notebooks[0];
}

export async function getUserNotebooks() {
    if (!auth || !currentUser) return null;

    try {
        const colRef = collection(db, "users", currentUser.uid, "notebooks");
        const snapshot = await getDocs(colRef);
        
        if (snapshot.empty) return [];

        const notebooks = [];
        snapshot.forEach(doc => {
            notebooks.push({ id: doc.id, ...doc.data() });
        });
        
        notebooks.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        return notebooks;
    } catch (e) {
        console.error("Failed to fetch notebooks:", e);
        return null;
    }
}

export async function deleteFromCloud(id) {
    if (!auth || !currentUser) return false;
    try {
        const docRef = doc(db, "users", currentUser.uid, "notebooks", id);
        await deleteDoc(docRef);
        console.log("Deleted notebook:", id);
        return true;
    } catch (e) {
        console.error("Failed to delete notebook:", e);
        return false;
    }
}
