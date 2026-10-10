export type QuestionBankFilter = "all" | "attempted" | "unattempted" | "starter";

export function readQuestionBankFilter(search: string): QuestionBankFilter {
  const value = new URLSearchParams(search).get("filter");
  return value === "attempted" || value === "unattempted" || value === "starter" ? value : "all";
}

export function questionBankFilterSearch(filter: QuestionBankFilter, savedOnly = false) {
  const params = new URLSearchParams();
  if (savedOnly) params.set("saved", "1");
  if (filter !== "all") params.set("filter", filter);
  const search = params.toString();
  return search ? `?${search}` : "";
}

export function matchesQuestionBankFilter(
  question: { difficulty?: string | null; progress?: { attemptCount: number } | null },
  filter: QuestionBankFilter,
  locallyAttempted = false,
) {
  if (filter === "all") return true;
  if (filter === "starter") return question.difficulty?.trim().toLowerCase() === "starter";
  const attempted = locallyAttempted || (question.progress?.attemptCount ?? 0) > 0;
  return filter === "attempted" ? attempted : !attempted;
}
