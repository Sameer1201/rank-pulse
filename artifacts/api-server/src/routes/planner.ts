import { Router } from "express";
import {
  db,
  examTemplatesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSignedUserId } from "../lib/authUtils";
import { ensureJamChemistryTemplate, JAM_CHEMISTRY_EXAM } from "../lib/examCatalog";

const router = Router();

function getAuth(req: any, res: any): { userId: number; role: string } | null {
  const userId = getSignedUserId(req);
  const role = req.cookies?.userRole;
  if (!userId || !role) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return { userId, role };
}

function getDefaultTemplateInstructions(templateName: string, durationMinutes: number) {
  const safeName = templateName?.trim() || "the examination";
  const safeDuration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 180;
  return [
    `The duration of ${safeName} is ${safeDuration} minutes. The countdown timer at the top right-hand corner of your screen displays the remaining time.`,
    "When the timer reaches zero, the test will be submitted automatically.",
    "Read every question carefully before selecting or entering your response.",
    "Use Save & Next to save the current response and move ahead.",
    "Use Mark for Review & Next when you want to revisit a question before final submission.",
    "You can jump to any question from the question palette without losing the current screen context.",
    "Use Clear Response to remove the selected answer from the current question.",
    "MCQ uses single selection, MSQ uses multiple selections, and integer questions require a numeric answer.",
  ].join("\n");
}

function extractCustomTemplateInstructions(storedInstructions: unknown, templateName: string, durationMinutes: number) {
  if (typeof storedInstructions !== "string" || !storedInstructions.trim()) return "";
  const defaultInstructions = getDefaultTemplateInstructions(templateName, durationMinutes).trim();
  const normalizedStored = storedInstructions.trim();
  if (normalizedStored === defaultInstructions) return "";
  if (normalizedStored.startsWith(defaultInstructions)) {
    return normalizedStored.slice(defaultInstructions.length).replace(/^\s+/, "").trim();
  }
  return normalizedStored;
}

function mergeTemplateInstructions(storedInstructions: unknown, templateName: string, durationMinutes: number) {
  const defaultInstructions = getDefaultTemplateInstructions(templateName, durationMinutes).trim();
  const customInstructions = extractCustomTemplateInstructions(storedInstructions, templateName, durationMinutes);
  return customInstructions ? `${defaultInstructions}\n${customInstructions}` : defaultInstructions;
}

function serializeTemplate(row: typeof examTemplatesTable.$inferSelect) {
  return {
    ...row,
    examHeader: row.examHeader ?? null,
    examSubheader: row.examSubheader ?? null,
    instructions: mergeTemplateInstructions(row.instructions, row.name, row.durationMinutes),
    customInstructions: extractCustomTemplateInstructions(row.instructions, row.name, row.durationMinutes),
    showInRegistration: row.showInRegistration ?? true,
    isLocked: row.isLocked ?? false,
    sections: row.sections ? JSON.parse(row.sections) : [],
  };
}

const DEFAULT_EXAM_TEMPLATES = [
  {
    key: "jee-main",
    name: "JEE Main",
    description: "Physics, Chemistry, Mathematics with mixed MCQ and numerical structure.",
    examHeader: "JOINT ENTRANCE EXAMINATION",
    examSubheader: "JEE Main Mock Assessment",
    instructions: getDefaultTemplateInstructions("JEE Main", 180),
    durationMinutes: 180,
    passingScore: null,
    defaultPositiveMarks: 4,
    defaultNegativeMarks: 1,
    isSystem: true,
    showInRegistration: true,
    sections: [
      { title: "Physics", subjectLabel: "Physics", description: "JEE Main Physics. Teacher can mix MCQ and NAT.", questionCount: 25, marksPerQuestion: 4, negativeMarks: 1, preferredQuestionType: "mcq" },
      { title: "Chemistry", subjectLabel: "Chemistry", description: "JEE Main Chemistry. Teacher can mix MCQ and NAT.", questionCount: 25, marksPerQuestion: 4, negativeMarks: 1, preferredQuestionType: "mcq" },
      { title: "Mathematics", subjectLabel: "Mathematics", description: "JEE Main Mathematics. Teacher can mix MCQ and NAT.", questionCount: 25, marksPerQuestion: 4, negativeMarks: 1, preferredQuestionType: "mcq" },
    ],
  },
  {
    key: "gate",
    name: "GATE",
    description: "General Aptitude, Engineering Mathematics, and Core Subject with MCQ, MSQ, and NAT.",
    examHeader: "GRADUATE APTITUDE TEST IN ENGINEERING",
    examSubheader: "GATE Mock Assessment",
    instructions: getDefaultTemplateInstructions("GATE", 180),
    durationMinutes: 180,
    passingScore: null,
    defaultPositiveMarks: 2,
    defaultNegativeMarks: 0.66,
    isSystem: true,
    showInRegistration: true,
    sections: [
      { title: "General Aptitude", subjectLabel: "General Aptitude", description: "10 questions. Mixed +1 and +2. MCQ can carry -1/3 or -2/3. NAT/MSQ no negative.", questionCount: 10, marksPerQuestion: 1, negativeMarks: 0.33, preferredQuestionType: "mcq" },
      { title: "Engineering Mathematics", subjectLabel: "Engineering Maths", description: "Around 10-12 questions. Mixed MCQ, MSQ, NAT allowed.", questionCount: 10, marksPerQuestion: 1, negativeMarks: 0.33, preferredQuestionType: "mcq" },
      { title: "Core Subject", subjectLabel: "Core Subject", description: "Around 40-45 questions. Core paper with MCQ, MSQ, NAT.", questionCount: 45, marksPerQuestion: 2, negativeMarks: 0.66, preferredQuestionType: "mcq" },
    ],
  },
  {
    key: "iit-jam",
    name: "IIT JAM",
    description: "Single-subject paper with Section A, B, and C.",
    examHeader: "JOINT ADMISSION TEST FOR MASTERS",
    examSubheader: "IIT JAM Mock Assessment",
    instructions: getDefaultTemplateInstructions("IIT JAM", 180),
    durationMinutes: 180,
    passingScore: null,
    defaultPositiveMarks: 2,
    defaultNegativeMarks: 0.33,
    isSystem: true,
    showInRegistration: true,
    sections: [
      { title: "Section A", subjectLabel: "Section A", description: "30 MCQs with negative marking.", questionCount: 30, marksPerQuestion: 1, negativeMarks: 0.33, preferredQuestionType: "mcq" },
      { title: "Section B", subjectLabel: "Section B", description: "10 MSQs with no negative marking.", questionCount: 10, marksPerQuestion: 2, negativeMarks: 0, preferredQuestionType: "multi" },
      { title: "Section C", subjectLabel: "Section C", description: "20 NAT questions with no negative marking.", questionCount: 20, marksPerQuestion: 2, negativeMarks: 0, preferredQuestionType: "integer" },
    ],
  },
  {
    key: "cuet",
    name: "CUET",
    description: "Language, Domain Subject, and General Test style structure. MCQ only.",
    examHeader: "COMMON UNIVERSITY ENTRANCE TEST",
    examSubheader: "CUET Mock Assessment",
    instructions: getDefaultTemplateInstructions("CUET", 60),
    durationMinutes: 60,
    passingScore: null,
    defaultPositiveMarks: 5,
    defaultNegativeMarks: 1,
    isSystem: true,
    showInRegistration: true,
    sections: [
      { title: "Language", subjectLabel: "Language", description: "50 questions, attempt around 40. MCQ only.", questionCount: 50, marksPerQuestion: 5, negativeMarks: 1, preferredQuestionType: "mcq" },
      { title: "Domain Subjects", subjectLabel: "Domain Subjects", description: "Subject-specific MCQ section. Multiple subjects can be cloned later by super admin.", questionCount: 50, marksPerQuestion: 5, negativeMarks: 1, preferredQuestionType: "mcq" },
      { title: "General Test", subjectLabel: "General Test", description: "General aptitude and reasoning. MCQ only.", questionCount: 50, marksPerQuestion: 5, negativeMarks: 1, preferredQuestionType: "mcq" },
    ],
  },
  {
    ...JAM_CHEMISTRY_EXAM,
    instructions: getDefaultTemplateInstructions(JAM_CHEMISTRY_EXAM.name, JAM_CHEMISTRY_EXAM.durationMinutes),
  },
  {
    key: "neet",
    name: "NEET",
    description: "Physics, Chemistry, Biology with NEET-style optional section logic.",
    examHeader: "NATIONAL ELIGIBILITY CUM ENTRANCE TEST",
    examSubheader: "NEET Mock Assessment",
    instructions: getDefaultTemplateInstructions("NEET", 200),
    durationMinutes: 200,
    passingScore: null,
    defaultPositiveMarks: 4,
    defaultNegativeMarks: 1,
    isSystem: true,
    showInRegistration: true,
    sections: [
      { title: "Physics", subjectLabel: "Physics", description: "45 MCQs. NEET-style section with optional choice rules configurable later.", questionCount: 45, marksPerQuestion: 4, negativeMarks: 1, preferredQuestionType: "mcq" },
      { title: "Chemistry", subjectLabel: "Chemistry", description: "45 MCQs. NEET-style section with optional choice rules configurable later.", questionCount: 45, marksPerQuestion: 4, negativeMarks: 1, preferredQuestionType: "mcq" },
      { title: "Biology", subjectLabel: "Biology", description: "90 MCQs. Includes Botany/Zoology coverage as needed.", questionCount: 90, marksPerQuestion: 4, negativeMarks: 1, preferredQuestionType: "mcq" },
    ],
  },
];

async function ensureExamTemplates(userId: number) {
  const existing = await db.select().from(examTemplatesTable);
  if (existing.length > 0) {
    await ensureJamChemistryTemplate();
    return db.select().from(examTemplatesTable);
  }
  const inserted = await db.insert(examTemplatesTable).values(
    DEFAULT_EXAM_TEMPLATES.map((template) => ({
      ...template,
      sections: JSON.stringify(template.sections),
      createdBy: userId,
    })),
  ).returning();
  return inserted;
}

router.get("/planner/exam-templates", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (!["super_admin", "admin"].includes(auth.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const rows = await ensureExamTemplates(auth.userId);
  return res.json(rows.map(serializeTemplate));
});

router.post("/planner/exam-templates", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { key, name, description, examHeader, examSubheader, instructions, customInstructions, durationMinutes, passingScore, defaultPositiveMarks, defaultNegativeMarks, sections, showInRegistration } = req.body;
  if (!name || !Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ error: "name and sections are required" });
  }
  const resolvedDuration = Number(durationMinutes) || 180;
  const resolvedCustomInstructions =
    typeof customInstructions === "string"
      ? customInstructions.trim()
      : typeof instructions === "string"
        ? extractCustomTemplateInstructions(instructions, String(name), resolvedDuration)
        : "";
  const [template] = await db.insert(examTemplatesTable).values({
    key: key ? String(key) : String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: String(name),
    description: description ? String(description) : null,
    examHeader: examHeader ? String(examHeader) : null,
    examSubheader: examSubheader ? String(examSubheader) : null,
    instructions: resolvedCustomInstructions || null,
    durationMinutes: resolvedDuration,
    passingScore: passingScore === undefined || passingScore === null || String(passingScore).trim() === "" ? null : Number(passingScore),
    defaultPositiveMarks: Number(defaultPositiveMarks) || 1,
    defaultNegativeMarks: Number(defaultNegativeMarks) || 0,
    sections: JSON.stringify(sections),
    isSystem: false,
    showInRegistration: showInRegistration !== false,
    createdBy: auth.userId,
  }).returning();
  return res.status(201).json(serializeTemplate(template));
});

router.patch("/planner/exam-templates/:id", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const templateId = Number(req.params.id);
  const { key, name, description, examHeader, examSubheader, instructions, customInstructions, durationMinutes, passingScore, defaultPositiveMarks, defaultNegativeMarks, sections, showInRegistration } = req.body;
  const [existingTemplate] = await db.select().from(examTemplatesTable).where(eq(examTemplatesTable.id, templateId));
  if (!existingTemplate) return res.status(404).json({ error: "Template not found" });
  if (existingTemplate.isLocked) {
    return res.status(409).json({ error: "This exam template is locked. Unlock it to make changes." });
  }
  const updates: Record<string, unknown> = {};
  if (key !== undefined) updates.key = String(key);
  if (name !== undefined) updates.name = String(name);
  if (description !== undefined) updates.description = description ? String(description) : null;
  if (examHeader !== undefined) updates.examHeader = examHeader ? String(examHeader) : null;
  if (examSubheader !== undefined) updates.examSubheader = examSubheader ? String(examSubheader) : null;
  if (durationMinutes !== undefined) updates.durationMinutes = Number(durationMinutes);
  const nextName = name !== undefined ? String(name) : existingTemplate.name;
  const nextDuration = durationMinutes !== undefined ? Number(durationMinutes) : existingTemplate.durationMinutes;
  if (instructions !== undefined || customInstructions !== undefined) {
    updates.instructions =
      typeof customInstructions === "string"
        ? (customInstructions.trim() || null)
        : typeof instructions === "string"
          ? (extractCustomTemplateInstructions(instructions, nextName, nextDuration) || null)
          : null;
  }
  if (passingScore !== undefined) {
    updates.passingScore = passingScore === null || String(passingScore).trim() === "" ? null : Number(passingScore);
  }
  if (defaultPositiveMarks !== undefined) updates.defaultPositiveMarks = Number(defaultPositiveMarks);
  if (defaultNegativeMarks !== undefined) updates.defaultNegativeMarks = Number(defaultNegativeMarks);
  if (sections !== undefined) updates.sections = JSON.stringify(sections);
  if (showInRegistration !== undefined) updates.showInRegistration = Boolean(showInRegistration);
  const [template] = await db.update(examTemplatesTable).set(updates).where(eq(examTemplatesTable.id, templateId)).returning();
  return res.json(serializeTemplate(template));
});

router.patch("/planner/exam-templates/:id/lock", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const templateId = Number(req.params.id);
  const [existingTemplate] = await db.select().from(examTemplatesTable).where(eq(examTemplatesTable.id, templateId));
  if (!existingTemplate) return res.status(404).json({ error: "Template not found" });

  const [template] = await db
    .update(examTemplatesTable)
    .set({ isLocked: Boolean(req.body?.isLocked) })
    .where(eq(examTemplatesTable.id, templateId))
    .returning();

  return res.json(serializeTemplate(template));
});

router.delete("/planner/exam-templates/:id", async (req, res) => {
  const auth = getAuth(req, res);
  if (!auth) return;
  if (auth.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const templateId = Number(req.params.id);
  const [existingTemplate] = await db.select().from(examTemplatesTable).where(eq(examTemplatesTable.id, templateId));
  if (!existingTemplate) return res.status(404).json({ error: "Template not found" });
  if (existingTemplate.isLocked) {
    return res.status(409).json({ error: "This exam template is locked. Unlock it before deleting." });
  }

  await db.delete(examTemplatesTable).where(eq(examTemplatesTable.id, templateId));
  return res.json({ success: true, id: templateId });
});

export { router as plannerRouter };
