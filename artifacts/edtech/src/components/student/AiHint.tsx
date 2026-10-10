import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { buildApiUrl } from "@/lib/api-origin";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { RichQuestionContent } from "@/components/ui/rich-question-content";

type AiHintProps = {
  question: string;
  options?: string[];
  source: "pyq" | "question-bank" | "test";
};

function splitHintSections(value: string) {
  const clean = value.replace(/\*\*/g, "").trim();
  const ideaLabel = /\bQuestion idea\s*:\s*/i.exec(clean);
  const hintLabel = /\bHint\s*:\s*/i.exec(clean);
  if (ideaLabel && hintLabel && ideaLabel.index < hintLabel.index) {
    return {
      idea: clean.slice(ideaLabel.index + ideaLabel[0].length, hintLabel.index).trim(),
      hint: clean.slice(hintLabel.index + hintLabel[0].length).trim(),
    };
  }
  return { idea: "", hint: clean.replace(/^Hint\s*:\s*/i, "") };
}

export function AiHint({ question, options = [], source }: AiHintProps) {
  const { user } = useAuth();
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);
  const questionKey = `${source}\u0000${question}\u0000${options.join("\u0001")}`;

  useEffect(() => {
    // AiHint stays mounted while the question navigator swaps questions. Clear
    // the previous result and invalidate any response that is still in flight.
    requestVersion.current += 1;
    setHint("");
    setError("");
    setLoading(false);
  }, [questionKey]);

  const { data: accessStatus } = useQuery<{ priorityAccess?: boolean; aiAccess?: boolean }>({
    queryKey: ["student-access-window"],
    enabled: user?.role === "student",
    queryFn: async () => {
      const response = await fetch(buildApiUrl("/api/auth/registration-status"), { credentials: "include" });
      if (!response.ok) throw new Error("Could not load student access status");
      return response.json();
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
  const aiAccess = accessStatus?.aiAccess ?? (user as { aiAccess?: boolean } | null)?.aiAccess;
  const isAllowed = user?.role === "super_admin" || (user?.role === "student" && aiAccess === true);
  const hintSections = splitHintSections(hint);

  if (!isAllowed || !question.trim()) return null;

  const requestHint = async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const result = await api.post<{ hint: string }>("/ai/hint", { question, options, source });
      if (version !== requestVersion.current) return;
      setHint(result.hint.trim());
    } catch (requestError) {
      if (version !== requestVersion.current) return;
      setError(requestError instanceof Error ? requestError.message : "Could not generate a hint. Try again.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  return (
    <div className="my-4 space-y-3">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={requestHint}
        disabled={loading}
        title={loading ? "Thinking…" : hint ? "Get another question guide" : "Explain the question with AI"}
        aria-label={loading ? "Generating an AI hint" : hint ? "Get another question guide" : "Explain the question with AI"}
        aria-busy={loading}
        className="relative isolate h-9 w-9 shrink-0 overflow-hidden rounded-full border border-violet-300/80 bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 text-white shadow-[0_5px_18px_rgba(139,92,246,0.32)] transition duration-200 hover:-translate-y-0.5 hover:border-fuchsia-300 hover:from-violet-700 hover:via-fuchsia-600 hover:to-orange-500 hover:text-white hover:shadow-[0_8px_24px_rgba(139,92,246,0.42)] focus-visible:ring-violet-400 sm:h-10 sm:w-10 dark:border-violet-300/40 dark:from-violet-500 dark:via-fuchsia-500 dark:to-orange-400 dark:text-white dark:hover:text-white"
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-[3px] rounded-full border border-white/25" />
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin sm:h-5 sm:w-5" /> : <Sparkles className="h-4 w-4 drop-shadow-sm sm:h-5 sm:w-5" />}
      </Button>
      {hint ? (
        <div className="relative space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 pr-10 text-sm leading-6 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" role="status">
          <button
            type="button"
            onClick={() => {
              requestVersion.current += 1;
              setHint("");
              setError("");
              setLoading(false);
            }}
            title="Close hint"
            aria-label="Close hint"
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-amber-700/70 transition hover:bg-amber-200 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-200/70 dark:hover:bg-amber-900/60 dark:hover:text-amber-50"
          >
            <X className="h-4 w-4" />
          </button>
          {hintSections.idea ? (
            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
              <strong className="shrink-0 font-bold text-sky-700 dark:text-sky-300">Question idea:</strong>
              <RichQuestionContent content={hintSections.idea} className="min-w-0 text-sm leading-6 text-amber-950 dark:text-amber-100" />
            </div>
          ) : null}
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <strong className="shrink-0 font-bold text-violet-700 dark:text-violet-300">Hint:</strong>
            <RichQuestionContent content={hintSections.hint} className="min-w-0 text-sm leading-6 text-amber-950 dark:text-amber-100" />
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
