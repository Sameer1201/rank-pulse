import { Router } from "express";
import { db, classesTable, examTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSignedUserId } from "../lib/authUtils";
import { ensureJamChemistryQuestionBankCard, normalizeExamKey } from "../lib/examCatalog";

const router = Router();

router.get("/admin/exams", async (req, res) => {
  const userId = getSignedUserId(req);
  const role = String(req.cookies?.userRole ?? "");
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  if (role !== "admin" && role !== "super_admin") return res.status(403).json({ error: "Forbidden" });

  await ensureJamChemistryQuestionBankCard();
  const [templates, cards] = await Promise.all([
    db.select({ key: examTemplatesTable.key, label: examTemplatesTable.name, description: examTemplatesTable.description })
      .from(examTemplatesTable)
      .where(eq(examTemplatesTable.showInRegistration, true))
      .orderBy(examTemplatesTable.name),
    db.select({ key: classesTable.subject, title: classesTable.title })
      .from(classesTable)
      .where(eq(classesTable.workflowType, "question_bank")),
  ]);

  const cardKeys = new Set(cards.map((card) => normalizeExamKey(card.key ?? card.title)).filter((key): key is string => !!key));
  const exams = templates.map((template) => ({
    key: normalizeExamKey(template.key) ?? template.key,
    label: template.label,
    description: template.description ?? null,
    questionBankAvailable: cardKeys.has(normalizeExamKey(template.key) ?? template.key),
    pyqAvailable: true,
  }));
  res.json(exams);
});

export default router;
