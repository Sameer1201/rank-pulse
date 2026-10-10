import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import PendingVerificationDialog from "@/components/student/PendingVerificationDialog";
import StudentPreviewLockBanner from "@/components/student/StudentPreviewLockBanner";
import WeeklyActivityChart from "@/components/student/WeeklyActivityChart";
import PreparationOverview from "@/components/student/PreparationOverview";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatExamDisplayName } from "@/lib/exam-display";
import { isStudentFeatureLocked, isStudentPendingVerification } from "@/lib/student-access";
import {
  BrainCircuit,
  Target,
  Timer,
  Award,
  ChevronRight,
  Flame,
  Pencil,
  Check,
  X,
} from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  addDays,
  format,
  isSameDay,
  startOfWeek,
  subDays,
} from "date-fns";
import { api } from "@/lib/api";
import { isJamChemistryExam, readStudentExamSelection } from "@/lib/student-exam-selection";
import type {
  StudentQuestionBankExamResponse,
  StudentQuestionBankExamSummary,
} from "@/pages/student/question-bank/api";

type AnswerAction = "open" | "answer" | "clear" | "review";

type QuestionBankProgressSummary = {
  totalSolvedQuestions: number;
  totalAttemptedQuestions?: number;
  totalAttempts: number;
  correctAttempts: number;
  latestCorrectQuestions: number;
  accuracy: number;
  dailySolvedCounts: Array<{ date: string; questions: number }>;
  dailyAttemptedCounts?: Array<{ date: string; questions: number }>;
};

type PyqProgressSummary = {
  totalAttemptedQuestions?: number;
  totalSolvedQuestions?: number;
  totalAttempts?: number;
  correctAttempts?: number;
  dailyAttemptedCounts?: Array<{ date: string; questions: number }>;
};

interface StudentTestItem {
  id: number;
  title: string;
  durationMinutes: number;
  passingScore: number | null;
  scheduledAt: string | null;
  className: string | null;
  chapterName?: string | null;
  subjectName?: string | null;
  alreadySubmitted: boolean;
}

interface AnalysisQuestion {
  id: number;
  subjectLabel?: string | null;
  subjectName?: string | null;
  chapterName?: string | null;
  topicTag?: string | null;
  meta?: Record<string, unknown> | null;
  isCorrect: boolean;
  isSkipped: boolean;
  myTime: number;
  classSuccessRate: number;
}

interface AnalysisResponse {
  test: {
    id: number;
    title: string;
    className?: string | null;
    totalQuestions: number;
  };
  submission: {
    score: number;
    totalPoints: number;
    percentage: number;
    passed: boolean;
    submittedAt: string;
    totalTime: number;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    interactionLog?: Array<{
      at: number;
      questionId: number;
      sectionLabel: string;
      action: AnswerAction;
    }> | null;
  };
  classStats: {
    totalSubs: number;
    classAvg: number;
    classPassRate: number;
    rank: number;
    percentile: number;
  };
  perQuestion: AnalysisQuestion[];
}

type CompletedAnalysis = AnalysisResponse & {
  testItem: StudentTestItem;
};

type RecentPractice = {
  key: string;
  kind: "test" | "question-bank";
  name: string;
  date: string;
  timestamp: number;
  score: string;
  accuracy: string;
  time: string;
  path: string;
};

type FocusAreaMetrics = {
  correct: number;
  exposure: number;
  testQuestions: number;
  questionBankQuestions: number;
  questionBankAttempts: number;
};

const TIME_SERIES_COLORS = ["hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-5))"];
const DEFAULT_DAILY_GOAL = 50;
const PERFORMANCE_TREND_LINE_COLOR = "#D97706";
const PERFORMANCE_TREND_FILL_COLOR = "#F59E0B";
const SUBJECT_ACCURACY_BAR_COLOR = "#F59E0B";
const SUBJECT_PEER_BAR_COLOR = "#FCD34D";
const SUBJECT_PEER_LABEL_COLOR = "#B45309";

function safeNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function shortLabel(value: string, max = 14) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1))}…`;
}

function renderSubjectLegendLabel(value: string, index: number) {
  const color = index === 0 ? SUBJECT_ACCURACY_BAR_COLOR : SUBJECT_PEER_LABEL_COLOR;
  return <span style={{ color }}>{value}</span>;
}

function isBroadSubjectLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || ["technical", "general", "overall", "section", "subject", "all subjects"].includes(normalized);
}

function normalizeFocusKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getQuestionSubject(question: AnalysisQuestion, testItem: StudentTestItem) {
  const explicitSubjectName = typeof question.subjectName === "string" ? question.subjectName.trim() : "";
  if (explicitSubjectName && !isBroadSubjectLabel(explicitSubjectName)) return explicitSubjectName;

  const metaSubject = typeof question.meta?.subjectName === "string" ? question.meta.subjectName.trim() : "";
  if (metaSubject && !isBroadSubjectLabel(metaSubject)) return metaSubject;

  const explicitChapterName = typeof question.chapterName === "string" ? question.chapterName.trim() : "";
  if (explicitChapterName) return explicitChapterName;

  const chapterName = typeof question.meta?.chapterName === "string" ? question.meta.chapterName.trim() : "";
  if (chapterName) return chapterName;

  const explicitSubject = typeof question.subjectLabel === "string" ? question.subjectLabel.trim() : "";
  if (explicitSubject) return explicitSubject;

  return testItem.subjectName?.trim() || testItem.chapterName?.trim() || testItem.className?.trim() || "General";
}

function getQuestionTopic(question: AnalysisQuestion, testItem: StudentTestItem) {
  const explicitTopic = typeof question.topicTag === "string" ? question.topicTag.trim() : "";
  if (explicitTopic) return explicitTopic;

  const metaTopic = typeof question.meta?.topicTag === "string" ? question.meta.topicTag.trim() : "";
  if (metaTopic) return metaTopic;

  const explicitChapter = typeof question.chapterName === "string" ? question.chapterName.trim() : "";
  if (explicitChapter) return explicitChapter;

  const metaChapter = typeof question.meta?.chapterName === "string" ? question.meta.chapterName.trim() : "";
  if (metaChapter) return metaChapter;

  return getQuestionSubject(question, testItem);
}

function mergeFocusArea(
  buckets: Map<string, { topic: string; subject: string; metrics: FocusAreaMetrics }>,
  subject: string,
  topic: string,
  partial: Partial<FocusAreaMetrics>,
) {
  const resolvedSubject = subject.trim() || "General";
  const resolvedTopic = topic.trim() || resolvedSubject;
  const key = `${normalizeFocusKey(resolvedSubject)}::${normalizeFocusKey(resolvedTopic)}`;
  if (!key || key === "::") return;

  const existing = buckets.get(key) ?? {
    topic: resolvedTopic,
    subject: resolvedSubject,
    metrics: {
      correct: 0,
      exposure: 0,
      testQuestions: 0,
      questionBankQuestions: 0,
      questionBankAttempts: 0,
    },
  };

  existing.metrics.correct += safeNumber(partial.correct);
  existing.metrics.exposure += safeNumber(partial.exposure);
  existing.metrics.testQuestions += safeNumber(partial.testQuestions);
  existing.metrics.questionBankQuestions += safeNumber(partial.questionBankQuestions);
  existing.metrics.questionBankAttempts += safeNumber(partial.questionBankAttempts);

  buckets.set(key, existing);
}

function getDifficultyBucket(question: AnalysisQuestion): "easy" | "medium" | "hard" {
  const raw = typeof question.meta?.difficulty === "string" ? question.meta.difficulty.trim().toLowerCase() : "";
  if (raw.includes("easy")) return "easy";
  if (raw.includes("hard")) return "hard";
  return "medium";
}

function getQuestionBankDifficultyBucket(value: string | null | undefined): "easy" | "medium" | "hard" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.includes("easy")) return "easy";
  if (raw.includes("hard")) return "hard";
  return "medium";
}

function formatMinutes(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}m`;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getAttemptedCount(item: CompletedAnalysis) {
  return item.submission.correctCount + item.submission.wrongCount;
}

function resolveDailyGoal(value: number | undefined) {
  return Number.isInteger(value) && value && value > 0 ? value : DEFAULT_DAILY_GOAL;
}

type PendingPreviewState = {
  attemptedToday: number;
  streak: number;
  totalTestsTaken: number;
  totalQuestionBankSolved: number;
  totalPracticeQuestions: number;
  testsThisWeek: number;
  questionBankThisWeek: number;
  averageScore: number;
  averageScoreSub: string;
  avgTimeMinutes: number;
  averageTimeSub: string;
  bestScore: number;
  bestScoreTotal: number;
  bestTestTitle: string;
  performanceData: Array<{ name: string; score: number; index: number }>;
  subjectData: Array<{ subject: string; accuracy: number; avgAccuracy: number; attempted: number }>;
  timeSubjects: string[];
  timeData: Array<Record<string, string | number>>;
  difficultyData: Array<{ name: string; value: number; color: string }>;
  recentPractice: RecentPractice[];
  weakTopics: Array<{ topic: string; subject: string; accuracy: number }>;
  weeklyData: Array<{ day: string; questions: number; isToday: boolean }>;
};

function getPendingPreviewSubjects(targetExam?: string | null) {
  const exam = (targetExam ?? "").trim().toLowerCase();
  if (exam.includes("gate")) {
    return [
      "General Aptitude",
      "Engineering Mathematics",
      "Network Theory",
      "Control Systems",
      "Communication Systems",
      "Electronic Devices",
      "Signals & Systems",
      "Electromagnetics",
      "Digital Electronics",
      "Analog Circuits",
    ];
  }
  if (exam.includes("jee")) {
    return ["Physics", "Chemistry", "Mathematics", "Algebra", "Calculus", "Mechanics"];
  }
  if (exam.includes("neet")) {
    return ["Biology", "Botany", "Zoology", "Physics", "Chemistry", "Organic Chemistry"];
  }
  return ["General Aptitude", "Logical Reasoning", "Quantitative Aptitude", "Core Concepts", "Practice Sets"];
}

function buildPendingDashboardPreview(targetExam?: string | null): PendingPreviewState {
  const subjects = getPendingPreviewSubjects(targetExam);
  const weekPattern = [42, 58, 64, 51, 75, 83, 67];
  const weeklyData = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => ({
    day,
    questions: weekPattern[index] ?? 0,
    isToday: index === 6,
  }));

  const performanceData = [
    { name: "Mock 1", score: 54, index: 1 },
    { name: "Mock 2", score: 61, index: 2 },
    { name: "Mock 3", score: 58, index: 3 },
    { name: "Mock 4", score: 66, index: 4 },
    { name: "Mock 5", score: 72, index: 5 },
  ];

  const subjectData = subjects.map((subject, index) => ({
    subject,
    accuracy: Math.max(38, 76 - index * 3),
    avgAccuracy: Math.max(42, 68 - index * 2),
    attempted: Math.max(10, 42 - index * 2),
  }));

  const timeSubjects = subjects.slice(0, 3);
  const timeData = [
    { test: "Mock 1", [timeSubjects[0]]: 1.6, [timeSubjects[1]]: 1.3, [timeSubjects[2]]: 1.4 },
    { test: "Mock 2", [timeSubjects[0]]: 1.4, [timeSubjects[1]]: 1.2, [timeSubjects[2]]: 1.3 },
    { test: "Mock 3", [timeSubjects[0]]: 1.5, [timeSubjects[1]]: 1.1, [timeSubjects[2]]: 1.2 },
    { test: "Mock 4", [timeSubjects[0]]: 1.2, [timeSubjects[1]]: 1.0, [timeSubjects[2]]: 1.1 },
  ];

  const difficultyData = [
    { name: "Easy (Correct)", value: 24, color: "hsl(var(--chart-5))" },
    { name: "Medium (Correct)", value: 31, color: "hsl(var(--chart-1))" },
    { name: "Hard (Correct)", value: 14, color: "hsl(var(--chart-2))" },
    { name: "Incorrect/Unattempted", value: 19, color: "hsl(var(--muted))" },
  ];

  const label = formatExamDisplayName(targetExam) || "Practice";
  const recentPractice: RecentPractice[] = [
    { key: "preview-test-901", kind: "test", name: `${label} Preview Test 1`, date: "Apr 16, 2026", timestamp: new Date("2026-04-16").getTime(), score: "58/100", accuracy: "58%", time: "89 min", path: "/student/tests" },
    { key: "preview-test-902", kind: "test", name: `${label} Preview Test 2`, date: "Apr 17, 2026", timestamp: new Date("2026-04-17").getTime(), score: "64/100", accuracy: "64%", time: "84 min", path: "/student/tests" },
    { key: "preview-test-903", kind: "test", name: `${label} Preview Test 3`, date: "Apr 18, 2026", timestamp: new Date("2026-04-18").getTime(), score: "72/100", accuracy: "72%", time: "78 min", path: "/student/tests" },
  ];

  const weakTopics = subjects.slice(-5).map((subject, index) => ({
    topic: `${subject} Practice`,
    subject,
    accuracy: 42 + index * 4,
  }));

  return {
    attemptedToday: 67,
    streak: 6,
    totalTestsTaken: 12,
    totalQuestionBankSolved: 48,
    totalPracticeQuestions: 156,
    testsThisWeek: 3,
    questionBankThisWeek: 21,
    averageScore: 66,
    averageScoreSub: "Sample preview trend until verification is complete",
    avgTimeMinutes: 1.3,
    averageTimeSub: "Sample speed insight visible in preview mode",
    bestScore: 72,
    bestScoreTotal: 100,
    bestTestTitle: `${label} Preview Test 3`,
    performanceData,
    subjectData,
    timeSubjects,
    timeData,
    difficultyData,
    recentPractice,
    weakTopics,
    weeklyData,
  };
}

function DailyGoalTracker({
  attempted,
  syncState,
  onRetry,
  streak,
  goal,
  isEditing,
  draftGoal,
  onDraftChange,
  onEdit,
  onCancel,
  onSave,
  isSaving,
}: {
  attempted: number;
  syncState?: "loading" | "error";
  onRetry?: () => void;
  streak: number;
  goal: number;
  isEditing: boolean;
  draftGoal: string;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const progress = Math.min((attempted / goal) * 100, 100);
  const milestones = [
    { at: 0, icon: "🚶", color: "#a78bfa" },
    { at: Math.max(1, Math.round(goal * 0.25)), icon: "🏃", color: "#818cf8" },
    { at: Math.max(1, Math.round(goal * 0.5)), icon: "🏃‍♂️", color: "#38bdf8" },
    { at: Math.max(1, Math.round(goal * 0.8)), icon: "⚡", color: "#34d399" },
    { at: goal, icon: "🏁", color: "#f59e0b" },
  ];

  return (
    <div
      className="relative overflow-hidden rounded-2xl px-4 py-4 shadow-sm sm:px-6"
      style={{
        background: "linear-gradient(135deg, #6d28d9 0%, #4f46e5 45%, #0ea5e9 100%)",
      }}
    >
      <div className="relative flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:shrink-0">
          <Flame className="h-4 w-4 text-orange-300" />
          <span className="text-white font-semibold text-sm">Questions Attempted Today</span>
          {isEditing ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white/80 text-sm">
                (<span className="text-white font-bold">{syncState ? "—" : attempted}</span>/
              </span>
              <Input
                value={draftGoal}
                onChange={(event) => onDraftChange(event.target.value)}
                inputMode="numeric"
                className="h-8 w-20 border-white/20 bg-white/10 px-2 text-sm text-white placeholder:text-white/60"
                placeholder={String(goal)}
              />
              <span className="text-white/80 text-sm">Qs)</span>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/10 hover:text-white" onClick={onSave} disabled={isSaving}>
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/10 hover:text-white" onClick={onCancel} disabled={isSaving}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <span className="text-white/80 text-sm">
                (<span className="text-white font-bold">{syncState ? "—" : attempted}</span>/{goal} Qs)
              </span>
              <button
                type="button"
                className="inline-flex items-center justify-center text-white/80 transition hover:text-white"
                onClick={onEdit}
                aria-label="Edit daily goal"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </>
          )}
        </div>

        {syncState ? (
          <p className="text-sm text-white/90" role="status">
            {syncState === "loading" ? "Syncing today's attempts…" : "Could not sync today's attempts."}
            {syncState === "error" && <button type="button" className="ml-2 underline" onClick={onRetry}>Retry</button>}
          </p>
        ) : null}

        <div className={`hidden items-center gap-6 ${syncState ? "" : "sm:flex"}`}>
          <div className="relative h-3 w-full flex-1 overflow-visible rounded-full bg-white/20 sm:mx-4">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(90deg, #c4b5fd 0%, #60a5fa 50%, #34d399 100%)",
                boxShadow: "0 0 10px rgba(196,181,253,0.5)",
              }}
            />
            {milestones.map((milestone) => {
              const pct = (milestone.at / goal) * 100;
              const reached = attempted >= milestone.at;
              return (
                <div
                  key={milestone.at}
                  className="absolute top-1/2 flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm shadow-md transition-all duration-500"
                  style={{
                    left: `${pct}%`,
                    transform: "translate(-50%, -50%)",
                    backgroundColor: reached ? milestone.color : "rgba(255,255,255,0.15)",
                    borderColor: reached ? milestone.color : "rgba(255,255,255,0.25)",
                  }}
                >
                  <span style={{ fontSize: "12px", lineHeight: 1 }}>{milestone.icon}</span>
                </div>
              );
            })}
          </div>

          <div className="flex w-full items-center justify-between gap-4 text-white sm:w-auto sm:shrink-0 sm:justify-start">
            <div className="text-center">
              <p className="text-white/60 text-[10px] uppercase tracking-wide">Streak</p>
              <p className="font-bold text-sm">{streak} 🔥</p>
            </div>
            <div className="h-6 w-px bg-white/20" />
            <div className="text-center">
              <p className="text-white/60 text-[10px] uppercase tracking-wide">Progress</p>
              <p className="font-bold text-sm">{Math.round(progress)}%</p>
            </div>
          </div>
        </div>

        <div className={`space-y-3 sm:hidden ${syncState ? "hidden" : ""}`}>
          <div className="grid grid-cols-5 gap-2">
            {milestones.map((milestone) => {
              const reached = attempted >= milestone.at;
              return (
                <div key={`mobile-${milestone.at}`} className="flex flex-col items-center gap-1">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full border text-sm shadow-sm transition-all duration-500"
                    style={{
                      backgroundColor: reached ? milestone.color : "rgba(255,255,255,0.14)",
                      borderColor: reached ? milestone.color : "rgba(255,255,255,0.2)",
                    }}
                  >
                    <span style={{ fontSize: "12px", lineHeight: 1 }}>{milestone.icon}</span>
                  </div>
                  <span className="text-[10px] font-medium text-white/75">{milestone.at}</span>
                </div>
              );
            })}
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(90deg, #c4b5fd 0%, #60a5fa 50%, #34d399 100%)",
                boxShadow: "0 0 10px rgba(196,181,253,0.45)",
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-white">
            <div className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/60">Streak</p>
              <p className="mt-1 text-base font-bold">{streak} 🔥</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/60">Progress</p>
              <p className="mt-1 text-base font-bold">{Math.round(progress)}%</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingPreviewDashboard({
  preview,
  goal,
  onLockedAction,
  onOpenStatusPage,
}: {
  preview: PendingPreviewState;
  goal: number;
  onLockedAction: () => void;
  onOpenStatusPage: () => void;
}) {
  const subjectAxisAngle = preview.subjectData.length > 5 ? -18 : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Dashboard</h1>
      </div>

      <StudentPreviewLockBanner
        title="Dashboard preview locked"
        description="Sample metrics are visible for now. Tests and question bank unlock after approval."
        onCheckStatus={onOpenStatusPage}
        onOpenLocked={onLockedAction}
      />

      <DailyGoalTracker
        attempted={preview.attemptedToday}
        streak={preview.streak}
        goal={goal}
        isEditing={false}
        draftGoal={String(goal)}
        onDraftChange={() => undefined}
        onEdit={onLockedAction}
        onCancel={() => undefined}
        onSave={() => undefined}
        isSaving={false}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="hover-elevate transition-all border-l-4 border-l-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tests Taken</CardTitle>
            <div className="p-2 bg-primary/10 rounded-full">
              <Target className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{preview.totalTestsTaken}</div>
            <p className="text-xs text-muted-foreground mt-1">+{preview.testsThisWeek} this week</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate transition-all border-l-4 border-l-chart-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Average Score</CardTitle>
            <div className="p-2 bg-chart-2/10 rounded-full">
              <BrainCircuit className="h-4 w-4 text-chart-2" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{preview.averageScore}%</div>
            <p className="text-xs text-chart-5 font-medium mt-1">{preview.averageScoreSub}</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate transition-all border-l-4 border-l-chart-4">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Best Score</CardTitle>
            <div className="p-2 bg-chart-4/10 rounded-full">
              <Award className="h-4 w-4 text-chart-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {preview.bestScore}
              <span className="text-sm font-normal text-muted-foreground">/{preview.bestScoreTotal}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{preview.bestTestTitle}</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate transition-all border-l-4 border-l-chart-3">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Time / Question</CardTitle>
            <div className="p-2 bg-chart-3/10 rounded-full">
              <Timer className="h-4 w-4 text-chart-3" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMinutes(preview.avgTimeMinutes)}</div>
            <p className="text-xs text-chart-5 font-medium mt-1">{preview.averageTimeSub}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Performance Trend</CardTitle>
            <CardDescription>Sample mock trend available before verification</CardDescription>
          </CardHeader>
          <CardContent className="px-2">
            <div className="h-[240px] w-full sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={preview.performanceData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorScorePreview" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PERFORMANCE_TREND_FILL_COLOR} stopOpacity={0.32} />
                      <stop offset="95%" stopColor={PERFORMANCE_TREND_FILL_COLOR} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} dx={-10} domain={[0, 100]} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke={PERFORMANCE_TREND_LINE_COLOR}
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorScorePreview)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Subject-wise Accuracy</CardTitle>
            <CardDescription>Sample subject accuracy preview</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[240px] w-full sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={preview.subjectData} margin={{ top: 10, right: 10, left: 0, bottom: 36 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="subject"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(value) => shortLabel(String(value), 12)}
                    angle={subjectAxisAngle}
                    textAnchor={subjectAxisAngle === 0 ? "middle" : "end"}
                    interval={0}
                    height={subjectAxisAngle === 0 ? 38 : 56}
                    tickMargin={10}
                  />
                  <YAxis axisLine={false} tickLine={false} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(value) => `${value}%`} />
                  <Tooltip />
                  <Legend
                    wrapperStyle={{ paddingTop: "20px", fontSize: "12px" }}
                    formatter={(value, _entry, index) => renderSubjectLegendLabel(String(value), index)}
                  />
                  <Bar dataKey="accuracy" name="Preview Accuracy %" fill={SUBJECT_ACCURACY_BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="avgAccuracy" name="Peer Average %" fill={SUBJECT_PEER_BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Difficulty Breakdown</CardTitle>
            <CardDescription>Sample performance by question level</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center">
            <div className="h-[220px] w-full sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={preview.difficultyData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none">
                    {preview.difficultyData.map((entry, index) => (
                      <Cell key={`preview-cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid w-full grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {preview.difficultyData.map((item, index) => (
                <div key={index} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-muted-foreground truncate">{item.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Time Analysis (mins/question)</CardTitle>
            <CardDescription>Sample time spent per subject</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] w-full sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={preview.timeData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="test" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} domain={[0, 3]} />
                  <Tooltip />
                  <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                  {preview.timeSubjects.map((subject, index) => (
                    <Line
                      key={subject}
                      type="monotone"
                      dataKey={subject}
                      name={subject}
                      stroke={TIME_SERIES_COLORS[index % TIME_SERIES_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <Card className="md:col-span-2 shadow-sm border-border/60 overflow-hidden">
          <CardHeader className="bg-muted/30 border-b border-border/50">
            <CardTitle>Recent Practice</CardTitle>
            <CardDescription>Sample test and question bank activity</CardDescription>
          </CardHeader>
          <div className="space-y-3 px-4 pb-4 md:hidden">
            {preview.recentPractice.map((test) => (
              <div key={test.key} className="rounded-2xl border border-border/60 bg-background px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{test.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{test.date}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-foreground">{test.score}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Accuracy</span>
                      <span>{test.accuracy}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: test.accuracy }} />
                    </div>
                  </div>
                  <button className="shrink-0 text-xs font-semibold text-primary transition-colors hover:text-primary/80" onClick={onLockedAction}>
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/20">
                <tr>
                  <th className="px-6 py-3 font-medium">Practice</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Score</th>
                  <th className="px-6 py-3 font-medium">Accuracy</th>
                  <th className="px-6 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {preview.recentPractice.map((test) => (
                  <tr key={test.key} className="border-b border-border/50 last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-6 py-4 font-medium text-foreground">{test.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">{test.date}</td>
                    <td className="px-6 py-4 font-medium">{test.score}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span>{test.accuracy}</span>
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: test.accuracy }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-primary hover:text-primary/80 font-medium flex items-center justify-end gap-1 ml-auto text-xs transition-colors" onClick={onLockedAction}>
                        Open <ChevronRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="shadow-sm border-border/60 bg-gradient-to-br from-card to-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-destructive" />
              Priority Focus Areas
            </CardTitle>
            <CardDescription>Sample weak-topic preview before approval</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="divide-y divide-border/50">
              {preview.weakTopics.map((topic, index) => (
                <div key={`${topic.topic}-${index}`} className="flex items-center justify-between px-6 py-3 hover:bg-white/50 transition-colors">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none text-foreground">{topic.topic}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {topic.subject}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-bold text-destructive">{topic.accuracy}%</span>
                    <span className="text-[10px] text-muted-foreground">Accuracy</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>Weekly Questions Solved</CardTitle>
          <CardDescription>Sample weekly consistency view</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[160px] w-full sm:h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={preview.weeklyData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip formatter={(value: number) => [`${value} Qs`, "Solved"]} />
                <Bar dataKey="questions" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {preview.weeklyData.map((entry, index) => (
                    <Cell
                      key={`preview-week-${index}`}
                      fill={entry.isToday ? "hsl(var(--primary))" : entry.questions >= 80 ? "hsl(var(--chart-3))" : "hsl(var(--muted))"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  return isStudentPendingVerification(user) ? <PendingDashboard /> : <PreparationOverview GoalTracker={DailyGoalTracker} />;
}

function PendingDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);
  const preview = useMemo(() => buildPendingDashboardPreview(user?.subject), [user?.subject]);
  return <>
    <PendingPreviewDashboard
      preview={preview}
      goal={resolveDailyGoal(user?.profileDetails?.dashboard?.dailyQuestionGoal)}
      onLockedAction={() => setPendingDialogOpen(true)}
      onOpenStatusPage={() => setLocation("/student/pending-approval")}
    />
    <PendingVerificationDialog
      open={pendingDialogOpen}
      onOpenChange={setPendingDialogOpen}
      onCheckStatus={() => setLocation("/student/pending-approval")}
    />
  </>;
}
