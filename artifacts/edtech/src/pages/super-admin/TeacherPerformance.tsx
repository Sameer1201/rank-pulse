import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatExamDisplayName } from "@/lib/exam-display";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Trophy, Users, ClipboardList, Star,
  TrendingUp, ChevronUp, ChevronDown, ChevronsUpDown,
  GraduationCap, Zap, Medal, MessageSquare, ListChecks,
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-origin";

interface TeacherStat {
  id: number;
  fullName: string;
  username: string;
  subject: string | null;
  email: string | null;
  status: string;
  uniqueStudents: number;
  testsCount: number;
  testSubmissions: number;
  avgScore: number | null;
  rankingScore: number;
}

type SortKey =
  | "rankingScore"
  | "uniqueStudents"
  | "testsCount"
  | "testSubmissions"
  | "avgScore";

const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ReactNode }[] = [
  { key: "rankingScore", label: "Ranking Score", icon: <Zap size={13} /> },
  { key: "uniqueStudents", label: "Students", icon: <Users size={13} /> },
  { key: "testsCount", label: "Tests", icon: <ClipboardList size={13} /> },
  { key: "testSubmissions", label: "Attempts", icon: <ListChecks size={13} /> },
  { key: "avgScore", label: "Avg Score", icon: <TrendingUp size={13} /> },
];

const RANK_COLORS = [
  "from-amber-400 to-yellow-500",
  "from-slate-400 to-slate-500",
  "from-orange-400 to-amber-600",
];

const BAR_COLORS = [
  "#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4",
  "#10b981", "#84cc16", "#f59e0b", "#ef4444",
];

function getInitials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").toUpperCase().slice(0, 2);
}

function MetricPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${color} text-xs font-medium`}>
      {icon}
      <span>{label}:</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function StarRatingDisplay({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((index) => (
        <Star
          key={index}
          size={11}
          className={index <= Math.round(value) ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30"}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{value.toFixed(1)}</span>
    </div>
  );
}

function SortButton({
  label,
  sortKey,
  current,
  dir,
  onChange,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onChange: (key: SortKey) => void;
}) {
  const isActive = current === sortKey;
  return (
    <Button
      variant={isActive ? "default" : "outline"}
      size="sm"
      className={`gap-1 text-xs h-8 ${isActive ? "" : "text-muted-foreground"}`}
      onClick={() => onChange(sortKey)}
    >
      {label}
      {isActive ? (
        dir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />
      ) : (
        <ChevronsUpDown size={12} className="opacity-40" />
      )}
    </Button>
  );
}

export default function TeacherPerformance() {
  const [sortBy, setSortBy] = useState<SortKey>("rankingScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [chartMetric, setChartMetric] = useState<SortKey>("rankingScore");
  const [view, setView] = useState<"cards" | "table">("cards");

  const { data: teachers = [], isLoading } = useQuery<TeacherStat[]>({
    queryKey: ["teacher-performance"],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/teacher-performance`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
    staleTime: 30_000,
  });

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((direction) => (direction === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(key);
    setSortDir("desc");
  };

  const sorted = [...teachers].sort((a, b) => {
    const av = (a[sortBy] as number) ?? -1;
    const bv = (b[sortBy] as number) ?? -1;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const chartData = [...teachers]
    .sort((a, b) => ((b[chartMetric] as number) ?? 0) - ((a[chartMetric] as number) ?? 0))
    .slice(0, 10)
    .map((teacher) => ({
      name: teacher.fullName.split(" ")[0],
      value: (teacher[chartMetric] as number) ?? 0,
    }));

  const chartLabel = SORT_OPTIONS.find((option) => option.key === chartMetric)?.label ?? chartMetric;
  const maxScore = teachers.length > 0 ? Math.max(...teachers.map((teacher) => teacher.rankingScore)) : 1;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-36 bg-muted rounded-2xl animate-pulse" />
        <div className="grid gap-4">
          {[...Array(4)].map((_, index) => <div key={index} className="h-28 bg-muted rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 p-6 text-white shadow-lg">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-white/60 text-sm mb-1">
              <Trophy size={14} /> Teacher Rankings
            </div>
            <h1 className="text-2xl font-bold">Teacher Performance</h1>
            <p className="text-white/60 text-sm mt-1">
              Ranked by student reach, test activity, learner attempts, and feedback quality.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap shrink-0">
            <div className="bg-white/10 rounded-xl px-4 py-2.5 text-center">
              <p className="text-xl font-bold">{teachers.length}</p>
              <p className="text-xs text-white/60">Teachers</p>
            </div>
            <div className="bg-white/10 rounded-xl px-4 py-2.5 text-center">
              <p className="text-xl font-bold">{teachers.reduce((sum, teacher) => sum + teacher.testsCount, 0)}</p>
              <p className="text-xs text-white/60">Total Tests</p>
            </div>
            <div className="bg-white/10 rounded-xl px-4 py-2.5 text-center">
              <p className="text-xl font-bold">{teachers.reduce((sum, teacher) => sum + teacher.uniqueStudents, 0)}</p>
              <p className="text-xs text-white/60">Student Reach</p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-12 translate-x-12" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium mr-1">Sort by:</span>
        {SORT_OPTIONS.map((option) => (
          <SortButton
            key={option.key}
            label={option.label}
            sortKey={option.key}
            current={sortBy}
            dir={sortDir}
            onChange={handleSort}
          />
        ))}
        <div className="ml-auto flex gap-2">
          <Button variant={view === "cards" ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setView("cards")}>
            Cards
          </Button>
          <Button variant={view === "table" ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setView("table")}>
            Table
          </Button>
        </div>
      </div>

      {teachers.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <GraduationCap size={44} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No admin/teacher accounts found.</p>
          </CardContent>
        </Card>
      ) : view === "cards" ? (
        <div className="space-y-3">
          {sorted.map((teacher, index) => {
            const pct = maxScore > 0 ? Math.round((teacher.rankingScore / maxScore) * 100) : 0;
            const rankColor = index < 3 ? RANK_COLORS[index] : null;

            return (
              <Card
                key={teacher.id}
                className="hover:shadow-md transition-shadow duration-150"
                data-testid={`teacher-row-${teacher.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 flex flex-col items-center gap-1 w-10">
                      {rankColor ? (
                        <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${rankColor} flex items-center justify-center text-white shadow`}>
                          {index === 0 ? <Trophy size={16} /> : index === 1 ? <Medal size={16} /> : <Medal size={14} />}
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-sm font-bold">
                          {index + 1}
                        </div>
                      )}
                    </div>

                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {getInitials(teacher.fullName)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <p className="font-semibold text-sm">{teacher.fullName}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-muted-foreground">@{teacher.username}</span>
                            {teacher.subject && (
                              <Badge variant="secondary" className="text-[10px]">{formatExamDisplayName(teacher.subject) || teacher.subject}</Badge>
                            )}
                            {teacher.status !== "approved" && (
                              <Badge variant="destructive" className="text-[10px]">{teacher.status}</Badge>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="flex items-center gap-1.5 justify-end">
                            <Zap size={14} className="text-violet-500" />
                            <span className="text-lg font-bold text-violet-600">{teacher.rankingScore}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">ranking pts</p>
                        </div>
                      </div>

                      <div className="mt-3 mb-3">
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{pct}% of top teacher</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <MetricPill
                          icon={<Users size={11} />}
                          label="Students"
                          value={teacher.uniqueStudents}
                          color="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                        />
                        <MetricPill
                          icon={<ClipboardList size={11} />}
                          label="Tests"
                          value={teacher.testsCount}
                          color="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300"
                        />
                        <MetricPill
                          icon={<ListChecks size={11} />}
                          label="Attempts"
                          value={teacher.testSubmissions}
                          color="border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-300"
                        />
                        {teacher.avgScore !== null && (
                          <MetricPill
                            icon={<TrendingUp size={11} />}
                            label="Avg Score"
                            value={`${teacher.avgScore}%`}
                            color="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground w-10">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Teacher</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground">Students</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground">Tests</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground">Attempts</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground">Avg Score</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-violet-600">Rank ↓</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((teacher, index) => (
                  <tr key={teacher.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors" data-testid={`teacher-table-row-${teacher.id}`}>
                    <td className="px-4 py-3 text-center">
                      {index === 0 ? <Trophy size={14} className="text-amber-500 mx-auto" />
                        : index === 1 ? <Medal size={14} className="text-slate-400 mx-auto" />
                        : index === 2 ? <Medal size={14} className="text-orange-400 mx-auto" />
                        : <span className="text-muted-foreground text-xs">{index + 1}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {getInitials(teacher.fullName)}
                        </div>
                        <div>
                          <p className="font-medium text-xs">{teacher.fullName}</p>
                          {teacher.subject && <p className="text-[10px] text-muted-foreground">{formatExamDisplayName(teacher.subject) || teacher.subject}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center font-semibold text-emerald-600">{teacher.uniqueStudents}</td>
                    <td className="px-3 py-3 text-center font-semibold">{teacher.testsCount}</td>
                    <td className="px-3 py-3 text-center font-semibold">{teacher.testSubmissions}</td>
                    <td className="px-3 py-3 text-center">
                      {teacher.avgScore !== null ? <span className="text-violet-600 font-semibold">{teacher.avgScore}%</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="font-bold text-violet-600">{teacher.rankingScore}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {teachers.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-violet-500" /> Teacher Comparison Chart
              </CardTitle>
              <div className="flex gap-1.5 flex-wrap">
                {SORT_OPTIONS.slice(0, 5).map((option) => (
                  <Button
                    key={option.key}
                    variant={chartMetric === option.key ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-[11px] gap-1"
                    onClick={() => setChartMetric(option.key)}
                  >
                    {option.icon} {option.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ fontSize: "12px", borderRadius: "8px" }}
                  formatter={(value) => [value, chartLabel]}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {chartData.map((_, index) => (
                    <Cell key={index} fill={BAR_COLORS[index % BAR_COLORS.length]} />
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
