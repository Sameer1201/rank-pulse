import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, ScatterChart, Scatter,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ReferenceLine,
} from "recharts";
import {
  ArrowLeft, TrendingUp, Users, Award, Target, Clock, Flag, AlertTriangle,
  CheckCircle2, XCircle, BarChart3, Zap, Brain, Activity, Info,
  ChevronDown, ChevronRight, ThumbsDown, ThumbsUp, MinusCircle, Timer
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-origin";

type QuestionType = "mcq" | "multi" | "integer";
type Difficulty = "easy" | "medium" | "hard";
type Quality = "excellent" | "good" | "fair" | "poor";

interface PerQuestion {
  id: number;
  question: string;
  questionType: QuestionType;
  options: string[];
  optionImages: (string | null)[] | null;
  correctAnswer: number;
  correctAnswerMulti: number[] | null;
  correctAnswerMin: number | null;
  correctAnswerMax: number | null;
  points: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  successRate: number;
  optionCounts: number[];
  imageData: string | null;
  difficulty: Difficulty;
  quality: Quality;
  discriminationIndex: number;
  flaggedCount: number;
  avgTime: number;
  maxTime: number;
  minTime: number;
  timingsPerSub: number[];
}

interface StudentResult {
  id: number;
  studentId: number | null;
  studentName: string | null;
  studentUsername: string | null;
  score: number;
  totalPoints: number;
  percentage: number;
  passed: boolean;
  submittedAt: string | null;
  totalTime: number;
  questionResults: { qId: number; correct: boolean | null; time: number; flagged: boolean }[];
}

interface Analytics {
  test: { id: number; title: string; passingScore: number | null; durationMinutes: number };
  total: number;
  passCount: number;
  failCount: number;
  avgPercentage: number;
  avgScore: number;
  maxScore: number;
  minScore: number;
  stdDev: number;
  median: number;
  scoreDistribution: { range: string; count: number }[];
  perQuestion: PerQuestion[];
  studentBreakdown: StudentResult[];
  trendData: { date: string; submissions: number; passRate: number; avgScore: number }[];
  difficultyBreakdown: { easy: number; medium: number; hard: number };
  hardestQuestions: { id: number; question: string; successRate: number }[];
  easiestQuestions: { id: number; question: string; successRate: number }[];
  mostTimeConsuming: { id: number; question: string; avgTime: number }[];
  mostFlagged: { id: number; question: string; flaggedCount: number }[];
}

const DIFF_COLOR: Record<Difficulty, string> = { easy: "#22c55e", medium: "#f59e0b", hard: "#ef4444" };
const DIFF_BG: Record<Difficulty, string> = { easy: "bg-green-100 text-green-700", medium: "bg-amber-100 text-amber-700", hard: "bg-red-100 text-red-700" };
const QUALITY_BG: Record<Quality, string> = { excellent: "bg-indigo-100 text-indigo-700", good: "bg-green-100 text-green-700", fair: "bg-amber-100 text-amber-700", poor: "bg-red-100 text-red-700" };

function fmtTime(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function HeatmapCell({ value, label }: { value: boolean | null; label?: string }) {
  if (value === null) return <div className="w-6 h-6 rounded bg-muted/40 border border-border/30" title="Skipped" />;
  return (
    <div
      className={`w-6 h-6 rounded border ${value ? "bg-green-400 border-green-500" : "bg-red-300 border-red-400"}`}
      title={label}
    />
  );
}

function TimeHeatCell({ time, max }: { time: number; max: number }) {
  const pct = max > 0 ? time / max : 0;
  const alpha = Math.max(0.1, pct);
  return (
    <div
      className="w-6 h-6 rounded border border-blue-200"
      style={{ backgroundColor: `rgba(99,102,241,${alpha})` }}
      title={`${fmtTime(time)}`}
    />
  );
}

type Tab = "overview" | "questions" | "heatmap" | "students" | "trends";

export default function TestAnalytics() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const testId = parseInt(params.id, 10);
  const [tab, setTab] = useState<Tab>("overview");
  const [expandedQ, setExpandedQ] = useState<number | null>(null);
  const [heatmapMode, setHeatmapMode] = useState<"correct" | "time">("correct");

  const { data: analytics, isLoading, error } = useQuery<Analytics>({
    queryKey: ["test-analytics-adv", testId],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/tests/${testId}/analytics`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load analytics");
      return r.json();
    },
    enabled: !isNaN(testId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading advanced analytics...</p>
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertTriangle size={32} className="mx-auto text-destructive mb-3" />
          <p className="text-muted-foreground">Failed to load analytics.</p>
          <Button variant="outline" className="mt-3" onClick={() => setLocation("/admin/tests")}>Go Back</Button>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Overview", icon: <BarChart3 size={15} /> },
    { key: "questions", label: "Question Analysis", icon: <Brain size={15} /> },
    { key: "heatmap", label: "Answer Heatmap", icon: <Activity size={15} /> },
    { key: "students", label: "Student Results", icon: <Users size={15} /> },
    { key: "trends", label: "Trends", icon: <TrendingUp size={15} /> },
  ];

  const totalQuestions = analytics.perQuestion.length;
  const allCellTimes = analytics.studentBreakdown.flatMap((s) => s.questionResults.map((r) => r.time));
  const maxCellTime = Math.max(...allCellTimes, 0);

  const radarData = analytics.perQuestion.map((q, i) => ({
    subject: `Q${i + 1}`,
    successRate: q.successRate,
    avgTime: q.avgTime,
    flagged: analytics.total > 0 ? Math.round((q.flaggedCount / analytics.total) * 100) : 0,
  }));

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/tests")} className="gap-1.5">
          <ArrowLeft size={15} />Back
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate flex items-center gap-2">
            <BarChart3 size={20} className="text-primary shrink-0" />
            Advanced Analytics
          </h1>
          <p className="text-sm text-muted-foreground truncate">{analytics.test.title}</p>
        </div>
        <Badge variant="outline" className="shrink-0">{analytics.total} submission{analytics.total !== 1 ? "s" : ""}</Badge>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/40 p-1 rounded-xl flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {analytics.total === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-xl">
          <Users size={40} className="text-muted-foreground mb-3" />
          <p className="font-medium text-muted-foreground">No submissions yet</p>
          <p className="text-sm text-muted-foreground mt-1">Analytics will appear once students submit this test.</p>
        </div>
      ) : (
        <>
          {/* ══ OVERVIEW TAB ══ */}
          {tab === "overview" && (
            <div className="space-y-5">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Submissions", value: analytics.total, icon: <Users size={16} />, color: "blue" },
                  { label: "Pass Rate", value: `${analytics.total > 0 ? Math.round(analytics.passCount / analytics.total * 100) : 0}%`, icon: <Award size={16} />, color: "green" },
                  { label: "Avg Score", value: `${analytics.avgPercentage}%`, icon: <TrendingUp size={16} />, color: "purple" },
                  { label: "Median", value: `${analytics.median}%`, icon: <Target size={16} />, color: "orange" },
                ].map((kpi) => (
                  <div key={kpi.label} className={`bg-${kpi.color}-50 border border-${kpi.color}-200 rounded-xl p-3 text-center`}>
                    <div className={`mx-auto w-fit text-${kpi.color}-600 mb-1`}>{kpi.icon}</div>
                    <p className={`text-2xl font-bold text-${kpi.color}-700`}>{kpi.value}</p>
                    <p className={`text-xs text-${kpi.color}-600`}>{kpi.label}</p>
                  </div>
                ))}
              </div>

              {/* Stats Row 2 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="bg-muted/40 rounded-xl p-3 border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Highest Score</p>
                  <p className="text-xl font-bold text-green-600">{analytics.maxScore}%</p>
                </div>
                <div className="bg-muted/40 rounded-xl p-3 border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Lowest Score</p>
                  <p className="text-xl font-bold text-red-600">{analytics.minScore}%</p>
                </div>
                <div className="bg-muted/40 rounded-xl p-3 border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Std. Deviation</p>
                  <p className="text-xl font-bold">{analytics.stdDev}%</p>
                </div>
                <div className="bg-muted/40 rounded-xl p-3 border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Passing Mark</p>
                  <p className="text-xl font-bold">{analytics.test.passingScore == null ? "No cutoff" : `${analytics.test.passingScore}%`}</p>
                </div>
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-1.5"><BarChart3 size={14} className="text-primary" />Score Distribution</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-4">
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={analytics.scoreDistribution} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [v, "Students"]} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {analytics.scoreDistribution.map((bucket, i) => {
                            const [minLabel = "0", maxLabel = "100"] = bucket.range.replace("%", "").split("–");
                            const min = Number(minLabel);
                            const max = Number(maxLabel);
                            const fill = analytics.test.passingScore == null
                              ? "#6366f1"
                              : min >= analytics.test.passingScore
                                ? "#22c55e"
                                : max < analytics.test.passingScore
                                  ? "#ef4444"
                                  : "#f59e0b";
                            return <Cell key={i} fill={fill} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-1.5"><Award size={14} className="text-primary" />Pass vs Fail</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-4 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={[{ name: "Passed", value: analytics.passCount }, { name: "Failed", value: analytics.failCount }]}
                          cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value"
                        >
                          <Cell fill="#22c55e" />
                          <Cell fill="#ef4444" />
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v, name) => [`${v} (${analytics.total > 0 ? Math.round(Number(v) / analytics.total * 100) : 0}%)`, name]} />
                        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Difficulty Breakdown */}
              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-1.5"><Brain size={14} className="text-primary" />Question Difficulty Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                      { label: "Easy", key: "easy" as const, icon: <ThumbsUp size={16} />, color: "green" },
                      { label: "Medium", key: "medium" as const, icon: <MinusCircle size={16} />, color: "amber" },
                      { label: "Hard", key: "hard" as const, icon: <ThumbsDown size={16} />, color: "red" },
                    ].map((d) => (
                      <div key={d.key} className={`bg-${d.color}-50 border border-${d.color}-200 rounded-xl p-3 text-center`}>
                        <div className={`mx-auto w-fit text-${d.color}-600 mb-1`}>{d.icon}</div>
                        <p className={`text-2xl font-bold text-${d.color}-700`}>{analytics.difficultyBreakdown[d.key]}</p>
                        <p className={`text-xs text-${d.color}-600`}>{d.label} Questions</p>
                      </div>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart
                      data={analytics.perQuestion.map((q, i) => ({ name: `Q${i + 1}`, rate: q.successRate, diff: q.difficulty }))}
                      margin={{ top: 0, right: 8, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [`${v}%`, "Success Rate"]} />
                      <ReferenceLine y={75} stroke="#22c55e" strokeDasharray="3 3" label={{ value: "Easy", position: "right", fontSize: 9, fill: "#22c55e" }} />
                      <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Hard", position: "right", fontSize: 9, fill: "#ef4444" }} />
                      <Bar dataKey="rate" radius={[3, 3, 0, 0]}>
                        {analytics.perQuestion.map((q, i) => (
                          <Cell key={i} fill={DIFF_COLOR[q.difficulty]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Quick Insights */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-1.5"><ThumbsDown size={14} className="text-red-500" />Hardest Questions</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {analytics.hardestQuestions.map((q, i) => (
                      <div key={q.id} className="flex items-center gap-2 text-sm">
                        <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                        <p className="flex-1 text-xs truncate">{q.question}</p>
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs shrink-0">{q.successRate}%</Badge>
                      </div>
                    ))}
                    {analytics.hardestQuestions.length === 0 && <p className="text-xs text-muted-foreground">No data</p>}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-1.5"><Timer size={14} className="text-blue-500" />Most Time-Consuming</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {analytics.mostTimeConsuming.map((q, i) => (
                      <div key={q.id} className="flex items-center gap-2 text-sm">
                        <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                        <p className="flex-1 text-xs truncate">{q.question}</p>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs shrink-0">{fmtTime(q.avgTime)} avg</Badge>
                      </div>
                    ))}
                    {analytics.mostTimeConsuming.length === 0 && <p className="text-xs text-muted-foreground">No timing data</p>}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-1.5"><ThumbsUp size={14} className="text-green-500" />Easiest Questions</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {analytics.easiestQuestions.map((q, i) => (
                      <div key={q.id} className="flex items-center gap-2 text-sm">
                        <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                        <p className="flex-1 text-xs truncate">{q.question}</p>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs shrink-0">{q.successRate}%</Badge>
                      </div>
                    ))}
                    {analytics.easiestQuestions.length === 0 && <p className="text-xs text-muted-foreground">No data</p>}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-1.5"><Flag size={14} className="text-orange-500" />Most Flagged Questions</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {analytics.mostFlagged.filter((q) => q.flaggedCount > 0).map((q, i) => (
                      <div key={q.id} className="flex items-center gap-2 text-sm">
                        <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                        <p className="flex-1 text-xs truncate">{q.question}</p>
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs shrink-0">{q.flaggedCount} flags</Badge>
                      </div>
                    ))}
                    {analytics.mostFlagged.filter((q) => q.flaggedCount > 0).length === 0 && (
                      <p className="text-xs text-muted-foreground">No questions were flagged</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* ══ QUESTION ANALYSIS TAB ══ */}
          {tab === "questions" && (
            <div className="space-y-3">
              {/* Radar chart overview */}
              {analytics.perQuestion.length <= 12 && (
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-1.5"><Zap size={14} className="text-primary" />Question Radar (Success Rate %)</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="#e5e7eb" />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9 }} />
                        <Radar name="Success Rate" dataKey="successRate" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
                        <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [`${v}%`, "Success Rate"]} />
                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Per-question cards */}
              {analytics.perQuestion.map((q, idx) => (
                <div key={q.id} className="border border-border rounded-xl overflow-hidden">
                  {/* Question Header */}
                  <button
                    className={`w-full flex items-start gap-2 px-4 py-3 text-left transition-colors ${
                      q.difficulty === "easy" ? "bg-green-50 hover:bg-green-100/60"
                      : q.difficulty === "hard" ? "bg-red-50 hover:bg-red-100/60"
                      : "bg-amber-50 hover:bg-amber-100/60"
                    }`}
                    onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}
                  >
                    <span className="text-xs font-bold text-muted-foreground shrink-0 mt-0.5 w-6">Q{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug truncate">{q.question}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${DIFF_BG[q.difficulty]}`}>
                          {q.difficulty}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${QUALITY_BG[q.quality]}`}>
                          {q.quality} quality
                        </span>
                        <span className="text-xs text-muted-foreground">{q.successRate}% correct</span>
                        {q.avgTime > 0 && <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Clock size={10} />{fmtTime(q.avgTime)} avg</span>}
                        {q.flaggedCount > 0 && <span className="text-xs text-orange-600 flex items-center gap-0.5"><Flag size={10} />{q.flaggedCount} flagged</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-muted-foreground">
                      {expandedQ === q.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                  </button>

                  {/* Expanded Detail */}
                  {expandedQ === q.id && (
                    <div className="p-4 bg-background space-y-4 border-t border-border">
                      {/* Metrics row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-muted/40 rounded-lg p-2 text-center">
                          <CheckCircle2 size={14} className="mx-auto text-green-600 mb-1" />
                          <p className="text-lg font-bold text-green-700">{q.correctCount}</p>
                          <p className="text-xs text-muted-foreground">Correct</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg p-2 text-center">
                          <XCircle size={14} className="mx-auto text-red-600 mb-1" />
                          <p className="text-lg font-bold text-red-700">{q.wrongCount}</p>
                          <p className="text-xs text-muted-foreground">Wrong</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg p-2 text-center">
                          <MinusCircle size={14} className="mx-auto text-muted-foreground mb-1" />
                          <p className="text-lg font-bold">{q.skippedCount}</p>
                          <p className="text-xs text-muted-foreground">Skipped</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg p-2 text-center">
                          <Flag size={14} className="mx-auto text-orange-500 mb-1" />
                          <p className="text-lg font-bold text-orange-700">{q.flaggedCount}</p>
                          <p className="text-xs text-muted-foreground">Flagged</p>
                        </div>
                      </div>

                      {/* Time analysis */}
                      {q.avgTime > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1"><Clock size={12} />Time Analysis</p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div><p className="text-sm font-bold text-blue-700">{fmtTime(q.avgTime)}</p><p className="text-xs text-blue-600">Average</p></div>
                            <div><p className="text-sm font-bold text-blue-700">{fmtTime(q.minTime)}</p><p className="text-xs text-blue-600">Fastest</p></div>
                            <div><p className="text-sm font-bold text-blue-700">{fmtTime(q.maxTime)}</p><p className="text-xs text-blue-600">Slowest</p></div>
                          </div>
                          {q.timingsPerSub.length > 1 && (
                            <div className="mt-3">
                              <ResponsiveContainer width="100%" height={80}>
                                <BarChart data={q.timingsPerSub.map((t, i) => ({ s: `S${i + 1}`, t }))} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                                  <XAxis dataKey="s" tick={{ fontSize: 8 }} />
                                  <YAxis tick={{ fontSize: 8 }} tickFormatter={(v) => `${v}s`} />
                                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => [fmtTime(Number(v)), "Time"]} />
                                  <Bar dataKey="t" fill="#6366f1" radius={[2, 2, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Discrimination index */}
                      <div className="bg-muted/40 rounded-lg p-3">
                        <p className="text-xs font-semibold mb-1 flex items-center gap-1">
                          <Info size={12} className="text-primary" />Discrimination Index: <span className={`font-bold ${q.discriminationIndex >= 0.3 ? "text-green-700" : q.discriminationIndex >= 0.2 ? "text-amber-700" : "text-red-700"}`}>{q.discriminationIndex.toFixed(2)}</span>
                          <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${QUALITY_BG[q.quality]}`}>{q.quality}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">Measures how well this question differentiates high vs low performers. ≥0.4 excellent · ≥0.3 good · ≥0.2 fair · &lt;0.2 poor</p>
                        <div className="mt-2 h-2.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${q.discriminationIndex >= 0.4 ? "bg-indigo-500" : q.discriminationIndex >= 0.3 ? "bg-green-500" : q.discriminationIndex >= 0.2 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${Math.max(2, Math.min(100, (q.discriminationIndex + 1) / 2 * 100))}%` }}
                          />
                        </div>
                      </div>

                      {/* Option distribution for MCQ/multi */}
                      {(q.questionType === "mcq" || q.questionType === "multi") && q.options.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-2">Option Selection Distribution</p>
                          <div className="space-y-1.5">
                            {q.options.map((opt, i) => {
                              const isCorrect = q.questionType === "multi" ? (q.correctAnswerMulti ?? []).includes(i) : i === q.correctAnswer;
                              const count = q.optionCounts[i] ?? 0;
                              const pct = analytics.total > 0 ? Math.round((count / analytics.total) * 100) : 0;
                              const optImg = q.optionImages?.[i];
                              return (
                                <div key={i} className={`rounded-lg border px-3 py-2 ${isCorrect ? "border-green-300 bg-green-50" : "border-border bg-background"}`}>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs font-bold shrink-0 w-5 ${isCorrect ? "text-green-700" : "text-muted-foreground"}`}>{String.fromCharCode(65 + i)}.</span>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1 mb-1">
                                        <span className={`text-xs ${isCorrect ? "font-medium text-green-700" : "text-foreground"}`}>{opt}</span>
                                        {optImg && <img src={optImg} alt="" className="h-5 w-5 rounded object-cover border border-border/50 shrink-0" />}
                                        {isCorrect && <CheckCircle2 size={12} className="text-green-600 shrink-0" />}
                                      </div>
                                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all ${isCorrect ? "bg-green-500" : "bg-slate-400"}`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </div>
                                    <span className="text-xs font-semibold w-20 text-right shrink-0">{pct}% ({count})</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Integer type */}
                      {q.questionType === "integer" && (
                        <div className="bg-muted/40 rounded-lg p-3">
                          <p className="text-xs font-semibold mb-1">Correct Answer</p>
                          {q.correctAnswerMin !== null && q.correctAnswerMax !== null ? (
                            <p className="text-sm font-bold text-blue-700">{q.correctAnswerMin} — {q.correctAnswerMax}</p>
                          ) : (
                            <p className="text-sm font-bold text-green-700">{q.correctAnswer}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ══ HEATMAP TAB ══ */}
          {tab === "heatmap" && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity size={14} className="text-primary" />
                    Answer Pattern Heatmap
                    <div className="ml-auto flex gap-1">
                      <Button size="sm" variant={heatmapMode === "correct" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setHeatmapMode("correct")}>
                        Correct/Wrong
                      </Button>
                      <Button size="sm" variant={heatmapMode === "time" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setHeatmapMode("time")}>
                        Time Spent
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {/* Legend */}
                  <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground flex-wrap">
                    {heatmapMode === "correct" ? (
                      <>
                        <span className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-green-400 border border-green-500" />Correct</span>
                        <span className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-red-300 border border-red-400" />Wrong</span>
                        <span className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-muted/40 border border-border/30" />Skipped</span>
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-indigo-100 border border-blue-200" />Low time</span>
                        <span className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-indigo-500 border border-blue-200" />High time</span>
                      </>
                    )}
                  </div>

                  {/* Heatmap table */}
                  <div className="overflow-x-auto">
                    <table className="text-xs border-separate border-spacing-1">
                      <thead>
                        <tr>
                          <th className="text-left text-muted-foreground font-medium pr-2 text-xs w-24 min-w-24">Student</th>
                          {analytics.perQuestion.map((_, i) => (
                            <th key={i} className="text-center text-muted-foreground font-medium">Q{i + 1}</th>
                          ))}
                          {heatmapMode === "time" && <th className="text-center text-muted-foreground font-medium pl-2">Total</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.studentBreakdown.sort((a, b) => b.percentage - a.percentage).map((s) => (
                          <tr key={s.id}>
                            <td className="pr-2 py-0.5">
                              <div>
                                <p className="font-medium text-xs truncate max-w-24" title={s.studentName ?? ""}>{s.studentName ?? "Unknown"}</p>
                                <p className={`text-xs font-bold ${s.passed ? "text-green-600" : "text-red-600"}`}>{s.percentage}%</p>
                              </div>
                            </td>
                            {s.questionResults.map((r) => (
                              <td key={r.qId} className="text-center py-0.5">
                                {heatmapMode === "correct"
                                  ? <HeatmapCell value={r.correct} label={`${r.correct === null ? "Skipped" : r.correct ? "Correct" : "Wrong"}${r.flagged ? " (Flagged)" : ""}`} />
                                  : <TimeHeatCell time={r.time} max={maxCellTime} />
                                }
                              </td>
                            ))}
                            {heatmapMode === "time" && (
                              <td className="text-center py-0.5 pl-2">
                                <span className="text-xs font-medium text-blue-700">{fmtTime(s.totalTime)}</span>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Per-question time bar chart */}
              {heatmapMode === "time" && (
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-1.5"><Clock size={14} className="text-primary" />Average Time per Question</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-4">
                    <ResponsiveContainer width="100%" height={Math.max(160, totalQuestions * 28)}>
                      <BarChart
                        data={analytics.perQuestion.map((q, i) => ({ name: `Q${i + 1}`, avgTime: q.avgTime, maxTime: q.maxTime }))}
                        layout="vertical"
                        margin={{ top: 0, right: 60, left: 24, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}s`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={28} />
                        <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v, name) => [fmtTime(Number(v)), name === "avgTime" ? "Avg Time" : "Max Time"]} />
                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="avgTime" name="Avg Time" fill="#6366f1" radius={[0, 3, 3, 0]} />
                        <Bar dataKey="maxTime" name="Max Time" fill="#c4b5fd" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ══ STUDENTS TAB ══ */}
          {tab === "students" && (
            <div className="space-y-3">
              {/* Scatter: score vs time */}
              {analytics.studentBreakdown.some((s) => s.totalTime > 0) && (
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-1.5"><Zap size={14} className="text-primary" />Score vs Total Time</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-4">
                    <ResponsiveContainer width="100%" height={200}>
                      <ScatterChart margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="time" name="Time (s)" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}s`} label={{ value: "Time (s)", position: "insideBottom", offset: -2, fontSize: 10 }} />
                        <YAxis dataKey="score" name="Score %" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ strokeDasharray: "3 3" }}
                          formatter={(v, name) => [name === "time" ? fmtTime(Number(v)) : `${v}%`, name === "time" ? "Time" : "Score"]}
                        />
                        {analytics.test.passingScore != null && (
                          <ReferenceLine y={analytics.test.passingScore} stroke="#ef4444" strokeDasharray="3 3" />
                        )}
                        <Scatter
                          data={analytics.studentBreakdown.map((s) => ({ time: s.totalTime, score: s.percentage, name: s.studentName, passed: s.passed }))}
                          fill="#6366f1"
                        >
                          {analytics.studentBreakdown.map((s, i) => (
                            <Cell key={i} fill={s.passed ? "#22c55e" : "#ef4444"} />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-muted-foreground text-center mt-1">Green = Pass · Red = Fail{analytics.test.passingScore != null ? " · Dashed line = Passing mark" : ""}</p>
                  </CardContent>
                </Card>
              )}

              {/* Student table */}
              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-1.5"><Users size={14} className="text-primary" />Student Results (Ranked)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">#</th>
                          <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Student</th>
                          <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Score</th>
                          <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Correct</th>
                          <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Time</th>
                          <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...analytics.studentBreakdown].sort((a, b) => b.percentage - a.percentage).map((s, i) => {
                          const correctCount = s.questionResults.filter((r) => r.correct === true).length;
                          const skippedCount = s.questionResults.filter((r) => r.correct === null).length;
                          return (
                            <tr key={s.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                              <td className="px-4 py-3 text-xs font-bold text-muted-foreground">{i + 1}</td>
                              <td className="px-4 py-3">
                                <p className="font-medium">{s.studentName ?? "Unknown"}</p>
                                <p className="text-xs text-muted-foreground">@{s.studentUsername}</p>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-sm font-bold ${analytics.test.passingScore == null || s.percentage >= analytics.test.passingScore ? "text-green-600" : "text-red-600"}`}>
                                  {s.percentage}%
                                </span>
                                <p className="text-xs text-muted-foreground">{s.score}/{s.totalPoints} pts</p>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <p className="text-sm font-medium text-green-700">{correctCount}/{totalQuestions}</p>
                                {skippedCount > 0 && <p className="text-xs text-muted-foreground">{skippedCount} skipped</p>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className="text-sm font-medium text-blue-700">{s.totalTime > 0 ? fmtTime(s.totalTime) : "—"}</span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                {s.passed
                                  ? <span className="flex items-center justify-center gap-1 text-xs text-green-600 font-medium"><CheckCircle2 size={12} />Pass</span>
                                  : <span className="flex items-center justify-center gap-1 text-xs text-red-600 font-medium"><XCircle size={12} />Fail</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ══ TRENDS TAB ══ */}
          {tab === "trends" && (
            <div className="space-y-4">
              {analytics.trendData.length > 1 ? (
                <>
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-1.5"><TrendingUp size={14} className="text-primary" />Average Score Over Time</CardTitle>
                    </CardHeader>
                    <CardContent className="px-2 pb-4">
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={analytics.trendData} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [`${v}%`, "Avg Score"]} />
                          {analytics.test.passingScore != null && (
                            <ReferenceLine y={analytics.test.passingScore} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Pass", position: "right", fontSize: 10, fill: "#ef4444" }} />
                          )}
                          <Line type="monotone" dataKey="avgScore" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-1.5"><Award size={14} className="text-primary" />Pass Rate Over Time</CardTitle>
                    </CardHeader>
                    <CardContent className="px-2 pb-4">
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={analytics.trendData} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                          <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [`${v}%`, "Pass Rate"]} />
                          <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="3 3" />
                          <Line type="monotone" dataKey="passRate" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm flex items-center gap-1.5"><Users size={14} className="text-primary" />Submissions per Day</CardTitle>
                    </CardHeader>
                    <CardContent className="px-2 pb-4">
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={analytics.trendData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [v, "Submissions"]} />
                          <Bar dataKey="submissions" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-xl">
                  <TrendingUp size={40} className="text-muted-foreground mb-3" />
                  <p className="font-medium text-muted-foreground">Not enough data for trends</p>
                  <p className="text-sm text-muted-foreground mt-1">Trends appear when submissions span multiple dates.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
