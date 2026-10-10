export type PracticeAnswer = number | number[] | string;
type Attempt = {
  id: number;
  questionId: number;
  answer: PracticeAnswer;
  isCorrect: boolean;
  status: "pending" | "confirmed" | "failed" | "interrupted";
  notified: boolean;
};
export type PracticeSnapshot = {
  attempts: Attempt[];
  count: number;
  celebration: { id: number; count: number } | null;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function isStreakMilestone(count: number) {
  return count === 3 || count === 5 || (count >= 10 && count % 5 === 0);
}

// Count submission order, never chapter order or historical question progress.
function countStreak(attempts: Attempt[]) {
  return attempts.reduce((count, attempt) =>
    attempt.status === "failed" ? count : attempt.status === "interrupted" ? 0 : attempt.isCorrect ? count + 1 : 0, 0);
}

export function createPracticeStreak(storage?: Storage, key = "practice") {
  let attempts: Attempt[] = [];
  try {
    const saved: unknown = JSON.parse(storage?.getItem(key) ?? "null");
    if (Array.isArray(saved) && saved.every((entry) => entry &&
      Number.isSafeInteger(entry.id) && Number.isSafeInteger(entry.questionId) &&
      typeof entry.isCorrect === "boolean" && typeof entry.notified === "boolean" &&
      ["pending", "confirmed", "failed", "interrupted"].includes(entry.status) &&
      (typeof entry.answer === "string" || typeof entry.answer === "number" ||
        (Array.isArray(entry.answer) && entry.answer.every((n: unknown) => typeof n === "number"))))) {
      // An interrupted request has an unknown outcome; don't count it on reload.
      // Keep a wrong-answer boundary so later answers cannot bridge that gap.
      attempts = saved.map(entry => entry.status === "pending"
        ? { ...entry, isCorrect: false, status: "interrupted", notified: true }
        : { ...entry, notified: true });
    }
  } catch { /* Storage may be unavailable; in-memory practice still works. */ }
  let nextId = Math.max(0, ...attempts.map(entry => entry.id)) + 1;
  let snapshot: PracticeSnapshot = { attempts, count: countStreak(attempts), celebration: null };
  const listeners = new Set<() => void>();
  function publish(next: Attempt[], celebration = snapshot.celebration) {
    snapshot = { attempts: next, count: countStreak(next), celebration };
    try { storage?.setItem(key, JSON.stringify(next)); } catch { /* Optional persistence. */ }
    listeners.forEach(listener => listener());
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    begin(questionId: number, answer: PracticeAnswer, isCorrect: boolean) {
      // Synchronous guard also catches double clicks before React rerenders.
      if (snapshot.attempts.some(entry => entry.questionId === questionId &&
        (entry.status === "pending" || entry.status === "confirmed"))) return null;
      const id = nextId++;
      publish([...snapshot.attempts, { id, questionId, answer, isCorrect, status: "pending", notified: false }],
        isCorrect ? snapshot.celebration : null);
      return id;
    },
    regrade(id: number, isCorrect: boolean) {
      if (!snapshot.attempts.some(entry => entry.id === id && entry.status === "confirmed" && entry.isCorrect !== isCorrect)) return;
      // An admin correction is not another submission or a new celebration.
      publish(snapshot.attempts.map(entry => entry.id === id ? { ...entry, isCorrect, notified: true } : entry), null);
    },
    settle(id: number, isCorrect: boolean | null) {
      if (!snapshot.attempts.some(entry => entry.id === id && entry.status === "pending")) return;
      const next: Attempt[] = snapshot.attempts.map(entry => entry.id === id
        ? { ...entry, status: isCorrect === null ? "failed" : "confirmed", isCorrect: isCorrect ?? false }
        : { ...entry });
      let count = 0;
      let celebration = snapshot.celebration;
      // Only celebrate a verified sequence; responses may arrive out of order.
      for (const entry of next) {
        if (entry.status === "pending") break;
        if (entry.status === "failed") continue;
        if (entry.status === "interrupted") { count = 0; continue; }
        count = entry.isCorrect ? count + 1 : 0;
        if (!entry.notified && isStreakMilestone(count)) celebration = { id: entry.id, count };
        entry.notified = true;
      }
      if (celebration) {
        const celebratedIndex = next.findIndex(entry => entry.id === celebration?.id);
        if (next.slice(celebratedIndex + 1).some(entry =>
          entry.status !== "failed" && (!entry.isCorrect || entry.status === "interrupted"))) celebration = null;
      }
      publish(next, celebration);
    },
  };
}

export type PracticeStreakStore = ReturnType<typeof createPracticeStreak>;
