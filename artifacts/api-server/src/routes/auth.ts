import { Router, type IRouter, type Response } from "express";
import { getSignedUserId } from "../lib/authUtils";
import { createNodeSession, revokeNodeSession, revokeNodeUserSessions, nodeSessionEnv } from '../lib/nodeSession';
import { allowLoginAttempt } from '../lib/workerRequestSecurity';
import { compromisedPrivilegedCredential, EXPOSED_DEMO_PASSWORD } from '../lib/compromisedCredentials';
import { mergeOnboardingProfile } from '../lib/onboardingProfile';
import { firebasePasswordReset } from '../lib/firebasePasswordReset';
import { ensureJamChemistryTemplate } from "../lib/examCatalog";
import { db, examTemplatesTable, usersTable, executeD1Sql } from "@workspace/db";
import { eq, or, ilike, sql } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword, isLegacyPasswordHash } from "../lib/auth";
import { hasBrevoAccounts, queuePasswordChangedEmail, sendPasswordResetEmail } from "../lib/brevo";
import { getStudentAccessWindow, getStudentReviewAutomationSettings } from "../lib/platformSettings";
import {
  buildCustomPasswordResetUrl,
  formatPasswordResetCooldown,
  getPasswordResetCooldownRemaining,
  isPasswordResetLinkSignatureValid,
} from "../lib/passwordReset";
import {
  buildStudentReviewSummary,
  getStudentReviewCycleAt,
  listStudentReviewEmailRecipients,
} from "../lib/studentReview";
import { queueNewStudentReviewRequestEmails } from "../lib/brevo";
import {
  deleteFirebaseUser,
  ensureFirebaseEmailUser,
  ensureFirebaseEmailUserExists,
  generateFirebasePasswordResetLink,
  isFirebaseAdminConfigured,
  isFirebaseRestCreationAvailable,
  isFirebaseTokenVerificationConfigured,
  verifyFirebaseIdToken,
} from "../lib/firebaseAdmin";
import { getStudentFeatureAccess, getStudentFeatureUnlockPricing } from "../lib/studentFeatureAccess";

const router: IRouter = Router();
router.use(async (req, res, next) => {
  if (req.method !== 'POST' || !['/auth/login', '/auth/google', '/auth/firebase-email'].includes(req.path)) { next(); return; }
  const identifier = String(req.body?.username ?? req.body?.email ?? req.body?.idToken ?? '').slice(0, 16384);
  const request = new Request('https://auth.internal/', { headers: { 'cf-connecting-ip': req.ip ?? req.socket.remoteAddress ?? 'unknown' } });
  try {
    if (!await allowLoginAttempt(request, nodeSessionEnv, identifier)) { res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.' }); return; }
    next();
  } catch { res.status(503).json({ error: 'Sign-in verification is temporarily unavailable.' }); }
});
const STUDENT_ONBOARDING_TOTAL_STEPS = 1;
const COLLEGE_BOARD_VALUE = "UG University";
const COLLEGE_CLASS_LEVELS = new Set(["Clg 1st", "Clg 2nd", "Clg 3rd", "Clg 4th", "Graduated"]);

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCollegeClassLevel(value: unknown) {
  const raw = readTrimmedString(value);
  const legacyStageMap: Record<string, string> = {
    "College 1st Year": "Clg 1st",
    "College 2nd Year": "Clg 2nd",
    "College 3rd Year": "Clg 3rd",
    "College 4th Year": "Clg 4th",
    Graduate: "Graduated",
  };
  return legacyStageMap[raw] ?? raw;
}

function requiresCollegeAndUniversityFields(classLevel: string | null | undefined, board: string | null | undefined) {
  return COLLEGE_CLASS_LEVELS.has(readTrimmedString(classLevel)) || readTrimmedString(board) === COLLEGE_BOARD_VALUE;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function getPasswordResetRoleLabel(role: string) {
  if (role === "student") return "student account";
  if (role === "admin") return "teacher account";
  if (role === "super_admin") return "super admin account";
  return "account";
}

router.post("/auth/password-reset-link/validate", async (req, res): Promise<void> => {
  const oobCode = readTrimmedString(req.body?.oobCode);
  const sig = readTrimmedString(req.body?.sig);
  const expiresAtRaw = Number(req.body?.expiresAt);

  if (!oobCode || !sig || !Number.isFinite(expiresAtRaw)) {
    res.status(400).json({ error: "Reset link is invalid or incomplete." });
    return;
  }

  if (!isPasswordResetLinkSignatureValid(oobCode, expiresAtRaw, sig)) {
    res.status(400).json({ error: "Reset link signature is invalid." });
    return;
  }

  const remainingMs = expiresAtRaw - Date.now();
  if (remainingMs <= 0) {
    res.status(400).json({ error: "This reset link has expired. Please request a new one." });
    return;
  }

  res.json({
    valid: true,
    expiresAt: new Date(expiresAtRaw).toISOString(),
    remainingMs,
  });
});

router.post("/auth/password-reset/finalize", async (req, res): Promise<void> => {
  const email = normalizeEmail(readTrimmedString(req.body?.email));
  const oobCode = readTrimmedString(req.body?.oobCode);
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  if (!oobCode) {
    res.status(400).json({ error: "A single-use password reset code is required." });
    return;
  }

  if (newPassword.length < 6 || newPassword.length > 1024) {
    res.status(400).json({ error: "New password must be at least 6 characters." });
    return;
  }

  try {
    const apiKey = process.env.FIREBASE_WEB_API_KEY ?? process.env.VITE_FIREBASE_API_KEY;
    const tokenEmail = await firebasePasswordReset(apiKey, oobCode);

    if (!tokenEmail) {
      res.status(400).json({ error: "A valid Firebase email session is required." });
      return;
    }

    if (email && email !== tokenEmail) {
      res.status(400).json({ error: "Reset email does not match the Firebase account." });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(ilike(usersTable.email, tokenEmail));

    if (!user) {
      res.status(404).json({ error: "This account was not found anymore. Please request a fresh reset link." });
      return;
    }

    if (['blocked', 'disabled', 'suspended', 'inactive'].includes(user.status)) {
      res.status(403).json({ error: 'Account is disabled.' }); return;
    }
    if (['admin', 'super_admin'].includes(user.role) && newPassword === EXPOSED_DEMO_PASSWORD) {
      res.status(400).json({ error: 'Choose a new password that is not the exposed demo password.' }); return;
    }
    const passwordHash = await hashPassword(newPassword);
    if (await firebasePasswordReset(apiKey, oobCode, newPassword) !== tokenEmail) throw new Error('Reset identity mismatch.');
    await db
      .update(usersTable)
      .set({
        passwordHash,
        mustChangePassword: false,
      })
      .where(eq(usersTable.id, user.id));
    await revokeNodeUserSessions(user.id);

    if (user.email && await hasBrevoAccounts()) {
      queuePasswordChangedEmail({
        accountName: user.fullName?.trim() || user.username,
        email: user.email,
        username: user.username,
        roleLabel: getPasswordResetRoleLabel(user.role),
      });
    }

    res.json({ message: "Password reset completed." });
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : "Firebase reset session verification failed.",
    });
  }
});

function sanitizeGoogleUsernameBase(email: string, name: string) {
  const emailBase = email.split("@")[0] ?? "";
  const fromName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const fromEmail = emailBase
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const fallback = fromName || fromEmail || "student";
  const compact = fallback.slice(0, 24);
  if (compact.length >= 3) return compact;
  return `${compact}student`.slice(0, 24);
}

async function buildUniqueGoogleUsername(email: string, name: string) {
  const base = sanitizeGoogleUsernameBase(email, name);
  let candidate = base;
  let suffix = 1;

  while (true) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, candidate));
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}${suffix}`.slice(0, 64);
  }
}

function readGoogleNewStudentStatus() {
  const configured = readTrimmedString(process.env.FIREBASE_GOOGLE_NEW_STUDENT_STATUS).toLowerCase();
  if (configured === "approved") return "approved" as const;
  return "pending" as const;
}

function validateRegisterStudentBody(body: unknown) {
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const username = readTrimmedString(payload.username);
  const email = normalizeEmail(readTrimmedString(payload.email));
  const password = typeof payload.password === "string" ? payload.password : "";
  const fullName = readTrimmedString(payload.fullName);

  if (username.length < 3) return { error: "User ID must be at least 3 characters" } as const;
  if (username.length > 64) return { error: "User ID is too long" } as const;
  if (!email) return { error: "Email is required" } as const;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return { error: "Enter a valid email address" } as const;
  if (password.length < 6) return { error: "Password must be at least 6 characters" } as const;
  if (!fullName) return { error: "Name is required" } as const;
  if (fullName.length > 120) return { error: "Name is too long" } as const;

  return { data: { username, email, password, fullName } } as const;
}

function validateStudentOnboardingBody(body: unknown) {
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fullName = readTrimmedString(payload.fullName);
  const phone = readTrimmedString(payload.phone);
  const avatarUrl = readTrimmedString(payload.avatarUrl);
  const subject = readTrimmedString(payload.subject);
  const profileDetails = payload.profileDetails;

  if (!fullName) return { error: "Full name is required" } as const;
  if (fullName.length > 120) return { error: "Full name is too long" } as const;
  if (!phone) return { error: "Phone number is required" } as const;
  if (phone.length > 20) return { error: "Phone number is too long" } as const;
  if (!avatarUrl) return { error: "A profile photo is required before you can submit your profile" } as const;
  if (!subject) return { error: "Target exam is required" } as const;

  if (!profileDetails || typeof profileDetails !== "object") {
    return { error: "Profile details are required" } as const;
  }

  const details = profileDetails as Record<string, unknown>;
  const preparation = (details.preparation && typeof details.preparation === "object" ? details.preparation : {}) as Record<string, unknown>;

  const institutionName = readTrimmedString(preparation.institutionName);
  const collegeName = readTrimmedString(preparation.collegeName);
  const resolvedCollegeName = collegeName || institutionName;

  if (!resolvedCollegeName) return { error: "College name is required" } as const;

  const normalized = {
    dateOfBirth: readTrimmedString(details.dateOfBirth),
    whatsappOnSameNumber: details.whatsappOnSameNumber === true,
    whatsappNumber: readTrimmedString(details.whatsappNumber),
    address: {
      country: "India",
      state: "",
      district: "",
      street: "",
      city: "",
      pincode: "",
    },
    preparation: {
      classLevel: normalizeCollegeClassLevel(preparation.classLevel),
      board: COLLEGE_BOARD_VALUE,
      targetYear: readTrimmedString(preparation.targetYear),
      targetExam: readTrimmedString(preparation.targetExam) || subject,
      institutionName: resolvedCollegeName,
      collegeName: resolvedCollegeName,
      universityName: readTrimmedString(preparation.universityName),
    },
    learningMode: {
      mode: readTrimmedString((details.learningMode as Record<string, unknown>)?.mode),
      provider: readTrimmedString((details.learningMode as Record<string, unknown>)?.provider),
    },
    hearAboutUs: readTrimmedString(details.hearAboutUs),
  };

  if (!normalized.preparation.targetExam) return { error: "Target exam is required" } as const;

  return {
    data: {
      fullName,
      phone,
      avatarUrl,
      subject,
      profileDetails: normalized,
    },
  } as const;
}

function parseStudentProfileData(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStudentOnboardingDraftStep(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const stepRaw = Number((raw as Record<string, unknown>).__draftStep);
  if (!Number.isFinite(stepRaw)) return null;
  return Math.min(Math.max(0, Math.trunc(stepRaw)), STUDENT_ONBOARDING_TOTAL_STEPS - 1);
}

function stripStudentOnboardingDraftMeta(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const next = { ...(raw as Record<string, unknown>) };
  delete next.__draftStep;
  delete next.__draftSavedAt;
  return next;
}

function readUserField<T = unknown>(user: Record<string, unknown>, camelKey: string, snakeKey?: string): T | undefined {
  if (camelKey in user) return user[camelKey] as T;
  if (snakeKey && snakeKey in user) return user[snakeKey] as T;
  return undefined;
}

function validateStudentOnboardingDraftBody(body: unknown) {
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fullName = readTrimmedString(payload.fullName);
  const avatarUrlValue = payload.avatarUrl;
  const avatarUrl = typeof avatarUrlValue === "string" ? readTrimmedString(avatarUrlValue) : null;
  const profileDetails = payload.profileDetails;
  const step = Number(payload.step);

  if (!fullName) return { error: "Full name is required" } as const;
  if (fullName.length > 120) return { error: "Full name is too long" } as const;
  if (avatarUrl !== null && avatarUrl.length > 0 && avatarUrl.length > 8_000_000) {
    return { error: "Profile image is too large" } as const;
  }
  if (!Number.isFinite(step)) return { error: "Onboarding step is invalid" } as const;
  if (step < 0 || step >= STUDENT_ONBOARDING_TOTAL_STEPS) {
    return { error: "Onboarding step is invalid" } as const;
  }
  if (!profileDetails || typeof profileDetails !== "object") {
    return { error: "Profile details are required" } as const;
  }

  return {
    data: {
      fullName,
      phone: "",
      avatarUrl,
      step: Math.trunc(step),
      profileDetails,
    },
  } as const;
}

function serializeUser(user: typeof usersTable.$inferSelect) {
  const raw = user as unknown as Record<string, unknown>;
  const role = readUserField<typeof user.role>(raw, "role", "role") ?? "student";
  const status = readUserField<typeof user.status>(raw, "status", "status") ?? "pending";
  const onboardingCompleteFlag = readUserField<boolean>(raw, "onboardingComplete", "onboarding_complete");
  const subject = readUserField<string | null>(raw, "subject", "subject");
  const onboardingComplete = Boolean(onboardingCompleteFlag || (role === "student" && Boolean(String(subject ?? "").trim())));
  const parsedProfileDetails = parseStudentProfileData(
    readUserField(raw, "studentProfileData", "student_profile_data") ?? null,
  );
  const studentFeatureAccess = getStudentFeatureAccess(parsedProfileDetails);
  const id = readUserField<number>(raw, "id", "id") ?? Number((raw.id as number | string | undefined) ?? 0);
  const username = readUserField<string>(raw, "username", "username") ?? String(raw.username ?? "");
  const fullName = readUserField<string>(raw, "fullName", "full_name") ?? String(raw.fullName ?? raw.full_name ?? username);
  const email = readUserField<string>(raw, "email", "email") ?? String(raw.email ?? "");
  return {
    id,
    username,
    fullName,
    email,
    role,
    status,
    priorityAccess: Boolean(readUserField(raw, "priorityAccess", "priority_access")),
    phone: readUserField<string | null>(raw, "phone"),
    subject,
    rejectionReason: readUserField<string | null>(raw, "rejectionReason", "rejection_reason"),
    avatarUrl: readUserField<string | null>(raw, "avatarUrl", "avatar_url"),
    additionalExams: readUserField<string[] | null>(raw, "additionalExams", "additional_exams") ?? [],
    onboardingComplete,
    onboardingDraftStep: onboardingComplete ? null : getStudentOnboardingDraftStep(parsedProfileDetails),
    profileDetails: stripStudentOnboardingDraftMeta(parsedProfileDetails),
    studentFeatureAccess,
    studentFeaturePricing: getStudentFeatureUnlockPricing(parsedProfileDetails),
    createdAt: readUserField(raw, "createdAt", "created_at") ?? new Date().toISOString(),
    updatedAt: readUserField(raw, "updatedAt", "updated_at"),
  };
}

function canUserAccessPlatform(user: typeof usersTable.$inferSelect) {
  if (user.role === "planner") {
    return { error: "Planner role is no longer supported on this platform", status: 403 } as const;
  }

  return null;
}

async function sendSessionResponse(
  res: Response,
  user: typeof usersTable.$inferSelect,
  message: string,
) {
  const accessError = canUserAccessPlatform(user);
  if (accessError || ['blocked', 'disabled', 'suspended', 'inactive'].includes(user.status)) {
    if (user.role === "planner") {
      res.clearCookie("userId");
      res.clearCookie("userRole");
    }
    res.status(accessError?.status ?? 403).json({ error: accessError?.error ?? 'Account is disabled.' });
    return false;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const cookieOpts = {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: isProduction ? ("none" as const) : ("lax" as const),
    secure: isProduction,
  };
  res.cookie("userId", await createNodeSession(user.id), cookieOpts);
  res.cookie("userRole", user.role, cookieOpts);
  res.json({ user: serializeUser(user), message });
  return true;
}

async function upsertFirebaseUser({
  email,
  fullName,
  avatarUrl,
}: {
  email: string;
  fullName: string;
  avatarUrl: string | null;
}) {
  let [user] = await db
    .select()
    .from(usersTable)
    .where(ilike(usersTable.email, email));

  if (!user) {
    const username = await buildUniqueGoogleUsername(email, fullName);
    const status = readGoogleNewStudentStatus();
    const [createdUser] = await db.insert(usersTable).values({
      username,
      passwordHash: await hashPassword(randomBytes(24).toString("hex")),
      fullName,
      email,
      phone: null,
      subject: null,
      avatarUrl,
      role: "student",
      status,
      approvedAt: status === "approved" ? new Date() : null,
      rejectionReason: null,
    }).returning();
    user = createdUser;
  } else {
    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (avatarUrl && user.avatarUrl !== avatarUrl) updates.avatarUrl = avatarUrl;
    if (fullName && user.fullName?.trim() !== fullName) updates.fullName = fullName;
    if (Object.keys(updates).length > 0) {
      const [updatedUser] = await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.id, user.id))
        .returning();
      user = updatedUser;
    }
  }
  return user;
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const username = parsed.data.username.trim();
  const password = parsed.data.password.trim();
  const normalizedIdentifier = normalizeEmail(username);

  const [user] = await db.select().from(usersTable).where(or(
    sql`lower(${usersTable.username}) = lower(${username})`,
    sql`lower(${usersTable.email}) = lower(${normalizedIdentifier})`,
  )).limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  if (['admin', 'super_admin'].includes(user.role) && password === EXPOSED_DEMO_PASSWORD) {
    res.status(403).json({ error: 'Reset your exposed password through the registered email before password sign-in.' }); return;
  }
  if (isLegacyPasswordHash(user.passwordHash)) {
    await db.update(usersTable).set({ passwordHash: await hashPassword(password) }).where(eq(usersTable.id, user.id));
  }
  await sendSessionResponse(res, user, "Login successful");
});

router.post("/auth/google", async (req, res): Promise<void> => {
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "";
  if (!idToken) {
    res.status(400).json({ error: "Firebase Google ID token is required" });
    return;
  }

  if (!isFirebaseTokenVerificationConfigured()) {
    res.status(503).json({ error: "Firebase Google login is not configured on the server yet" });
    return;
  }

  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    const provider = decoded.firebase?.sign_in_provider;
    const email = normalizeEmail(typeof decoded.email === "string" ? decoded.email : "");
    const fullName = readTrimmedString(decoded.name) || email.split("@")[0] || "Student";
    const avatarUrl = typeof decoded.picture === "string" ? decoded.picture : null;

    if (provider !== "google.com") {
      res.status(400).json({ error: "This token is not from Firebase Google sign-in" });
      return;
    }

    if (!decoded.email_verified || !email) {
      res.status(400).json({ error: "A verified Google email is required to continue" });
      return;
    }

    const user = await upsertFirebaseUser({ email, fullName, avatarUrl });
    await sendSessionResponse(res, user, "Google login successful");
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : "Firebase Google login failed",
    });
  }
});

router.post("/auth/firebase-email", async (req, res): Promise<void> => {
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "";
  if (!idToken) {
    res.status(400).json({ error: "Firebase email/password ID token is required" });
    return;
  }

  if (!isFirebaseTokenVerificationConfigured()) {
    res.status(503).json({ error: "Firebase email/password login is not configured on the server yet" });
    return;
  }

  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    const provider = decoded.firebase?.sign_in_provider;
    const email = normalizeEmail(typeof decoded.email === "string" ? decoded.email : "");
    if (provider !== "password") {
      res.status(400).json({ error: "This token is not from Firebase email/password sign-in" });
      return;
    }

    if (!email) {
      res.status(400).json({ error: "A Firebase email is required to continue" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(ilike(usersTable.email, email));

    if (!user) {
      res.status(403).json({
        error: "Account not found. Student signup is public, but teacher accounts must be created by admin.",
      });
      return;
    }

    if (await compromisedPrivilegedCredential(user.role, user.passwordHash)) {
      res.status(403).json({ error: 'Reset your exposed password through the registered email before password sign-in.' }); return;
    }
    if (!(typeof req.body.password === 'string' && await verifyPassword(req.body.password, user.passwordHash))) {
      res.status(401).json({ error: 'The current application password is required.' }); return;
    }
    await sendSessionResponse(res, user, "Firebase email login successful");
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : "Firebase email/password login failed",
    });
  }
});

router.post("/auth/forgot-password-request", async (req, res): Promise<void> => {
  const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim() : "";
  if (!identifier) {
    res.status(400).json({ error: "Username or email is required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(or(eq(usersTable.username, identifier), ilike(usersTable.email, normalizeEmail(identifier))));

  if (!user) {
    res.json({ message: "If this student account exists, a reset request has been sent." });
    return;
  }

  if (user.role === "student" || user.role === "admin" || user.role === "super_admin") {
    if (user.email) {
      const cooldownRemaining = getPasswordResetCooldownRemaining(user.lastPasswordResetEmailAt);
      if (cooldownRemaining > 0) {
        res.status(429).json({
          error: `A reset email was already sent recently. You can request the next email after ${formatPasswordResetCooldown(cooldownRemaining)}.`,
          retryAfterSeconds: Math.ceil(cooldownRemaining / 1000),
          nextAllowedAt: new Date(Date.now() + cooldownRemaining).toISOString(),
        });
        return;
      }

      if (isFirebaseAdminConfigured() && await hasBrevoAccounts()) {
        try {
          await ensureFirebaseEmailUserExists({
            email: user.email,
            password: randomBytes(32).toString("base64url"),
            fullName: user.fullName?.trim() || user.username,
          });
          const firebaseLink = await generateFirebasePasswordResetLink(user.email);
          const resetUrl = buildCustomPasswordResetUrl(firebaseLink);
          await sendPasswordResetEmail({
            accountName: user.fullName?.trim() || user.username,
            email: user.email,
            resetUrl,
          });
          await db
            .update(usersTable)
            .set({ lastPasswordResetEmailAt: new Date() })
            .where(eq(usersTable.id, user.id));

          res.json({
            message: "Password reset link sent to your registered email. The next reset email can be sent after 2 hours.",
            delivery: "server",
          });
          return;
        } catch (error) {
          res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to send password reset email.",
          });
          return;
        }
      }

      await db
        .update(usersTable)
        .set({ lastPasswordResetEmailAt: new Date() })
        .where(eq(usersTable.id, user.id));

      res.json({
        message: "Password reset link sent to your registered email. The next reset email can be sent after 2 hours.",
        email: user.email,
        delivery: "client",
      });
      return;
    }

  }

  res.status(400).json({ error: "This account does not have a valid email address." });
  return;
});

router.get("/auth/exams", async (_req, res): Promise<void> => {
  await ensureJamChemistryTemplate();
  const templates = await db
    .select({
      key: examTemplatesTable.key,
      name: examTemplatesTable.name,
      description: examTemplatesTable.description,
      durationMinutes: examTemplatesTable.durationMinutes,
      showInRegistration: examTemplatesTable.showInRegistration,
    })
    .from(examTemplatesTable)
    .orderBy(examTemplatesTable.name);

  const exams = templates
    .filter((template) => template.showInRegistration !== false)
    .map((template) => ({
      exam: template.key,
      label: template.name,
      description: template.description ?? null,
      durationMinutes: template.durationMinutes ?? null,
    }));
  res.json(exams);
});

router.get("/auth/registration-status", async (_req, res): Promise<void> => {
  const accessWindow = await getStudentAccessWindow();
  const currentUserId = getSignedUserId(_req);
  let priorityAccess = false;
  if (currentUserId) {
    const [currentUser] = await db.select({ role: usersTable.role, priorityAccess: usersTable.priorityAccess }).from(usersTable).where(eq(usersTable.id, currentUserId));
    priorityAccess = currentUser?.role === "student" && Boolean(currentUser.priorityAccess);
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({
    isClosed: accessWindow.isClosed,
    closedUntil: accessWindow.registrationClosedUntil?.toISOString() ?? null,
    serverNow: new Date().toISOString(),
    priorityAccess,
  });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const accessWindow = await getStudentAccessWindow();
  if (accessWindow.isClosed) {
    res.status(423).json({
      error: "New student registration is temporarily closed.",
      closedUntil: accessWindow.registrationClosedUntil?.toISOString() ?? null,
    });
    return;
  }

  const parsed = validateRegisterStudentBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { username, email, password, fullName } = parsed.data;
  const firebaseIdToken = typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "";

  if (!firebaseIdToken && !isFirebaseAdminConfigured() && !isFirebaseRestCreationAvailable()) {
    res.status(503).json({ error: "Firebase student registration is not configured on the server yet" });
    return;
  }

  if (firebaseIdToken && !isFirebaseTokenVerificationConfigured()) {
    res.status(503).json({ error: "Firebase student registration is not configured on the server yet" });
    return;
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (existing) {
    res.status(400).json({ error: "Username already taken" });
    return;
  }

  const [existingEmail] = await db
    .select()
    .from(usersTable)
    .where(ilike(usersTable.email, email));

  if (existingEmail) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  let firebaseUid: string | null = null;
  let usesClientManagedFirebaseUser = false;

  try {
    if (firebaseIdToken) {
      const decoded = await verifyFirebaseIdToken(firebaseIdToken);
      const provider = decoded.firebase?.sign_in_provider;
      const decodedEmail = normalizeEmail(typeof decoded.email === "string" ? decoded.email : "");

      if (provider && provider !== "password") {
        res.status(400).json({ error: "Student registration must use Firebase email/password." });
        return;
      }

      if (!decodedEmail) {
        res.status(400).json({ error: "A Firebase email is required to continue." });
        return;
      }

      if (decodedEmail !== email) {
        res.status(400).json({ error: "Registered email does not match the Firebase account." });
        return;
      }

      firebaseUid = typeof decoded.uid === "string" && decoded.uid.trim() ? decoded.uid.trim() : null;
      usesClientManagedFirebaseUser = true;
    } else {
      const firebaseUser = await ensureFirebaseEmailUser({ email, password, fullName });
      if ("reusedExisting" in firebaseUser && firebaseUser.reusedExisting) {
        // Email already exists in Firebase but Admin SDK is unavailable, so we cannot
        // reset that account's password. The user must sign in to Firebase with their
        // original credentials and then supply an idToken, or an admin must configure
        // Firebase Admin SDK so the server can manage user accounts directly.
        res.status(400).json({
          error: "This email is already linked to an existing account. Please sign in instead, or use a different email to register.",
        });
        return;
      }
      firebaseUid = firebaseUser.uid;
    }

    const [newUser] = await db.insert(usersTable).values({
      username,
      passwordHash: await hashPassword(password),
      fullName,
      email,
      phone: null,
      subject: null,
      role: "student",
      status: "pending",
      onboardingComplete: false,
    }).returning();

    res.status(201).json(serializeUser(newUser));
  } catch (error) {
    if (firebaseUid && !usesClientManagedFirebaseUser) {
      await deleteFirebaseUser(firebaseUid).catch(() => undefined);
    }

    if (error instanceof Error) {
      if (error.message.includes("email-already-exists")) {
        res.status(400).json({ error: "This email is already linked to an active account. Try signing in instead." });
        return;
      }
      // Include the underlying cause (e.g. Postgres error) for debugging
      const causeMsg = (error as any).cause instanceof Error ? (error as any).cause.message : undefined;
      const displayMsg = causeMsg || error.message;
      console.error("[register] error:", error.message, "cause:", causeMsg);
      res.status(400).json({ error: displayMsg });
      return;
    }

    res.status(500).json({ error: "Student registration failed" });
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await revokeNodeSession(req);
  res.clearCookie("userId");
  res.clearCookie("userRole");
  res.json({ message: "Logged out successfully" });
});

router.patch("/auth/profile", async (req, res): Promise<void> => {
  const userIdCookie = getSignedUserId(req)?.toString();
  if (!userIdCookie) { res.status(401).json({ error: "Not authenticated" }); return; }
  const userId = parseInt(userIdCookie, 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!existingUser) { res.status(404).json({ error: "User not found" }); return; }

  const { fullName, phone, avatarUrl, additionalExams, dailyQuestionGoal } = req.body;
  const updates: Record<string, any> = {};
  if (typeof fullName === "string" && fullName.trim()) updates.fullName = fullName.trim();
  if (typeof phone === "string") updates.phone = phone.trim() || null;
  if (typeof avatarUrl === "string" || avatarUrl === null) updates.avatarUrl = avatarUrl;
  if (Array.isArray(additionalExams)) {
    updates.additionalExams = additionalExams
      .filter((exam): exam is string => typeof exam === "string")
      .map((exam) => exam.trim())
      .filter(Boolean)
      .filter((exam, index, all) => all.indexOf(exam) === index);
  }
  if (dailyQuestionGoal !== undefined) {
    const parsedGoal = Number(dailyQuestionGoal);
    if (!Number.isInteger(parsedGoal) || parsedGoal <= 0 || parsedGoal > 5000) {
      res.status(400).json({ error: "Daily question goal must be between 1 and 5000" }); return;
    }

    const existingProfileData = parseStudentProfileData(existingUser.studentProfileData ?? null);
    const nextProfileData = {
      ...(existingProfileData && typeof existingProfileData === "object" ? existingProfileData : {}),
      dashboard: {
        ...(existingProfileData?.dashboard && typeof existingProfileData.dashboard === "object" ? existingProfileData.dashboard : {}),
        dailyQuestionGoal: parsedGoal,
      },
    };
    updates.studentProfileData = JSON.stringify(nextProfileData);
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" }); return;
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  res.json(serializeUser(updated));
});

router.post("/auth/student-onboarding/draft", async (req, res): Promise<void> => {
  const userIdCookie = getSignedUserId(req)?.toString();
  if (!userIdCookie) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = parseInt(userIdCookie, 10);
  if (isNaN(userId)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = validateStudentOnboardingDraftBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!existingUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (existingUser.role !== "student") {
    res.status(403).json({ error: "Only students can save onboarding progress" });
    return;
  }

  const { fullName, phone, avatarUrl, step, profileDetails } = parsed.data;
  const existingProfileData = parseStudentProfileData(existingUser.studentProfileData ?? null);
  const nextProfileData = {
    ...(existingProfileData && typeof existingProfileData === "object" ? stripStudentOnboardingDraftMeta(existingProfileData) ?? {} : {}),
    ...mergeOnboardingProfile(existingProfileData, profileDetails),
    __draftStep: step,
    __draftSavedAt: new Date().toISOString(),
  };

  const [updated] = await db
    .update(usersTable)
    .set({
      fullName,
      phone,
      avatarUrl,
      studentProfileData: JSON.stringify(nextProfileData),
      onboardingComplete: false,
    })
    .where(eq(usersTable.id, userId))
    .returning();

  res.json(serializeUser(updated));
});

router.post("/auth/student-onboarding", async (req, res): Promise<void> => {
  const userIdCookie = getSignedUserId(req)?.toString();
  if (!userIdCookie) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = parseInt(userIdCookie, 10);
  if (isNaN(userId)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = validateStudentOnboardingBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!existingUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (existingUser.role !== "student") {
    res.status(403).json({ error: "Only students can complete onboarding" });
    return;
  }

  const { fullName, phone, avatarUrl, subject, profileDetails } = parsed.data;
  const normalizedSubject = profileDetails.preparation.targetExam.trim() || subject.trim();

  const [updated] = await db
    .update(usersTable)
    .set({
      fullName,
      phone,
      avatarUrl,
      subject: normalizedSubject,
      status: "pending",
      reviewedById: null,
      reviewedAt: null,
      approvedAt: null,
      approvedById: null,
      rejectionReason: null,
      pendingReviewStartedAt: new Date(),
      pendingReviewEscalatedAt: null,
      onboardingComplete: true,
      studentProfileData: JSON.stringify({
        ...mergeOnboardingProfile(parseStudentProfileData(existingUser.studentProfileData ?? null), profileDetails),
        preparation: {
          ...profileDetails.preparation,
          targetExam: normalizedSubject,
        },
      }),
    })
    .where(eq(usersTable.id, userId))
    .returning();

  const studentReviewSettings = await getStudentReviewAutomationSettings();
  if (studentReviewSettings.emailEnabled && await hasBrevoAccounts()) {
    const recipients = await listStudentReviewEmailRecipients();
    if (recipients.length > 0) {
      queueNewStudentReviewRequestEmails({
        studentId: updated.id,
        cycleAt: getStudentReviewCycleAt(updated),
        studentSummary: buildStudentReviewSummary(updated),
        recipients,
        quickActionsEnabled: studentReviewSettings.quickActionsEnabled,
      });
    }
  }

  res.json(serializeUser(updated));
});

router.post("/auth/change-password", async (req, res): Promise<void> => {
  const userIdCookie = getSignedUserId(req)?.toString();
  if (!userIdCookie) { res.status(401).json({ error: "Not authenticated" }); return; }
  const userId = parseInt(userIdCookie, 10);
  if (isNaN(userId)) { res.status(401).json({ error: "Not authenticated" }); return; }

  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword.trim() : "";

  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (['admin', 'super_admin'].includes(user.role) && newPassword === EXPOSED_DEMO_PASSWORD) { res.status(400).json({ error: 'Choose a new password that is not the exposed demo password.' }); return; }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false })
    .where(eq(usersTable.id, userId))
    .returning();
  await revokeNodeUserSessions(userId);
  res.cookie('userId', await createNodeSession(userId), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', maxAge: 7 * 86400000 });
  res.json(serializeUser(updated));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const userIdCookie = getSignedUserId(req)?.toString();
  if (!userIdCookie) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = parseInt(userIdCookie, 10);
  if (isNaN(userId)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.clearCookie("userId");
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  if (user.role === "planner") {
    res.clearCookie("userId");
    res.clearCookie("userRole");
    res.status(403).json({ error: "Planner role is no longer supported on this platform" });
    return;
  }

  res.json(serializeUser(user));
});

export default router;
