type Row = Record<string, unknown>;
export type LinkedTestTarget = { testId: number; questionId: number };
export type LinkedTestSyncStatement = { sql: string; params: (string | number | null)[] };

/** Exact stored identities only. Never infer a link from matching text, and never recreate/delete a test row. */
export function linkedTestTargets(question: Row, links: Row[]): LinkedTestTarget[] {
  const targets = new Map<string, LinkedTestTarget>();
  const add = (test: unknown, question: unknown) => {
    const testId = Number(test), questionId = Number(question);
    if (!Number.isSafeInteger(testId) || testId <= 0 || !Number.isSafeInteger(questionId) || questionId <= 0) return;
    targets.set(`${testId}:${questionId}`, { testId, questionId });
  };
  for (const link of links) add(link.test_id, link.test_question_id);
  add(question.source_test_id, question.source_test_question_id);
  return [...targets.values()];
}

const columns: Record<string, [string, string]> = {
  question: ['question', 'question'], questionType: ['question_type', 'question_type'],
  options: ['options', 'options'], optionImages: ['option_images', 'option_images'],
  correctAnswer: ['correct_answer', 'correct_answer'], correctAnswerMulti: ['correct_answer_multi', 'correct_answer_multi'],
  correctAnswerMin: ['correct_answer_min', 'correct_answer_min'], correctAnswerMax: ['correct_answer_max', 'correct_answer_max'],
  imageData: ['image_data', 'image_data'], explanation: ['explanation', 'solution_text'],
};

/** Mirror only edited content; sections, order, IDs, test marks and student submissions are not touched. */
export function linkedTestSyncStatements(question: Row, changedKeys: string[], targets: LinkedTestTarget[]): LinkedTestSyncStatement[] {
  const fields: string[] = [], values: (string | number | null)[] = [];
  for (const key of new Set(changedKeys)) {
    const mapping = columns[key];
    if (!mapping) continue;
    const [source, destination] = mapping;
    let value = question[source] ?? null;
    // Tests require a non-null scalar answer. -1 means an unset MCQ key, never option A.
    if (key === 'correctAnswer' && value === null) value = question.question_type === 'mcq' ? -1 : 0;
    if (key === 'options' && value === null) value = '[]';
    if ((key === 'correctAnswerMulti' || key === 'optionImages') && value === 'null') value = null;
    if (Array.isArray(value)) value = JSON.stringify(value);
    fields.push(`${destination} = ?`);
    values.push(typeof value === 'number' || typeof value === 'string' ? value : null);
  }
  if (!fields.length) return [];
  if (changedKeys.includes('explanation')) {
    // QBank stores the complete teacher solution (including inline images) as HTML.
    // Do not display the old test-only solution image beside its replacement.
    fields.push('solution_image_data = NULL');
  }
  fields.push('ai_solution_text = NULL'); // A generated solution for the old question/key is stale.
  return targets.map(target => ({
    sql: `UPDATE test_questions SET ${fields.join(', ')} WHERE id = ? AND test_id = ?`,
    params: [...values, target.questionId, target.testId],
  }));
}
