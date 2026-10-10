import { eq } from "drizzle-orm";
import {
  db,
  questionBankQuestionsTable,
  testQuestionsTable,
} from "@workspace/db";
import { extractNumericAnswerFromSolution } from "./numericAnswers";

function parseMeta(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sameNumber(left: number | null | undefined, right: number | null) {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(Number(left) - right) < 1e-12;
}

function hasOtherSetupFlags(meta: Record<string, unknown>) {
  return [
    "needsSubjectName",
    "needsChapterName",
    "needsDifficulty",
    "needsIdealTimeSeconds",
    "needsTaxonomyReview",
  ].some((key) => meta[key] === true || meta[key] === "true");
}

/**
 * Repairs old imported numeric questions using the first meaningful line of
 * their teacher solution. This is intentionally idempotent and only touches
 * questions with a parseable numeric answer.
 */
export async function repairStoredNumericAnswers() {
  let testQuestionCount = 0;
  let questionBankCount = 0;

  const testQuestions = await db
    .select()
    .from(testQuestionsTable)
    .where(eq(testQuestionsTable.questionType, "integer"));

  for (const question of testQuestions) {
    const extracted = extractNumericAnswerFromSolution(
      question.solutionText ?? question.aiSolutionText,
    );
    const hasRange = extracted.min !== null && extracted.max !== null;
    const hasExact = !hasRange && extracted.exact !== null;
    if (!hasRange && !hasExact) continue;

    const nextMin = hasRange ? Math.min(extracted.min!, extracted.max!) : null;
    const nextMax = hasRange ? Math.max(extracted.min!, extracted.max!) : null;
    const nextExact = hasRange ? 0 : extracted.exact ?? 0;
    const meta = parseMeta(question.meta);
    const needsAnswerReview = meta.needsCorrectAnswer === true || meta.needsCorrectAnswer === "true";
    const nextNeedsSetup = hasOtherSetupFlags(meta) || (
      (meta.needsQuestionSetup === true || meta.needsQuestionSetup === "true") &&
      !needsAnswerReview
    );

    if (
      sameNumber(question.correctAnswer, nextExact) &&
      sameNumber(question.correctAnswerMin, nextMin) &&
      sameNumber(question.correctAnswerMax, nextMax) &&
      !needsAnswerReview
    ) {
      continue;
    }

    await db
      .update(testQuestionsTable)
      .set({
        correctAnswer: nextExact,
        correctAnswerMin: nextMin,
        correctAnswerMax: nextMax,
        meta: JSON.stringify({
          ...meta,
          needsCorrectAnswer: false,
          needsQuestionSetup: nextNeedsSetup,
        }),
      })
      .where(eq(testQuestionsTable.id, question.id));
    testQuestionCount += 1;
  }

  const questionBankQuestions = await db
    .select()
    .from(questionBankQuestionsTable)
    .where(eq(questionBankQuestionsTable.questionType, "integer"));

  for (const question of questionBankQuestions) {
    const extracted = extractNumericAnswerFromSolution(question.explanation);
    const hasRange = extracted.min !== null && extracted.max !== null;
    const hasExact = !hasRange && extracted.exact !== null;
    if (!hasRange && !hasExact) continue;

    const nextMin = hasRange ? Math.min(extracted.min!, extracted.max!) : null;
    const nextMax = hasRange ? Math.max(extracted.min!, extracted.max!) : null;
    const nextExact = hasRange ? null : extracted.exact;
    if (
      sameNumber(question.correctAnswer, nextExact) &&
      sameNumber(question.correctAnswerMin, nextMin) &&
      sameNumber(question.correctAnswerMax, nextMax)
    ) {
      continue;
    }

    await db
      .update(questionBankQuestionsTable)
      .set({
        correctAnswer: nextExact,
        correctAnswerMin: nextMin,
        correctAnswerMax: nextMax,
        answer: hasRange
          ? `${nextMin} - ${nextMax}`
          : String(nextExact),
        updatedAt: new Date(),
      })
      .where(eq(questionBankQuestionsTable.id, question.id));
    questionBankCount += 1;
  }

  return { testQuestionCount, questionBankCount };
}