import { useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Flag, XCircle } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { Button } from "@/components/ui/button";

type SolutionQuestion = {
  id: number;
  order: number;
  question?: string | null;
  options?: string[] | null;
  questionType?: string | null;
  points?: number | null;
  negativeMarks?: number | null;
  myAnswer?: unknown;
  correctAnswer?: number | null;
  correctAnswerMulti?: number[] | null;
  correctAnswerMin?: number | null;
  correctAnswerMax?: number | null;
  isCorrect: boolean;
  isSkipped: boolean;
  solutionText?: string | null;
  subjectLabel?: string | null;
  chapterName?: string | null;
};

type AnalysisResponse = {
  test?: { title?: string | null };
  perQuestion?: SolutionQuestion[];
};

function answerLabel(question: SolutionQuestion, answer: unknown) {
  if (question.questionType === "integer") return answer == null || answer === "" ? "Not answered" : String(answer);
  if (question.questionType === "multi") {
    return Array.isArray(answer) && answer.length
      ? answer.map((value) => String.fromCharCode(65 + Number(value))).join(", ")
      : "Not answered";
  }
  return answer == null || answer === "" ? "Not answered" : String.fromCharCode(65 + Number(answer));
}

function correctLabel(question: SolutionQuestion) {
  if (question.questionType === "integer") {
    if (question.correctAnswerMin != null && question.correctAnswerMax != null) return `${question.correctAnswerMin} – ${question.correctAnswerMax}`;
    return question.correctAnswer == null ? "Not available" : String(question.correctAnswer);
  }
  if (question.questionType === "multi") return (question.correctAnswerMulti ?? []).map((value) => String.fromCharCode(65 + Number(value))).join(", ") || "Not available";
  return question.correctAnswer == null ? "Not available" : String.fromCharCode(65 + Number(question.correctAnswer));
}

function optionIsCorrect(question: SolutionQuestion, index: number) {
  if (question.questionType === "multi") return (question.correctAnswerMulti ?? []).includes(index);
  return Number(question.correctAnswer) === index;
}

export default function PSUTestSolutions() {
  const [, params] = useRoute<{ psuId: string; testId: string }>("/student/psu/:psuId/tests/:testId/solutions");
  const [, setLocation] = useLocation();
  const psuId = Number(params?.psuId);
  const testId = Number(params?.testId);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const query = useQuery({
    queryKey: ["psu-test-solutions", psuId, testId],
    enabled: Number.isInteger(psuId) && Number.isInteger(testId),
    queryFn: () => api.get<AnalysisResponse>(`/psus/${psuId}/tests/${testId}/analysis`),
  });
  const questions = query.data?.perQuestion ?? [];
  const current = questions[selectedIndex];

  if (query.isLoading) return <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm text-slate-500">Loading solutions...</div>;
  if (query.isError || !query.data || !current) return <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-5"><div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">{query.error instanceof Error ? query.error.message : "No solution data available."}</div></div>;

  const options = current.options ?? [];
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#111827]">
      <header className="sticky top-0 z-20 border-b border-[#E2E8F0] bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Button variant="outline" className="rounded-full" onClick={() => setLocation(`/student/psu/${psuId}/tests/${testId}/analysis`)}><ArrowLeft className="mr-2 h-4 w-4" /> Back to Analysis</Button>
          <div className="min-w-0 text-right"><p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">Solutions</p><h1 className="truncate text-base font-bold sm:text-lg">{query.data.test?.title ?? "PSU Test"}</h1></div>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="rounded-3xl border border-[#E2E8F0] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Question {selectedIndex + 1} of {questions.length}</p><p className="mt-1 text-sm text-[#64748B]">{current.subjectLabel ?? "PSU"}{current.chapterName ? ` · ${current.chapterName}` : ""}</p></div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${current.isSkipped ? "bg-slate-100 text-slate-600" : current.isCorrect ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {current.isSkipped ? "Not answered" : current.isCorrect ? <><CheckCircle2 className="h-3.5 w-3.5" /> Correct</> : <><XCircle className="h-3.5 w-3.5" /> Wrong</>}
            </span>
          </div>
          <div className="space-y-5 px-5 py-6 sm:px-8">
            <RichQuestionContent content={current.question ?? ""} className="text-base font-medium leading-8 text-[#111827] sm:text-lg" />
            {current.questionType !== "integer" ? <div className="space-y-3">{options.map((option, index) => {
              const selected = Array.isArray(current.myAnswer) ? current.myAnswer.includes(index) : Number(current.myAnswer) === index;
              const correct = optionIsCorrect(current, index);
              return <div key={index} className={`flex items-start gap-3 rounded-2xl border p-4 ${correct ? "border-emerald-300 bg-emerald-50" : selected ? "border-red-300 bg-red-50" : "border-[#E2E8F0] bg-white"}`}><span className="font-bold">{String.fromCharCode(65 + index)}.</span><RichQuestionContent content={option} className="min-w-0 flex-1 text-sm leading-7" />{correct ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" /> : selected ? <XCircle className="mt-0.5 shrink-0 text-red-600" /> : null}</div>;
            })}</div> : null}
            <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-[#F8FAFC] p-3"><p className="text-xs text-slate-500">Your answer</p><p className="mt-1 font-semibold">{answerLabel(current, current.myAnswer)}</p></div><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Correct answer</p><p className="mt-1 font-semibold text-emerald-900">{correctLabel(current)}</p></div><div className="rounded-xl bg-[#F8FAFC] p-3"><p className="text-xs text-slate-500">Marks</p><p className="mt-1 font-semibold">+{current.points ?? 1} / −{current.negativeMarks ?? 0}</p></div></div>
            <div className="border-t border-[#E2E8F0] pt-5"><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">Solution</p>{current.solutionText?.trim() ? <RichQuestionContent content={current.solutionText} className="text-sm leading-8 text-[#334155]" /> : <p className="text-sm text-[#64748B]">No solution was attached to this question.</p>}</div>
          </div>
          <div className="flex items-center justify-between border-t border-[#E2E8F0] px-5 py-4"><Button variant="outline" className="rounded-full" disabled={selectedIndex === 0} onClick={() => setSelectedIndex((value) => Math.max(0, value - 1))}><ChevronLeft className="mr-1 h-4 w-4" /> Previous</Button><Button variant="outline" className="rounded-full" disabled={selectedIndex === questions.length - 1} onClick={() => setSelectedIndex((value) => Math.min(questions.length - 1, value + 1))}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button></div>
        </section>
        <aside className="rounded-3xl border border-[#E2E8F0] bg-white p-4 shadow-sm"><div className="flex items-center gap-2 border-b border-[#E2E8F0] pb-3"><Flag className="h-4 w-4 text-indigo-500" /><p className="font-semibold">Question Palette</p></div><div className="mt-4 grid grid-cols-5 gap-2">{questions.map((question, index) => <button key={question.id} type="button" onClick={() => setSelectedIndex(index)} className={`h-10 rounded-xl border text-sm font-semibold ${selectedIndex === index ? "border-indigo-500 bg-indigo-500 text-white" : question.isSkipped ? "border-slate-200 bg-slate-50 text-slate-600" : question.isCorrect ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-red-300 bg-red-50 text-red-700"}`}>{index + 1}</button>)}</div></aside>
      </main>
    </div>
  );
}
