import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  confirmPasswordReset,
  EmailAuthProvider,
  GoogleAuthProvider,
  browserSessionPersistence,
  getAuth,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  verifyPasswordResetCode,
} from "firebase/auth";

const env = import.meta.env as Record<string, string | undefined>;

const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

let persistencePromise: Promise<void> | null = null;

export function isFirebaseGoogleConfigured() {
  return Boolean(
    firebaseConfig.apiKey
      && firebaseConfig.authDomain
      && firebaseConfig.projectId
      && firebaseConfig.appId,
  );
}

function getFirebaseApp() {
  if (!isFirebaseGoogleConfigured()) {
    throw new Error("Firebase Google login is not configured yet.");
  }
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

async function ensureFirebasePersistence() {
  if (!persistencePromise) {
    persistencePromise = setPersistence(getFirebaseAuth(), browserSessionPersistence).then(() => undefined);
  }
  return persistencePromise;
}

export async function signInWithFirebaseGoogle() {
  await ensureFirebasePersistence();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(getFirebaseAuth(), provider);
  const idToken = await result.user.getIdToken(true);
  return { idToken, firebaseUser: result.user };
}

export async function signInWithFirebaseEmailPassword(email: string, password: string) {
  await ensureFirebasePersistence();
  const result = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  const idToken = await result.user.getIdToken(true);
  return { idToken, firebaseUser: result.user };
}

export async function registerWithFirebaseEmailPassword(email: string, password: string) {
  await ensureFirebasePersistence();
  const result = await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  const idToken = await result.user.getIdToken(true);
  return { idToken, firebaseUser: result.user };
}

export async function verifyFirebaseResetCode(oobCode: string) {
  await ensureFirebasePersistence();
  return verifyPasswordResetCode(getFirebaseAuth(), oobCode.trim());
}

export async function confirmFirebaseResetPassword(oobCode: string, newPassword: string) {
  await ensureFirebasePersistence();
  await confirmPasswordReset(getFirebaseAuth(), oobCode.trim(), newPassword);
}

export async function sendFirebasePasswordResetEmail(email: string) {
  await ensureFirebasePersistence();
  await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
}

export async function changeFirebasePassword(currentPassword: string, newPassword: string) {
  await ensureFirebasePersistence();
  const auth = getFirebaseAuth();
  const currentUser = auth.currentUser;
  if (!currentUser?.email) {
    throw new Error("Firebase session not found. Please sign in again.");
  }

  const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
  await reauthenticateWithCredential(currentUser, credential);
  await updatePassword(currentUser, newPassword);
}

export async function clearFirebaseGoogleSession() {
  if (!isFirebaseGoogleConfigured()) return;
  await signOut(getFirebaseAuth()).catch(() => undefined);
}

export async function deleteCurrentFirebaseUser() {
  if (!isFirebaseGoogleConfigured()) return;
  const auth = getFirebaseAuth();
  if (!auth.currentUser) return;
  await deleteUser(auth.currentUser).catch(() => undefined);
}
