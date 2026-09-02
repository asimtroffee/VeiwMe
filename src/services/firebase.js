import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

// Read config exclusively from environment variables (.env)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

let app = null;
let db = null;
let auth = null;

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.apiKey !== 'YOUR_API_KEY'
  );
}

if (isFirebaseConfigured()) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    console.log('✅ Firebase Firestore & Auth successfully initialized');
  } catch (error) {
    console.error('❌ Error initializing Firebase:', error);
  }
}

export async function ensureFirebaseAuth() {
  if (isFirebaseConfigured() && auth) {
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
        console.log('✅ Firebase anonymous session active');
      } catch (err) {
        // In case anonymous auth is disabled on Firebase console, ignore
        console.warn('Firebase anonymous auth notice:', err.message);
      }
    }
  }
}

export { app, db, auth, firebaseConfig };
