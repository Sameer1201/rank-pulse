import { db, examTemplatesTable, classesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const JAM_CHEMISTRY_EXAM = {
  key: "jam-chemistry",
  name: "JAM Chemistry",
  description: "IIT JAM Chemistry paper with Section A, B, and C question types.",
  examHeader: "JOINT ADMISSION TEST FOR MASTERS",
  examSubheader: "JAM Chemistry Mock Assessment",
  durationMinutes: 180,
  passingScore: null,
  defaultPositiveMarks: 2,
  defaultNegativeMarks: 0.33,
  isSystem: true,
  showInRegistration: true,
  sections: [
    { title: "Section A", subjectLabel: "Chemistry", description: "MCQs with negative marking.", questionCount: 30, marksPerQuestion: 1, negativeMarks: 0.33, preferredQuestionType: "mcq" },
    { title: "Section B", subjectLabel: "Chemistry", description: "MSQs with no negative marking.", questionCount: 10, marksPerQuestion: 2, negativeMarks: 0, preferredQuestionType: "multi" },
    { title: "Section C", subjectLabel: "Chemistry", description: "NAT questions with no negative marking.", questionCount: 20, marksPerQuestion: 2, negativeMarks: 0, preferredQuestionType: "integer" },
  ],
} as const;

export function normalizeExamKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!compact) return null;
  if (compact.includes("jam chemistry") || compact.includes("iit jam chemistry")) return JAM_CHEMISTRY_EXAM.key;
  if (compact.includes("iit jam")) return "iit-jam";
  if (compact.includes("jee main")) return "jee-main";
  if (compact === "jee") return "jee";
  if (compact.includes("gate")) return "gate";
  if (compact.includes("cuet")) return "cuet";
  if (compact.includes("neet")) return "neet";
  if (compact.includes("cat")) return "cat";
  return compact.replace(/\s+/g, "-");
}

/**
 * System templates are also used as the source of truth for registration and
 * the admin exam switcher. Keep this repair idempotent so an older database
 * gets JAM Chemistry without replacing any template a super-admin edited.
 */
export async function ensureJamChemistryTemplate() {
  const [existing] = await db
    .select()
    .from(examTemplatesTable)
    .where(eq(examTemplatesTable.key, JAM_CHEMISTRY_EXAM.key))
    .limit(1);
  if (existing) return existing;

  const [created] = await db.insert(examTemplatesTable).values({
    key: JAM_CHEMISTRY_EXAM.key,
    name: JAM_CHEMISTRY_EXAM.name,
    description: JAM_CHEMISTRY_EXAM.description,
    examHeader: JAM_CHEMISTRY_EXAM.examHeader,
    examSubheader: JAM_CHEMISTRY_EXAM.examSubheader,
    instructions: "Attempt all three sections according to the JAM Chemistry marking scheme.",
    durationMinutes: JAM_CHEMISTRY_EXAM.durationMinutes,
    passingScore: JAM_CHEMISTRY_EXAM.passingScore,
    defaultPositiveMarks: JAM_CHEMISTRY_EXAM.defaultPositiveMarks,
    defaultNegativeMarks: JAM_CHEMISTRY_EXAM.defaultNegativeMarks,
    sections: JSON.stringify(JAM_CHEMISTRY_EXAM.sections),
    isSystem: true,
    showInRegistration: true,
  }).returning();
  return created;
}

/** Create the empty admin-owned question-bank card once, so JAM Chemistry is
 * importable immediately after the exam is added. Existing cards are left
 * untouched, including their teacher assignments and lock state. */
export async function ensureJamChemistryQuestionBankCard() {
  await ensureJamChemistryTemplate();
  const [existing] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.subject, JAM_CHEMISTRY_EXAM.name))
    .limit(1);
  if (existing) return existing;

  const admins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  const teacherIds = admins.map((admin) => admin.id);
  const primaryTeacherId = teacherIds[0] ?? null;
  const [created] = await db.insert(classesTable).values({
    title: JAM_CHEMISTRY_EXAM.name,
    subject: JAM_CHEMISTRY_EXAM.name,
    description: JAM_CHEMISTRY_EXAM.description,
    workflowType: "question_bank",
    adminId: primaryTeacherId,
    assignedTeacherIds: teacherIds,
    status: "scheduled",
    weeklyTargetQuestions: null,
    weeklyTargetDeadline: null,
    scheduledAt: null,
    maxStudents: null,
    meetingLink: null,
  }).returning();
  return created;
}
