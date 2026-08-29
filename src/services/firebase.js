import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Read config from Vite environment variables or fallback to project configuration
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDvozuagpIYq4j70Y6YJo4hhlNWsG93A88",
  authDomain: "veiwme-57ac3.firebaseapp.com",
  projectId: "veiwme-57ac3",
  storageBucket: "veiwme-57ac3.firebasestorage.app",
  messagingSenderId: "1081966141967",
  appId: "1:1081966141967:web:af34878c88709c77d9b97a"
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || DEFAULT_FIREBASE_CONFIG.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_CONFIG.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_CONFIG.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_CONFIG.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || DEFAULT_FIREBASE_CONFIG.appId
};

let app = null;
let db = null;

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
    console.log('✅ Firebase Firestore successfully initialized');
  } catch (error) {
    console.error('❌ Error initializing Firebase:', error);
  }
}

export { app, db, firebaseConfig };
