import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, signInAnonymously } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const missingConfig = Object.entries(firebaseConfig).find(([, value]) => !value);
if (missingConfig) throw new Error(`Missing Firebase setting: ${missingConfig[0]}`);

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export const firebaseDatabaseUrl = firebaseConfig.databaseURL;

export async function getPlayerUid() {
  await auth.authStateReady();
  let user = auth.currentUser;

  if (!user) {
    await setPersistence(auth, browserLocalPersistence);
    const credential = await signInAnonymously(auth);
    user = credential.user;
  }

  // Force the anonymous ID token to be available before database rules evaluate auth.
  await user.getIdToken();
  return user.uid;
}
