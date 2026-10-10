import { useMemo, useSyncExternalStore } from "react";
import { createPracticeStreak } from "@/lib/practice-streak";

const sessions = new Map<string, ReturnType<typeof createPracticeStreak>>();

export function usePracticeStreak(scope: string) {
  const store = useMemo(() => {
    const existing = sessions.get(scope);
    if (existing) return existing;
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* Use memory when storage is blocked. */ }
    const created = createPracticeStreak(storage, `rankpulse:practice-streak:v1:${scope}`);
    sessions.set(scope, created);
    return created;
  }, [scope]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, ...snapshot };
}
