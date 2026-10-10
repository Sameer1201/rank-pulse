import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type StudentReviewAutomationSettings = {
  emailEnabled: boolean;
  quickActionsEnabled: boolean;
};

export type StudentAccessWindow = {
  registrationClosedUntil: Date | null;
  isClosed: boolean;
};

const DEFAULT_SETTINGS: StudentReviewAutomationSettings = {
  emailEnabled: true,
  quickActionsEnabled: true,
};

async function ensurePlatformSettingsRow() {
  const [existing] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, 1));

  if (existing) return existing;

  const [created] = await db
    .insert(platformSettingsTable)
    .values({
      id: 1,
      studentReviewEmailEnabled: DEFAULT_SETTINGS.emailEnabled,
      studentReviewEmailActionsEnabled: DEFAULT_SETTINGS.quickActionsEnabled,
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [retried] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, 1));

  return retried ?? null;
}

export async function getPlatformSettings() {
  const row = await ensurePlatformSettingsRow();
  if (!row) {
    return {
      id: 1,
      studentReviewEmailEnabled: DEFAULT_SETTINGS.emailEnabled,
      studentReviewEmailActionsEnabled: DEFAULT_SETTINGS.quickActionsEnabled,
      registrationClosedUntil: null,
      updatedAt: new Date(),
    };
  }
  return row;
}

export function getActiveRegistrationClosedUntil(value: Date | string | number | null | undefined) {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > Date.now() ? parsed : null;
}

export async function getStudentAccessWindow(): Promise<StudentAccessWindow> {
  const row = await getPlatformSettings();
  const registrationClosedUntil = getActiveRegistrationClosedUntil(row.registrationClosedUntil);
  return {
    registrationClosedUntil,
    isClosed: Boolean(registrationClosedUntil),
  };
}

export async function updateRegistrationClosedUntil(value: Date | null) {
  await getPlatformSettings();
  const [updated] = await db
    .update(platformSettingsTable)
    .set({ registrationClosedUntil: value })
    .where(eq(platformSettingsTable.id, 1))
    .returning({ registrationClosedUntil: platformSettingsTable.registrationClosedUntil });
  return getActiveRegistrationClosedUntil(updated?.registrationClosedUntil ?? value);
}

export async function getStudentReviewAutomationSettings(): Promise<StudentReviewAutomationSettings> {
  const row = await getPlatformSettings();
  return {
    emailEnabled: row.studentReviewEmailEnabled,
    quickActionsEnabled: row.studentReviewEmailActionsEnabled,
  };
}

export async function updateStudentReviewAutomationSettings(
  patch: Partial<StudentReviewAutomationSettings>,
): Promise<StudentReviewAutomationSettings> {
  const current = await getPlatformSettings();
  const [updated] = await db
    .update(platformSettingsTable)
    .set({
      studentReviewEmailEnabled: patch.emailEnabled ?? current.studentReviewEmailEnabled,
      studentReviewEmailActionsEnabled: patch.quickActionsEnabled ?? current.studentReviewEmailActionsEnabled,
    })
    .where(eq(platformSettingsTable.id, 1))
    .returning();

  return {
    emailEnabled: updated?.studentReviewEmailEnabled ?? current.studentReviewEmailEnabled,
    quickActionsEnabled: updated?.studentReviewEmailActionsEnabled ?? current.studentReviewEmailActionsEnabled,
  };
}
