import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Lock,
  LockOpen,
  Layers,
  Plus,
  Target,
  TrendingUp,
  Trash2,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { buildApiUrl } from "@/lib/api-origin";

const COLORS = ["#f97316", "#3b82f6", "#10b981", "#8b5cf6", "#14b8a6", "#ec4899"];

interface AssignedTeacher {
  id: number;
  fullName?: string | null;
  username?: string | null;
}

interface PlannerQuestionBankCard {
  id: number;
  title: string;
  description?: string | null;
  exam: string;
  status: string;
  adminId: number;
  assignedTeacherIds?: number[];
  assignedTeachers?: AssignedTeacher[];
  weeklyTargetQuestions?: number | null;
  weeklyTargetDeadline?: string | null;
  isLocked: boolean;
  subjectCount: number;
  chapterCount: number;
  questionCount: number;
  remainingQuestions: number;
}

interface TeacherUser {
  id: number;
  fullName: string;
  username: string;
}

interface ExamTemplateSummary {
  id: number;
  name: string;
  key: string;
}

type FormState = {
  exam: string;
  teacherIds: number[];
  weeklyTargetQuestions: string;
  weeklyTargetDeadline: string;
};

type ChartTooltipProps = {
  active?: boolean;
  label?: string;
  payload?: Array<{ color?: string; name?: string; value?: number | string }>;
};

type TeacherContributionRow = {
  name: string;
  uploaded: number;
};

const emptyForm = (): FormState => ({
  exam: "",
  teacherIds: [],
  weeklyTargetQuestions: "",
  weeklyTargetDeadline: "",
});

function shortLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Untitled";
  const words = trimmed.split(/\s+/);
  return words.length <= 2 ? trimmed : words.slice(0, 2).join(" ");
}

function compactCount(value: number) {
  if (value < 1000) return value.toString();
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function getProgress(card: Pick<PlannerQuestionBankCard, "questionCount" | "weeklyTargetQuestions">) {
  const target = card.weeklyTargetQuestions ?? 0;
  if (target <= 0) return card.questionCount > 0 ? 100 : 0;
  return Math.min(Math.round((card.questionCount / target) * 100), 100);
}

function normalizeExamKey(value: string) {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const compact = raw.replace(/[^a-z0-9]+/g, " ").trim();
  if (compact.includes("jam chemistry") || compact.includes("iit jam chemistry")) return "jam-chemistry";
  if (compact.includes("iit jam")) return "iit-jam";
  if (compact.includes("jee main")) return "jee-main";
  if (compact === "jee") return "jee";
  if (compact.includes("gate")) return "gate";
  if (compact.includes("cuet")) return "cuet";
  if (compact.includes("neet")) return "neet";
  if (compact.includes("cat")) return "cat";
  return compact.replace(/\s+/g, "-");
}

function formatTeacherName(teacher: AssignedTeacher) {
  return teacher.fullName ?? (teacher.username ? `@${teacher.username}` : "Teacher");
}

function CustomTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm shadow-lg">
      {label ? <p className="mb-1 font-semibold text-foreground">{label}</p> : null}
      {payload.map((entry, index) => (
        <p key={`${entry.name}-${index}`} style={{ color: entry.color }} className="text-xs">
          {entry.name}: {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
        </p>
      ))}
    </div>
  );
}

function EmptyAnalyticsState({
  onCreate,
  search,
  createDisabled,
}: {
  onCreate: () => void;
  search: string;
  createDisabled: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
        <div className="space-y-1">
          <p className="font-semibold">{search ? "No question banks found" : "No question bank analytics yet"}</p>
          <p className="text-sm text-muted-foreground">
            {search
              ? `No banks matched "${search}".`
              : "Create your first question bank to unlock this workspace."}
          </p>
        </div>
        {search ? null : (
          <Button onClick={onCreate} className="gap-2" disabled={createDisabled}>
            <Plus className="h-4 w-4" />
            Create Question Bank
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function PlannerQuestionBank() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [cardToDelete, setCardToDelete] = useState<PlannerQuestionBankCard | null>(null);
  const basePath = "/super-admin";

  const { data: cards = [], isLoading } = useQuery<PlannerQuestionBankCard[]>({
    queryKey: ["planner-question-bank-cards"],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/question-bank/cards`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load question bank cards");
      return response.json();
    },
  });

  const { data: teachers = [] } = useQuery<TeacherUser[]>({
    queryKey: ["planner-question-bank-teachers"],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/users?role=admin`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load teachers");
      return response.json();
    },
    staleTime: 30000,
  });

  const { data: examTemplates = [] } = useQuery<ExamTemplateSummary[]>({
    queryKey: ["planner-question-bank-exam-names"],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/planner/exam-templates`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load exam templates");
      const rows = await response.json();
      return rows.map((row: { id: number; name: string; key: string }) => ({
        id: row.id,
        name: row.name,
        key: row.key,
      }));
    },
    staleTime: 30000,
  });

  const filteredCards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (!term) return true;
      const teacherNames = (card.assignedTeachers ?? [])
        .map((teacher) => `${teacher.fullName ?? ""} ${teacher.username ?? ""}`)
        .join(" ");
      const haystack = `${card.title} ${card.exam} ${teacherNames}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [cards, search]);

  const usedExamKeys = useMemo(
    () => new Set(cards.map((card) => normalizeExamKey(card.exam)).filter((value): value is string => !!value)),
    [cards],
  );

  const availableExamTemplates = useMemo(
    () =>
      examTemplates.filter((template) => {
        const examKey = normalizeExamKey(template.key || template.name);
        return !!examKey && !usedExamKeys.has(examKey);
      }),
    [examTemplates, usedExamKeys],
  );

  const totalExams = cards.length;
  const totalQuestions = cards.reduce((acc, card) => acc + (card.weeklyTargetQuestions ?? 0), 0);
  const uploadedQuestions = cards.reduce((acc, card) => acc + card.questionCount, 0);
  const overallProgress = totalQuestions > 0 ? Math.min(Math.round((uploadedQuestions / totalQuestions) * 100), 100) : 0;

  const barChartData = useMemo(
    () =>
      cards.map((card) => ({
        name: shortLabel(card.title || card.exam),
        Uploaded: card.questionCount,
        Remaining: Math.max((card.weeklyTargetQuestions ?? 0) - card.questionCount, 0),
      })),
    [cards],
  );

  const donutData = useMemo(
    () =>
      cards.map((card, index) => ({
        name: shortLabel(card.title || card.exam),
        value: card.questionCount,
        fill: COLORS[index % COLORS.length],
      })),
    [cards],
  );

  const radialData = useMemo(
    () =>
      cards.map((card, index) => ({
        name: shortLabel(card.title || card.exam),
        progress: getProgress(card),
        fill: COLORS[index % COLORS.length],
      })),
    [cards],
  );

  const teacherBarData = useMemo<TeacherContributionRow[]>(() => {
    const contributionMap = new Map<string, TeacherContributionRow>();

    cards.forEach((card) => {
      const assignedTeachers = card.assignedTeachers ?? [];
      if (assignedTeachers.length === 0) return;

      const contributionPerTeacher = card.questionCount / assignedTeachers.length;
      assignedTeachers.forEach((teacher) => {
        const key = String(teacher.id);
        const existing = contributionMap.get(key);
        contributionMap.set(key, {
          name: formatTeacherName(teacher).split(" ").pop() ?? formatTeacherName(teacher),
          uploaded: (existing?.uploaded ?? 0) + contributionPerTeacher,
        });
      });
    });

    return Array.from(contributionMap.values())
      .map((entry) => ({ ...entry, uploaded: Math.round(entry.uploaded) }))
      .sort((a, b) => b.uploaded - a.uploaded);
  }, [cards]);

  const resetDialog = () => {
    setOpen(false);
    setError("");
    setForm(emptyForm());
  };

  const upsertQuestionBankCard = useMutation({
    mutationFn: async () => {
      const response = await fetch(buildApiUrl(`/api/question-bank/cards`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam: form.exam.trim(),
          teacherIds: form.teacherIds,
          weeklyTargetQuestions: form.weeklyTargetQuestions.trim() ? Number(form.weeklyTargetQuestions) : undefined,
          weeklyTargetDeadline: form.weeklyTargetDeadline.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to create question bank");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planner-question-bank-cards"] });
      resetDialog();
      toast({
        title: "Question bank created",
        description: "The new question bank is ready.",
      });
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to save question bank");
    },
  });

  const deleteQuestionBankCard = useMutation({
    mutationFn: async (cardId: number) => {
      const response = await fetch(buildApiUrl(`/api/question-bank/cards/${cardId}`), {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to delete question bank");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planner-question-bank-cards"] });
      setCardToDelete(null);
      toast({
        title: "Question bank deleted",
        description: "The active question bank has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not delete question bank",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleQuestionBankLock = useMutation({
    mutationFn: async ({ cardId, isLocked }: { cardId: number; isLocked: boolean }) => {
      const response = await fetch(buildApiUrl(`/api/question-bank/cards/${cardId}/lock`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLocked }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed to ${isLocked ? "lock" : "unlock"} question bank`);
      }

      return response.json();
    },
    onSuccess: (_payload, variables) => {
      queryClient.invalidateQueries({ queryKey: ["planner-question-bank-cards"] });
      queryClient.invalidateQueries({ queryKey: ["planner-question-bank-detail", variables.cardId] });
      toast({
        title: variables.isLocked ? "Question bank locked" : "Question bank unlocked",
        description: variables.isLocked
          ? "Editing is now disabled for this question bank."
          : "Editing is enabled again for this question bank.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update lock state",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleTeacher = (teacherId: number) => {
    setForm((prev) => ({
      ...prev,
      teacherIds: prev.teacherIds.includes(teacherId)
        ? prev.teacherIds.filter((id) => id !== teacherId)
        : [...prev.teacherIds, teacherId],
    }));
  };

  const handleSave = () => {
    setError("");
    if (!form.exam.trim()) return setError("Exam name is required.");
    const selectedExamKey = normalizeExamKey(form.exam);
    if (selectedExamKey && usedExamKeys.has(selectedExamKey)) {
      return setError("Question bank for this exam already exists.");
    }
    if (form.teacherIds.length === 0) return setError("At least one teacher assignment is required.");
    upsertQuestionBankCard.mutate();
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-9 w-40 rounded-lg bg-muted animate-pulse" />
            <div className="h-5 w-80 rounded-lg bg-muted animate-pulse" />
          </div>
          <div className="h-10 w-40 rounded-lg bg-muted animate-pulse" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="h-32 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="h-80 rounded-2xl bg-muted animate-pulse lg:col-span-2" />
          <div className="h-80 rounded-2xl bg-muted animate-pulse" />
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="h-80 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Question Bank</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your question banks and track content upload progress.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2" disabled={availableExamTemplates.length === 0}>
          <Plus className="h-4 w-4" />
          Create Question Bank
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Exams</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalExams}</div>
            <p className="mt-1 text-xs text-muted-foreground">Active competitive exams</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Questions Target</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalQuestions.toLocaleString()}</div>
            <p className="mt-1 text-xs text-muted-foreground">Across all question banks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Uploaded Questions</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uploadedQuestions.toLocaleString()}</div>
            <p className="mt-1 flex items-center gap-1 text-xs text-primary">
              <TrendingUp className="h-3 w-3" /> {overallProgress}% completion rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Assigned Teachers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teachers.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">Content creators active</p>
          </CardContent>
        </Card>
      </div>

      {cards.length === 0 ? (
        <EmptyAnalyticsState onCreate={() => setOpen(true)} search={search} createDisabled={availableExamTemplates.length === 0} />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Upload Progress by Exam</CardTitle>
                <CardDescription>Uploaded vs remaining questions across all exams</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={barChartData} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      tickFormatter={(value) => compactCount(Number(value))}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
                      formatter={(value) => <span style={{ color: "hsl(var(--foreground))" }}>{value}</span>}
                    />
                    <Bar dataKey="Uploaded" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Remaining" stackId="a" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Question Distribution</CardTitle>
                <CardDescription>Share of uploaded questions per exam</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {donutData.map((entry, index) => (
                        <Cell key={`${entry.name}-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [value.toLocaleString(), "Uploaded"]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                  {donutData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
                      {entry.name}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Completion Rate</CardTitle>
                <CardDescription>Percentage complete per exam</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <RadialBarChart
                    cx="50%"
                    cy="50%"
                    innerRadius="25%"
                    outerRadius="90%"
                    data={radialData}
                    startAngle={90}
                    endAngle={-270}
                  >
                    <RadialBar dataKey="progress" background={{ fill: "hsl(var(--muted))" }} cornerRadius={4}>
                      {radialData.map((entry, index) => (
                        <Cell key={`${entry.name}-${index}`} fill={entry.fill} />
                      ))}
                    </RadialBar>
                    <Tooltip
                      formatter={(value: number) => [`${value}%`, "Completion"]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                  {radialData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
                      {entry.name} — {entry.progress}%
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Teacher Contributions</CardTitle>
                <CardDescription>Total questions uploaded per teacher</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(220, teacherBarData.length * 36)}>
                  <BarChart data={teacherBarData} layout="vertical" barSize={20}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => compactCount(Number(value))}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={70}
                    />
                    <Tooltip
                      formatter={(value: number) => [Math.round(value).toLocaleString(), "Questions Uploaded"]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="uploaded" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                      {teacherBarData.map((_, index) => (
                        <Cell key={`teacher-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Active Question Banks</h2>
        </div>

        {filteredCards.length === 0 ? (
          <EmptyAnalyticsState onCreate={() => setOpen(true)} search={search} createDisabled={availableExamTemplates.length === 0} />
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filteredCards.map((card) => {
              const progress = getProgress(card);
              return (
                <Card key={card.id} className="flex flex-col hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-lg">{card.title}</CardTitle>
                          {card.isLocked ? (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                              <Lock className="mr-1 h-3 w-3" /> Locked
                            </Badge>
                          ) : null}
                        </div>
                        <CardDescription className="mt-1 line-clamp-1">
                          {card.description || card.exam}
                        </CardDescription>
                      </div>
                      <div className="rounded-md border bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                        {progress}%
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Layers className="h-4 w-4" />
                        <span>{card.subjectCount} Subjects</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <BookOpen className="h-4 w-4" />
                        <span>{card.chapterCount} Chapters</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Upload Progress</span>
                        <span className="font-medium">
                          {card.questionCount.toLocaleString()} / {(card.weeklyTargetQuestions ?? 0).toLocaleString()}
                        </span>
                      </div>
                      <Progress value={progress} className="h-2" />
                    </div>
                  </CardContent>

                  <CardFooter className="border-t pt-4">
                    <div className="flex w-full gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="flex-1 justify-between hover:bg-primary/5 hover:text-primary"
                        onClick={() => setLocation(`${basePath}/question-bank/${card.id}`)}
                      >
                        <>
                          Manage Question Bank
                          <ArrowRight className="h-4 w-4" />
                        </>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => toggleQuestionBankLock.mutate({ cardId: card.id, isLocked: !card.isLocked })}
                        disabled={toggleQuestionBankLock.isPending}
                        aria-label={card.isLocked ? `Unlock ${card.title}` : `Lock ${card.title}`}
                        title={card.isLocked ? "Locked question bank" : "Unlocked question bank"}
                      >
                        {card.isLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0 text-destructive hover:text-destructive"
                        onClick={() => setCardToDelete(card)}
                        disabled={card.isLocked}
                        aria-label={`Delete ${card.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : resetDialog())}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Question Bank</DialogTitle>
          </DialogHeader>

          <div className="mt-2 space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label>Exam Name</Label>
              <select
                value={form.exam}
                onChange={(event) => setForm((prev) => ({ ...prev, exam: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">
                  {availableExamTemplates.length === 0
                    ? "All exam templates already have question banks"
                    : "Select exam template name"}
                </option>
                {availableExamTemplates.map((template) => (
                  <option key={template.id} value={template.name}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Assign Teachers</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {teachers.map((teacher) => {
                  const selected = form.teacherIds.includes(teacher.id);
                  return (
                    <button
                      key={teacher.id}
                      type="button"
                      onClick={() => toggleTeacher(teacher.id)}
                      className={`rounded-xl border px-3 py-2 text-left transition ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40 hover:bg-accent/30"
                      }`}
                    >
                      <div className="text-sm font-medium">{teacher.fullName}</div>
                      <div className="text-xs text-muted-foreground">@{teacher.username}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Target Questions</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.weeklyTargetQuestions}
                  onChange={(event) => setForm((prev) => ({ ...prev, weeklyTargetQuestions: event.target.value }))}
                  placeholder="Optional"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Deadline</Label>
                <Input
                  type="datetime-local"
                  value={form.weeklyTargetDeadline}
                  onChange={(event) => setForm((prev) => ({ ...prev, weeklyTargetDeadline: event.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>

            <Button className="w-full" onClick={handleSave} disabled={upsertQuestionBankCard.isPending}>
              {upsertQuestionBankCard.isPending ? "Creating..." : "Create Question Bank"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cardToDelete} onOpenChange={(open) => !open && setCardToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete question bank?</AlertDialogTitle>
            <AlertDialogDescription>
              {cardToDelete
                ? `${cardToDelete.title} and all of its subjects, chapters, and questions will be removed permanently.`
                : "This active question bank will be removed permanently."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cardToDelete && deleteQuestionBankCard.mutate(cardToDelete.id)}
            >
              {deleteQuestionBankCard.isPending ? "Deleting..." : "Delete Question Bank"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
