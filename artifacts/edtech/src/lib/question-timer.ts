export function questionTimerStorageKey(
  studentId: number | string | undefined,
  source: "pyq" | "question-bank",
  examKey: string,
  questionId: number,
) {
  return `rankpulse:question-timer:${studentId ?? "guest"}:${source}:${examKey}:${questionId}`;
}

export function readQuestionTimerSeconds(key: string) {
  if (typeof window === "undefined") return 0;
  try {
    const value = Number(window.localStorage.getItem(key) ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  } catch {
    return 0;
  }
}

export function writeQuestionTimerSeconds(key: string, seconds: number) {
  if (typeof window === "undefined") return;
  try {
    const current = readQuestionTimerSeconds(key);
    window.localStorage.setItem(key, String(Math.max(current, Math.floor(seconds), 0)));
  } catch {
    // Server persistence remains authoritative if browser storage is unavailable.
  }
}

export function formatTimeSpent(seconds: number) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`
    : `${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
}
