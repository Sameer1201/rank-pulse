/** Practice first, Starter last. Imported sections can restart numbering at Q1. Never sort
 * them together by that number, or fetch full content to establish navigation. */
export function groupStarterQuestions<T extends { difficulty?: string | null }>(questions: T[]): T[] {
  const starter: T[] = [];
  const regular: T[] = [];
  for (const question of questions) {
    (question.difficulty?.trim().toLowerCase() === "starter" ? starter : regular).push(question);
  }
  return [...regular, ...starter];
}
