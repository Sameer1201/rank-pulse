export const REVIEW_BUCKET_REMOVED_IDS_KEY = "rankpulse-review-bucket-removed-question-ids";

function normalizeQuestionIds(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value)),
    ),
  );
}

export function getReviewBucketRemovedQuestionIds(): number[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(REVIEW_BUCKET_REMOVED_IDS_KEY);
    if (!raw) return [];
    return normalizeQuestionIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function setReviewBucketRemovedQuestionIds(questionIds: number[]): number[] {
  const normalized = normalizeQuestionIds(questionIds);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(REVIEW_BUCKET_REMOVED_IDS_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export function addReviewBucketRemovedQuestionId(questionId: number): number[] {
  return setReviewBucketRemovedQuestionIds([
    ...getReviewBucketRemovedQuestionIds(),
    questionId,
  ]);
}

export function filterReviewBucketEntries<T extends { questionId: number }>(
  entries: T[],
  removedQuestionIds: number[],
): T[] {
  if (!entries.length || !removedQuestionIds.length) return entries;
  const removedQuestionIdSet = new Set(removedQuestionIds);
  return entries.filter((entry) => !removedQuestionIdSet.has(Number(entry.questionId)));
}
