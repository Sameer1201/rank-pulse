import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ClipboardList, CheckCircle2, BookOpen, Clock, TrendingUp,
  Search, Users, FileText, AlertCircle, ChevronLeft,
  Target, BarChart3, Zap, Flag, Timer, Award, ThumbsUp,
  ThumbsDown, Hash, ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { buildApiUrl } from "@/lib/api-origin";

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Test {
  id: number; title: string; isPublished: boolean;
  className: string | null; subjectName: string | null; chapterName: string | null;
  durationMinutes: number; passingScore: number | null;
  questionCount: number; submissionCount: number;
  scheduledAt: string | null; createdAt: string;
}
interface PerQuestion {
  id: number; question: string; questionType: string;
  correctCount: number; wrongCount: number; skippedCount: number;
  successRate: number; difficulty: "easy" | "medium" | "hard";
  quality: "excellent" | "good" | "fair" | "poor";
  discriminationIndex: number; flaggedCount: number;
  avgTime: number; optionCounts: number[];
}
interface StudentBreakdown {
  id: number; studentId: number | null; studentName: string | null;
  studentUsername: string | null; score: number; totalPoints: number | null;
  percentage: number; passed: boolean | null; submittedAt: string | null;
  totalTime: number;
  questionResults: { qId: number; correct: boolean | null; time: number; flagged: boolean }[];
}
interface Analytics {
  test: { id: number; title: string; passingScore: number | null; durationMinutes: number };
  total: number; passCount: number; failCount: number;
  avgPercentage: number; avgScore: number; maxScore: number; minScore: number;
  stdDev: number; median: number;
  scoreDistribution: { range: string; count: number }[];
  perQuestion: PerQuestion[];
  studentBreakdown: StudentBreakdown[];
  trendData: { date: string; submissions: number; passRate: number; avgScore: number }[];
  difficultyBreakdown: { easy: number; medium: number; hard: number };
  hardestQuestions: { id: number; question: string; successRate: number }[];
  easiestQuestions: { id: number; question: string; successRate: number }[];
  mostTimeConsuming: { id: number; question: string; avgTime: number }[];
  mostFlagged: { id: number; question: string; flaggedCount: number }[];
}

type FilterTab = "all" | "published" | "draft";
type SortKey = "newest" | "submissions" | "questions" | "name";

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmtTime = (sec: number) => sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/* ─── Mini reusable visuals ──────────────────────────────────────────────── */
function ProgressBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${clamp(value, 0, 100)}%` }} />
    </div>
  );
}

function DiffBadge({ d }: { d: PerQuestion["difficulty"] }) {
  const map = { easy: "bg-emerald-100 text-emerald-700", medium: "bg-amber-100 text-amber-700", hard: "bg-red-100 text-red-700" };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${map[d]}`}>{d}</span>;
}

function QualityBadge({ q }: { q: PerQuestion["quality"] }) {
  const map = { excellent: "text-emerald-600", good: "text-blue-600", fair: "text-amber-600", poor: "text-red-500" };
  return <span className={`text-[11px] font-semibold ${map[q]}`}>{q}</span>;
}

/* ─── SVG Score Distribution Chart ──────────────────────────────────────── */
function ScoreDistributionChart({ data }: { data: { range: string; count: number }[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const w = 320; const h = 120; const barW = 44; const gap = 16; const padL = 28; const padB = 32; const padT = 8;
  const chartH = h - padB - padT;
  const colors = ["#ef4444", "#f97316", "#eab308", "#3b82f6", "#22c55e"];
  const total = data.reduce((a, d) => a + d.count, 0);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 140 }}>
      {data.map((d, i) => {
        const barH = total === 0 ? 0 : (d.count / maxCount) * chartH;
        const x = padL + i * (barW + gap);
        const y = padT + chartH - barH;
        const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
        return (
          <g key={d.range}>
            {/* Bar */}
            <rect x={x} y={y} width={barW} height={barH} rx={4} fill={colors[i]} fillOpacity={0.85} />
            {/* Count label on bar */}
            {d.count > 0 && (
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={10} fill={colors[i]} fontWeight="700">
                {d.count}
              </text>
            )}
            {/* Range label */}
            <text x={x + barW / 2} y={h - 14} textAnchor="middle" fontSize={9} fill="#94a3b8" fontWeight="500">
              {d.range}
            </text>
            {/* % label */}
            {pct > 0 && (
              <text x={x + barW / 2} y={h - 3} textAnchor="middle" fontSize={8} fill="#cbd5e1">
                {pct}%
              </text>
            )}
          </g>
        );
      })}
      {/* Y-axis label */}
      <text x={10} y={padT + chartH / 2} textAnchor="middle" fontSize={9} fill="#94a3b8" transform={`rotate(-90, 10, ${padT + chartH / 2})`}>
        students
      </text>
    </svg>
  );
}

/* ─── SVG Trend Chart ────────────────────────────────────────────────────── */
function TrendChart({ data }: { data: { date: string; avgScore: number; passRate: number; submissions: number }[] }) {
  if (data.length < 2) return null;
  const w = 400; const h = 100; const padL = 32; const padR = 12; const padT = 10; const padB = 24;
  const chartW = w - padL - padR; const chartH = h - padT - padB;
  const maxScore = Math.max(...data.map((d) => d.avgScore), 1);
  const xStep = chartW / (data.length - 1);

  const scorePoints = data.map((d, i) => ({ x: padL + i * xStep, y: padT + chartH - (d.avgScore / 100) * chartH }));
  const passPoints = data.map((d, i) => ({ x: padL + i * xStep, y: padT + chartH - (d.passRate / 100) * chartH }));

  const polyline = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 110 }}>
      {/* Grid lines */}
      {[0, 25, 50, 75, 100].map((pct) => {
        const y = padT + chartH - (pct / 100) * chartH;
        return (
          <g key={pct}>
            <line x1={padL} y1={y} x2={padL + chartW} y2={y} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padL - 4} y={y + 3} fontSize={8} fill="#94a3b8" textAnchor="end">{pct}</text>
          </g>
        );
      })}
      {/* Pass rate line */}
      <polyline points={polyline(passPoints)} fill="none" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.7} />
      {/* Avg score line */}
      <polyline points={polyline(scorePoints)} fill="none" stroke="#6366f1" strokeWidth={2} />
      {/* Dots */}
      {scorePoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#6366f1" />
      ))}
      {/* X labels (first + last + middle) */}
      {[0, Math.floor(data.length / 2), data.length - 1]
        .filter((i, _, arr) => arr.indexOf(i) === arr.lastIndexOf(i))
        .map((i) => (
          <text key={i} x={padL + i * xStep} y={h - 4} fontSize={8} fill="#94a3b8" textAnchor="middle">
            {format(new Date(data[i].date), "dd MMM")}
          </text>
        ))}
      {/* Legend */}
      <circle cx={padL} cy={padT - 2} r={3} fill="#6366f1" />
      <text x={padL + 6} y={padT + 1} fontSize={8} fill="#6366f1">Avg score</text>
      <line x1={padL + 60} y1={padT - 2} x2={padL + 75} y2={padT - 2} stroke="#22c55e" strokeWidth={1.5} strokeDasharray="3 1" />
      <text x={padL + 78} y={padT + 1} fontSize={8} fill="#22c55e">Pass rate</text>
    </svg>
  );
}

/* ─── Student × Question Heatmap ─────────────────────────────────────────── */
function QuestionHeatmap({ students, questions }: {
  students: StudentBreakdown[];
  questions: PerQuestion[];
}) {
  const MAX_STUDENTS = 20;
  const MAX_QS = 30;
  const shown = students.slice(0, MAX_STUDENTS);
  const shownQs = questions.slice(0, MAX_QS);
  const cellSize = 18;
  const labelW = 100;
  const headerH = 24;

  return (
    <div className="overflow-auto">
      <svg
        viewBox={`0 0 ${labelW + shownQs.length * cellSize + 4} ${headerH + shown.length * cellSize + 4}`}
        style={{ minWidth: labelW + shownQs.length * cellSize + 4, minHeight: headerH + shown.length * cellSize + 4 }}
      >
        {/* Q# column headers */}
        {shownQs.map((q, qi) => (
          <text key={q.id} x={labelW + qi * cellSize + cellSize / 2} y={headerH - 6} fontSize={8} fill="#94a3b8" textAnchor="middle">
            {qi + 1}
          </text>
        ))}
        {/* Student rows */}
        {shown.map((s, si) => (
          <g key={s.id}>
            {/* Name label */}
            <text
              x={labelW - 4} y={headerH + si * cellSize + cellSize / 2 + 3}
              fontSize={9} fill="#64748b" textAnchor="end"
            >
              {(s.studentName ?? "?").split(" ")[0].slice(0, 12)}
            </text>
            {/* Cells */}
            {shownQs.map((q, qi) => {
              const result = s.questionResults.find((r) => r.qId === q.id);
              const fill = result === undefined || result.correct === null
                ? "#f1f5f9"
                : result.correct ? "#86efac" : "#fca5a5";
              const borderColor = result?.flagged ? "#f97316" : "white";
              return (
                <rect
                  key={q.id}
                  x={labelW + qi * cellSize + 1}
                  y={headerH + si * cellSize + 1}
                  width={cellSize - 2}
                  height={cellSize - 2}
                  rx={2}
                  fill={fill}
                  stroke={borderColor}
                  strokeWidth={result?.flagged ? 1.5 : 0}
                />
              );
            })}
          </g>
        ))}
      </svg>
      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#86efac] inline-block" />Correct</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#fca5a5] inline-block" />Wrong</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#f1f5f9] inline-block" />Skipped</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-orange-400 inline-block" />Flagged</span>
      </div>
    </div>
  );
}

/* ─── Analytics Detail Panel ─────────────────────────────────────────────── */
function TestAnalyticsPanel({ test, onBack }: { test: Test; onBack: () => void }) {
  const [qSort, setQSort] = useState<"order" | "difficulty" | "successRate" | "time">("order");
  const [qSortDir, setQSortDir] = useState<"asc" | "desc">("asc");
  const [showHeatmap, setShowHeatmap] = useState(false);

  const { data: analytics, isLoading } = useQuery<Analytics>({
    queryKey: ["sa-test-analytics", test.id],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/tests/${test.id}/analytics`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load analytics");
      return r.json();
    },
    staleTime: 60_000,
  });

  const sortedQuestions = useMemo(() => {
    if (!analytics) return [];
    const list = [...analytics.perQuestion];
    const dir = qSortDir === "asc" ? 1 : -1;
    if (qSort === "difficulty") {
      const rank = { easy: 0, medium: 1, hard: 2 };
      list.sort((a, b) => dir * (rank[a.difficulty] - rank[b.difficulty]));
    } else if (qSort === "successRate") {
      list.sort((a, b) => dir * (a.successRate - b.successRate));
    } else if (qSort === "time") {
      list.sort((a, b) => dir * (a.avgTime - b.avgTime));
    }
    return list;
  }, [analytics, qSort, qSortDir]);

  const toggleSort = (col: typeof qSort) => {
    if (qSort === col) setQSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setQSort(col); setQSortDir("desc"); }
  };

  const SortTh = ({ col, children }: { col: typeof qSort; children: React.ReactNode }) => (
    <th
      className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 whitespace-nowrap"
      onClick={() => toggleSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {qSort === col ? (
          qSortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
        ) : <span className="opacity-30"><ChevronDown size={11} /></span>}
      </span>
    </th>
  );

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded-xl" />
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-2xl" />)}
        </div>
        <div className="h-40 bg-muted rounded-2xl" />
        <div className="h-64 bg-muted rounded-2xl" />
      </div>
    );
  }

  if (!analytics) return null;

  const { total, passCount, avgPercentage, median, maxScore, minScore, stdDev, scoreDistribution,
    difficultyBreakdown, perQuestion, studentBreakdown, trendData,
    hardestQuestions, easiestQuestions, mostFlagged, mostTimeConsuming } = analytics;

  const passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;
  const sortedStudents = [...studentBreakdown].sort((a, b) => b.percentage - a.percentage);

  return (
    <div className="space-y-6">
      {/* Breadcrumb / back */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-slate-900 transition-colors"
        >
          <ChevronLeft size={16} />
          Tests Overview
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-semibold text-slate-900 truncate max-w-xs">{test.title}</span>
        <Badge variant={test.isPublished ? "default" : "secondary"} className="text-[10px]">
          {test.isPublished ? "Published" : "Draft"}
        </Badge>
      </div>

      {/* Test meta chips */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {test.className && (
          <span className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full border border-purple-100">
            <BookOpen size={10} /> {test.className}
          </span>
        )}
        {test.subjectName && (
          <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full border border-blue-100">
            {test.subjectName}
          </span>
        )}
        {test.chapterName && (
          <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full border border-indigo-100">
            {test.chapterName}
          </span>
        )}
        <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
          <Hash size={10} /> {test.questionCount} questions
        </span>
        <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
          <Clock size={10} /> {test.durationMinutes} min
        </span>
        {test.passingScore != null && (
          <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
            <Target size={10} /> Pass: {test.passingScore}%
          </span>
        )}
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: "Submissions", value: total, icon: <Users size={15} className="text-blue-500" />, bg: "bg-blue-50", val: `${total}` },
          { label: "Pass Rate", value: passRate, icon: <CheckCircle2 size={15} className="text-emerald-500" />, bg: "bg-emerald-50", val: `${passRate}%` },
          { label: "Avg Score", value: avgPercentage, icon: <TrendingUp size={15} className="text-violet-500" />, bg: "bg-violet-50", val: `${avgPercentage}%` },
          { label: "Median", value: median, icon: <BarChart3 size={15} className="text-sky-500" />, bg: "bg-sky-50", val: `${median}%` },
          { label: "Top Score", value: maxScore, icon: <Award size={15} className="text-amber-500" />, bg: "bg-amber-50", val: `${maxScore}%` },
          { label: "Std Dev", value: stdDev, icon: <Zap size={15} className="text-slate-400" />, bg: "bg-slate-50", val: `±${stdDev}` },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-3 flex flex-col gap-1 shadow-sm">
            <div className={`w-7 h-7 rounded-lg ${s.bg} flex items-center justify-center`}>{s.icon}</div>
            <p className="text-[10px] text-muted-foreground font-medium mt-1">{s.label}</p>
            <p className="text-xl font-bold text-slate-900 leading-none">{s.val}</p>
          </div>
        ))}
      </div>

      {total === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <Users size={36} className="mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No submissions yet for this test.</p>
        </div>
      ) : (
        <>
          {/* ── Score Distribution + Difficulty ── */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <BarChart3 size={14} className="text-violet-500" /> Score Distribution
              </p>
              <ScoreDistributionChart data={scoreDistribution} />
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
              <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Target size={14} className="text-amber-500" /> Question Difficulty
              </p>
              <div className="space-y-3">
                {[
                  { label: "Easy", count: difficultyBreakdown.easy, total: perQuestion.length, color: "bg-emerald-500", text: "text-emerald-700" },
                  { label: "Medium", count: difficultyBreakdown.medium, total: perQuestion.length, color: "bg-amber-500", text: "text-amber-700" },
                  { label: "Hard", count: difficultyBreakdown.hard, total: perQuestion.length, color: "bg-red-500", text: "text-red-700" },
                ].map((d) => (
                  <div key={d.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-semibold ${d.text}`}>{d.label}</span>
                      <span className="text-xs text-muted-foreground">{d.count} / {d.total}</span>
                    </div>
                    <ProgressBar
                      value={d.total > 0 ? (d.count / d.total) * 100 : 0}
                      color={d.color}
                    />
                  </div>
                ))}
              </div>

              {/* Min / Max range */}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">Range:</span>
                <span className="text-xs font-semibold text-red-500">{minScore}%</span>
                <div className="flex-1 h-1 rounded-full bg-gradient-to-r from-red-400 via-amber-400 to-emerald-400" />
                <span className="text-xs font-semibold text-emerald-600">{maxScore}%</span>
              </div>
            </div>
          </div>

          {/* ── Trend over time ── */}
          {trendData.length >= 2 && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <TrendingUp size={14} className="text-indigo-500" /> Submission Trend
              </p>
              <TrendChart data={trendData} />
            </div>
          )}

          {/* ── Insight Cards ── */}
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {[
              {
                title: "Hardest Questions", icon: <ThumbsDown size={13} className="text-red-500" />, bg: "bg-red-50 border-red-100",
                items: hardestQuestions.map((q) => ({ label: q.question, value: `${q.successRate}%`, valueClass: "text-red-600" })),
              },
              {
                title: "Easiest Questions", icon: <ThumbsUp size={13} className="text-emerald-500" />, bg: "bg-emerald-50 border-emerald-100",
                items: easiestQuestions.map((q) => ({ label: q.question, value: `${q.successRate}%`, valueClass: "text-emerald-600" })),
              },
              {
                title: "Most Flagged", icon: <Flag size={13} className="text-orange-500" />, bg: "bg-orange-50 border-orange-100",
                items: mostFlagged.map((q) => ({ label: q.question, value: `${q.flaggedCount} flags`, valueClass: "text-orange-600" })),
              },
              {
                title: "Slowest Questions", icon: <Timer size={13} className="text-blue-500" />, bg: "bg-blue-50 border-blue-100",
                items: mostTimeConsuming.map((q) => ({ label: q.question, value: fmtTime(q.avgTime), valueClass: "text-blue-600" })),
              },
            ].map((card) => (
              <div key={card.title} className={`rounded-2xl border p-4 ${card.bg}`}>
                <p className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
                  {card.icon} {card.title}
                </p>
                <div className="space-y-2">
                  {card.items.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">—</p>
                  ) : card.items.map((item, i) => (
                    <div key={i}>
                      <p className="text-[11px] text-slate-700 line-clamp-1 leading-tight">{item.label}</p>
                      <p className={`text-[11px] font-bold ${item.valueClass}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ── Per-Question Table ── */}
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <ClipboardList size={14} className="text-primary" /> Per-Question Breakdown
                <span className="text-[11px] font-normal text-muted-foreground">({perQuestion.length} questions)</span>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Question</th>
                    <SortTh col="difficulty">Difficulty</SortTh>
                    <SortTh col="successRate">Success %</SortTh>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">C / W / S</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Quality</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">DI</th>
                    <SortTh col="time">Avg Time</SortTh>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      <Flag size={10} className="inline mr-1" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedQuestions.map((q, idx) => (
                    <tr key={q.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-3 py-2.5 text-[11px] text-slate-400 font-mono">{idx + 1}</td>
                      <td className="px-3 py-2.5 max-w-[200px]">
                        <p className="text-[12px] text-slate-800 line-clamp-2 leading-snug">
                          {q.question.replace(/<[^>]+>/g, "").slice(0, 100) + (q.question.length > 100 ? "…" : "")}
                        </p>
                      </td>
                      <td className="px-3 py-2.5"><DiffBadge d={q.difficulty} /></td>
                      <td className="px-3 py-2.5 w-28">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${q.successRate >= 60 ? "text-emerald-600" : q.successRate >= 35 ? "text-amber-600" : "text-red-500"}`}>
                            {q.successRate}%
                          </span>
                          <div className="flex-1">
                            <ProgressBar
                              value={q.successRate}
                              color={q.successRate >= 60 ? "bg-emerald-500" : q.successRate >= 35 ? "bg-amber-500" : "bg-red-500"}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] font-mono whitespace-nowrap">
                        <span className="text-emerald-600">{q.correctCount}</span>
                        <span className="text-slate-300 mx-0.5">/</span>
                        <span className="text-red-500">{q.wrongCount}</span>
                        <span className="text-slate-300 mx-0.5">/</span>
                        <span className="text-slate-400">{q.skippedCount}</span>
                      </td>
                      <td className="px-3 py-2.5"><QualityBadge q={q.quality} /></td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[11px] font-bold ${q.discriminationIndex >= 0.3 ? "text-emerald-600" : q.discriminationIndex >= 0.1 ? "text-amber-600" : "text-red-500"}`}>
                          {q.discriminationIndex.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-500 whitespace-nowrap">{fmtTime(q.avgTime)}</td>
                      <td className="px-3 py-2.5">
                        {q.flaggedCount > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-orange-500">
                            <Flag size={9} />{q.flaggedCount}
                          </span>
                        ) : <span className="text-slate-200">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Student Leaderboard ── */}
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Award size={14} className="text-amber-500" /> Student Leaderboard
                <span className="text-[11px] font-normal text-muted-foreground">({total} submissions)</span>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-8">Rank</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Student</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Score</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wider">%</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Result</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Time</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedStudents.map((s, rank) => {
                    const medal = rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : null;
                    return (
                      <tr key={s.id} className={`hover:bg-slate-50/60 transition-colors ${rank < 3 ? "bg-amber-50/30" : ""}`}>
                        <td className="px-3 py-2.5 text-center">
                          {medal
                            ? <span className="text-base">{medal}</span>
                            : <span className="text-[11px] font-bold text-slate-400">{rank + 1}</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-[12px] font-semibold text-slate-800">{s.studentName ?? "—"}</p>
                          <p className="text-[10px] text-muted-foreground">@{s.studentUsername ?? "?"}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center text-[12px] font-bold text-slate-700">
                          {s.score}
                          <span className="text-muted-foreground font-normal text-[10px]">/{s.totalPoints ?? "?"}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[13px] font-bold ${s.percentage >= 60 ? "text-emerald-600" : s.percentage >= 35 ? "text-amber-600" : "text-red-500"}`}>
                            {s.percentage}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {s.passed === true
                            ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">✓ Pass</span>
                            : s.passed === false
                              ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">✗ Fail</span>
                              : <span className="text-muted-foreground text-[10px]">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center text-[11px] text-slate-500">
                          {s.totalTime > 0 ? fmtTime(s.totalTime) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-400">
                          {s.submittedAt ? format(new Date(s.submittedAt), "dd MMM, h:mm a") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Heatmap Toggle ── */}
          {studentBreakdown.length > 0 && perQuestion.length > 0 && (
            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <button
                onClick={() => setShowHeatmap((v) => !v)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <Hash size={14} className="text-primary" /> Student × Question Heatmap
                  <span className="text-[11px] font-normal text-muted-foreground">
                    (up to 20 students × 30 questions)
                  </span>
                </p>
                {showHeatmap ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </button>
              {showHeatmap && (
                <div className="px-5 pb-5 border-t border-border">
                  <div className="mt-4 overflow-auto">
                    <QuestionHeatmap students={studentBreakdown} questions={perQuestion} />
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Main List View ─────────────────────────────────────────────────────── */
export default function SuperAdminTests() {
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [sortBy, setSortBy] = useState<SortKey>("newest");

  const { data: tests = [], isLoading } = useQuery<Test[]>({
    queryKey: ["sa-tests"],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/tests`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const published = tests.filter((t) => t.isPublished).length;
  const totalClasses = new Set(tests.map((t) => t.className).filter(Boolean)).size;
  const totalSubmissions = tests.reduce((a, t) => a + (t.submissionCount ?? 0), 0);
  const totalQuestions = tests.reduce((a, t) => a + (t.questionCount ?? 0), 0);

  const filtered = useMemo(() => {
    let list = tests;
    if (filterTab === "published") list = list.filter((t) => t.isPublished);
    if (filterTab === "draft") list = list.filter((t) => !t.isPublished);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.className ?? "").toLowerCase().includes(q) ||
        (t.subjectName ?? "").toLowerCase().includes(q) ||
        (t.chapterName ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    if (sortBy === "submissions") sorted.sort((a, b) => (b.submissionCount ?? 0) - (a.submissionCount ?? 0));
    else if (sortBy === "questions") sorted.sort((a, b) => (b.questionCount ?? 0) - (a.questionCount ?? 0));
    else if (sortBy === "name") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sorted;
  }, [tests, filterTab, search, sortBy]);

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: tests.length },
    { key: "published", label: "Published", count: published },
    { key: "draft", label: "Draft", count: tests.length - published },
  ];

  /* Show analytics panel */
  if (selectedTest) {
    return (
      <div className="space-y-6">
        <TestAnalyticsPanel test={selectedTest} onBack={() => setSelectedTest(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList size={22} className="text-primary" /> Tests Overview
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Platform-wide test analytics — click any test for deep insights</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Tests", value: tests.length, icon: <FileText size={15} className="text-blue-600" />, bg: "bg-blue-50", color: "text-blue-700" },
          { label: "Published", value: published, icon: <CheckCircle2 size={15} className="text-emerald-600" />, bg: "bg-emerald-50", color: "text-emerald-700" },
          { label: "Draft", value: tests.length - published, icon: <Clock size={15} className="text-amber-600" />, bg: "bg-amber-50", color: "text-amber-700" },
          { label: "Total Submissions", value: totalSubmissions, icon: <Users size={15} className="text-violet-600" />, bg: "bg-violet-50", color: "text-violet-700" },
          { label: "Total Questions", value: totalQuestions, icon: <Hash size={15} className="text-slate-500" />, bg: "bg-slate-100", color: "text-slate-700" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3 shadow-sm">
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center shrink-0`}>{s.icon}</div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                filterTab === tab.key
                  ? "bg-white shadow-sm text-slate-900"
                  : "text-muted-foreground hover:text-slate-700"
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                filterTab === tab.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-60">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search tests…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm rounded-xl" />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="newest">Newest</option>
            <option value="submissions">Most Submissions</option>
            <option value="questions">Most Questions</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>

      {/* Test Table */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-2xl bg-muted animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle size={32} className="text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">{search ? "No tests match your search." : "No tests yet."}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          {/* Table head (desktop) */}
          <div className="hidden md:grid grid-cols-[1fr_80px_72px_80px_80px_100px_110px] gap-2 px-4 py-2.5 bg-muted/40 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Test</span>
            <span className="text-center">Status</span>
            <span className="text-center">Qns</span>
            <span className="text-center">Submissions</span>
            <span className="text-center">Duration</span>
            <span className="text-center">Created</span>
            <span className="text-center">Analytics</span>
          </div>

          <div className="divide-y divide-border">
            {filtered.map((test) => (
              <div
                key={test.id}
                className="grid md:grid-cols-[1fr_80px_72px_80px_80px_100px_110px] gap-2 px-4 py-3.5 items-center hover:bg-muted/25 transition-colors group"
              >
                {/* Title + chips */}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 leading-snug truncate">{test.title}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {test.className && (
                      <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded-full border border-purple-100">{test.className}</span>
                    )}
                    {test.subjectName && (
                      <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-100">{test.subjectName}</span>
                    )}
                    {test.chapterName && (
                      <span className="text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full border border-indigo-100">{test.chapterName}</span>
                    )}
                    {/* Mobile inline stats */}
                    <span className="md:hidden text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                      {test.questionCount}Q · {test.submissionCount} subs
                    </span>
                  </div>
                </div>

                {/* Status */}
                <div className="hidden md:flex justify-center">
                  <Badge variant={test.isPublished ? "default" : "secondary"} className="text-[10px] px-2 py-0.5">
                    {test.isPublished ? "Live" : "Draft"}
                  </Badge>
                </div>

                {/* Questions */}
                <div className="hidden md:flex justify-center">
                  <span className="text-xs font-semibold text-slate-700">{test.questionCount}</span>
                </div>

                {/* Submissions */}
                <div className="hidden md:flex justify-center">
                  <span className={`text-xs font-bold ${test.submissionCount > 0 ? "text-violet-600" : "text-slate-300"}`}>
                    {test.submissionCount}
                  </span>
                </div>

                {/* Duration */}
                <div className="hidden md:flex justify-center">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock size={10} />{test.durationMinutes}m
                  </span>
                </div>

                {/* Date */}
                <div className="hidden md:flex justify-center">
                  <span className="text-[11px] text-muted-foreground">
                    {format(new Date(test.scheduledAt ?? test.createdAt), "dd MMM yy")}
                  </span>
                </div>

                {/* Analytics button */}
                <div className="flex md:justify-center">
                  <button
                    onClick={() => setSelectedTest(test)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 transition-colors shadow-sm"
                    data-testid={`button-sa-results-${test.id}`}
                  >
                    <BarChart3 size={12} /> Deep Dive
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-muted/20 border-t border-border text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1">
              <FileText size={11} />
              {filtered.length === tests.length ? `${tests.length} tests` : `${filtered.length} of ${tests.length} tests`}
            </span>
            <span>{totalClasses} classes</span>
          </div>
        </div>
      )}
    </div>
  );
}
