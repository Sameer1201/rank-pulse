import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Flag, Loader2, XCircle } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { Button } from "@/components/ui/button";

type Question = {
  question: string;
  questionType?: string;
  options?: string[];
  correctAnswer?: number;
  correctAnswerMulti?: number[];
  correctAnswerMin?: number;
  correctAnswerMax?: number;
  points?: number;
  negativeMarks?: number;
  solutionText?: string | null;
};
type TestResponse = { title: string; durationMinutes: number; bundle: { test?: { questions?: Question[] } } | null };
type AttemptResult = { score: number; totalPoints: number; percentage: number; correctCount: number; wrongCount: number; skippedCount: number };

export default function PSUTest() {
  const [, navigate] = useLocation();
  const [match, params] = useRoute<{ psuId: string; testId: string }>("/student/psu/:psuId/tests/:testId");
  const psuId = Number(params?.psuId); const testId = Number(params?.testId);
  const [answers, setAnswers] = useState<Record<number, number | string | number[]>>({});
  const [interactionLog, setInteractionLog] = useState<Array<{ at: number; questionId: number; action: string; answerSnapshot?: unknown }>>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [activeQuestion, setActiveQuestion] = useState(0);
  const query = useQuery({ queryKey: ["psu-test", psuId, testId], enabled: match && Number.isInteger(psuId) && Number.isInteger(testId), queryFn: () => api.get<TestResponse>(`/psus/${psuId}/tests/${testId}`) });
  const questions = useMemo(() => query.data?.bundle?.test?.questions ?? [], [query.data]);
  const localScore = questions.reduce((total, question, index) => total + (isCorrect(question, answers[index]) ? Number(question.points ?? 1) : 0), 0);
  const durationSeconds = Number(query.data?.durationMinutes ?? 0) * 60;

  useEffect(() => {
    if (!questions.length || submitted) return;
    setInteractionLog(current => [...current, { at: Math.floor((Date.now() - startedAt) / 1000), questionId: activeQuestion + 1, action: 'open' }]);
  }, [activeQuestion, questions.length, startedAt, submitted]);

  useEffect(() => {
    if (submitted) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, submitted]);

  function recordAnswer(index: number, answer: number | string | number[]) {
    setAnswers((current) => ({ ...current, [index]: answer }));
    setInteractionLog((current) => [...current, { at: Math.floor((Date.now() - startedAt) / 1000), questionId: index + 1, action: "answer", answerSnapshot: answer }]);
  }

  async function submit() {
    setSubmitting(true); setSubmitError(null);
    try {
      const response = await api.post<AttemptResult>(`/psus/${psuId}/tests/${testId}/attempts`, { answers: { ...answers, __indexBase: 0 }, totalTimeSeconds: elapsedSeconds, interactionLog, questionTimings: {}, flaggedQuestions: [] });
      setResult(response); setSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not submit test");
    } finally { setSubmitting(false); }
  }

  if (query.isLoading) return <div className="mx-auto max-w-4xl rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">Loading test...</div>;
  if (query.isError || !query.data) return <div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700">Could not load this PSU test.</div>;
  const timeLeft = Math.max(0, durationSeconds - elapsedSeconds);
  return <div className="mx-auto max-w-5xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><Button variant="ghost" onClick={() => navigate(`/student/psu/${psuId}`)}><ArrowLeft className="mr-1 h-4 w-4" /> Back to PSU</Button><div><h1 className="text-2xl font-bold text-slate-900">{query.data.title}</h1><p className="mt-1 text-sm text-slate-500">{questions.length} questions · {query.data.durationMinutes} minutes</p></div></div>
      {!submitted ? <div className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${timeLeft < 60 ? "border-red-200 bg-red-50 text-red-700" : "border-indigo-200 bg-indigo-50 text-indigo-700"}`}><Clock3 className="h-4 w-4" /> {formatTime(timeLeft)}</div> : null}
    </div>
    {submitted ? <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-emerald-700">Test submitted successfully</p><p className="mt-1 text-2xl font-bold text-emerald-900">{Number(result?.score ?? localScore).toFixed(2)} / {Number(result?.totalPoints ?? questions.reduce((sum, question) => sum + Number(question.points ?? 1), 0)).toFixed(2)}</p><p className="mt-1 text-sm text-emerald-800">{result?.correctCount ?? 0} correct · {result?.wrongCount ?? 0} wrong · {result?.skippedCount ?? 0} skipped</p></div><Button onClick={() => navigate(`/student/psu/${psuId}/tests/${testId}/analysis`)}>View detailed analysis</Button></div></div> : null}
    {!submitted ? <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">{questions.map((question, index) => <button key={index} type="button" onClick={() => setActiveQuestion(index)} className={`h-9 w-9 rounded-lg border text-xs font-semibold ${activeQuestion === index ? "border-indigo-600 bg-indigo-600 text-white" : answers[index] !== undefined ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>{index + 1}</button>)}</div> : null}
    {submitError ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{submitError}</div> : null}
    {!submitted ? <Question question={questions[activeQuestion]} index={activeQuestion} answer={answers[activeQuestion]} onAnswer={(answer) => recordAnswer(activeQuestion, answer)} /> : <div className="space-y-4">{questions.map((question, index) => <Question key={index} question={question} index={index} answer={answers[index]} submitted onAnswer={() => undefined} />)}</div>}
    {!submitted ? <div className="flex flex-wrap justify-between gap-3"><Button variant="outline" disabled={activeQuestion === 0} onClick={() => setActiveQuestion((value) => Math.max(0, value - 1))}>Previous</Button><div className="flex gap-2"><Button variant="outline" disabled={activeQuestion === questions.length - 1} onClick={() => setActiveQuestion((value) => Math.min(questions.length - 1, value + 1))}>Next</Button><Button onClick={submit} disabled={submitting}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting...</> : "Submit test"}</Button></div></div> : <Button variant="outline" className="w-full" onClick={() => { setSubmitted(false); setResult(null); setAnswers({}); setActiveQuestion(0); }}>Retry test</Button>}
  </div>;
}

function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, "0")} : ${(seconds % 60).toString().padStart(2, "0")}`; }

function isCorrect(question: Question, answer: number | string | number[] | undefined) {
  if (question.questionType === "integer") { const value = Number(answer); if (!Number.isFinite(value)) return false; if (question.correctAnswerMin != null && question.correctAnswerMax != null) return value >= question.correctAnswerMin && value <= question.correctAnswerMax; return value === Number(question.correctAnswer); }
  if (question.questionType === "multi") return JSON.stringify([...(Array.isArray(answer) ? answer : [])].sort()) === JSON.stringify([...(question.correctAnswerMulti ?? [])].sort());
  return Number(answer) === Number(question.correctAnswer);
}

function Question({ question, index, answer, submitted, onAnswer }: { question?: Question; index: number; answer: number | string | number[] | undefined; submitted?: boolean; onAnswer: (answer: number | string | number[]) => void }) {
  if (!question) return <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">No questions found.</div>;
  const options = question.options ?? []; const multi = question.questionType === "multi"; const integer = question.questionType === "integer"; const selected = Array.isArray(answer) ? answer : []; const correct = submitted && isCorrect(question, answer);
  return <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">Q{index + 1}</span>{submitted ? correct ? <CheckCircle2 className="text-emerald-600" /> : <XCircle className="text-red-600" /> : <Flag className="h-4 w-4 text-slate-300" />}</div><RichQuestionContent content={question.question} className="text-sm leading-7 text-slate-800" />{integer ? <input className="mt-5 h-10 w-full rounded-lg border px-3" type="number" value={typeof answer === "string" ? answer : ""} disabled={submitted} onChange={(event) => onAnswer(event.target.value)} placeholder="Enter numerical answer" /> : <div className="mt-5 space-y-2">{options.map((option, optionIndex) => { const picked = multi ? selected.includes(optionIndex) : answer === optionIndex; return <button key={optionIndex} type="button" disabled={submitted} onClick={() => onAnswer(multi ? (picked ? selected.filter((item) => item !== optionIndex) : [...selected, optionIndex]) : optionIndex)} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${picked ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-indigo-300"}`}><span className="font-semibold">{String.fromCharCode(65 + optionIndex)}.</span><RichQuestionContent content={option} className="text-sm" /></button>; })}</div>}{submitted ? <div className={`mt-4 rounded-xl p-3 text-sm ${correct ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{correct ? "Correct" : `Correct answer: ${question.questionType === "multi" ? (question.correctAnswerMulti ?? []).map((item) => String.fromCharCode(65 + item)).join(", ") : question.questionType === "integer" ? question.correctAnswer : String.fromCharCode(65 + Number(question.correctAnswer ?? 0))}`}{question.solutionText ? <RichQuestionContent content={question.solutionText} className="mt-2" /> : null}</div> : null}</div>;
}
