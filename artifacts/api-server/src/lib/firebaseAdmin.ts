import { existsSync, statSync } from "node:fs";

type FirebaseAppModule = typeof import("firebase-admin/app");
type FirebaseAuthModule = typeof import("firebase-admin/auth");
type FirebaseAdminApp = ReturnType<FirebaseAppModule["initializeApp"]>;
type FirebaseAdminAuth = ReturnType<FirebaseAuthModule["getAuth"]>;

type FirebaseServiceAccountConfig = {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

type FirebaseDecodedToken = {
  uid: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  firebase?: {
    sign_in_provider?: string;
  };
};

type FirebaseLookupUser = {
  localId?: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  photoUrl?: string;
  providerUserInfo?: Array<{
    providerId?: string;
  }>;
};

let firebaseAppModulePromise: Promise<FirebaseAppModule> | undefined;
let firebaseAuthModulePromise: Promise<FirebaseAuthModule> | undefined;

function loadFirebaseAppModule() {
  firebaseAppModulePromise ??= import("firebase-admin/app");
  return firebaseAppModulePromise;
}

function loadFirebaseAuthModule() {
  firebaseAuthModulePromise ??= import("firebase-admin/auth");
  return firebaseAuthModulePromise;
}

function isMissingFirebaseAdminModule(error: unknown) {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND"
      && String((error as { message?: unknown }).message ?? "").includes("firebase-admin"),
  );
}

function firebaseAdminUnavailableError() {
  const error = new Error("Firebase Admin SDK is not installed on the server. Rebuild and deploy the application package.");
  (error as { code?: string }).code = "FIREBASE_ADMIN_UNAVAILABLE";
  return error;
}

function isFirebaseAdminUnavailable(error: unknown) {
  return isMissingFirebaseAdminModule(error)
    || Boolean(
      error
        && typeof error === "object"
        && "code" in error
        && (error as { code?: unknown }).code === "FIREBASE_ADMIN_UNAVAILABLE",
    );
}

function readTrimmedEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readFirebasePrivateKey() {
  const value = process.env.FIREBASE_PRIVATE_KEY;
  return typeof value === "string" && value.trim() ? value.replace(/\\n/g, "\n") : undefined;
}

function readFirebaseWebApiKey() {
  return readTrimmedEnv("FIREBASE_WEB_API_KEY")
    ?? readTrimmedEnv("VITE_FIREBASE_API_KEY");
}

function readFirebaseServiceAccountJson(): FirebaseServiceAccountConfig | undefined {
  const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (typeof value !== "string" || !value.trim()) return undefined;

  try {
    const parsed = JSON.parse(value) as FirebaseServiceAccountConfig;
    const projectId = parsed.projectId ?? parsed.project_id;
    const clientEmail = parsed.clientEmail ?? parsed.client_email;
    const privateKey = parsed.privateKey ?? parsed.private_key;

    return {
      projectId,
      clientEmail,
      privateKey: typeof privateKey === "string"
        ? privateKey.replace(/\\n/g, "\n")
        : undefined,
    };
  } catch {
    return undefined;
  }
}

function hasServiceAccountConfig() {
  const jsonConfig = readFirebaseServiceAccountJson();
  return Boolean(
    (jsonConfig?.projectId && jsonConfig.clientEmail && jsonConfig.privateKey)
      || (process.env.FIREBASE_PROJECT_ID
        && process.env.FIREBASE_CLIENT_EMAIL
        && readFirebasePrivateKey()),
  );
}

function hasReadableGoogleCredentialsFile() {
  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (typeof filePath !== "string" || !filePath.trim()) return false;

  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function clearInvalidGoogleCredentialsPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !hasReadableGoogleCredentialsFile()) {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}

export function isFirebaseAdminConfigured() {
  return hasServiceAccountConfig() || hasReadableGoogleCredentialsFile();
}

// ── REST API fallback (uses Web API key when Admin SDK is not configured) ────

type FirebaseRestCreatedUser = {
  uid: string;
  email: string;
  displayName?: string;
};

/** Returned by ensureFirebaseEmailUser when the account already existed in Firebase
 *  and we could not update it (REST-only path — no Admin SDK to reset the password).
 *  Callers must check `reusedExisting` before using `uid`. */
export type FirebaseReusedUser = {
  uid: null;
  email: string;
  displayName: string;
  reusedExisting: true;
};

async function createFirebaseUserViaRest({
  email,
  password,
  fullName,
}: {
  email: string;
  password: string;
  fullName: string;
}): Promise<FirebaseRestCreatedUser> {
  const apiKey = readFirebaseWebApiKey();
  if (!apiKey) {
    throw new Error("Firebase Web API key is not configured. Set FIREBASE_WEB_API_KEY or VITE_FIREBASE_API_KEY.");
  }

  // Step 1: Create the user account
  const signUpRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );

  const signUpData = await signUpRes.json().catch(() => ({})) as {
    localId?: string;
    idToken?: string;
    error?: { message?: string };
  };

  if (!signUpRes.ok) {
    const msg = signUpData.error?.message ?? "Firebase user creation failed";
    throw new Error(msg);
  }

  if (!signUpData.localId || !signUpData.idToken) {
    throw new Error("Firebase user creation returned no user ID");
  }

  const uid = signUpData.localId;

  // Step 2: Update display name
  try {
    const updateRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: signUpData.idToken, displayName: fullName, returnSecureToken: false }),
      },
    );
    if (!updateRes.ok) {
      const updateData = await updateRes.json().catch(() => ({})) as { error?: { message?: string } };
      // Non-fatal — user was created; log the name-setting failure but don't throw
      console.warn("[Firebase REST] display name update failed:", updateData.error?.message ?? updateRes.status);
    }
  } catch (updateErr) {
    // Network failure on name update — non-fatal, user account already created
    console.warn("[Firebase REST] display name update network error:", updateErr instanceof Error ? updateErr.message : updateErr);
  }

  return { uid, email, displayName: fullName };
}

async function lookupFirebaseUserByEmailViaRest(email: string, idToken: string, apiKey: string): Promise<{ localId: string } | null> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const data = await res.json().catch(() => ({})) as {
    users?: Array<{ localId?: string; email?: string }>;
  };
  const found = Array.isArray(data.users)
    ? data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    : undefined;
  return found?.localId ? { localId: found.localId } : null;
}

export function isFirebaseRestCreationAvailable() {
  return Boolean(readFirebaseWebApiKey());
}

export function isFirebaseTokenVerificationConfigured() {
  return isFirebaseAdminConfigured() || Boolean(readFirebaseWebApiKey());
}

async function getFirebaseAdminApp(): Promise<FirebaseAdminApp> {
  const { applicationDefault, cert, getApps, initializeApp } = await loadFirebaseAppModule();
  const existing = getApps()[0];
  if (existing) return existing;

  const jsonConfig = readFirebaseServiceAccountJson();

  if (jsonConfig?.projectId && jsonConfig.clientEmail && jsonConfig.privateKey) {
    return initializeApp({
      credential: cert({
        projectId: jsonConfig.projectId,
        clientEmail: jsonConfig.clientEmail,
        privateKey: jsonConfig.privateKey,
      }),
      projectId: jsonConfig.projectId,
    });
  }

  if (hasServiceAccountConfig()) {
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: readFirebasePrivateKey(),
      }),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  clearInvalidGoogleCredentialsPath();

  return initializeApp({
    credential: applicationDefault(),
    ...(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {}),
  });
}

async function getFirebaseAdminAuth(): Promise<FirebaseAdminAuth> {
  try {
    const { getAuth } = await loadFirebaseAuthModule();
    return getAuth(await getFirebaseAdminApp());
  } catch (error) {
    if (isMissingFirebaseAdminModule(error)) {
      throw firebaseAdminUnavailableError();
    }
    throw error;
  }
}

function decodeFirebaseJwtPayload(idToken: string) {
  const parts = idToken.split(".");
  if (parts.length < 2 || !parts[1]) {
    throw new Error("Firebase ID token is invalid");
  }

  try {
    const normalized = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Partial<FirebaseDecodedToken>;
  } catch {
    throw new Error("Firebase ID token is invalid");
  }
}

function normalizeFirebaseLookupError(code: string) {
  switch (code) {
    case "INVALID_ID_TOKEN":
    case "USER_NOT_FOUND":
      return "Firebase session is invalid. Please sign in again.";
    case "PROJECT_NOT_FOUND":
    case "API_KEY_INVALID":
      return "Firebase verification is not configured on the server yet";
    default:
      return code.replace(/_/g, " ").toLowerCase();
  }
}

async function verifyFirebaseIdTokenWithApiKey(idToken: string): Promise<FirebaseDecodedToken> {
  const apiKey = readFirebaseWebApiKey();
  if (!apiKey) {
    throw new Error("Firebase verification is not configured on the server yet");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );

  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    users?: FirebaseLookupUser[];
  };

  if (!response.ok) {
    throw new Error(normalizeFirebaseLookupError(payload.error?.message ?? "Firebase token lookup failed"));
  }

  const lookupUser = Array.isArray(payload.users) ? payload.users[0] : undefined;
  if (!lookupUser?.localId) {
    throw new Error("Firebase session is invalid. Please sign in again.");
  }

  const decoded = decodeFirebaseJwtPayload(idToken);
  if (decoded.sub !== lookupUser.localId || (typeof decoded.email === 'string' && decoded.email.toLowerCase() !== lookupUser.email?.toLowerCase())) {
    throw new Error('Firebase session is invalid. Please sign in again.');
  }
  const uid = typeof decoded.sub === "string" && decoded.sub.trim()
    ? decoded.sub.trim()
    : lookupUser.localId;

  return {
    ...decoded,
    uid,
    sub: uid,
    email: typeof decoded.email === "string" && decoded.email.trim()
      ? decoded.email.trim()
      : lookupUser.email,
    email_verified: typeof decoded.email_verified === "boolean"
      ? decoded.email_verified
      : lookupUser.emailVerified === true,
    name: typeof decoded.name === "string" && decoded.name.trim()
      ? decoded.name.trim()
      : lookupUser.displayName,
    picture: typeof decoded.picture === "string" && decoded.picture.trim()
      ? decoded.picture.trim()
      : lookupUser.photoUrl,
    firebase: {
      sign_in_provider:
        typeof decoded.firebase?.sign_in_provider === "string" && decoded.firebase.sign_in_provider.trim()
          ? decoded.firebase.sign_in_provider.trim()
          : undefined,
    },
  };
}

export async function verifyFirebaseIdToken(idToken: string) {
  if (!isFirebaseAdminConfigured()) {
    return verifyFirebaseIdTokenWithApiKey(idToken);
  }

  try {
    const auth = await getFirebaseAdminAuth();
    return auth.verifyIdToken(idToken);
  } catch (error) {
    if (isFirebaseAdminUnavailable(error) && readFirebaseWebApiKey()) {
      return verifyFirebaseIdTokenWithApiKey(idToken);
    }
    throw error;
  }
}

export async function createFirebaseEmailUser({
  email,
  password,
  fullName,
}: {
  email: string;
  password: string;
  fullName: string;
}) {
  // When Admin SDK is not configured, use REST API directly
  if (!isFirebaseAdminConfigured()) {
    if (isFirebaseRestCreationAvailable()) {
      return createFirebaseUserViaRest({ email, password, fullName });
    }
    throw new Error("Firebase is not configured. Set FIREBASE_WEB_API_KEY or Firebase Admin credentials.");
  }
  // Admin SDK path — fall back to REST if SDK module is missing/broken at runtime
  try {
    const auth = await getFirebaseAdminAuth();
    return await auth.createUser({
      email,
      password,
      displayName: fullName,
      emailVerified: false,
    });
  } catch (error) {
    if (isFirebaseAdminUnavailable(error) && isFirebaseRestCreationAvailable()) {
      return createFirebaseUserViaRest({ email, password, fullName });
    }
    throw error;
  }
}

export async function deleteFirebaseUser(uid: string) {
  const auth = await getFirebaseAdminAuth();
  await auth.deleteUser(uid);
}

export async function deleteFirebaseUserByEmail(email: string) {
  const auth = await getFirebaseAdminAuth();
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.deleteUser(existing.uid);
    return true;
  } catch {
    return false;
  }
}

export async function generateFirebasePasswordResetLink(email: string) {
  const auth = await getFirebaseAdminAuth();
  return auth.generatePasswordResetLink(email);
}

function isFirebaseUserNotFoundError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  return code === "auth/user-not-found";
}

export async function ensureFirebaseEmailUser({
  email,
  password,
  fullName,
}: {
  email: string;
  password: string;
  fullName: string;
}): Promise<FirebaseRestCreatedUser | FirebaseReusedUser> {
  const makeReused = (): FirebaseReusedUser => ({ uid: null, email, displayName: fullName, reusedExisting: true });

  // When Admin SDK is not configured, use REST API directly
  if (!isFirebaseAdminConfigured()) {
    if (isFirebaseRestCreationAvailable()) {
      try {
        return await createFirebaseUserViaRest({ email, password, fullName });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("EMAIL_EXISTS") || msg.includes("email address is already in use")) {
          // User already exists in Firebase — cannot reset password without Admin SDK.
          return makeReused();
        }
        throw error;
      }
    }
    throw new Error("Firebase is not configured. Set FIREBASE_WEB_API_KEY or Firebase Admin credentials.");
  }

  // Admin SDK path — fall back to REST if SDK module is missing/broken at runtime
  try {
    const auth = await getFirebaseAdminAuth();
    try {
      const existing = await auth.getUserByEmail(email);
      const updated = await auth.updateUser(existing.uid, { password, displayName: fullName });
      return { uid: updated.uid, email: updated.email ?? email, displayName: updated.displayName } satisfies FirebaseRestCreatedUser;
    } catch (lookupError) {
      // Only treat "user not found" as creatable — rethrow everything else
      if (!isFirebaseUserNotFoundError(lookupError)) throw lookupError;
      const created = await auth.createUser({ email, password, displayName: fullName, emailVerified: false });
      return { uid: created.uid, email: created.email ?? email, displayName: created.displayName } satisfies FirebaseRestCreatedUser;
    }
  } catch (error) {
    if (isFirebaseAdminUnavailable(error) && isFirebaseRestCreationAvailable()) {
      try {
        return await createFirebaseUserViaRest({ email, password, fullName });
      } catch (restError) {
        const msg = restError instanceof Error ? restError.message : "";
        if (msg.includes("EMAIL_EXISTS") || msg.includes("email address is already in use")) {
          return makeReused();
        }
        throw restError;
      }
    }
    throw error;
  }
}

export async function ensureFirebaseEmailUserExists({
  email,
  password,
  fullName,
}: {
  email: string;
  password: string;
  fullName: string;
}) {
  const auth = await getFirebaseAdminAuth();
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code && code !== "auth/user-not-found") throw error;
    return auth.createUser({
      email,
      password,
      displayName: fullName,
      emailVerified: false,
    });
  }
}
