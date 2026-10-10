import { hashPassword } from './lib/passwordSecurity';
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ensureFirebaseEmailUser, isFirebaseAdminConfigured } from "./lib/firebaseAdmin";

const DEMO_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? '';

const DEFAULT_USERS = [
  {
    username: "Sameer",
    oldUsernames: [] as string[],
    password: DEMO_PASSWORD,
    fullName: "Sameer",
    email: "Rankpulsee@gmail.com",
    role: "super_admin" as const,
    status: "active" as const,
  },
  {
    username: "Admin",
    oldUsernames: ["Sameer_Teacher"],
    password: DEMO_PASSWORD,
    fullName: "Priya Sharma",
    email: "priya@educonnect.com",
    role: "admin" as const,
    status: "active" as const,
  },
  {
    username: "Student",
    oldUsernames: ["Sameer_Student"],
    password: DEMO_PASSWORD,
    fullName: "Rahul Singh",
    email: "rahul@educonnect.com",
    role: "student" as const,
    status: "approved" as const,
  },
];

export async function seedDefaultUsers() {
  // Provisioning is explicit; never create privileged demo accounts on startup.
  if (process.env.ENABLE_DEMO_SEED !== 'true') return;
  if (process.env.NODE_ENV === 'production') throw new Error('Demo account seeding is disabled in production.');
  if (DEMO_PASSWORD.length < 12) throw new Error('Set a strong SEED_SUPER_ADMIN_PASSWORD before explicit demo provisioning.');
  for (const u of DEFAULT_USERS) {
    // Check if canonical username already exists — if so, skip entirely.
    // Credentials for existing accounts are NEVER reset by the seed so that
    // password changes made by the user are preserved across restarts.
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, u.username));

    if (existing) {
      // Already present — nothing to do.
      continue;
    }

    // Check old usernames: if found, rename to canonical name but do NOT
    // touch the password — the account already belongs to a real user.
    let handled = false;
    for (const oldName of u.oldUsernames) {
      const [old] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, oldName));

      if (old) {
        await db
          .update(usersTable)
          .set({ username: u.username })
          .where(eq(usersTable.id, old.id));
        console.log(`[seed] Renamed ${oldName} → ${u.username}`);
        handled = true;
        break;
      }
    }

    if (!handled) {
      const passwordHash = await hashPassword(u.password);
      await db.insert(usersTable).values({
        username: u.username,
        passwordHash,
        fullName: u.fullName,
        email: u.email,
        role: u.role,
        status: u.status,
        onboardingComplete: true,
      });
      console.log(`[seed] Created: ${u.username} (${u.role})`);

      // Only sync a brand-new account to Firebase — never for existing or
      // renamed accounts, so we never overwrite credentials for real users.
      if (isFirebaseAdminConfigured()) {
        await ensureFirebaseEmailUser({
          email: u.email,
          password: u.password,
          fullName: u.fullName,
        }).catch((err) => {
          console.warn(`[seed] Firebase sync failed for ${u.email}:`, err);
        });
      }
    }
  }
}
