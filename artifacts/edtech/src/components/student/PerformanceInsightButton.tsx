import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { buildApiUrl } from "@/lib/api-origin";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type PerformanceTarget =
  | { source: "question-bank"; scope: "subject" | "chapter"; exam: string; subjectId: number; chapterId?: number; label: string }
  | { source: "pyq"; scope: "subject" | "chapter"; exam: string; subject: string; chapter?: string; label: string };

type PerformanceResult = {
  title: string;
  metrics: {
    totalQuestions: number;
    attemptedQuestions: number;
    solvedQuestions: number;
    totalAttempts: number;
    correctAttempts: number;
    accuracy: number;
    coverage: number;
    remainingQuestions: number;
    incorrectAttempts: number;
    retriedQuestions: number;
    currentlyIncorrect: number;
    recentQuestions: number;
  };
  focusChapters: Array<{ name: string; totalQuestions: number; attemptedQuestions: number; solvedQuestions: number; coverage: number; accuracy: number | null }>;
  nextStep: string;
  insight: string;
};

function insightParts(value: string) {
  const clean = value.replace(/\*\*/g, "").trim();
  const performance = /\bPerformance\s*:\s*/i.exec(clean);
  const nextStep = /\bNext step\s*:\s*/i.exec(clean);
  if (performance && nextStep && performance.index < nextStep.index) {
    return {
      performance: clean.slice(performance.index + performance[0].length, nextStep.index).trim(),
      nextStep: clean.slice(nextStep.index + nextStep[0].length).trim(),
    };
  }
  return { performance: clean.replace(/^Performance\s*:\s*/i, ""), nextStep: "" };
}

export function PerformanceInsightButton({ target }: { target: PerformanceTarget }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PerformanceResult | null>(null);
  const { data: accessStatus } = useQuery<{ priorityAccess?: boolean; aiAccess?: boolean }>({
    queryKey: ["student-access-window"],
    enabled: user?.role === "student",
    queryFn: async () => {
      const response = await fetch(buildApiUrl("/api/auth/registration-status"), { credentials: "include" });
      if (!response.ok) throw new Error("Could not load priority access status");
      return response.json();
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
  // AuthContext can already know the student has access while the status
  // endpoint is briefly stale (or returning a cached false). Don't hide the
  // chapter insight button in that case; the API still enforces access when
  // the student opens it.
  const aiAccess = accessStatus?.aiAccess === true || (user as { aiAccess?: boolean } | null)?.aiAccess === true;
  const isAllowed = user?.role === "student" && aiAccess === true;

  const loadInsight = async () => {
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      setResult(await api.post<PerformanceResult>("/ai/performance", target));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your performance insight.");
    } finally {
      setLoading(false);
    }
  };

  const parts = insightParts(result?.insight ?? "");

  if (!isAllowed) return null;

  return (
    <>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); void loadInsight(); }}
        aria-label={`AI performance insight for ${target.label}`}
        title={`AI performance insight for ${target.label}`}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-violet-300 bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 text-white shadow-sm transition hover:scale-105 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-violet-300/50"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" /> Your performance</DialogTitle>
            <DialogDescription>{target.label} · {target.scope === "subject" ? "Subject" : "Chapter"}</DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Analyzing your progress…</div>
          ) : error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>
          ) : result ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                <div className="rounded-lg bg-muted p-2"><div className="text-lg font-bold">{result.metrics.attemptedQuestions}/{result.metrics.totalQuestions}</div><div className="text-xs text-muted-foreground">Questions tried</div></div>
                <div className="rounded-lg bg-muted p-2"><div className="text-lg font-bold">{result.metrics.coverage}%</div><div className="text-xs text-muted-foreground">Coverage</div></div>
                <div className="rounded-lg bg-muted p-2"><div className="text-lg font-bold">{result.metrics.accuracy}%</div><div className="text-xs text-muted-foreground">Attempt accuracy</div></div>
                <div className="rounded-lg bg-muted p-2"><div className="text-lg font-bold">{result.metrics.solvedQuestions}</div><div className="text-xs text-muted-foreground">Unique questions solved</div></div>
              </div>
              <div className="space-y-1.5"><div className="flex justify-between text-xs text-muted-foreground"><span>Questions covered</span><span>{result.metrics.coverage}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${result.metrics.coverage}%` }} /></div></div>
              <p className="text-xs leading-5 text-muted-foreground">Accuracy counts all answers: {result.metrics.correctAttempts} correct out of {result.metrics.totalAttempts} attempts. Solved counts distinct questions, so retrying one question does not increase that total.</p>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div className="rounded-lg border border-border p-2"><strong className="block text-base text-foreground">{result.metrics.remainingQuestions}</strong>Not tried</div><div className="rounded-lg border border-border p-2"><strong className="block text-base text-foreground">{result.metrics.currentlyIncorrect}</strong>Last answer wrong</div><div className="rounded-lg border border-border p-2"><strong className="block text-base text-foreground">{result.metrics.retriedQuestions}</strong>Retried questions</div><div className="rounded-lg border border-border p-2"><strong className="block text-base text-foreground">{result.metrics.recentQuestions}</strong>Active in 7 days</div></div>
              {result.focusChapters?.length ? <div className="space-y-2"><h3 className="text-sm font-semibold text-foreground">Where to focus next</h3>{result.focusChapters.map((chapter) => <div key={chapter.name} className="rounded-lg border border-border p-2.5"><div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate font-medium">{chapter.name}</span><span className="shrink-0 text-muted-foreground">{chapter.attemptedQuestions}/{chapter.totalQuestions} tried</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-orange-500" style={{ width: `${chapter.coverage}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{chapter.coverage}% coverage · {chapter.accuracy === null ? "No attempts yet" : `${chapter.accuracy}% attempt accuracy`} · {chapter.solvedQuestions} solved</p></div>)}</div> : null}
              <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm leading-6 dark:border-violet-500/30 dark:bg-violet-500/10">
                <p><strong className="text-violet-700 dark:text-violet-300">What your data says:</strong> {parts.performance}</p>
                <p><strong className="text-sky-700 dark:text-sky-300">Next step:</strong> {result.nextStep || parts.nextStep}</p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
