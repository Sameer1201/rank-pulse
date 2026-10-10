import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart2, Users, ClipboardList, FileText, Trophy,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  Target, BookOpen, Activity, Percent, Eye,
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-origin";

const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#a855f7"];

function useAnalytics() {
  return useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/analytics`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json() as Promise<AnalyticsData>;
    },
    staleTime: 60_000,
  });
}

interface AnalyticsData {
  summary: { totalClasses: number; totalStudents: number; totalTests: number; totalSubmissions: number; avgScore: number; passRate: number; submissionRate: number };
  scoreDistribution: { range: string; count: number }[];
  classMetrics: { id: number; title: string; subject: string; enrolledCount: number; testCount: number; submissionCount: number; avgScore: number | null }[];
  testMetrics: { id: number; title: string; className: string; totalSubmissions: number; avgScore: number | null; passRate: number | null }[];
  topStudents: { id: number; fullName: string; username: string; avgScore: number }[];
  bottomStudents: { id: number; fullName: string; username: string; avgScore: number }[];
  assignmentMetrics: { id: number; title: string; className: string; totalEnrolled: number; submissionCount: number; gradedCount: number; avgGrade: number | null; submissionRate: number }[];
  attendanceSummary: { classId: number; className: string; total: number; present: number; rate: number | null }[];
}

const TABS = [
  { id: "overview", label: "Overview", icon: <BarChart2 size={14} /> },
  { id: "tests", label: "Tests", icon: <ClipboardList size={14} /> },
  { id: "students", label: "Students", icon: <Users size={14} /> },
  { id: "assignments", label: "Assignments", icon: <FileText size={14} /> },
];

function MetricCard({ label, value, sub, icon, color, trend }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string; trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card className={`border-0 shadow-sm overflow-hidden`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className="text-3xl font-bold mt-1 tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
            {icon}
          </div>
        </div>
        {trend && (
          <div className={`flex items-center gap-1 mt-3 text-xs font-medium ${trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "text-muted-foreground"}`}>
            {trend === "up" ? <TrendingUp size={12} /> : trend === "down" ? <TrendingDown size={12} /> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min((score / max) * 100, 100);
  const color = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-blue-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums w-8 text-right">{score}%</span>
    </div>
  );
}

function OverviewTab({ data }: { data: AnalyticsData }) {
  const { summary, scoreDistribution, classMetrics, attendanceSummary } = data;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total Students" value={summary.totalStudents} icon={<Users size={18} className="text-white" />} color="bg-violet-500" />
        <MetricCard label="Avg Score" value={`${summary.avgScore}%`} sub={`${summary.passRate}% pass rate`} icon={<Target size={18} className="text-white" />} color={summary.avgScore >= 70 ? "bg-emerald-500" : summary.avgScore >= 50 ? "bg-amber-500" : "bg-red-500"} />
        <MetricCard label="Submissions" value={summary.totalSubmissions} sub={`${summary.submissionRate}% completion`} icon={<ClipboardList size={18} className="text-white" />} color="bg-blue-500" />
        <MetricCard label="Active Classes" value={summary.totalClasses} sub={`${summary.totalTests} tests total`} icon={<BookOpen size={18} className="text-white" />} color="bg-indigo-500" />
      </div>

      {/* Score distribution + class bar chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart2 size={14} className="text-indigo-500" /> Score Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scoreDistribution.every((d) => d.count === 0) ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No submission data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={scoreDistribution} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="count" name="Students" radius={[4, 4, 0, 0]}>
                    {scoreDistribution.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity size={14} className="text-blue-500" /> Class Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {classMetrics.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No classes yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={classMetrics.slice(0, 6).map((c) => ({ name: c.title.slice(0, 12), score: c.avgScore ?? 0, enrolled: c.enrolledCount }))} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="score" name="Avg Score %" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attendance + class table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {attendanceSummary.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle size={14} className="text-emerald-500" /> Attendance Rates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {attendanceSummary.map((a) => (
                  <div key={a.classId} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium truncate max-w-[60%]">{a.className}</span>
                      <span className="text-muted-foreground">{a.present}/{a.total} sessions</span>
                    </div>
                    <ScoreBar score={a.rate ?? 0} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen size={14} className="text-indigo-500" /> Class Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {classMetrics.slice(0, 6).map((cls) => (
                <div key={cls.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center shrink-0">
                    <BookOpen size={13} className="text-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{cls.title}</p>
                    <p className="text-xs text-muted-foreground">{cls.enrolledCount} students · {cls.testCount} tests</p>
                  </div>
                  {cls.avgScore !== null ? (
                    <Badge variant="outline" className={`text-[11px] shrink-0 ${cls.avgScore >= 70 ? "border-emerald-300 text-emerald-700" : cls.avgScore >= 50 ? "border-amber-300 text-amber-700" : "border-red-300 text-red-700"}`}>
                      {cls.avgScore}%
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground shrink-0">No data</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TestsTab({ data }: { data: AnalyticsData }) {
  const { testMetrics, scoreDistribution } = data;

  const pieData = scoreDistribution.filter((d) => d.count > 0).map((d) => ({ name: d.range, value: d.count }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Percent size={14} className="text-violet-500" /> Score Breakdown (Pie)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No submissions yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`} labelLine={false} fontSize={10}>
                    {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp size={14} className="text-blue-500" /> Pass Rate by Test
            </CardTitle>
          </CardHeader>
          <CardContent>
            {testMetrics.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No tests yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={testMetrics.slice(0, 7).map((t) => ({ name: t.title.slice(0, 10), pass: t.passRate ?? 0, avg: t.avgScore ?? 0 }))} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="pass" name="Pass Rate %" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="avg" name="Avg Score %" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList size={14} className="text-indigo-500" /> All Tests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {testMetrics.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No tests created yet</div>
          ) : (
            <div className="space-y-2">
              {testMetrics.map((t) => (
                <div key={t.id} className="flex items-center gap-4 p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center shrink-0">
                    <ClipboardList size={14} className="text-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.className} · {t.totalSubmissions} submissions</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {t.avgScore !== null && (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Avg</p>
                        <p className={`text-sm font-bold ${t.avgScore >= 70 ? "text-emerald-600" : t.avgScore >= 50 ? "text-amber-600" : "text-red-500"}`}>{t.avgScore}%</p>
                      </div>
                    )}
                    {t.passRate !== null && (
                      <Badge className={`text-[11px] ${t.passRate >= 70 ? "bg-emerald-500 hover:bg-emerald-500" : t.passRate >= 50 ? "bg-amber-500 hover:bg-amber-500" : "bg-red-500 hover:bg-red-500"}`}>
                        {t.passRate}% pass
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StudentsTab({ data }: { data: AnalyticsData }) {
  const { topStudents, bottomStudents } = data;

  function getInitials(name: string) {
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  }

  function scoreColor(score: number) {
    if (score >= 80) return "from-emerald-500 to-teal-600";
    if (score >= 60) return "from-blue-500 to-indigo-600";
    if (score >= 40) return "from-amber-500 to-orange-600";
    return "from-red-500 to-rose-600";
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top performers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Trophy size={14} className="text-amber-500" /> Top Performers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topStudents.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No submission data yet</div>
            ) : (
              <div className="space-y-2">
                {topStudents.map((student, rank) => (
                  <div key={student.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 transition-colors">
                    <span className={`w-6 text-center text-xs font-bold shrink-0 ${rank === 0 ? "text-amber-500" : rank === 1 ? "text-slate-400" : rank === 2 ? "text-orange-500" : "text-muted-foreground"}`}>
                      #{rank + 1}
                    </span>
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${scoreColor(student.avgScore)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                      {getInitials(student.fullName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{student.fullName}</p>
                      <p className="text-xs text-muted-foreground">@{student.username}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-bold ${student.avgScore >= 70 ? "text-emerald-600" : "text-amber-600"}`}>{student.avgScore}%</p>
                      <div className="w-16 h-1 bg-muted rounded-full overflow-hidden mt-1">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${student.avgScore}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Needs attention */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" /> Needs Attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bottomStudents.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">All students performing well!</div>
            ) : (
              <div className="space-y-2">
                {bottomStudents.map((student) => (
                  <div key={student.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900 hover:bg-red-50 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-400 to-rose-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {getInitials(student.fullName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{student.fullName}</p>
                      <p className="text-xs text-muted-foreground">@{student.username}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-red-500">{student.avgScore}%</p>
                      <p className="text-[10px] text-red-400">below average</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Score comparison bar */}
      {topStudents.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart2 size={14} className="text-indigo-500" /> Student Score Comparison
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topStudents.map((s) => ({ name: s.fullName.split(" ")[0], score: s.avgScore }))} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="score" name="Avg Score %" radius={[4, 4, 0, 0]}>
                  {topStudents.map((s, i) => (
                    <Cell key={i} fill={s.avgScore >= 80 ? "#22c55e" : s.avgScore >= 60 ? "#6366f1" : "#f59e0b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AssignmentsTab({ data }: { data: AnalyticsData }) {
  const { assignmentMetrics } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText size={14} className="text-violet-500" /> Submission Rates
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assignmentMetrics.length === 0 ? (
              <div className="flex items-center justify-center h-44 text-muted-foreground text-sm">No assignments yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={assignmentMetrics.slice(0, 6).map((a) => ({ name: a.title.slice(0, 12), rate: a.submissionRate }))} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="rate" name="Submission Rate %" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target size={14} className="text-blue-500" /> Average Grades
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assignmentMetrics.filter((a) => a.avgGrade !== null).length === 0 ? (
              <div className="flex items-center justify-center h-44 text-muted-foreground text-sm">No graded assignments yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={assignmentMetrics.filter((a) => a.avgGrade !== null).slice(0, 6).map((a) => ({ name: a.title.slice(0, 12), grade: a.avgGrade }))} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="grade" name="Avg Grade" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText size={14} className="text-indigo-500" /> All Assignments
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assignmentMetrics.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No assignments created yet</div>
          ) : (
            <div className="space-y-2">
              {assignmentMetrics.map((a) => (
                <div key={a.id} className="flex items-center gap-4 p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-950/50 flex items-center justify-center shrink-0">
                    <FileText size={14} className="text-violet-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.className}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-right">
                    <div>
                      <p className="text-xs text-muted-foreground">Submitted</p>
                      <p className="text-sm font-semibold">{a.submissionCount}<span className="text-muted-foreground text-xs">/{a.totalEnrolled}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Rate</p>
                      <Badge className={`text-[11px] ${a.submissionRate >= 80 ? "bg-emerald-500 hover:bg-emerald-500" : a.submissionRate >= 50 ? "bg-amber-500 hover:bg-amber-500" : "bg-red-500 hover:bg-red-500"}`}>
                        {a.submissionRate}%
                      </Badge>
                    </div>
                    {a.avgGrade !== null && (
                      <div>
                        <p className="text-xs text-muted-foreground">Avg grade</p>
                        <p className={`text-sm font-bold ${a.avgGrade >= 70 ? "text-emerald-600" : a.avgGrade >= 50 ? "text-amber-600" : "text-red-500"}`}>{a.avgGrade}%</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function useVisitorStats() {
  return useQuery({
    queryKey: ["visitor-stats"],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/visitor/stats`), { credentials: "include" });
      if (!res.ok) return { totalVisitors: 0, todayVisitors: 0 };
      return res.json() as Promise<{ totalVisitors: number; todayVisitors: number }>;
    },
    staleTime: 60_000,
  });
}

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("overview");
  const { data, isLoading, error } = useAnalytics();
  const { data: visitorData } = useVisitorStats();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-700 p-6 text-white shadow-lg">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-white/60 text-sm mb-1">
              <BarChart2 size={14} /> Analytics & Insights
            </div>
            <h1 className="text-2xl font-bold">Teaching Analytics</h1>
            <p className="text-white/60 text-sm mt-1">Real-time performance data across all your classes and students.</p>
          </div>
          {visitorData !== undefined && (
            <div className="flex items-center gap-3 rounded-xl bg-white/10 border border-white/20 px-4 py-3 shrink-0">
              <Eye size={16} className="text-white/70" />
              <div className="text-center">
                <p className="text-lg font-bold leading-none">{visitorData.totalVisitors.toLocaleString()}</p>
                <p className="text-[11px] text-white/60 mt-0.5">Total Visitors</p>
              </div>
              <div className="w-px h-8 bg-white/20" />
              <div className="text-center">
                <p className="text-lg font-bold leading-none text-emerald-300">{(visitorData.todayVisitors ?? 0).toLocaleString()}</p>
                <p className="text-[11px] text-white/60 mt-0.5">Today</p>
              </div>
            </div>
          )}
        </div>
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-12 translate-x-12" />
        <div className="absolute bottom-0 right-16 w-32 h-32 bg-white/4 rounded-full translate-y-10" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-xl w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-950/30 text-red-600 rounded-xl text-sm border border-red-200 dark:border-red-800">
          <AlertTriangle size={15} /> Failed to load analytics data
        </div>
      )}
      {data && activeTab === "overview" && <OverviewTab data={data} />}
      {data && activeTab === "tests" && <TestsTab data={data} />}
      {data && activeTab === "students" && <StudentsTab data={data} />}
      {data && activeTab === "assignments" && <AssignmentsTab data={data} />}
    </div>
  );
}
