type Value = string | number | boolean | null;
type Statement = { sql: string; params: Value[] };

/** Content-only repair: preserve question identity, answer keys and student history. */
export function pyqContentRepairStatements(body: Record<string, unknown>): Statement[] {
  const { exam, subject, questions } = body;
  if (typeof exam !== "string" || !exam.trim() || typeof subject !== "string" || !subject.trim() || !Array.isArray(questions) || !questions.length || questions.length > 25) {
    throw new Error("Exam, subject and 1–25 content repairs are required");
  }
  const ids = new Set<number>();
  const content = (value: unknown, nullable = false): string | null => {
    if (nullable && value === null) return null;
    if (typeof value !== "string" || value.length > 2_000_000 || (!nullable && !value.trim())) throw new Error("Invalid repair content");
    return value;
  };
  return questions.map((q) => {
    if (!q || !Number.isSafeInteger(q.id) || q.id < 1 || ids.has(q.id)) throw new Error("Unique question IDs are required");
    ids.add(q.id);
    if (!Array.isArray(q.options) || q.options.length > 6 || !q.options.every((s: unknown) => typeof s === "string" && s.length <= 2_000_000)) throw new Error("Invalid options");
    const expectedQuestion = content(q.expectedQuestion);
    const expectedUpdatedAt = content(q.expectedUpdatedAt);
    return {
      sql: `UPDATE pyq_questions SET question = ?, options_json = ?, explanation = ?, image_data = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND exam = ? AND subject = ? AND question = ? AND updated_at = ?`,
      params: [content(q.question), JSON.stringify(q.options), content(q.explanation, true), content(q.imageData, true), q.id, exam, subject, expectedQuestion, expectedUpdatedAt],
    };
  });
}
