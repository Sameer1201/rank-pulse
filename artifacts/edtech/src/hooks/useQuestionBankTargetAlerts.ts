import { useCallback, useEffect, useRef, useState } from "react";
import { buildApiUrl } from "@/lib/api-origin";

export type QuestionBankAlert = {
  id: number;
  title: string;
  exam: string;
  deadline: string;
  urgency: "overdue" | "critical" | "warning";
  minutesLeft: number;
  weeklyTargetQuestions: number;
  currentQuestions: number;
  remainingQuestions: number;
};

function getSessionKey(userId: number | null | undefined) {
  return userId ? `question-bank-target-alert-shown:${userId}` : null;
}

export function useQuestionBankTargetAlerts(enabled: boolean, userId?: number | null) {
  const [alerts, setAlerts] = useState<QuestionBankAlert[]>([]);
  const [show, setShow] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const sessionKey = getSessionKey(userId);

  const dismiss = useCallback(() => {
    alerts.forEach((item) => seenRef.current.add(`${item.id}:${item.urgency}:${item.remainingQuestions}`));
    if (sessionKey) {
      try {
        window.sessionStorage.setItem(sessionKey, "1");
      } catch {
        // noop
      }
    }
    setShow(false);
  }, [alerts, sessionKey]);

  const checkNow = useCallback(async () => {
    if (!enabled) {
      setAlerts([]);
      setShow(false);
      return;
    }

    const alreadyShownThisSession = sessionKey
      ? (() => {
          try {
            return window.sessionStorage.getItem(sessionKey) === "1";
          } catch {
            return false;
          }
        })()
      : false;

    try {
      const response = await fetch(buildApiUrl("/api/question-bank/alerts"), { credentials: "include" });
      if (!response.ok) return;
      const payload: QuestionBankAlert[] = await response.json();
      const unseen = payload.filter((item) => !seenRef.current.has(`${item.id}:${item.urgency}:${item.remainingQuestions}`));
      setAlerts(unseen);
      if (!alreadyShownThisSession && unseen.length > 0) {
        setAlerts(unseen);
        setShow(true);
        if (sessionKey) {
          try {
            window.sessionStorage.setItem(sessionKey, "1");
          } catch {
            // noop
          }
        }
      } else {
        setShow(false);
      }
    } catch {
      // noop
    }
  }, [enabled, sessionKey]);

  useEffect(() => {
    void checkNow();
  }, [enabled, checkNow]);

  return { alerts, show, dismiss, checkNow };
}
