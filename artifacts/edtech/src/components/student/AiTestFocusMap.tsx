import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, BrainCircuit, Check, LoaderCircle, Sparkles, Target } from "lucide-react";
import { api } from "@/lib/api";
import { buildApiUrl } from "@/lib/api-origin";
import { useAuth } from "@/contexts/AuthContext";
import TestPreparationPlan, { type PreparationPlan } from "./TestPreparationPlan";

interface FocusMap {
  source?: "attempt-data";
  notice?: string;
  preparationPlan?: PreparationPlan;
  headline: string;
  focusAreas: { topic: string; priority: "high" | "medium" | "low"; evidence: string; action: string }[];
  strengths: { topic: string; evidence: string }[];
  studyFlow: string[];
  result: { percentage: number; correct: number; incorrect: number; skipped: number };
}

const priorityStyles = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-sky-200 bg-sky-50 text-sky-700",
};

export default function AiTestFocusMap({ testId, label }: { testId: number; label?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const accessQuery = useQuery<{ priorityAccess?: boolean; aiAccess?: boolean }>({
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
  const mutation = useMutation({
    mutationKey: ["ai-test-focus-map", testId],
    mutationFn: () => api.post<{ focusMap: FocusMap }>("/ai/test-result", { testId }),
  });
  const aiAccess = accessQuery.data?.aiAccess ?? (user as { aiAccess?: boolean } | null)?.aiAccess;

  const canUseCoach = user?.role === "student" && aiAccess === true;
  if (!canUseCoach) return null;

  const showMap = () => {
    setOpen((value) => !value);
    if (!mutation.data && !mutation.isPending && !mutation.isError) mutation.mutate();
  };
  const focusMap = mutation.data?.focusMap;

  return <div className={label ? "mb-2 w-full" : "px-5 pt-2"}>
    <div className={`flex items-center ${label ? "justify-between" : "justify-end"}`}>
      {label ? <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#94a3b8]">{label}</p> : null}
      {canUseCoach ? <button
          type="button"
          aria-label="Open AI study focus map"
          title="AI study focus map"
          onClick={showMap}
          className="grid h-8 w-8 place-items-center rounded-full border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 text-violet-700 shadow-sm transition hover:scale-105 hover:shadow"
        >
          {mutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
        </button> : null}
    </div>

    {open ? <section className="mb-4 mt-2 overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-orange-50 p-3 shadow-sm sm:p-4" aria-label="AI study focus map">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow"><Sparkles className="h-4 w-4" /></div>
        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600">{focusMap?.source === "attempt-data" ? "Study map" : "AI study map"}</p><h3 className="font-bold text-slate-900">{focusMap?.headline ?? "Finding your next focus"}</h3></div>
      </div>

      {mutation.isPending ? <div className="flex items-center justify-center gap-2 py-10 text-sm font-medium text-violet-700"><LoaderCircle className="h-4 w-4 animate-spin" />Building your focus map…</div> : null}
      {mutation.isError ? <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700" role="alert"><span>{mutation.error instanceof Error ? mutation.error.message : "Could not create the focus map. Please try again."}</span><button type="button" className="shrink-0 font-bold underline" onClick={() => mutation.mutate()}>Retry</button></div> : null}

      {focusMap ? <div className="mt-4 space-y-4">
        {focusMap.notice ? <p className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">{focusMap.notice}</p> : null}
        {focusMap.preparationPlan ? <TestPreparationPlan plan={focusMap.preparationPlan} /> : <>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[{ label: "Correct", value: focusMap.result.correct, style: "border-emerald-200 bg-emerald-50 text-emerald-700" }, { label: "Review", value: focusMap.result.incorrect, style: "border-rose-200 bg-rose-50 text-rose-700" }, { label: "Skipped", value: focusMap.result.skipped, style: "border-slate-200 bg-white text-slate-700" }].map((item) => <div key={item.label} className={`rounded-xl border px-2 py-2 ${item.style}`}><p className="text-lg font-black leading-tight">{item.value}</p><p className="text-[10px] font-semibold uppercase tracking-wide opacity-75">{item.label}</p></div>)}
        </div>

        {focusMap.focusAreas.length ? <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500"><Target className="h-4 w-4 text-orange-500" />Focus first</p>
          <div className="space-y-2">
            {focusMap.focusAreas.map((item, index) => <div key={`${item.topic}-${index}`} className="rounded-xl border border-white/90 bg-white/90 p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2"><p className="font-bold text-slate-900">{index + 1}. {item.topic}</p><span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${priorityStyles[item.priority]}`}>{item.priority}</span></div>
              {item.evidence ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.evidence}</p> : null}
              {item.action ? <p className="mt-2 rounded-lg bg-violet-50 px-2.5 py-2 text-xs font-semibold leading-relaxed text-violet-800"><span className="text-violet-500">Next: </span>{item.action}</p> : null}
            </div>)}
          </div>
        </div> : !focusMap.notice ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">No clear weak topic appeared in this attempt. Keep your practice balanced.</p> : null}

        {focusMap.strengths.length ? <div className="flex flex-wrap gap-2">{focusMap.strengths.map((item, index) => <span key={`${item.topic}-${index}`} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800"><Check className="h-3.5 w-3.5" />{item.topic}</span>)}</div> : null}

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Your next steps</p>
          <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            {focusMap.studyFlow.slice(0, 3).map((step, index) => <div key={`${step}-${index}`} className="flex min-w-0 flex-1 items-center gap-2 sm:flex-col sm:gap-1">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-600 text-xs font-black text-white">{index + 1}</span>
              <span className="text-xs font-semibold leading-snug text-slate-700 sm:text-center">{step}</span>
              {index < Math.min(focusMap.studyFlow.length, 3) - 1 ? <ArrowDown className="ml-auto h-4 w-4 shrink-0 text-violet-400 sm:ml-0 sm:rotate-[-90deg]" /> : null}
            </div>)}
          </div>
        </div>
        </>}
      </div> : null}
    </section> : null}
  </div>;
}
