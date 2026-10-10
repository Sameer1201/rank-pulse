import { type ReactNode, type TouchEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, Bookmark, BookmarkCheck, Calculator, CheckCircle2, ChevronRight, Circle, Flag, MoreHorizontal, Search, SlidersHorizontal, Tag, XCircle, Sparkles, Flame, Trophy, Star, Timer } from "lucide-react";
import { api } from "@/lib/api";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { getPyqDisplayOptions, stripRepeatedPyqOptions } from "@/lib/pyqContent";
import { sanitizeRichHtml, stripRichHtmlToText } from "@/lib/richContent";
import { ChapterThemeIcon, SubjectThemeIcon, getSubjectAccent } from "@/lib/subject-theme";
import { TcsCalculator } from "@/components/student/TcsCalculator";
import { AiHint } from "@/components/student/AiHint";
import { PracticeAnswerFields, PracticeAnswerReview, PracticeActionBar, PracticeQuestionText, practiceCardClass, practiceHeaderClass } from "@/components/student/PracticeQuestionControls";
import { usePracticeStreak } from "@/hooks/use-practice-streak";
import AiSimilarPractice, { AiPracticeLibrary } from "@/components/student/AiSimilarPractice";
import { PerformanceInsightButton } from "@/components/student/PerformanceInsightButton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useQuestionReport } from "@/hooks/use-question-report";
import { useAuth } from "@/contexts/AuthContext";
import { buildStudentUnlockPath } from "@/lib/student-unlock";
import { isStudentFeatureLocked } from "@/lib/student-access";
import { useLocation } from "wouter";
import { readStudentExamSelection, normalizePyqWorkspaceKey } from "@/lib/student-exam-selection";
import { formatExamDisplayName } from "@/lib/exam-display";
import { getPyqProgress, getPyqStatusColor } from "@/lib/pyq-progress";
import { formatTimeSpent, questionTimerStorageKey, readQuestionTimerSeconds, writeQuestionTimerSeconds } from "@/lib/question-timer";
import { OfflinePackLoader, useBufferedPractice } from "@/components/student/OfflinePractice";
import { practiceBufferIds } from "@/lib/practice-network";
import type { OfflineQuestion } from "@/lib/offline-practice";
import { getPyqDisplayOptions as offlineDisplayOptions } from "@/lib/pyqContent";

type Subject = { exam: string; subject: string; questionCount: number; chapterCount: number; attemptedCount?: number; totalTimeSpentSeconds?: number };
type Chapter = { chapter: string; chapterOrder: number; questionCount: number; attemptedCount?: number; totalTimeSpentSeconds?: number };
type QuestionType = "mcq" | "multi" | "integer";
type PyqQuestion = {
  offlineUnavailable?: boolean;
  offlineAnswer?: AnswerValue;
  offlineCorrect?: boolean;
  sessionAnswer?: AnswerValue;
  id: number;
  exam: string;
  subject: string;
  chapter: string;
  questionNumber: number | null;
  marks: string | null;
  year: number;
  paper: string | null;
  question: string;
  questionType: QuestionType | string;
  options: string[];
  correctAnswer: number | null;
  correctAnswerMulti: number[];
  answerText: string | null;
  answerMin: number | null;
  answerMax: number | null;
  explanation: string | null;
  sourceName?: string | null;
  imageData?: string | null;
  isSaved?: boolean;
  practiceResult?: boolean;
  practiceVisited?: boolean;
  practiceAttemptCount?: number;
  jamSolutionMode?: boolean;
  jamSubmitted?: boolean;
  jamSubmittedAnswer?: AnswerValue;
  jamSubmittedCorrect?: boolean;
  timeSpentSeconds?: number;
  progress?: { attemptCount: number; correctCount: number; incorrectCount: number; lastIsCorrect: boolean; solvedAt?: number | null } | null;
};

function questionTypeLabel(type: string) {
  return type === "integer" ? "NAT" : type === "multi" ? "MSQ" : "MCQ";
}

// JAM uses an explicit Submit button; its progress is persisted just like GATE.
function isJamChemistryContext(exam?: string | null, subject?: string | null, sourceName?: string | null) {
  const context = `${exam ?? ""} ${subject ?? ""} ${sourceName ?? ""}`;
  return /\bjam\b/i.test(context) && /\bchemistry\b/i.test(context);
}

function tracksPyqAttempt(question: Pick<PyqQuestion, "exam" | "subject" | "sourceName">) {
  return !isJamChemistryContext(question.exam, question.subject, question.sourceName);
}

function formatQuestionYear(exam: string, year: number, sourceName?: string | null, displayExam?: string | null) {
  if (!year) return null;
  // Workspace selection controls routing, not the exam this question came from.
  // Keep the opened question's badge identical to the list, including GATE/NET
  // questions curated into the JAM Chemistry workspace.
  const formattedExam = formatExamDisplayName(exam) || formatExamDisplayName(displayExam) || exam;
  const sourceExamText = `${sourceName ?? ""} ${exam}`;
  const prefix = /gate/i.test(sourceExamText) ? "GATE" : /net/i.test(sourceExamText) ? "NET" : formattedExam;
  return `${prefix} ${year}`;
}

function QuestionYearBadge({ exam, year, sourceName, displayExam, compact = false }: { exam: string; year: number; sourceName?: string | null; displayExam?: string | null; compact?: boolean }) {
  const label = formatQuestionYear(exam, year, sourceName, displayExam);
  if (!label) return null;
  return <span className={`flex items-center gap-1 rounded-full border border-border text-[10px] font-medium text-muted-foreground ${compact ? "px-2 py-0.5" : "shrink-0 px-2 py-0.5 sm:px-2.5 sm:py-1 sm:text-[11px]"}`}><Tag className="h-2.5 w-2.5" />{label}</span>;
}

function markValue(marks: string | null) {
  const parsed = Number((marks || "").match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function expectedMulti(question: PyqQuestion) {
  return question.correctAnswerMulti.length > 0 ? question.correctAnswerMulti : question.correctAnswer == null ? [] : [question.correctAnswer];
}

function answerIsCorrect(question: PyqQuestion, answer: string | number | number[]) {
  if (question.questionType === "integer") {
    const value = Number(String(answer).trim());
    if (!Number.isFinite(value)) return false;
    if (question.answerMin != null && question.answerMax != null) return value >= question.answerMin && value <= question.answerMax;
    const target = question.answerMin ?? question.answerMax ?? (question.answerText?.trim() ? Number(stripRichHtmlToText(question.answerText)) : null);
    return target !== null && Number.isFinite(target) && value === target;
  }
  if (question.questionType === "multi") {
    const actual = (Array.isArray(answer) ? answer : []).slice().sort((a, b) => a - b);
    const expected = expectedMulti(question).slice().sort((a, b) => a - b);
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  }
  return Number(answer) === (question.correctAnswer ?? -1);
}

function answerLabel(question: PyqQuestion) {
  if (question.questionType === "integer") return question.answerMin != null && question.answerMax != null ? question.answerMin === question.answerMax ? String(question.answerMin) : `${question.answerMin} to ${question.answerMax}` : question.answerText || "Not available";
  return expectedMulti(question).map((index) => String.fromCharCode(65 + index)).join(", ") || "Not available";
}

function formatTimerDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

type AnswerValue = string | number | number[] | null;
type PyqViewState = {
  selectedSubject: Subject | null;
  selectedChapter: Chapter | null;
  showSaved: boolean;
  practiceMode: boolean;
  questionIndex: number;
  attemptedFilter: "all" | "attempted" | "unattempted";
  typeFilter: "all" | QuestionType;
  markFilter: "all" | "1" | "2";
  yearFilter: string;
  practiceResults: Record<string, boolean>;
  practiceVisited: Record<string, boolean>;
  practiceAttemptCounts: Record<string, number>;
  practiceSubmitted?: Record<string, boolean>;
};

type PyqHistoryView = "subjects" | "subject" | "chapter" | "saved" | "practice";
type PyqHistoryEntry = {
  view: PyqHistoryView;
  generation: string;
  selectedSubject: Subject | null;
  selectedChapter: Chapter | null;
  showSaved: boolean;
  questionIndex: number;
};

function readPyqViewState(userId?: number | string): Partial<PyqViewState> {
  if (!userId || typeof window === "undefined") return {};
  try {
    if (window.sessionStorage.getItem(`pyq-open-home:${userId}`) === "true") return {};
    const saved = window.sessionStorage.getItem(`pyq-view:${userId}`);
    if (!saved) return {};
    const parsed = JSON.parse(saved) as Partial<PyqViewState>;
    return {
      selectedSubject: parsed.selectedSubject ?? null,
      selectedChapter: parsed.selectedChapter ?? null,
      showSaved: parsed.showSaved === true,
      practiceMode: parsed.practiceMode === true,
      questionIndex: Number.isInteger(parsed.questionIndex) && Number(parsed.questionIndex) >= 0 ? Number(parsed.questionIndex) : 0,
      attemptedFilter: parsed.attemptedFilter === "attempted" || parsed.attemptedFilter === "unattempted" ? parsed.attemptedFilter : "all",
      typeFilter: parsed.typeFilter === "mcq" || parsed.typeFilter === "multi" || parsed.typeFilter === "integer" ? parsed.typeFilter : "all",
      markFilter: parsed.markFilter === "1" || parsed.markFilter === "2" ? parsed.markFilter : "all",
      yearFilter: typeof parsed.yearFilter === "string" ? parsed.yearFilter : "all",
      practiceResults: Object.fromEntries(Object.entries(parsed.practiceResults ?? {}).filter(([, value]) => typeof value === "boolean")),
      practiceVisited: Object.fromEntries(Object.entries(parsed.practiceVisited ?? {}).filter(([, value]) => value === true)),
      practiceAttemptCounts: Object.fromEntries(Object.entries(parsed.practiceAttemptCounts ?? {}).filter(([, value]) => typeof value === "number" && value >= 0)),
      practiceSubmitted: Object.fromEntries(Object.entries(parsed.practiceSubmitted ?? {}).filter(([, value]) => value === true)),
    };
  } catch {
    return {};
  }
}

function countPracticeSubmissions(progress: Record<string, boolean>, exam: string, subject: string, chapter?: string) {
  return Object.keys(progress).reduce((count, key) => {
    try {
      const [savedExam, savedSubject, savedChapter] = JSON.parse(key) as [string, string, string];
      const normalizedChapter = savedChapter || "General";
      return savedExam === exam && savedSubject === subject && (chapter == null || normalizedChapter === chapter) ? count + 1 : count;
    } catch {
      return count;
    }
  }, 0);
}

function QuestionCard({ question, displayExam, index, navigation, onSave, onAttempt, onJamSubmit, onSaveTime, onPrevious, onNext, onBack, hasNext, streakCount = 0 }: { question: PyqQuestion; displayExam?: string; index: number; navigation?: ReactNode; onSave: (id: number) => void; onAttempt?: (id: number, answer: AnswerValue, isCorrect: boolean, exam: string, firstSubmissionTime: number | null) => void; onJamSubmit?: (id: number, answer: AnswerValue, exam: string, firstSubmissionTime: number | null) => Promise<{ submitted: boolean; alreadySubmitted: boolean; answer: AnswerValue; isCorrect: boolean }>; onSaveTime?: (id: number, exam: string, seconds: number) => Promise<number>; onPrevious?: () => void; onNext?: () => void; onBack?: () => void; hasNext?: boolean; streakCount?: number }) {
  const { user: timerUser } = useAuth();
  const [selected, setSelected] = useState<number | null>(() => typeof question.jamSubmittedAnswer === "number" ? question.jamSubmittedAnswer : null);
  const [selectedMulti, setSelectedMulti] = useState<number[]>(() => Array.isArray(question.jamSubmittedAnswer) ? question.jamSubmittedAnswer : []);
  const [integerAnswer, setIntegerAnswer] = useState(() => typeof question.jamSubmittedAnswer === "string" ? question.jamSubmittedAnswer : "");
  const [submitted, setSubmitted] = useState(question.jamSubmitted === true || question.offlineAnswer !== undefined || question.sessionAnswer !== undefined);
  useEffect(() => {
    const answer = question.sessionAnswer;
    if (answer === undefined) {
      setSubmitted(question.jamSubmitted === true || question.offlineAnswer !== undefined);
      setTimerRunning(timerEnabled && !timerLocked && !question.jamSubmitted && question.offlineAnswer === undefined);
      return;
    }
    setSelected(typeof answer === "number" ? answer : null);
    setSelectedMulti(Array.isArray(answer) ? answer : []);
    setIntegerAnswer(typeof answer === "string" ? answer : "");
    setSubmitted(true);
  }, [question.sessionAnswer]);
  useEffect(()=>{
    if(question.offlineAnswer===undefined)return;
    setSelected(typeof question.offlineAnswer==='number'?question.offlineAnswer:null);
    setSelectedMulti(Array.isArray(question.offlineAnswer)?question.offlineAnswer:[]);
    setIntegerAnswer(typeof question.offlineAnswer==='string'?question.offlineAnswer:'');setSubmitted(true);
  },[question.offlineAnswer]);
  const [submissionPending, setSubmissionPending] = useState(false);
  const isJamPractice = !tracksPyqAttempt(question);
  const timerEnabled = Boolean(onSaveTime);
  const timerLocked = question.jamSubmitted === true || (question.progress?.attemptCount ?? 0) > 0;
  const timerStorageKey = questionTimerStorageKey(timerUser?.id, "pyq", question.exam, question.id);
  const serverTimeSpentSeconds = Math.max(0, Number(question.timeSpentSeconds ?? 0));
  const [timerRunning, setTimerRunning] = useState(timerEnabled && !timerLocked);
  const [timeSpentSeconds, setTimeSpentSeconds] = useState(() => timerLocked ? serverTimeSpentSeconds : Math.max(serverTimeSpentSeconds, readQuestionTimerSeconds(timerStorageKey)));
  const timeSpentRef = useRef(timeSpentSeconds);
  const lastSavedTimeRef = useRef(serverTimeSpentSeconds);
  const timerSavePendingRef = useRef(false);
  const saveTimeHandlerRef = useRef(onSaveTime);
  saveTimeHandlerRef.current = onSaveTime;
  const saveTimer = useCallback(async (recordVisit = false) => {
    if (timerLocked) return;
    const seconds = Math.floor(timeSpentRef.current);
    writeQuestionTimerSeconds(timerStorageKey, seconds);
    if (!timerEnabled || (!recordVisit && seconds <= lastSavedTimeRef.current) || timerSavePendingRef.current) return;
    timerSavePendingRef.current = true;
    try {
      const savedSeconds = await saveTimeHandlerRef.current?.(question.id, question.exam, seconds);
      lastSavedTimeRef.current = Math.max(seconds, Number(savedSeconds ?? seconds));
      if (lastSavedTimeRef.current > timeSpentRef.current) {
        timeSpentRef.current = lastSavedTimeRef.current;
        setTimeSpentSeconds(lastSavedTimeRef.current);
        writeQuestionTimerSeconds(timerStorageKey, lastSavedTimeRef.current);
      }
    } catch {
      // Keep the newer local total and retry at the next autosave or pause.
    } finally {
      timerSavePendingRef.current = false;
    }
  }, [question.exam, question.id, timerEnabled, timerLocked, timerStorageKey]);
  useEffect(() => { if (!timerLocked) void saveTimer(true); }, [saveTimer, timerLocked]);
  useEffect(() => {
    if (!question.jamSubmitted) return;
    const answer = question.jamSubmittedAnswer;
    setSelected(typeof answer === "number" ? answer : null);
    setSelectedMulti(Array.isArray(answer) ? answer : []);
    setIntegerAnswer(answer == null || Array.isArray(answer) ? "" : String(answer));
    setSubmitted(true);
  }, [question.jamSubmitted, question.jamSubmittedAnswer]);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const reportState = useQuestionReport(`/pyq/questions/${question.id}/report`, showReport, () => { setShowReport(false); setReportReason(""); }, displayExam ?? question.exam);
  const [reportReason, setReportReason] = useState("");
  const isNat = question.questionType === "integer";
  const isMulti = question.questionType === "multi";
  const yearLabel = formatQuestionYear(question.exam, question.year, question.sourceName, displayExam);
  const displayOptions = useMemo(() => getPyqDisplayOptions(question.question, question.options), [question.question, question.options]);
  const currentAnswer = isNat ? integerAnswer : isMulti ? selectedMulti : selected;
  const canSubmit = !question.offlineUnavailable && currentAnswer !== null && (!Array.isArray(currentAnswer) || currentAnswer.length > 0) && (typeof currentAnswer !== "string" || currentAnswer.trim().length > 0);
  const isCorrect = submitted && (question.jamSubmitted ? question.jamSubmittedCorrect === true : answerIsCorrect(question, currentAnswer as string | number | number[]));
  const toggleMulti = (option: number) => setSelectedMulti((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option]);
  const submitAnswer = async (answer: AnswerValue) => {
    if (question.offlineUnavailable || submitted || submissionPending || answer == null || (Array.isArray(answer) && answer.length === 0) || (typeof answer === "string" && !answer.trim())) return;
    const firstSubmissionTime = timerEnabled && !timerLocked ? Math.floor(timeSpentRef.current) : null;
    // Match QBank: reveal immediately and persist in the background. A failed
    // request unlocks this answer rather than counting an unsaved submission.
    setSubmitted(true);
    setTimerRunning(false);
    if (isJamPractice && question.jamSolutionMode) {
      setSubmissionPending(true);
      try {
        const saved = await onJamSubmit?.(question.id, answer, question.exam, firstSubmissionTime);
        const lockedAnswer = saved?.answer ?? answer;
        if (!isNat && !isMulti) setSelected(Number(lockedAnswer));
        if (isMulti) setSelectedMulti(Array.isArray(lockedAnswer) ? lockedAnswer : []);
        if (isNat) setIntegerAnswer(String(lockedAnswer));
        setSubmitted(true);
      } catch {
        setSubmitted(false);
        setTimerRunning(timerEnabled && !timerLocked);
        return;
      } finally {
        setSubmissionPending(false);
      }
      return;
    }
    setSubmissionPending(true);
    try {
      await onAttempt?.(question.id, answer, answerIsCorrect(question, answer as string | number | number[]), question.exam, firstSubmissionTime);
      if (!isNat && !isMulti) setSelected(Number(answer));
      setSubmitted(true);
    } catch { setSubmitted(false); setTimerRunning(timerEnabled && !timerLocked); }
    finally {setSubmissionPending(false);}
  };

  useEffect(() => {
    const serverSeconds = Math.max(0, Number(question.timeSpentSeconds ?? 0));
    if (timerLocked) {
      timeSpentRef.current = serverSeconds;
      lastSavedTimeRef.current = serverSeconds;
      setTimeSpentSeconds(serverSeconds);
      return;
    }
    if (serverSeconds > timeSpentRef.current) {
      timeSpentRef.current = serverSeconds;
      setTimeSpentSeconds(serverSeconds);
      writeQuestionTimerSeconds(timerStorageKey, serverSeconds);
    }
    if (serverSeconds > lastSavedTimeRef.current) lastSavedTimeRef.current = serverSeconds;
  }, [question.timeSpentSeconds, timerLocked, timerStorageKey]);

  useEffect(() => {
    if (!timerEnabled || submitted || timerLocked) {
      setTimerRunning(false);
      return;
    }
    if (!timerRunning || submissionPending) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const next = timeSpentRef.current + 1;
      timeSpentRef.current = next;
      setTimeSpentSeconds(next);
      writeQuestionTimerSeconds(timerStorageKey, next);
      if (next - lastSavedTimeRef.current >= 30) void saveTimer();
    }, 1000);
    return () => {
      window.clearInterval(interval);
      void saveTimer();
    };
  }, [saveTimer, submitted, submissionPending, timerEnabled, timerLocked, timerRunning, timerStorageKey]);

  return (<>
    {navigation ? <div className="hidden sm:block">{navigation}</div> : null}
    {/* Sticky metadata must use the page scroller, not Card's default clipping container. */}
    <div className={practiceCardClass} data-question-navigation-card>
      <button type="button" aria-label="Previous question" title="Previous question" disabled={!onPrevious || index <= 0} onClick={onPrevious} className="absolute inset-y-2 left-0 z-10 hidden w-6 cursor-pointer items-center justify-center rounded-l-xl text-primary/0 transition hover:bg-primary/5 hover:text-primary/70 disabled:cursor-default lg:flex disabled:hover:bg-transparent disabled:hover:text-transparent"><ArrowLeft className="h-4 w-4" /></button>
      <button type="button" aria-label="Next question" title="Next question" disabled={!onNext || !hasNext} onClick={onNext} className="absolute inset-y-2 right-0 z-10 hidden w-6 cursor-pointer items-center justify-center rounded-r-xl text-primary/0 transition hover:bg-primary/5 hover:text-primary/70 disabled:cursor-default lg:flex disabled:hover:bg-transparent disabled:hover:text-transparent"><ArrowRight className="h-4 w-4" /></button>
      <div className={practiceHeaderClass}>
        {navigation ? <div className="pb-4 pt-1 sm:hidden">{navigation}</div> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 max-w-[45%] truncate text-xs text-muted-foreground sm:max-w-none">{question.chapter}</span>
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:px-2.5 sm:py-1 sm:text-[11px]">{questionTypeLabel(question.questionType)}</span>
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:px-2.5 sm:py-1 sm:text-[11px]">{question.marks || "1 Mark"}</span>
            {yearLabel ? <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:px-2.5 sm:py-1 sm:text-[11px]">{yearLabel}</span> : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm" aria-label="More question actions"><MoreHorizontal className="h-5 w-5" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <AiSimilarPractice mobileMenu source="pyq" sourceQuestionId={question.id} exam={question.exam} subject={question.subject} chapter={question.chapter} question={stripRepeatedPyqOptions(question.question, displayOptions)} options={displayOptions} questionType={isNat ? "integer" : isMulti ? "multi" : "mcq"} hasDiagram={Boolean(question.imageData)} solved={submitted} />
                  <DropdownMenuItem disabled><span className="w-4 text-center text-xs font-semibold text-muted-foreground">#</span> {getPyqProgress(question).attemptCount} attempt{getPyqProgress(question).attemptCount === 1 ? "" : "s"}</DropdownMenuItem>
                  {timerEnabled ? <DropdownMenuItem disabled><Timer className="h-4 w-4 text-orange-600" /> Time spent · {formatTimerDuration(timeSpentSeconds)}</DropdownMenuItem> : null}
                  <DropdownMenuItem onSelect={() => setShowCalculator(true)}><Calculator className="h-4 w-4 text-sky-600" /> Calculator</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onSave(question.id)}><Bookmark className="h-4 w-4 text-amber-600" /> {question.isSaved ? "Remove bookmark" : "Save question"}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { setReportReason(""); setShowReport(true); }}><Flag className="h-4 w-4 text-rose-600" /> Report question</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="hidden flex-nowrap items-center gap-1.5 whitespace-nowrap sm:flex sm:gap-2">
              {timerEnabled ? <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 text-xs font-semibold tabular-nums text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300" title={submitted ? "Timer stopped after answer submission" : "Question time"} aria-label={`Time spent ${formatTimerDuration(timeSpentSeconds)}`}><Timer className="h-3.5 w-3.5" /><span>{formatTimerDuration(timeSpentSeconds)}</span></div> : null}
              <AiSimilarPractice source="pyq" sourceQuestionId={question.id} exam={question.exam} subject={question.subject} chapter={question.chapter} question={stripRepeatedPyqOptions(question.question, displayOptions)} options={displayOptions} questionType={isNat ? "integer" : isMulti ? "multi" : "mcq"} hasDiagram={Boolean(question.imageData)} solved={submitted} />
              <button type="button" onClick={() => setShowCalculator(true)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 p-0 text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 active:scale-95 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300" title="Open calculator" aria-label="Open calculator"><Calculator className="h-4 w-4" /></button>
              <button type="button" onClick={() => onSave(question.id)} className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border p-0 transition active:scale-95 ${question.isSaved ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300" : "border-border bg-card text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"}`} title={question.isSaved ? "Remove bookmark" : "Save question"} aria-label={question.isSaved ? "Remove bookmark" : "Save question"}>{question.isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}</button>
              <button type="button" onClick={() => { setReportReason(""); setShowReport(true); }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 p-0 text-red-600 transition hover:border-red-400 hover:bg-red-100 hover:text-red-700 active:scale-95 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300" title="Report this question" aria-label="Report this question"><Flag className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      </div>

      <PracticeQuestionText content={stripRepeatedPyqOptions(question.question, displayOptions)} />

      {question.imageData ? (
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-muted/30 p-3">
          <img src={question.imageData} alt="Question figure" className="max-h-[13rem] w-full object-contain sm:max-h-[24rem]" />
        </div>
      ) : null}

      <AiHint question={stripRepeatedPyqOptions(question.question, displayOptions)} options={displayOptions} source="pyq" />

      <PracticeAnswerFields questionId={question.id} questionType={isNat ? "integer" : isMulti ? "multi" : "mcq"} options={displayOptions} selected={selected} selectedMulti={selectedMulti} integerAnswer={integerAnswer} revealed={submitted || submissionPending} correctIndexes={expectedMulti(question)} onSelect={option => isMulti ? toggleMulti(option) : setSelected(option)} onIntegerChange={setIntegerAnswer} />
      {submitted ? <PracticeAnswerReview isCorrect={isCorrect} answerLabel={answerLabel(question)} answerContent={!isNat && !isMulti && question.correctAnswer != null ? displayOptions[question.correctAnswer] : isNat ? question.answerText : null} explanation={question.explanation} /> : null}
      <TcsCalculator open={showCalculator} onClose={() => setShowCalculator(false)} />
      <Dialog open={showReport} onOpenChange={(open) => { if (!open) setShowReport(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Report this PYQ?</DialogTitle><DialogDescription>Tell the admin what is incorrect in this question, answer or explanation.</DialogDescription></DialogHeader>
          {reportState.message ? <p role="status" className="text-sm text-muted-foreground">{reportState.message}</p> : null}
          <Textarea disabled={reportState.blocked || reportState.mutation.isPending} value={reportReason} onChange={(event) => setReportReason(event.target.value)} placeholder="Write the issue..." rows={4} />
          <DialogFooter><Button type="button" variant="outline" disabled={reportState.mutation.isPending} onClick={() => setShowReport(false)}>Cancel</Button><Button type="button" disabled={!reportReason.trim() || reportState.blocked || reportState.mutation.isPending} onClick={() => reportState.mutation.mutate({ reason: reportReason.trim() })}>{reportState.mutation.isPending ? "Sending…" : "Send report"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    <PracticeActionBar revealed={submitted} pending={submissionPending} canSubmit={canSubmit} hasPrevious={index > 0} hasNext={Boolean(hasNext)} streak={streakCount} onPrevious={() => onPrevious?.()} onNext={() => onNext?.()} onFinish={() => onBack?.()} onSubmit={() => void submitAnswer(currentAnswer as AnswerValue)} />
    </>
  );
}

export default function StudentPYQ() {
  const { user } = useAuth();
  return <StudentPYQWorkspace key={user?.id ?? "guest"} />;
}

function StudentPYQWorkspace() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [activeExam, setActiveExam] = useState(() => readStudentExamSelection(user));
  const activeExamQueryValue = formatExamDisplayName(activeExam) || activeExam;
  const pyqLocked = isStudentFeatureLocked(user, "pyq");
  useEffect(() => {
    if (pyqLocked) {
      setLocation(buildStudentUnlockPath({ feature: "pyq", kind: "feature", returnTo: "/student/pyq" }));
    }
  }, [pyqLocked, setLocation]);

  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(() => readPyqViewState(user?.id).selectedSubject ?? null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(() => readPyqViewState(user?.id).selectedChapter ?? null);
  const [showSaved, setShowSaved] = useState(() => readPyqViewState(user?.id).showSaved ?? false);
  const [practiceMode, setPracticeMode] = useState(() => readPyqViewState(user?.id).practiceMode ?? false);
  const [questionIndex, setQuestionIndex] = useState(() => readPyqViewState(user?.id).questionIndex ?? 0);
  const [practiceQuestionId, setPracticeQuestionId] = useState<number | null>(null);
  const [subjectSearch, setSubjectSearch] = useState("");
  const [attemptedFilter, setAttemptedFilter] = useState<"all" | "attempted" | "unattempted">(() => readPyqViewState(user?.id).attemptedFilter ?? "all");
  const [typeFilter, setTypeFilter] = useState<"all" | QuestionType>(() => readPyqViewState(user?.id).typeFilter ?? "all");
  const [markFilter, setMarkFilter] = useState<"all" | "1" | "2">(() => readPyqViewState(user?.id).markFilter ?? "all");
  const [yearFilter, setYearFilter] = useState(() => readPyqViewState(user?.id).yearFilter ?? "all");
  const [practiceResults, setPracticeResults] = useState<Record<string, boolean>>(() => readPyqViewState(user?.id).practiceResults ?? {});
  const [practiceVisited, setPracticeVisited] = useState<Record<string, boolean>>(() => readPyqViewState(user?.id).practiceVisited ?? {});
  const [practiceAttemptCounts, setPracticeAttemptCounts] = useState<Record<string, number>>(() => readPyqViewState(user?.id).practiceAttemptCounts ?? {});
  const [practiceSubmitted, setPracticeSubmitted] = useState<Record<string, boolean>>(() => readPyqViewState(user?.id).practiceSubmitted ?? {});
  const [showAiGenerated, setShowAiGenerated] = useState(false);
  const [aiQuestionsAvailable, setAiQuestionsAvailable] = useState(false);
  const practice = usePracticeStreak(JSON.stringify(["pyq", user?.id, activeExamQueryValue, selectedSubject?.subject, selectedChapter?.chapter, showSaved]));
  const streakCount = practice.count;
  const [celebration, setCelebration] = useState<number | null>(null);
  const seenCelebration = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (practice.celebration && seenCelebration.current !== practice.celebration.id) {
      seenCelebration.current = practice.celebration.id;
      setCelebration(practice.celebration.count);
    }
  }, [practice.celebration]);
  const pyqHistoryReadyRef = useRef(false);
  const pyqHistoryGenerationRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currentPyqHistoryView = (): PyqHistoryView => practiceMode ? "practice" : showSaved ? "saved" : selectedChapter ? "chapter" : selectedSubject ? "subject" : "subjects";
  const pyqHistoryEntry = (view: PyqHistoryView, overrides: Partial<PyqHistoryEntry> = {}): PyqHistoryEntry => ({
    view,
    generation: pyqHistoryGenerationRef.current,
    selectedSubject,
    selectedChapter,
    showSaved,
    questionIndex,
    ...overrides,
  });
  const pushPyqHistory = (view: PyqHistoryView, overrides: Partial<PyqHistoryEntry> = {}) => {
    if (typeof window === "undefined" || !pyqHistoryReadyRef.current) return;
    window.history.pushState({ ...(window.history.state ?? {}), __rankpulsePyq: pyqHistoryEntry(view, overrides) }, "", window.location.href);
  };
  const applyPyqHistoryEntry = (entry: Partial<PyqHistoryEntry>) => {
    const view = entry.view ?? "subjects";
    setSelectedSubject(entry.selectedSubject ?? null);
    setSelectedChapter(entry.selectedChapter ?? null);
    setShowSaved(view === "saved" || entry.showSaved === true);
    setPracticeMode(view === "practice");
    setPracticeQuestionId(null);
    setQuestionIndex(Number.isInteger(entry.questionIndex) && Number(entry.questionIndex) >= 0 ? Number(entry.questionIndex) : 0);
  };
  const goBackInPyqHistory = () => {
    if (typeof window !== "undefined" && pyqHistoryReadyRef.current && window.history.state?.__rankpulsePyq && currentPyqHistoryView() !== "subjects") {
      window.history.back();
      return;
    }
    if (practiceMode) setPracticeMode(false);
    else if (selectedChapter) setSelectedChapter(null);
    else if (selectedSubject || showSaved) { setSelectedSubject(null); setSelectedChapter(null); setShowSaved(false); }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const initialEntry = pyqHistoryEntry(currentPyqHistoryView());
    // PYQ view state survives reloads in sessionStorage, but browser history does not.
    // Rebuild the internal navigation trail so a phone's native Back key walks
    // practice -> question list -> chapters -> subjects instead of leaving PYQ.
    const subjectsEntry = pyqHistoryEntry("subjects", {
      selectedSubject: null,
      selectedChapter: null,
      showSaved: false,
      questionIndex: 0,
    });
    window.history.replaceState({ ...(window.history.state ?? {}), __rankpulsePyq: subjectsEntry }, "", window.location.href);

    const restoredTrail: PyqHistoryEntry[] = [];
    if (initialEntry.selectedSubject) {
      restoredTrail.push(pyqHistoryEntry("subject", {
        selectedSubject: initialEntry.selectedSubject,
        selectedChapter: null,
        showSaved: false,
        questionIndex: 0,
      }));
    }
    if (initialEntry.showSaved) {
      restoredTrail.push(pyqHistoryEntry("saved", {
        selectedSubject: null,
        selectedChapter: null,
        showSaved: true,
        questionIndex: 0,
      }));
    } else if (initialEntry.selectedSubject && initialEntry.selectedChapter) {
      restoredTrail.push(pyqHistoryEntry("chapter", {
        selectedSubject: initialEntry.selectedSubject,
        selectedChapter: initialEntry.selectedChapter,
        showSaved: false,
        questionIndex: 0,
      }));
    }
    if (initialEntry.view === "practice") restoredTrail.push(initialEntry);
    for (const entry of restoredTrail) {
      window.history.pushState({ ...(window.history.state ?? {}), __rankpulsePyq: entry }, "", window.location.href);
    }

    pyqHistoryReadyRef.current = true;
    const handlePopState = (event: PopStateEvent) => {
      const entry = (event.state as { __rankpulsePyq?: Partial<PyqHistoryEntry> } | null)?.__rankpulsePyq;
      if (entry?.generation && entry.generation !== pyqHistoryGenerationRef.current) {
        window.history.back();
        return;
      }
      if (entry) applyPyqHistoryEntry(entry);
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      pyqHistoryReadyRef.current = false;
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);
  useEffect(() => {
    const sync = () => setActiveExam(readStudentExamSelection(user));
    window.addEventListener("student-exam-changed", sync);
    window.addEventListener("storage", sync);
    sync();
    return () => {
      window.removeEventListener("student-exam-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [user]);
  useEffect(() => {
    if (selectedSubject && activeExam && normalizePyqWorkspaceKey(selectedSubject.exam) !== normalizePyqWorkspaceKey(activeExam)) {
      setSelectedSubject(null);
      setSelectedChapter(null);
      setPracticeMode(false);
    }
  }, [activeExam, selectedSubject]);
  const syncOptions = { networkMode:'always', retry:false, staleTime: 30_000, refetchOnMount: true, refetchOnWindowFocus: true, refetchOnReconnect: true } as const;
  const subjectsQuery = useQuery({ ...syncOptions, queryKey: ["pyq-subjects", "student", user?.id, activeExamQueryValue], queryFn: () => api.get<{ subjects: Subject[] }>(`/pyq/subjects?exam=${encodeURIComponent(activeExamQueryValue)}`), enabled: !pyqLocked && !selectedSubject && Boolean(activeExamQueryValue) });
  const chaptersQuery = useQuery({ ...syncOptions, queryKey: ["pyq-chapters", "student", user?.id, selectedSubject?.exam, selectedSubject?.subject], enabled: !pyqLocked && Boolean(selectedSubject && !selectedChapter && !showSaved), queryFn: () => api.get<{ chapters: Chapter[] }>(`/pyq/chapters?exam=${encodeURIComponent(selectedSubject!.exam)}&subject=${encodeURIComponent(selectedSubject!.subject)}`) });
  const questionParams = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ limit: "100", ...extra });
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (markFilter !== "all") params.set("marks", markFilter);
    if (yearFilter !== "all") params.set("year", yearFilter);
    return params;
  };
  const questionsQuery = useQuery({
    ...syncOptions,
    queryKey: ["pyq-questions", "student", user?.id, selectedSubject?.exam, selectedSubject?.subject, selectedChapter?.chapter, typeFilter, markFilter, yearFilter],
    enabled: !pyqLocked && Boolean(selectedSubject && selectedChapter && !showSaved),
    queryFn: () => api.get<{ questions: PyqQuestion[]; total: number }>(`/pyq/questions?${questionParams({ exam: selectedSubject!.exam, subject: selectedSubject!.subject, chapter: selectedChapter!.chapter }).toString()}`),
  });
  const savedQuery = useQuery({
    ...syncOptions,
    queryKey: ["pyq-saved-questions", "student", user?.id, activeExamQueryValue, typeFilter, markFilter, yearFilter],
    enabled: showSaved && Boolean(activeExamQueryValue),
    queryFn: () => api.get<{ questions: PyqQuestion[]; total: number }>(`/pyq/questions?${questionParams({ exam: activeExamQueryValue, saved: "1" }).toString()}`),
  });
  const savedCountQuery = useQuery({
    queryKey: ["pyq-saved-question-count", "student", user?.id, activeExamQueryValue],
    enabled: Boolean(activeExamQueryValue),
    queryFn: () => api.get<{ total: number }>(`/pyq/questions?countOnly=1&exam=${encodeURIComponent(activeExamQueryValue)}&saved=1`),
    staleTime: 30_000,
  });
  const progressQuery = useQuery({ ...syncOptions, queryKey: ["pyq-progress-summary", "student", user?.id, activeExamQueryValue], enabled: !pyqLocked && !showSaved && !selectedSubject && Boolean(activeExamQueryValue), queryFn: () => api.get<{ totalAttemptedQuestions: number; totalSolvedQuestions: number; totalAttempts: number; correctAttempts: number; accuracy: number }>(`/pyq/progress/summary?exam=${encodeURIComponent(activeExamQueryValue)}`) });
  const updateQuestionProgress = (id: number, exam: string, update: Partial<PyqQuestion>) => {
    for (const key of ["pyq-questions", "pyq-saved-questions"]) {
      queryClient.setQueriesData<{ questions: PyqQuestion[]; total: number }>({ queryKey: [key, "student", user?.id] }, (data) => data ? { ...data, questions: data.questions.map((question) => question.id === id && question.exam === exam ? { ...question, ...update } : question) } : data);
    }
  };
  const refreshProgress = () => {
    // The mutation response already updates question progress. Reload summaries
    // when their screen is opened, not after every answer in a practice session.
    for (const key of ["pyq-subjects", "pyq-chapters", "pyq-progress-summary", "dashboard-pyq-progress"]) void queryClient.invalidateQueries({ queryKey: [key], refetchType: "none" });
  };
  const saveMutation = useMutation({
    mutationFn: async (id: number) => {
      const exam = selectedSubject?.exam ?? activeExamQueryValue;
      const result = await api.post<{ saved: boolean }>(`/pyq/questions/${id}/save`, { exam });
      return { ...result, exam };
    },
    onSuccess: ({ saved, exam }, id) => {
      updateQuestionProgress(id, exam, { isSaved: saved });
      void queryClient.invalidateQueries({ queryKey: ["pyq-saved-questions", "student", user?.id], refetchType: showSaved ? "active" : "none" });
      void queryClient.invalidateQueries({ queryKey: ["pyq-saved-question-count", "student", user?.id] });
      toast({ title: saved ? "Question saved" : "Question removed", description: saved ? "You can find it in Saved questions." : "Removed from Saved questions." });
    },
    onError: (error: Error) => toast({ title: "Could not update saved question", description: error.message, variant: "destructive" }),
  });
  const attemptMutation = useMutation({
    networkMode:'always',
    mutationFn: async ({ id, answer, exam, firstSubmissionTime }: { id: number; answer: AnswerValue; exam: string; firstSubmissionTime: number | null }) => {
      if (firstSubmissionTime !== null) {
        const timed = await api.post<{ timeSpentSeconds: number }>(`/pyq/questions/${id}/time`, { exam, timeSpentSeconds: firstSubmissionTime });
        updateQuestionProgress(id, exam, { timeSpentSeconds: timed.timeSpentSeconds });
      }
      return api.post<{ isCorrect: boolean | null; progress: PyqQuestion["progress"] }>(`/pyq/questions/${id}/attempt`, { answer, exam });
    },
    onSuccess: (saved, { id, exam }) => { updateQuestionProgress(id, exam, { progress: saved.progress }); refreshProgress(); },
    onError: (error: Error) => toast({ title: "Could not save progress", description: error.message, variant: "destructive" }),
  });
  const jamSubmitMutation = useMutation({
    networkMode:'always',
    mutationFn: async ({ id, answer, exam, firstSubmissionTime }: { id: number; answer: AnswerValue; exam: string; firstSubmissionTime: number | null }) => {
      if (firstSubmissionTime !== null) {
        const timed = await api.post<{ timeSpentSeconds: number }>(`/pyq/questions/${id}/time`, { exam, timeSpentSeconds: firstSubmissionTime });
        updateQuestionProgress(id, exam, { timeSpentSeconds: timed.timeSpentSeconds });
      }
      return api.post<{ submitted: boolean; alreadySubmitted: boolean; answer: AnswerValue; isCorrect: boolean }>(`/pyq/questions/${id}/jam-submit`, { answer, exam });
    },
    onSuccess: (saved, { id, exam }) => { updateQuestionProgress(id, exam, { jamSubmitted: true, jamSubmittedAnswer: saved.answer, jamSubmittedCorrect: saved.isCorrect }); refreshProgress(); },
    onError: (error: Error) => toast({ title: "Could not save answer", description: error.message, variant: "destructive" }),
  });

  const buffered=useBufferedPractice();
  const rawQuestions = showSaved ? savedQuery.data?.questions : questionsQuery.data?.questions;
  const allQuestions = useMemo(()=>(rawQuestions??[]).map(q=>{
    const saved=buffered.pack?.source==='pyq'?buffered.attempts.find(a=>a.packId===buffered.pack?.id&&a.questionId===q.id&&a.exam===q.exam):undefined;
    const cached=buffered.pack?.source==='pyq'?buffered.pack.questions.find(item=>item.id===q.id&&item.exam===q.exam):undefined;
    const displayed=cached&&(buffered.offline||q.offlineUnavailable)?{...q,...cached,explanation:cached.explanation??null,offlineUnavailable:false}
      :cached?{...q,imageData:cached.imageData}:q;
    return saved?{...displayed,offlineAnswer:saved.answer,offlineCorrect:saved.isCorrect??undefined}:displayed;
  }),[rawQuestions,buffered.pack,buffered.attempts,buffered.offline]);
  const questionsWithProgress = useMemo(() => allQuestions.map((question) => {
    const session = practice.attempts.find(attempt => attempt.questionId === question.id && (attempt.status === "pending" || attempt.status === "confirmed"));
    return { ...question, sessionAnswer: session?.answer, practiceResult: session ? answerIsCorrect(question, session.answer) : practiceResults[`${question.exam}:${question.id}`], practiceVisited: practiceVisited[`${question.exam}:${question.id}`], practiceAttemptCount: practiceAttemptCounts[`${question.exam}:${question.id}`] ?? 0 };
  }), [allQuestions, practice.attempts, practiceResults, practiceVisited, practiceAttemptCounts]);
  useEffect(() => {
    for (const attempt of practice.attempts) {
      const question = allQuestions.find(q => q.id === attempt.questionId);
      if (question && attempt.status === "confirmed") practice.store.regrade(attempt.id, answerIsCorrect(question, attempt.answer));
    }
  }, [allQuestions, practice.attempts, practice.store]);
  const filteredQuestions = useMemo(() => questionsWithProgress.filter((question) => {
    const { attempted } = getPyqProgress(question);
    // The current result stays visible even if it no longer matches the
    // Unattempted filter, exactly as in QBank. Next retains the same position.
    if (practiceMode && question.id === practiceQuestionId) return true;
    if (attemptedFilter === "attempted" && !attempted) return false;
    if (attemptedFilter === "unattempted" && attempted) return false;
    return true;
  }), [questionsWithProgress, attemptedFilter, practiceMode, practiceQuestionId]);
  const resolvedQuestionIndex = practiceMode && practiceQuestionId !== null
    ? Math.max(0, filteredQuestions.findIndex(q => q.id === practiceQuestionId)) : questionIndex;
  useEffect(() => {
    if (practiceMode && practiceQuestionId === null && filteredQuestions[questionIndex]) setPracticeQuestionId(filteredQuestions[questionIndex].id);
    if (practiceMode && practiceQuestionId !== null && resolvedQuestionIndex !== questionIndex) setQuestionIndex(resolvedQuestionIndex);
  }, [practiceMode, practiceQuestionId, filteredQuestions, questionIndex, resolvedQuestionIndex]);
  useEffect(() => {
    if (!user?.id || typeof window === "undefined") return;
    const view: PyqViewState = { selectedSubject, selectedChapter, showSaved, practiceMode, questionIndex, attemptedFilter, typeFilter, markFilter, yearFilter, practiceResults, practiceVisited, practiceAttemptCounts, practiceSubmitted };
    try {
      window.sessionStorage.setItem(`pyq-view:${user.id}`, JSON.stringify(view));
    } catch {
      // Keep PYQ usable when browser storage is disabled or full.
    }
  }, [user?.id, selectedSubject, selectedChapter, showSaved, practiceMode, questionIndex, attemptedFilter, typeFilter, markFilter, yearFilter, practiceResults, practiceVisited, practiceAttemptCounts, practiceSubmitted]);
  useEffect(() => {
    if (!practiceMode || !filteredQuestions.length) return;
    if (questionIndex >= filteredQuestions.length) setQuestionIndex(filteredQuestions.length - 1);
  }, [practiceMode, questionIndex, filteredQuestions.length]);

  const subjects = subjectsQuery.data?.subjects ?? [];
  const filteredSubjects = subjects.filter((item) => item.subject.toLowerCase().includes(subjectSearch.toLowerCase()) || item.exam.toLowerCase().includes(subjectSearch.toLowerCase()));
  const examLabel = formatExamDisplayName(selectedSubject?.exam ?? subjects[0]?.exam ?? activeExam) || "PYQ";
  const totalExamQuestions = subjects.reduce((sum, item) => sum + item.questionCount, 0);
  const totalAttempted = subjects.reduce((sum, item) => sum + (item.attemptedCount ?? 0), 0);
  const listAttempted = questionsWithProgress.filter((question) => getPyqProgress(question).attempted).length;
  const listTotal = showSaved ? savedQuery.data?.total ?? filteredQuestions.length : selectedChapter ? questionsQuery.data?.total ?? filteredQuestions.length : 0;

  const resetFilters = () => { setTypeFilter("all"); setMarkFilter("all"); setYearFilter("all"); setAttemptedFilter("all"); setShowAiGenerated(false); setAiQuestionsAvailable(false); setPracticeMode(false); setQuestionIndex(0); };
  useEffect(() => {
    if (!user?.id) return;
    const resetToPyqHome = () => {
      pyqHistoryGenerationRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setSelectedSubject(null);
      setSelectedChapter(null);
      setShowSaved(false);
      setTypeFilter("all");
      setMarkFilter("all");
      setYearFilter("all");
      setAttemptedFilter("all");
      setShowAiGenerated(false);
      setAiQuestionsAvailable(false);
      setPracticeMode(false);
      setQuestionIndex(0);
      try { window.sessionStorage.removeItem(`pyq-open-home:${user.id}`); } catch {}
      if (pyqHistoryReadyRef.current) {
        const homeEntry = pyqHistoryEntry("subjects", {
          selectedSubject: null,
          selectedChapter: null,
          showSaved: false,
          questionIndex: 0,
        });
        window.history.replaceState({ ...(window.history.state ?? {}), __rankpulsePyq: homeEntry }, "", window.location.href);
      }
    };
    window.addEventListener("rankpulse:pyq-home", resetToPyqHome);
    try { window.sessionStorage.removeItem(`pyq-open-home:${user.id}`); } catch {}
    return () => window.removeEventListener("rankpulse:pyq-home", resetToPyqHome);
  }, [user?.id]);
  const openSaved = () => { setShowSaved(true); setSelectedSubject(null); setSelectedChapter(null); setPracticeMode(false); setQuestionIndex(0); resetFilters(); pushPyqHistory("saved", { showSaved: true, selectedSubject: null, selectedChapter: null, questionIndex: 0 }); };
  const openSubjects = () => { setShowSaved(false); setSelectedSubject(null); setSelectedChapter(null); resetFilters(); };
  const openChapters = () => { setSelectedChapter(null); resetFilters(); };
  const markPracticeVisited = (question?: PyqQuestion) => {
    if (!question) return;
    setPracticeVisited((current) => ({ ...current, [`${question.exam}:${question.id}`]: true }));
  };
  const openQuestion = (index: number) => { markPracticeVisited(filteredQuestions[index]); setPracticeQuestionId(filteredQuestions[index]?.id ?? null); setQuestionIndex(index); setPracticeMode(true); pushPyqHistory("practice", { questionIndex: index }); };
  const moveToQuestion = (nextIndex: number) => { markPracticeVisited(filteredQuestions[nextIndex]); setPracticeQuestionId(filteredQuestions[nextIndex]?.id ?? null); setQuestionIndex(nextIndex); };
  const handleAttempt = async (id: number, answer: AnswerValue, isCorrect: boolean, exam: string, firstSubmissionTime: number | null) => {
    if (answer === null) return;
    const store = practice.store;
    const attemptId = store.begin(id, answer, isCorrect);
    if (attemptId === null) return;
    try {
      const saved = await attemptMutation.mutateAsync({ id, answer, exam, firstSubmissionTime });
      store.settle(attemptId, saved.isCorrect ?? isCorrect);
    } catch (error) { store.settle(attemptId, null); throw error; }
  };
  const submitJamAnswer = async (id: number, answer: AnswerValue, exam: string, firstSubmissionTime: number | null) => {
    if (answer === null) throw new Error("Choose an answer before submitting.");
    const store = practice.store;
    const question = allQuestions.find(q => q.id === id && q.exam === exam);
    const attemptId = store.begin(id, answer, question ? answerIsCorrect(question, answer) : false);
    try {
      const saved = await jamSubmitMutation.mutateAsync({ id, answer, exam, firstSubmissionTime });
      if (attemptId !== null) store.settle(attemptId, saved.isCorrect);
      return saved;
    } catch (error) { if (attemptId !== null) store.settle(attemptId, null); throw error; }
  };
  const saveJamQuestionTime = async (id: number, exam: string, timeSpentSeconds: number) => {
    const saved = await api.post<{ timeSpentSeconds: number }>(`/pyq/questions/${id}/time`, { exam, timeSpentSeconds });
    updateQuestionProgress(id, exam, { timeSpentSeconds: saved.timeSpentSeconds });
    return saved.timeSpentSeconds;
  };
  const activeQuestion = filteredQuestions[resolvedQuestionIndex];
  const jamPractice = practiceMode && activeQuestion;
  useEffect(() => {
    if (practiceMode && activeQuestion) window.dispatchEvent(new Event("rankpulse:collapse-sidebar"));
  }, [practiceMode, activeQuestion?.id]);
  const listLoading = showSaved ? savedQuery.isLoading : questionsQuery.isLoading;
  const listError = showSaved ? savedQuery.error as Error | null : questionsQuery.error as Error | null;

  if (pyqLocked) return <div>Redirecting to PYQ unlock…</div>;

  return (
    <div className={practiceMode ? "w-full space-y-6" : "mx-auto max-w-6xl space-y-4 sm:space-y-6"}>
      {filteredQuestions.length > 0 && (selectedChapter || showSaved || practiceMode) ? <OfflinePackLoader source="pyq"
        title={`${selectedSubject?.subject ?? "Saved PYQs"} · ${selectedChapter?.chapter ?? "Practice"}`}
        context={`pyq:${activeExamQueryValue}:${selectedSubject?.subject ?? "saved"}:${selectedChapter?.chapter ?? "practice"}`} exam={activeExamQueryValue}
        questionIds={practiceBufferIds(filteredQuestions.map(q=>q.id),practiceMode?resolvedQuestionIndex:0)}
        load={async (ids,signal,onReady)=>{
          const ready:OfflineQuestion[]=[];
          for(const id of ids){
            let q=rawQuestions?.find(q=>q.id===id);
            if(!q)continue;
            if(q.offlineUnavailable){
              // After an offline reload only metadata remains outside the buffer.
              // Fetch one existing list position, never the entire chapter again.
              const params=questionParams(showSaved?{exam:activeExamQueryValue,saved:'1'}:{exam:selectedSubject!.exam,subject:selectedSubject!.subject,chapter:selectedChapter!.chapter});
              params.set('limit','1');params.set('page',String(rawQuestions!.findIndex(item=>item.id===id)+1));
              const data=await api.get<{questions:PyqQuestion[]}>(`/pyq/questions?${params}`,{networkOnly:true,signal});
              const loaded=data.questions.find(item=>item.id===id&&item.exam===q!.exam);
              if(!loaded)throw new Error('Question list changed. Refresh when connected.');
              q=loaded;
            }
            const complete:OfflineQuestion={...q,view:{subject:q.subject,chapter:q.chapter,marks:q.marks,year:q.year,paper:q.paper,questionNumber:q.questionNumber,sourceName:q.sourceName,isSaved:q.isSaved,progress:q.progress},options:offlineDisplayOptions(q.question,q.options),attempted:q.jamSubmitted||(q.progress?.attemptCount??0)>0};
            ready.push(complete);
            await onReady?.(complete);
          }
          return ready;
        }}
      /> : null}
      <div className={`${jamPractice ? "hidden sm:flex" : "flex"} flex-wrap items-center gap-2 sm:gap-3`}>
        <div className={`${jamPractice ? "hidden sm:flex" : "flex"} min-w-0 flex-1 items-center gap-2 sm:gap-3`}>
        <button type="button" onClick={goBackInPyqHistory} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary sm:h-auto sm:px-3 sm:py-1.5 sm:text-sm">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground sm:text-xs">
          <span className="shrink-0">Student Dashboard</span><span>/</span><span className="shrink-0">{showSaved ? "Saved questions" : examLabel}</span>
          {selectedSubject ? <><span>/</span><span className="truncate">{selectedSubject.subject}</span></> : null}
          {selectedChapter ? <><span>/</span><span className="truncate">{selectedChapter.chapter}</span></> : null}
        </div>
        </div>
        {!selectedSubject && !selectedChapter && !showSaved && !practiceMode ? <Button type="button" variant="outline" onClick={openSaved} className="h-10 w-full justify-center rounded-xl px-3 text-sm sm:ml-auto sm:h-auto sm:w-auto sm:justify-start sm:px-4 sm:py-2"><BookmarkCheck className="mr-2 h-4 w-4" /><span className="flex items-center gap-1.5">Saved questions <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-slate-600">{savedCountQuery.isLoading ? "…" : savedCountQuery.data?.total ?? 0}</span></span></Button> : null}
        {practiceMode && filteredQuestions.length > 0 ? <span className="hidden shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground sm:ml-auto sm:block">{resolvedQuestionIndex + 1} / {filteredQuestions.length}</span> : null}
      </div>

      {practiceMode && activeQuestion ? (
        <PracticeView question={activeQuestion} displayExam={activeExamQueryValue} index={resolvedQuestionIndex} questions={filteredQuestions} streakCount={streakCount} onPrevious={() => moveToQuestion(Math.max(0, resolvedQuestionIndex - 1))} onNext={() => moveToQuestion(Math.min(filteredQuestions.length - 1, resolvedQuestionIndex + 1))} onSelect={moveToQuestion} onBack={goBackInPyqHistory} onSave={(id) => saveMutation.mutate(id)} onAttempt={handleAttempt} onJamSubmit={submitJamAnswer} onSaveTime={saveJamQuestionTime} />
      ) : showSaved ? (
        <QuestionListView title="Saved questions" subtitle="Bookmarked PYQs from every subject" displayExam={activeExamQueryValue} questions={filteredQuestions} totalQuestions={listTotal} attemptedCount={listAttempted} loading={listLoading} error={listError} attemptedFilter={attemptedFilter} setAttemptedFilter={setAttemptedFilter} typeFilter={typeFilter} setTypeFilter={setTypeFilter} markFilter={markFilter} setMarkFilter={setMarkFilter} yearFilter={yearFilter} setYearFilter={setYearFilter} onOpen={openQuestion} onSave={(id) => saveMutation.mutate(id)} />
      ) : !selectedSubject ? (
        <>
          <Card className="border-orange-100 bg-gradient-to-r from-orange-50 to-white p-3 dark:border-border dark:from-card dark:to-card sm:p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-foreground"><BarChart3 className="h-4 w-4 text-orange-600" /> Your PYQ progress</div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <ProgressStat label="Attempted" value={progressQuery.data?.totalAttemptedQuestions ?? totalAttempted} />
              <ProgressStat label="Solved" value={progressQuery.data?.totalSolvedQuestions ?? 0} />
              <ProgressStat label="Total questions" value={totalExamQuestions} />
              <ProgressStat label="Accuracy" value={`${progressQuery.data?.accuracy ?? 0}%`} />
            </div>
          </Card>
          <section>
            <div className="mb-3 flex flex-col gap-2.5 sm:mb-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-base font-semibold text-foreground sm:text-lg">Subjects</h2><p className="text-xs text-muted-foreground sm:text-sm">Choose a subject to view its chapters.</p></div><div className="relative w-full sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={subjectSearch} onChange={(event) => setSubjectSearch(event.target.value)} placeholder="Search subjects..." className="h-10 pl-9 sm:h-auto" /></div></div>
            {subjectsQuery.isLoading ? <Loading text="Loading subjects..." /> : subjectsQuery.isError ? <ErrorBox message={(subjectsQuery.error as Error).message} /> : filteredSubjects.length === 0 ? <Empty text="No PYQ subjects uploaded yet." /> : <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">{filteredSubjects.map((item, index) => <SubjectCard key={`${item.exam}-${item.subject}`} item={item} index={index} practiceSubmitted={practiceSubmitted} onClick={() => { setSelectedSubject(item); setSelectedChapter(null); resetFilters(); pushPyqHistory("subject", { selectedSubject: item, selectedChapter: null, showSaved: false, questionIndex: 0 }); }} />)}</div>}
          </section>
        </>
      ) : !selectedChapter ? (
        <ChapterView subject={subjects.find((item) => item.exam === selectedSubject.exam && item.subject === selectedSubject.subject) ?? selectedSubject} chapters={chaptersQuery.data?.chapters ?? []} loading={chaptersQuery.isLoading} error={chaptersQuery.error as Error | null} practiceSubmitted={practiceSubmitted} onOpen={(chapter) => { setSelectedChapter(chapter); resetFilters(); pushPyqHistory("chapter", { selectedSubject, selectedChapter: chapter, showSaved: false, questionIndex: 0 }); }} />
      ) : (
        <QuestionListView title={selectedChapter.chapter} subtitle={`${selectedSubject.subject} · ${selectedChapter.questionCount} questions`} displayExam={activeExamQueryValue} questions={filteredQuestions} totalQuestions={listTotal} attemptedCount={listAttempted} loading={listLoading} error={listError} attemptedFilter={attemptedFilter} setAttemptedFilter={setAttemptedFilter} typeFilter={typeFilter} setTypeFilter={setTypeFilter} markFilter={markFilter} setMarkFilter={setMarkFilter} yearFilter={yearFilter} setYearFilter={setYearFilter} onOpen={openQuestion} onSave={(id) => saveMutation.mutate(id)} aiGenerated={showAiGenerated} aiQuestionsAvailable={aiQuestionsAvailable} onToggleAiGenerated={() => setShowAiGenerated((value) => !value)} aiPracticeContext={{ exam: selectedSubject.exam, subject: selectedSubject.subject, chapter: selectedChapter.chapter }} />
      )}
      {!practiceMode && showSaved ? <AiPracticeLibrary source="pyq" savedOnly /> : !practiceMode && selectedSubject && selectedChapter && !showAiGenerated ? <AiPracticeLibrary source="pyq" exam={selectedSubject.exam} subject={selectedSubject.subject} chapter={selectedChapter.chapter} onQuestionsChange={(count) => setAiQuestionsAvailable(count > 0)} /> : null}
      {celebration ? <StreakCelebration milestone={celebration} onClose={() => setCelebration(null)} /> : null}
    </div>
  );
}

function HeaderStat({ value, label }: { value: number; label: string }) { return <div><div className="text-xl font-bold text-foreground sm:text-2xl">{value}</div><div className="text-xs text-muted-foreground sm:text-sm">{label}</div></div>; }
function CompactStat({ value, label }: { value: number; label: string }) { return <div><div className="text-xl font-bold text-foreground sm:text-2xl">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>; }

function SubjectCard({ item, index, onClick, practiceSubmitted }: { item: Subject; index: number; onClick: () => void; practiceSubmitted: Record<string, boolean> }) {
  const attemptedCount = isJamChemistryContext(item.exam, item.subject)
    ? Math.max(item.attemptedCount ?? 0, countPracticeSubmissions(practiceSubmitted, item.exam, item.subject))
    : (item.attemptedCount ?? 0);
  const progress = item.questionCount ? Math.round((attemptedCount / item.questionCount) * 100) : 0;
  const accent = getSubjectAccent(item.subject, index);
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm transition-all hover:shadow-md sm:p-4" style={{ borderColor: accent.border }}>
      <button type="button" onClick={onClick} className="group block w-full text-left">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border sm:h-10 sm:w-10" style={{ backgroundColor: accent.badgeBg, borderColor: accent.border, color: accent.text }}><SubjectThemeIcon label={item.subject} index={index} className="h-4 w-4 sm:h-5 sm:w-5" color={accent.text} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3"><h3 className="truncate text-sm font-semibold text-foreground sm:text-lg">{item.subject}</h3><ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></div>
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-center sm:mt-4 sm:gap-2">
              <div><div className="text-base font-bold text-foreground sm:text-lg">{item.chapterCount}</div><div className="text-[10px] text-muted-foreground sm:text-xs">Chapters</div></div>
              <div><div className="text-base font-bold text-foreground sm:text-lg">{item.questionCount}</div><div className="text-[10px] text-muted-foreground sm:text-xs">Questions</div></div>
              <div><div className="text-base font-bold text-foreground sm:text-lg">{progress}%</div><div className="text-[10px] text-muted-foreground sm:text-xs">Done</div></div>
            </div>
            {(item.totalTimeSpentSeconds ?? 0) > 0 ? <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Timer className="h-3.5 w-3.5" />Total time spent <span className="font-semibold tabular-nums text-foreground">{formatTimeSpent(item.totalTimeSpentSeconds!)}</span></div> : null}
          </div>
        </div>
      </button>
      <div className="mt-2.5 flex items-center gap-2 pl-12 sm:mt-3 sm:pl-[52px]"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: accent.line }} /></div><PerformanceInsightButton target={{ source: "pyq", scope: "subject", exam: item.exam, subject: item.subject, label: item.subject }} /></div>
    </div>
  );
}

function ChapterView({ subject, chapters, loading, error, onOpen, practiceSubmitted }: { subject: Subject; chapters: Chapter[]; loading: boolean; error: Error | null; onOpen: (chapter: Chapter) => void; practiceSubmitted: Record<string, boolean> }) {
  const subjectAccent = getSubjectAccent(subject.subject, 0);
  const attemptTrackingEnabled = !isJamChemistryContext(subject.exam, subject.subject);
  const attemptedCount = attemptTrackingEnabled
    ? (subject.attemptedCount ?? 0)
    : Math.max(subject.attemptedCount ?? 0, countPracticeSubmissions(practiceSubmitted, subject.exam, subject.subject));
  return (
    <>
      <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full border" style={{ backgroundColor: subjectAccent.badgeBg, borderColor: subjectAccent.border, color: subjectAccent.text }}><SubjectThemeIcon label={subject.subject} className="h-6 w-6" color={subjectAccent.text} /></span><div><h1 className="text-lg font-bold text-foreground sm:text-xl">{subject.subject}</h1><p className="text-sm text-muted-foreground">{subject.exam}</p></div></div>
          <div className="grid grid-cols-3 gap-5 text-center sm:gap-8"><HeaderStat value={subject.chapterCount} label="Chapters" /><HeaderStat value={subject.questionCount} label="Questions" /><HeaderStat value={attemptedCount} label="Attempted" /></div>
        </div>
        {(subject.totalTimeSpentSeconds ?? 0) > 0 ? <div className="mt-3 text-xs text-muted-foreground">Total time spent · <span className="font-semibold tabular-nums text-foreground">{formatTimeSpent(subject.totalTimeSpentSeconds!)}</span></div> : null}
        <div className="mt-3 flex items-center gap-2"><span className="text-xs text-muted-foreground">Progress</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-orange-500" style={{ width: `${subject.questionCount ? Math.round(attemptedCount / subject.questionCount * 100) : 0}%` }} /></div><PerformanceInsightButton target={{ source: "pyq", scope: "subject", exam: subject.exam, subject: subject.subject, label: subject.subject }} /></div>
      </div>
      <section>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Chapters</h2>
        {loading ? <Loading text="Loading chapters..." /> : error ? <ErrorBox message={error.message} /> : chapters.length === 0 ? <Empty text="No chapters available." /> : (
          <div className="grid gap-4 sm:grid-cols-2">
            {chapters.map((item, index) => {
              const chapterAttemptedCount = attemptTrackingEnabled
                ? (item.attemptedCount ?? 0)
                : Math.max(item.attemptedCount ?? 0, countPracticeSubmissions(practiceSubmitted, subject.exam, subject.subject, item.chapter));
              const progress = item.questionCount ? Math.round((chapterAttemptedCount / item.questionCount) * 100) : 0;
              const accent = getSubjectAccent(item.chapter, index);
              return (
                <div key={item.chapter} className="rounded-xl border bg-card p-3.5 shadow-sm transition-all hover:shadow-md sm:p-4" style={{ borderColor: accent.border }}>
                  <button type="button" onClick={() => onOpen(item)} className="group block w-full text-left">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border" style={{ backgroundColor: accent.badgeBg, borderColor: accent.border, color: accent.text }}><ChapterThemeIcon label={item.chapter} index={index} className="h-5 w-5" color={accent.text} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-base font-semibold text-foreground">{item.chapter}</h3><p className="mt-0.5 text-sm text-muted-foreground">{item.questionCount} questions</p></div><ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></div>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{chapterAttemptedCount}/{item.questionCount} attempted{(item.totalTimeSpentSeconds ?? 0) > 0 ? ` · ${formatTimeSpent(item.totalTimeSpentSeconds!)} spent` : ""}</span><span>{progress}%</span></div>
                      </div>
                    </div>
                  </button>
                  <div className="mt-2 flex items-center gap-2 pl-[52px]"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: accent.line }} /></div><PerformanceInsightButton target={{ source: "pyq", scope: "chapter", exam: subject.exam, subject: subject.subject, chapter: item.chapter, label: item.chapter }} /></div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function QuestionListView({ title, subtitle, displayExam, questions, totalQuestions, attemptedCount, loading, error, attemptedFilter, setAttemptedFilter, typeFilter, setTypeFilter, markFilter, setMarkFilter, yearFilter, setYearFilter, onOpen, onSave, aiGenerated = false, aiQuestionsAvailable = false, onToggleAiGenerated, aiPracticeContext }: { title: string; subtitle: string; displayExam?: string; questions: PyqQuestion[]; totalQuestions: number; attemptedCount: number; loading: boolean; error: Error | null; attemptedFilter: "all" | "attempted" | "unattempted"; setAttemptedFilter: (value: "all" | "attempted" | "unattempted") => void; typeFilter: "all" | QuestionType; setTypeFilter: (value: "all" | QuestionType) => void; markFilter: "all" | "1" | "2"; setMarkFilter: (value: "all" | "1" | "2") => void; yearFilter: string; setYearFilter: (value: string) => void; onOpen: (index: number) => void; onSave: (id: number) => void; aiGenerated?: boolean; aiQuestionsAvailable?: boolean; onToggleAiGenerated?: () => void; aiPracticeContext?: { exam: string; subject: string; chapter: string } }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const total = Math.max(totalQuestions, questions.length);
  const progress = total ? Math.round((attemptedCount / total) * 100) : 0;
  const active = typeFilter !== "all" || markFilter !== "all" || yearFilter !== "all";
  return <>
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-xl font-bold text-foreground sm:text-2xl">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{subtitle}</p></div><div className="grid grid-cols-3 gap-5 text-center sm:gap-8"><HeaderStat value={total} label="Total" /><HeaderStat value={attemptedCount} label="Attempted" /><HeaderStat value={Math.max(0, total - attemptedCount)} label="Remaining" /></div></div>
      <div className="mt-5"><div className="flex items-center justify-between text-sm text-muted-foreground"><span>Progress</span><span>{progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-orange-500" style={{ width: `${progress}%` }} /></div></div>
    </div>
    <section><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-lg font-semibold text-foreground">{aiGenerated ? "AI generated" : "Questions"} {!aiGenerated ? <span className="text-sm font-normal text-muted-foreground">({total})</span> : null}</h2><div className="flex items-center gap-2"><div className="flex items-center gap-1.5"><button type="button" onClick={() => { setAttemptedFilter("all"); if (aiGenerated) onToggleAiGenerated?.(); }} className={`rounded-full px-3 py-1.5 text-xs font-medium ${!aiGenerated && attemptedFilter === "all" ? "bg-orange-500 text-white" : "border border-border bg-card text-muted-foreground"}`}>All</button><button type="button" onClick={() => { setAttemptedFilter("unattempted"); if (aiGenerated) onToggleAiGenerated?.(); }} className={`rounded-full px-3 py-1.5 text-xs font-medium ${!aiGenerated && attemptedFilter === "unattempted" ? "bg-orange-500 text-white" : "border border-border bg-card text-muted-foreground"}`}>Unattempted</button><button type="button" onClick={() => { setAttemptedFilter("attempted"); if (aiGenerated) onToggleAiGenerated?.(); }} className={`rounded-full px-3 py-1.5 text-xs font-medium ${!aiGenerated && attemptedFilter === "attempted" ? "bg-orange-500 text-white" : "border border-border bg-card text-muted-foreground"}`}>Attempted</button>{onToggleAiGenerated && aiPracticeContext && (aiGenerated || aiQuestionsAvailable) ? <button type="button" onClick={onToggleAiGenerated} className={`rounded-full px-3 py-1.5 text-xs font-medium ${aiGenerated ? "bg-violet-600 text-white" : "border border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-300"}`}>AI generated</button> : null}</div><div className="relative"><Button type="button" variant="outline" size="icon" className={`h-8 w-8 rounded-lg ${active ? "border-orange-300 bg-orange-50 text-orange-700" : "text-slate-500"}`} aria-label="Open filters" title="Filters" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal className="h-3.5 w-3.5" />{active ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500" /> : null}</Button>{filtersOpen ? <div className="absolute right-0 top-10 z-20 grid w-56 gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"><label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type<select className="mt-1 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | QuestionType)}><option value="all">All types</option><option value="mcq">MCQ</option><option value="multi">MSQ</option><option value="integer">NAT</option></select></label><label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Marks<select className="mt-1 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs" value={markFilter} onChange={(event) => setMarkFilter(event.target.value as "all" | "1" | "2")}><option value="all">All marks</option><option value="1">1 mark</option><option value="2">2 marks</option></select></label><label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Year<input type="number" min="1900" max="2200" placeholder="All years" className="mt-1 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs" value={yearFilter === "all" ? "" : yearFilter} onChange={(event) => setYearFilter(event.target.value || "all")} /></label></div> : null}</div></div></div>{aiGenerated && aiPracticeContext ? <AiPracticeLibrary source="pyq" exam={aiPracticeContext.exam} subject={aiPracticeContext.subject} chapter={aiPracticeContext.chapter} embedded /> : loading ? <Loading text="Loading questions..." /> : error ? <ErrorBox message={error.message} /> : questions.length === 0 ? <Empty text="No questions match the selected filters." /> : <div className="space-y-3">{questions.map((question, index) => <QuestionPreview key={question.id} question={question} index={index} onOpen={() => onOpen(index)} onSave={onSave} />)}</div>}</section>
  </>;
}

function QuestionPreviewContent({ question, options }: { question: PyqQuestion; options: string[] }) {
  const content = stripRepeatedPyqOptions(question.question, options);
  const document = new DOMParser().parseFromString(sanitizeRichHtml(content), "text/html");
  const hasEmbeddedMedia = Array.from(document.querySelectorAll("img[src], svg, table"))
    .some((node) => !node.closest(".katex"));
  const hasText = Boolean(stripRichHtmlToText(content).replace(/[\s.\u2026\u200b]+/g, ""));
  const image = question.imageData;
  const imageAlreadyEmbedded = image && Array.from(document.querySelectorAll("img"))
    .some((node) => node.getAttribute("src") === image);

  return <div className="space-y-3">
    {hasText || hasEmbeddedMedia ? <RichQuestionContent content={content} className={`${hasEmbeddedMedia ? "" : "line-clamp-2"} whitespace-normal text-sm leading-6 text-foreground [&_p]:my-0 [&_p]:whitespace-normal [&_div]:whitespace-normal [&_img]:max-h-[20rem] [&_img]:w-auto [&_img]:object-contain [&_.katex-display]:my-0`} /> : null}
    {image && !imageAlreadyEmbedded ? <img src={image} alt="Question preview" loading="lazy" decoding="async" className="max-h-[20rem] max-w-full rounded-sm object-contain" /> : null}
    {!hasText && !hasEmbeddedMedia && !image ? <p className="text-sm text-muted-foreground">Open question to view its content.</p> : null}
  </div>;
}

function QuestionPreview({ question, index, onOpen, onSave }: { question: PyqQuestion; index: number; onOpen: () => void; onSave: (id: number) => void }) {
  const { attempted, correct, visited } = getPyqProgress(question);
  const StatusIcon = correct ? CheckCircle2 : attempted ? XCircle : Circle;
  const statusClass = correct ? "text-emerald-500" : attempted ? "text-red-500" : visited ? "text-amber-400" : "text-muted-foreground/50";
  const displayOptions = getPyqDisplayOptions(question.question, question.options);
  return <div onClick={onOpen} className="group cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md sm:p-5"><div className="flex items-start gap-3"><div className="mt-0.5 shrink-0"><StatusIcon className={`h-5 w-5 ${statusClass}`} aria-label={correct ? "Correct" : attempted ? "Wrong" : visited ? "Visited" : "Not visited"} /></div><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted-foreground">Q{question.questionNumber || index + 1}</span><span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-[10px] font-semibold text-orange-700">{questionTypeLabel(question.questionType)}</span><QuestionYearBadge exam={question.exam} year={question.year} sourceName={question.sourceName} compact /><span className="rounded-full border border-border px-2.5 py-0.5 text-[10px] text-muted-foreground">{question.marks || "1 mark"}</span><button type="button" onClick={(event) => { event.stopPropagation(); onSave(question.id); }} className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${question.isSaved ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"}`}><Bookmark className="h-3 w-3" />{question.isSaved ? "Saved" : "Save"}</button></div><QuestionPreviewContent question={question} options={displayOptions} /></div></div></div>;
}

function QuestionPreviewLegacyUnused({ question, index, onOpen, onSave }: { question: PyqQuestion; index: number; onOpen: () => void; onSave: (id: number) => void }) {
  const { attempted, correct, visited } = getPyqProgress(question);
  const StatusIcon = correct ? CheckCircle2 : attempted ? XCircle : Circle;
  const statusClass = correct ? "text-emerald-500" : attempted ? "text-red-500" : visited ? "text-amber-400" : "text-muted-foreground/50";
  const displayOptions = getPyqDisplayOptions(question.question, question.options);
  return <div onClick={onOpen} className="group cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md sm:p-5"><div className="flex items-start gap-3"><div className="mt-0.5 shrink-0"><StatusIcon className={`h-5 w-5 ${statusClass}`} aria-label={correct ? "Correct" : attempted ? "Wrong" : visited ? "Visited" : "Not visited"} /></div><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted-foreground">Q{question.questionNumber || index + 1}</span><span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-[10px] font-semibold text-orange-700">{questionTypeLabel(question.questionType)}</span><span className="flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[10px] text-muted-foreground"><Tag className="h-2.5 w-2.5" />{formatQuestionYear(question.exam, question.year, question.sourceName)}</span><span className="rounded-full border border-border px-2.5 py-0.5 text-[10px] text-muted-foreground">{question.marks || "1 mark"}</span>{(question.timeSpentSeconds ?? 0) > 0 ? <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Timer className="h-3 w-3" />{formatTimeSpent(question.timeSpentSeconds!)}</span> : null}<button type="button" onClick={(event) => { event.stopPropagation(); onSave(question.id); }} className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${question.isSaved ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"}`}><Bookmark className="h-3 w-3" />{question.isSaved ? "Saved" : "Save"}</button></div><QuestionPreviewContent question={question} options={displayOptions} /></div></div></div>;
}

function QuestionPreviewLegacy({ question, index, onOpen, onSave }: { question: PyqQuestion; index: number; onOpen: () => void; onSave: (id: number) => void }) {
  const { attempted, correct, visited } = getPyqProgress(question);
  const statusIcon = correct ? <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="Correct" /> : attempted ? <XCircle className="h-5 w-5 text-red-500" aria-label="Wrong" /> : visited ? <Circle className="h-5 w-5 text-amber-400" aria-label="Visited" /> : <Circle className="h-5 w-5 text-muted-foreground/50" aria-label="Not visited" />;
  const displayOptions = getPyqDisplayOptions(question.question, question.options);
  return <div onClick={onOpen} className="group cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md sm:p-5"><div className="flex items-start gap-3"><div className="mt-0.5 shrink-0">{attempted ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-muted-foreground/50" />}</div><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted-foreground">Q{question.questionNumber || index + 1}</span><span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-[10px] font-semibold text-orange-700">{questionTypeLabel(question.questionType)}</span><span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"><Tag className="h-2.5 w-2.5" />{formatQuestionYear(question.exam, question.year, question.sourceName)}</span><span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{question.marks || "1 mark"}</span><button type="button" onClick={(event) => { event.stopPropagation(); onSave(question.id); }} className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${question.isSaved ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"}`}><Bookmark className="h-3 w-3" />{question.isSaved ? "Saved" : "Save"}</button></div><QuestionPreviewContent question={question} options={displayOptions} /></div></div></div>;
}

function PracticeView({ question, displayExam, index, questions, onPrevious, onNext, onSelect, onBack, onSave, onAttempt, onJamSubmit, onSaveTime, streakCount }: { question: PyqQuestion; displayExam?: string; index: number; questions: PyqQuestion[]; onPrevious: () => void; onNext: () => void; onSelect: (index: number) => void; onBack: () => void; onSave: (id: number) => void; onAttempt: (id: number, answer: AnswerValue, isCorrect: boolean, exam: string, firstSubmissionTime: number | null) => void; onJamSubmit: (id: number, answer: AnswerValue, exam: string, firstSubmissionTime: number | null) => Promise<{ submitted: boolean; alreadySubmitted: boolean; answer: AnswerValue; isCorrect: boolean }>; onSaveTime: (id: number, exam: string, seconds: number) => Promise<number>; streakCount: number }) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const wheelNavigationLocked = useRef(false);
  const wheelResetTimer = useRef<number | null>(null);
  const wheelDeltaAccumulator = useRef(0);
  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 70 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    if (deltaX < 0 && index < questions.length - 1) onNext();
    if (deltaX > 0 && index > 0) onPrevious();
  };
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const horizontalDelta = Math.abs(event.deltaX);
    const verticalDelta = Math.abs(event.deltaY);
    if (horizontalDelta === 0 || horizontalDelta < verticalDelta * 0.8 || wheelNavigationLocked.current) {
      if (!wheelNavigationLocked.current && verticalDelta > horizontalDelta) wheelDeltaAccumulator.current = 0;
      return;
    }

    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerWidth : 1;
    wheelDeltaAccumulator.current += event.deltaX * scale;
    if (Math.abs(wheelDeltaAccumulator.current) < 36) return;
    const direction = wheelDeltaAccumulator.current < 0 ? "next" : "previous";
    wheelDeltaAccumulator.current = 0;
    wheelNavigationLocked.current = true;
    if (wheelResetTimer.current !== null) window.clearTimeout(wheelResetTimer.current);
    wheelResetTimer.current = window.setTimeout(() => {
      wheelNavigationLocked.current = false;
      wheelResetTimer.current = null;
    }, 450);

    if (direction === "next" && index < questions.length - 1) onNext();
    if (direction === "previous" && index > 0) onPrevious();
  };
  useEffect(() => () => {
    if (wheelResetTimer.current !== null) window.clearTimeout(wheelResetTimer.current);
  }, []);
  const navigation = <div className="flex gap-1">{questions.map((entry, entryIndex) => {
    const { attempted: hasAttempts, correct: solved, visited } = getPyqProgress(entry);
    const segmentColor = getPyqStatusColor(entry);
    const statusLabel = hasAttempts
      ? solved ? "solved correctly" : "answered incorrectly"
      : visited ? "visited, not attempted" : "not attempted";
    return <button type="button" key={entry.id} aria-label={`Open question ${entryIndex + 1}, ${statusLabel}`} title={`Question ${entryIndex + 1}: ${statusLabel}`} onClick={() => onSelect(entryIndex)} className={`h-1.5 flex-1 rounded-full transition-all ${segmentColor} ${entryIndex === index ? "ring-2 ring-orange-300 ring-offset-1" : ""}`} />;
  })}</div>;
  return <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onWheelCapture={handleWheel} className="touch-pan-y overscroll-x-none space-y-6"><QuestionCard key={question.id} question={question} displayExam={displayExam} index={index} navigation={navigation} onSave={onSave} onAttempt={onAttempt} onJamSubmit={onJamSubmit} onSaveTime={onSaveTime} onPrevious={onPrevious} onNext={onNext} onBack={onBack} hasNext={index < questions.length - 1} streakCount={streakCount} /></div>;
}

function StreakCelebration({ milestone, onClose }: { milestone: number; onClose: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 5200);
    return () => window.clearTimeout(timeout);
  }, [milestone, onClose]);

  const stage = milestone === 3
    ? { title: "You're on a roll!", message: "3 correct in a row. Keep that focus going!", icon: Flame, palette: "from-orange-500 to-rose-500", shell: "border-orange-200 bg-orange-50 text-orange-950", accent: "text-orange-600" }
    : milestone === 5
      ? { title: "Five in a row!", message: "Brilliant consistency. Your streak is heating up!", icon: Star, palette: "from-violet-500 to-blue-500", shell: "border-violet-200 bg-violet-50 text-violet-950", accent: "text-violet-600" }
      : { title: "Perfect ten!", message: "10 correct consecutively. Incredible work!", icon: Trophy, palette: "from-amber-400 to-orange-500", shell: "border-amber-200 bg-amber-50 text-amber-950", accent: "text-amber-600" };
  const Icon = stage.icon;

  return <div className="pointer-events-none fixed inset-x-0 top-5 z-[100] flex justify-center px-4" role="status" aria-live="polite">
    <div className={`pointer-events-auto relative flex w-full max-w-md items-center gap-4 overflow-hidden rounded-2xl border p-4 shadow-2xl ${stage.shell}`}>
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${stage.palette}`} />
      <div className={`relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${stage.palette} animate-bounce`}><Icon className="h-7 w-7" /><Sparkles className="absolute -right-1 -top-1 h-4 w-4 text-amber-400" /></div>
      <div className="min-w-0 flex-1"><div className={`text-[10px] font-black uppercase tracking-[0.2em] ${stage.accent}`}>{milestone} correct streak</div><div className="mt-0.5 text-lg font-extrabold leading-tight">{stage.title}</div><p className="mt-1 text-sm opacity-80">{stage.message}</p></div>
      <button type="button" onClick={onClose} className="self-start rounded-full p-1 text-current/60 transition hover:bg-black/5 hover:text-current" aria-label="Dismiss celebration"><XCircle className="h-4 w-4" /></button>
    </div>
  </div>;
}

function ProgressStat({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-orange-100 bg-white/80 px-2.5 py-1.5 dark:border-border dark:bg-background/70 sm:px-3 sm:py-2"><p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-muted-foreground sm:text-[11px]">{label}</p><p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-foreground sm:mt-1">{value}</p></div>; }

function Loading({ text }: { text: string }) { return <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">{text}</div>; }
function ErrorBox({ message }: { message: string }) { return <div className="rounded-2xl border border-red-200 bg-red-50 py-12 text-center text-sm text-red-700">{message}</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500"><BookOpen className="mx-auto mb-2 h-7 w-7 text-slate-300" />{text}</div>; }
