type QuestionProgress = {
  jamSubmitted?: boolean;
  jamSubmittedCorrect?: boolean;
  practiceResult?: boolean;
  practiceVisited?: boolean;
  practiceAttemptCount?: number;
  progress?: { attemptCount: number; lastIsCorrect: boolean } | null;
};

// All PYQ surfaces use the same persisted result, including one-time JAM answers.
// Browser history is only a fallback for older, unsynced practice sessions.
export function getPyqProgress(question: QuestionProgress) {
  const hasProgress = Number(question.progress?.attemptCount ?? 0) > 0;
  const attempted = question.jamSubmitted === true || hasProgress || question.practiceResult !== undefined;
  const correct = question.jamSubmitted
    ? question.jamSubmittedCorrect === true
    : hasProgress ? question.progress!.lastIsCorrect === true : question.practiceResult === true;
  return {
    attempted,
    correct: attempted && correct,
    visited: attempted || question.practiceVisited === true,
    attemptCount: Math.max(question.jamSubmitted ? 1 : 0, question.progress?.attemptCount ?? 0, question.practiceAttemptCount ?? 0),
  };
}

export function getPyqStatusColor(question: QuestionProgress) {
  const status = getPyqProgress(question);
  return status.correct ? "bg-emerald-400" : status.attempted ? "bg-red-500" : status.visited ? "bg-amber-300" : "bg-muted";
}
