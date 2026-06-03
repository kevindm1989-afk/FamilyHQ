/**
 * Firebase SDK initialization (Task 3, ADR-0005).
 *
 * - App + Auth + Firestore, modular v10 SDK.
 * - Firestore uses `persistentLocalCache` + `persistentMultipleTabManager`
 *   for offline-first reads/writes across tabs (ADR-0005).
 * - Web config comes from VITE_-prefixed env vars. These Firebase web keys are
 *   PUBLIC identifiers (not secrets) but are still injected via env per spec so
 *   no real value is hardcoded. `.env.example` documents the shape.
 * - When VITE_USE_EMULATOR is set, Auth + Firestore connect to the local
 *   emulator suite (see firebase.json).
 *
 * Auth/signup/tenant logic is NOT here — that is Phase 1 (ADR-0006), owned by
 * the implementer + test-writer. This module only wires the SDK.
 */
import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);

// Offline persistence (ADR-0005): IndexedDB cache, multi-tab safe.
export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Firebase Storage (Feature 2 — Chore Photo Verification). Lazy-instantiated
// here so the chore service can attach a proof image when a member marks a
// chore complete. The Storage SDK is small (~30KB gzip) but only meaningfully
// used by one flow; it loads with the rest of the firebase config, which is
// already gated behind the auth boundary, so it never hits the cold-load
// public bundle. storage.rules enforces same-family read + assignee write.
export const storage: FirebaseStorage = getStorage(app);

const useEmulator = import.meta.env.VITE_USE_EMULATOR === 'true';

if (useEmulator) {
  // Emulator ports mirror firebase.json. `disableWarnings` keeps console clean.
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

// Re-export the auth-state listener so useAuth can subscribe to it via the
// dynamic config import — no second dynamic-import promise to manage, and no
// static `firebase/auth` reference in any always-loaded module. Without this
// re-export, useAuth would need a static `import { onAuthStateChanged }` from
// firebase/auth, which would pull the entire Firebase Auth SDK into the main
// bundle and undo the lazy chunking.
export { onAuthStateChanged } from 'firebase/auth';
