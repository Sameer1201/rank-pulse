import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useGetSuperAdminDashboard, useApproveStudent, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useCountUp } from "@/hooks/useCountUp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { DashboardScene, TiltCard } from "@/components/dashboard-3d";
import { APP_NAME } from "@/lib/brand";
import { formatExamDisplayName } from "@/lib/exam-display";
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Users, UserCheck, Clock, CheckCircle,
  TrendingUp, Bell, Trophy, GraduationCap,
  Medal, ClipboardList, ArrowRight,
  Shield, Activity, Plus, ChevronRight,
  Mail, MousePointerClick, Eye, Send, AlertCircle, RefreshCw, Sparkles, Trash2, CalendarClock,
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-origin";

const KPI_BACKGROUNDS: Record<string, string> = {
  "from-blue-600 to-cyan-600": "linear-gradient(135deg, #2563eb 0%, #0891b2 100%)",
  "from-violet-600 to-purple-600": "linear-gradient(135deg, #7c3aed 0%, #9333ea 100%)",
  "from-emerald-600 to-teal-600": "linear-gradient(135deg, #059669 0%, #0d9488 100%)",
  "from-amber-500 to-orange-500": "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
  "from-fuchsia-600 to-pink-600": "linear-gradient(135deg, #c026d3 0%, #db2777 100%)",
  "from-indigo-600 to-blue-600": "linear-gradient(135deg, #4f46e5 0%, #2563eb 100%)",
  "from-yellow-500 to-amber-600": "linear-gradient(135deg, #eab308 0%, #d97706 100%)",
  "from-rose-600 to-pink-600": "linear-gradient(135deg, #e11d48 0%, #db2777 100%)",
};

const ACTION_ACCENTS: Record<string, { bg: string; color: string }> = {
  "from-blue-600 to-cyan-600": { bg: "#eff6ff", color: "#2563eb" },
  "from-violet-600 to-purple-600": { bg: "#f5f3ff", color: "#7c3aed" },
  "from-amber-500 to-orange-500": { bg: "#fff7ed", color: "#ea580c" },
  "from-rose-600 to-pink-600": { bg: "#fff1f2", color: "#e11d48" },
};

/* ─── helpers ─── */
function getHour() { return new Date().getHours(); }
function getGreeting() {
  const h = getHour();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}
function shortDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
}

type AccessWindowStudent = {
  id: number;
  fullName: string;
  username: string;
  email: string;
  status?: string;
  priorityAccess?: boolean;
  aiUsageCount?: number;
  aiHintUsageCount?: number;
};

function getAiUsageCount(student: AccessWindowStudent) {
  return student.aiUsageCount ?? student.aiHintUsageCount ?? 0;
}

/* ─── Animated KPI tile ─── */
function KpiTile({
  title, value, icon, from, to, sub, badge, onClick,
}: {
  title: string; value: number; icon: React.ReactNode;
  from: string; to: string; sub?: string;
  badge?: { label: string; variant: "default" | "destructive" | "outline" | "secondary" };
  onClick?: () => void;
}) {
  const count = useCountUp(value, 900, true);
  const background = KPI_BACKGROUNDS[`${from} ${to}`] ?? "linear-gradient(135deg, #334155 0%, #0f172a 100%)";
  return (
    <TiltCard>
    <div
      onClick={onClick}
      style={{ background }}
      className={`relative min-h-[8.25rem] overflow-hidden rounded-2xl p-4 text-white shadow-[0_16px_32px_rgba(15,23,42,0.16)] ring-1 ring-black/5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_36px_rgba(15,23,42,0.2)] sm:p-5 ${onClick ? "cursor-pointer" : ""}`}
      data-testid={`kpi-${title.toLowerCase().replace(/\s/g, "-")}`}
    >
      {/* bg glow */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -translate-y-4 translate-x-4" />
      <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/5 rounded-full translate-y-4 -translate-x-4" />

      <div className="relative z-10">
        <div className="mb-2.5 flex items-start justify-between sm:mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 sm:h-10 sm:w-10">
            {icon}
          </div>
          {badge && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white uppercase tracking-wide">
              {badge.label}
            </span>
          )}
        </div>
        <p className="text-3xl font-black leading-none tracking-tight">{count.toLocaleString()}</p>
        <p className="mt-2 text-sm font-semibold text-white">{title}</p>
        {sub && <p className="mt-1 text-xs text-white/75">{sub}</p>}
      </div>
    </div>
    </TiltCard>
  );
}

/* ─── Quick action card ─── */
function QuickAction({ icon, label, desc, href, color }: {
  icon: React.ReactNode; label: string; desc: string; href: string; color: string;
}) {
  const accent = ACTION_ACCENTS[color] ?? { bg: "#f3f4f6", color: "#4b5563" };
  return (
    <TiltCard>
    <Link href={href}>
      <div className="group flex cursor-pointer items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#CBD5E1] hover:shadow-md">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors"
          style={{ backgroundColor: accent.bg, color: accent.color }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#111827]">{label}</p>
          <p className="truncate text-xs text-[#6B7280]">{desc}</p>
        </div>
        <ChevronRight size={15} className="shrink-0 text-[#9CA3AF] transition-colors group-hover:text-[#4B5563]" />
      </div>
    </Link>
    </TiltCard>
  );
}

/* ─── Teacher row ─── */
function TeacherRow({ teacher, rank }: {
  teacher: { id: number; fullName: string; subject: string | null; testsCount: number; studentsCount: number };
  rank: number;
}) {
  const medal = rank === 1 ? <Trophy size={12} className="text-amber-400" />
    : rank === 2 ? <Medal size={12} className="text-slate-400" />
    : rank === 3 ? <Medal size={12} className="text-orange-400" />
    : <span className="text-xs text-muted-foreground font-bold w-3 text-center">{rank}</span>;

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 transition-colors">
      <div className="w-6 flex items-center justify-center shrink-0">{medal}</div>
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
        {getInitials(teacher.fullName)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{teacher.fullName}</p>
        {teacher.subject && <p className="text-[10px] text-muted-foreground truncate">{formatExamDisplayName(teacher.subject) || teacher.subject}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-bold">{teacher.testsCount} <span className="text-muted-foreground font-normal">tests</span></p>
        <p className="text-[10px] text-muted-foreground">{teacher.studentsCount} students</p>
      </div>
    </div>
  );
}

/* ─── Main Dashboard ─── */
export default function SuperAdminDashboard() {
  const { data, isLoading, isError, error, refetch } = useGetSuperAdminDashboard();
  const approveStudent = useApproveStudent();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [greeting] = useState(getGreeting());
  const [time, setTime] = useState(new Date());
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [reviewEmailEnabled, setReviewEmailEnabled] = useState(true);
  const [reviewQuickActionsEnabled, setReviewQuickActionsEnabled] = useState(true);
  const [savingSetting, setSavingSetting] = useState<"email" | "actions" | null>(null);
  const [closeAtInput, setCloseAtInput] = useState("");
  const [savingAccessWindow, setSavingAccessWindow] = useState(false);
  const [priorityStudentId, setPriorityStudentId] = useState("");
  const [savingPriorityAccess, setSavingPriorityAccess] = useState(false);

  const { data: emailQuota, refetch: refetchQuota, isFetching: quotaFetching } = useQuery({
    queryKey: ["email-quota"],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/email-quota`), { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<any>;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: accessWindow, refetch: refetchAccessWindow } = useQuery<{ isClosed: boolean; closedUntil: string | null; aiAccessForAllStudents?: boolean }>({
    queryKey: ["super-admin-access-controls"],
    queryFn: async () => {
      const response = await fetch(buildApiUrl("/api/dashboard/super-admin/access-controls"), { credentials: "include" });
      if (!response.ok) throw new Error("Could not load student access controls");
      return response.json();
    },
    staleTime: 10_000,
  });

  const { data: accessWindowStudents = [] } = useQuery<AccessWindowStudent[]>({
    queryKey: ["super-admin-access-window-students"],
    queryFn: async () => {
      const response = await fetch(buildApiUrl("/api/users?role=student"), { credentials: "include" });
      if (!response.ok) throw new Error("Could not load students for priority access");
      return response.json();
    },
    staleTime: 15_000,
  });

  const selectedPriorityStudent = accessWindowStudents.find((student) => String(student.id) === priorityStudentId);
  const priorityStudents = accessWindowStudents.filter((student) => student.priorityAccess);
  const isAccessPaused = accessWindow?.isClosed === true;
  const aiAccessForAllStudents = accessWindow?.aiAccessForAllStudents === true;

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const automation = (data as any)?.studentReviewAutomation;
    if (!automation) return;
    setReviewEmailEnabled(Boolean(automation.emailEnabled));
    setReviewQuickActionsEnabled(Boolean(automation.quickActionsEnabled));
  }, [data]);

  useEffect(() => {
    const value = accessWindow?.closedUntil;
    if (!value) {
      setCloseAtInput("");
      return;
    }
    const date = new Date(value);
    const pad = (part: number) => String(part).padStart(2, "0");
    setCloseAtInput(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`);
  }, [accessWindow?.closedUntil]);

  const handleApprove = (id: number, name: string) => {
    setApprovingId(id);
    approveStudent.mutate(
      { id, data: { status: "approved" } },
      {
        onSuccess: () => {
          toast({ title: "Student approved", description: `${name} can now access the platform.` });
          refetch();
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ role: "student" }) });
        },
        onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
        onSettled: () => setApprovingId(null),
      }
    );
  };

  const updateStudentReviewSetting = async (
    patch: { emailEnabled?: boolean; quickActionsEnabled?: boolean },
    key: "email" | "actions",
  ) => {
    const previousEmailEnabled = reviewEmailEnabled;
    const previousQuickActionsEnabled = reviewQuickActionsEnabled;

    if (patch.emailEnabled !== undefined) setReviewEmailEnabled(patch.emailEnabled);
    if (patch.quickActionsEnabled !== undefined) setReviewQuickActionsEnabled(patch.quickActionsEnabled);
    setSavingSetting(key);

    try {
      const response = await fetch(buildApiUrl(`/api/dashboard/super-admin/student-review-settings`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to update student review automation.");
      }
      const payload = await response.json();
      setReviewEmailEnabled(Boolean(payload.emailEnabled));
      setReviewQuickActionsEnabled(Boolean(payload.quickActionsEnabled));
      toast({
        title: "Student review automation updated",
        description: key === "email"
          ? `New setup emails are now ${payload.emailEnabled ? "enabled" : "disabled"}.`
          : `Email approve/reject links are now ${payload.quickActionsEnabled ? "enabled" : "disabled"}.`,
      });
      refetch();
    } catch (error) {
      setReviewEmailEnabled(previousEmailEnabled);
      setReviewQuickActionsEnabled(previousQuickActionsEnabled);
      toast({
        title: "Setting update failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingSetting(null);
    }
  };

  const saveAccessWindow = async (closedUntil: string | null) => {
    setSavingAccessWindow(true);
    try {
      const response = await fetch(buildApiUrl("/api/dashboard/super-admin/access-controls"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closedUntil }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update access window");
      await refetchAccessWindow();
      toast({
        title: closedUntil ? "Student access pause enabled" : "Student access opened",
        description: closedUntil
          ? "New registration is closed and non-priority students will see the countdown."
          : "Registration is open and all standard students can continue.",
      });
    } catch (error) {
      toast({ title: "Access window update failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSavingAccessWindow(false);
    }
  };

  const toggleGlobalAiAccess = async () => {
    const nextValue = !aiAccessForAllStudents;
    if (nextValue && !window.confirm("Give all current and future students access to every AI feature?")) return;
    try {
      const response = await fetch(buildApiUrl("/api/dashboard/super-admin/access-controls"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closedUntil: accessWindow?.closedUntil ?? null, aiAccessForAllStudents: nextValue }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update AI access");
      await refetchAccessWindow();
      toast({
        title: nextValue ? "AI access enabled for all students" : "Global AI access disabled",
        description: nextValue
          ? "Current and future students can use hints, performance insights and AI coaching."
          : "Students will now follow their individual priority access setting.",
      });
    } catch (error) {
      toast({ title: "AI access update failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    }
  };

  const updatePriorityAccess = async () => {
    if (!selectedPriorityStudent) return;
    setSavingPriorityAccess(true);
    const nextValue = !Boolean(selectedPriorityStudent.priorityAccess);
    try {
      const response = await fetch(buildApiUrl(`/api/users/${selectedPriorityStudent.id}/priority-access`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priorityAccess: nextValue }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update priority access");
      queryClient.setQueryData<AccessWindowStudent[]>(["super-admin-access-window-students"], (students = []) =>
        students.map((student) => student.id === selectedPriorityStudent.id ? { ...student, priorityAccess: nextValue } : student),
      );
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ role: "student" }) });
      toast({
        title: nextValue ? "Priority access enabled" : "Priority access removed",
        description: nextValue
          ? `${selectedPriorityStudent.fullName} can access the platform during a pause.`
          : `${selectedPriorityStudent.fullName} will follow the standard access window.`,
      });
    } catch (error) {
      toast({ title: "Priority access update failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSavingPriorityAccess(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-36 bg-muted rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => <div key={i} className="h-64 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <DashboardScene accent="from-orange-500/18 via-red-500/12 to-violet-500/12">
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-6 text-white shadow-[0_24px_56px_rgba(15,23,42,0.32)]">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 rounded-xl bg-red-500/20 p-3">
              <Activity size={20} className="text-red-200" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Unable to load dashboard data</h2>
              <p className="mt-2 text-sm text-white/75">
                {error instanceof Error ? error.message : "Super admin dashboard request failed."}
              </p>
              <div className="mt-4 flex gap-3">
                <Button onClick={() => refetch()} className="bg-white text-slate-900 hover:bg-white/90">
                  Retry
                </Button>
                <Link href="/super-admin/students">
                  <Button variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
                    Open Students
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </DashboardScene>
    );
  }

  if (!data) {
    return (
      <DashboardScene accent="from-orange-500/18 via-red-500/12 to-violet-500/12">
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-[#111827] shadow-sm">
          <h2 className="text-lg font-semibold">Dashboard data is not available yet</h2>
          <p className="mt-2 text-sm text-[#6B7280]">
            Summary cards will appear as soon as dashboard data is available.
          </p>
          <div className="mt-4">
            <Button onClick={() => refetch()}>
              Refresh
            </Button>
          </div>
        </div>
      </DashboardScene>
    );
  }

  const d = data as any;
  const studentReviewAutomation = d.studentReviewAutomation ?? {
    emailEnabled: reviewEmailEnabled,
    quickActionsEnabled: reviewQuickActionsEnabled,
    recipientsCount: 0,
    recipientEmails: [],
  };

  /* chart data */
  const trendData = (d.signupTrend ?? []).map((s: any) => ({
    date: shortDate(s.date),
    Students: s.students,
    Admins: s.admins,
  }));

  return (
    <DashboardScene accent="from-orange-500/18 via-red-500/12 to-violet-500/12">
    <div className="space-y-6">

      {/* ── Hero banner ── */}
      <div
        className="relative overflow-hidden rounded-2xl p-4 text-white shadow-[0_18px_40px_rgba(15,23,42,0.2)] sm:p-6"
        style={{ background: "linear-gradient(135deg, #111827 0%, #7f1d1d 52%, #c2410c 100%)" }}
      >
        {/* Decorative blobs */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full -translate-y-24 translate-x-24 blur-2xl" />
        <div className="absolute bottom-0 left-20 w-48 h-48 bg-red-500/10 rounded-full translate-y-16 blur-2xl" />

        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-white/75">Platform Live</span>
              <span className="ml-2 text-xs text-white/60 sm:ml-4">
                {time.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {greeting}, <span className="text-orange-300">Sameer</span> 👋
            </h1>
            <p className="mt-1 text-sm text-white/75">
              {APP_NAME} Platform — Super Administrator
            </p>

            {/* health badges */}
            <div className="flex flex-wrap gap-2 mt-4">
              {d.pendingStudents > 0 && (
                <div className="flex items-center gap-1.5 rounded-full border border-amber-300/35 bg-amber-400/20 px-3 py-1 text-xs font-medium text-white">
                  <Clock size={11} className="text-amber-400" />
                  <span>{d.pendingStudents} Pending Approval{d.pendingStudents > 1 ? "s" : ""}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 rounded-full border border-emerald-300/35 bg-emerald-400/20 px-3 py-1 text-xs font-medium text-white">
                <CheckCircle size={11} className="text-emerald-400" />
                <span>{d.approvedStudents} Active Students</span>
              </div>
              {d.totalTests > 0 && (
                <div className="flex items-center gap-1.5 rounded-full border border-violet-300/35 bg-violet-400/20 px-3 py-1 text-xs font-medium text-white">
                  <ClipboardList size={11} className="text-violet-300" />
                  <span>{d.totalTests} Published Tests</span>
                </div>
              )}
            </div>
          </div>

          {/* Platform score ring */}
          <div className="relative flex items-center justify-center w-24 h-24 shrink-0">
            <svg className="absolute inset-0 w-full h-full -rotate-90">
              <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
              <circle
                cx="48" cy="48" r="40" fill="none"
                stroke="url(#scoreGrad)" strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 40}`}
                strokeDashoffset={`${2 * Math.PI * 40 * (1 - Math.min(d.totalStudents / Math.max(d.totalStudents + 10, 1), 1))}`}
                style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
              />
              <defs>
                <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#fb923c" />
                  <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
              </defs>
            </svg>
            <div className="text-center">
              <p className="text-xl font-black">{d.totalStudents}</p>
              <p className="text-[9px] leading-tight text-white/70">students</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiTile
          title="Total Teachers"
          value={d.totalAdmins}
          icon={<UserCheck size={18} className="text-white" />}
          from="from-blue-600" to="to-cyan-600"
          sub="Admin accounts"
        />
        <KpiTile
          title="Total Students"
          value={d.totalStudents}
          icon={<Users size={18} className="text-white" />}
          from="from-violet-600" to="to-purple-600"
          sub={`${d.approvedStudents} approved`}
        />
        <KpiTile
          title="Active Students"
          value={d.approvedStudents}
          icon={<Shield size={18} className="text-white" />}
          from="from-emerald-600" to="to-teal-600"
          sub="Approved access"
        />
        <KpiTile
          title="Tests Created"
          value={d.totalTests}
          icon={<ClipboardList size={18} className="text-white" />}
          from="from-fuchsia-600" to="to-pink-600"
          sub="Platform-wide"
        />
        <KpiTile
          title="Pending Approvals"
          value={d.pendingStudents}
          icon={<Clock size={18} className="text-white" />}
          from="from-yellow-500" to="to-amber-600"
          badge={d.pendingStudents > 0 ? { label: "Action", variant: "default" } : undefined}
        />
        <KpiTile
          title="Total Visitors"
          value={d.totalVisitors ?? 0}
          icon={<Eye size={18} className="text-white" />}
          from="from-teal-600" to="to-emerald-600"
          sub={`${d.todayVisitors ?? 0} today`}
        />
      </div>

      {/* ── Quick actions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <QuickAction
          href="/super-admin/admins"
          icon={<Plus size={16} className="text-blue-600" />}
          label="Add Teacher"
          desc="Create admin account"
          color="from-blue-600 to-cyan-600"
        />
        <QuickAction
          href="/super-admin/send-notification"
          icon={<Bell size={16} className="text-violet-600" />}
          label="Broadcast"
          desc="Send notification"
          color="from-violet-600 to-purple-600"
        />
        <QuickAction
          href="/super-admin/teacher-performance"
          icon={<Trophy size={16} className="text-amber-600" />}
          label="Performance"
          desc="Teacher rankings"
          color="from-amber-500 to-orange-500"
        />
        <QuickAction
          href="/super-admin/activity"
          icon={<Activity size={16} className="text-rose-600" />}
          label="Activity"
          desc="Review recent platform activity"
          color="from-rose-600 to-pink-600"
        />
      </div>

      <TiltCard>
        <Card className="border-rose-200/70 bg-white shadow-[0_20px_48px_rgba(15,23,42,0.14)]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock size={15} className="text-rose-500" /> Student access window
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="rounded-2xl border border-rose-200/80 bg-rose-50/60 p-4">
              <p className="text-sm font-semibold text-slate-900">Pause new registrations and standard student access</p>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
                Priority-access students continue normally. Everyone else sees a live countdown until this window ends.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1 space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-700">Resume at</span>
                  <input
                    type="datetime-local"
                    value={closeAtInput}
                    onChange={(event) => setCloseAtInput(event.target.value)}
                    className="h-10 w-full rounded-md border border-rose-200 bg-white px-3 text-sm text-slate-800 outline-none ring-rose-300 focus:ring-2"
                    data-testid="input-student-access-window"
                  />
                </label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className={isAccessPaused
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-rose-600 text-white hover:bg-rose-700"}
                    disabled={savingAccessWindow || (!isAccessPaused && !closeAtInput)}
                    onClick={() => void saveAccessWindow(isAccessPaused ? null : new Date(closeAtInput).toISOString())}
                    data-testid={isAccessPaused ? "button-open-student-access" : "button-pause-student-access"}
                  >
                    {savingAccessWindow ? "Saving…" : isAccessPaused ? "Open access" : "Pause access"}
                  </Button>
                </div>
              </div>
              <p className="mt-3 text-xs font-medium text-slate-600">
                Current status: <span className={accessWindow?.isClosed ? "text-rose-700" : "text-emerald-700"}>
                  {accessWindow?.isClosed ? `Paused until ${new Date(accessWindow.closedUntil!).toLocaleString("en-IN")}` : "Open"}
                </span>
              </p>
              <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/80 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles size={15} className="text-violet-600" /> Give AI access to all students</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">Enable AI hints, performance insights and AI test coaching for every current and future student.</p>
                  </div>
                  <Button
                    type="button"
                    className={aiAccessForAllStudents ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-violet-600 text-white hover:bg-violet-700"}
                    onClick={() => void toggleGlobalAiAccess()}
                    data-testid="button-toggle-global-ai-access"
                  >
                    {aiAccessForAllStudents ? "Disable for all" : "Give access to all"}
                  </Button>
                </div>
                <p className={`mt-2 text-xs font-semibold ${aiAccessForAllStudents ? "text-emerald-700" : "text-slate-500"}`}>
                  {aiAccessForAllStudents ? "Global AI access is active for all students." : "Global AI access is currently off; individual priority access still applies."}
                </p>
              </div>
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-slate-900">Give priority access</p>
                  <p className="text-xs leading-5 text-slate-600">Select a student who should continue using the platform while this access window is paused.</p>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={priorityStudentId}
                    onChange={(event) => setPriorityStudentId(event.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-800 outline-none ring-amber-300 focus:ring-2"
                    data-testid="select-priority-access-student"
                  >
                    <option value="">Select a student</option>
                    {accessWindowStudents.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.fullName} · {student.username}{student.priorityAccess ? " · Priority" : ""}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    className={selectedPriorityStudent?.priorityAccess
                      ? "border-rose-200 text-rose-700 hover:bg-rose-50"
                      : "border-amber-300 bg-white text-amber-800 hover:bg-amber-100"}
                    disabled={!selectedPriorityStudent || savingPriorityAccess}
                    onClick={() => void updatePriorityAccess()}
                    data-testid="button-toggle-priority-access"
                  >
                    {savingPriorityAccess ? "Saving…" : selectedPriorityStudent?.priorityAccess ? "Remove Priority" : "Give Priority"}
                  </Button>
                </div>
                {selectedPriorityStudent ? (
                  <p className="mt-2 text-xs font-medium text-amber-800">
                    {selectedPriorityStudent.priorityAccess ? "Priority access is currently active for this student." : "Priority access is currently off for this student."}
                    {` AI uses: ${getAiUsageCount(selectedPriorityStudent).toLocaleString()}.`}
                  </p>
                ) : null}
                <div className="mt-4 border-t border-amber-200 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">Students with priority access</p>
                    <Badge variant="secondary" className="rounded-full bg-amber-100 text-amber-800">
                      {priorityStudents.length}
                    </Badge>
                  </div>
                  {priorityStudents.length > 0 ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {priorityStudents.map((student) => (
                        <button
                          key={student.id}
                          type="button"
                          onClick={() => setPriorityStudentId(String(student.id))}
                          className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2 text-left transition hover:border-amber-400 hover:bg-amber-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-900">{student.fullName}</span>
                            <span className="block truncate text-xs text-slate-500">{student.email || student.username}</span>
                            <span className="mt-1 block text-xs font-medium text-violet-700">AI uses: {getAiUsageCount(student).toLocaleString()}</span>
                          </span>
                          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Active</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-xl border border-dashed border-amber-200 bg-white/60 px-3 py-3 text-xs text-slate-500">
                      Abhi kisi student ko priority access nahi diya gaya hai.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </TiltCard>

      <TiltCard>
      <Card className="border-orange-200/70 bg-white shadow-[0_20px_48px_rgba(15,23,42,0.14)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail size={14} className="text-orange-500" /> Student Review Email Automation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="rounded-2xl border border-orange-200/80 bg-orange-50/70 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-slate-900">Send new setup review emails</p>
                <p className="max-w-3xl text-xs leading-5 text-slate-600">
                  Send a full student profile summary to the super admin inbox as soon as onboarding is completed.
                </p>
              </div>
              <div className="flex items-center gap-3 self-start rounded-full border border-orange-200 bg-white px-3 py-2 shadow-sm">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-700">
                  {reviewEmailEnabled ? "On" : "Off"}
                </span>
                <Switch
                  checked={reviewEmailEnabled}
                  disabled={savingSetting !== null}
                  onCheckedChange={(checked) => updateStudentReviewSetting({ emailEnabled: checked }, "email")}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-orange-200/80 bg-amber-50/60 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">Enable email approve/reject buttons</p>
                  <MousePointerClick size={13} className="text-amber-500" />
                </div>
                <p className="max-w-3xl text-xs leading-5 text-slate-600">
                  Show direct approve and reject action buttons inside the email. Turning this off disables those links immediately.
                </p>
              </div>
              <div className="flex items-center gap-3 self-start rounded-full border border-orange-200 bg-white px-3 py-2 shadow-sm">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-700">
                  {reviewQuickActionsEnabled ? "On" : "Off"}
                </span>
                <Switch
                  checked={reviewQuickActionsEnabled}
                  disabled={savingSetting !== null}
                  onCheckedChange={(checked) => updateStudentReviewSetting({ quickActionsEnabled: checked }, "actions")}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-orange-200/70 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Recipients
                </p>
                <p className="text-sm text-slate-700">
                  Super admin inboxes receiving new setup review emails.
                </p>
              </div>
              <Badge variant="secondary" className="w-fit border border-orange-200 bg-orange-100 text-orange-800 hover:bg-orange-100">
                {studentReviewAutomation.recipientsCount} recipient{studentReviewAutomation.recipientsCount === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(studentReviewAutomation.recipientEmails ?? []).length > 0 ? (
                (studentReviewAutomation.recipientEmails ?? []).slice(0, 4).map((email: string) => (
                  <span key={email} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm">
                    {email}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500">No recipient email configured yet.</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      </TiltCard>

      {/* ── Email Quota Card ── */}
      {emailQuota && (() => {
        const provider = emailQuota.providers?.[0];
        if (!provider) return null;
        const used = provider.usedToday ?? 0;
        const limit = provider.dailyLimit ?? 500;
        const remaining = provider.remainingDaily ?? Math.max(0, limit - used);
        const pct = Math.min(100, Math.round((used / limit) * 100));
        const isWarning = pct >= 70 && pct < 90;
        const isDanger = pct >= 90;
        const barColor = isDanger ? "#ef4444" : isWarning ? "#f59e0b" : "#22c55e";
        const hourly: any[] = emailQuota.hourlyToday ?? [];
        const daily: any[] = emailQuota.daily7Days ?? [];
        return (
          <TiltCard>
          <Card className="border-orange-200/70 bg-white shadow-[0_20px_48px_rgba(15,23,42,0.14)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Send size={14} className="text-orange-500" /> Daily Email Quota
                </CardTitle>
                <button
                  onClick={() => refetchQuota()}
                  disabled={quotaFetching}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition"
                >
                  <RefreshCw size={13} className={quotaFetching ? "animate-spin" : ""} />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              {/* Gauge row */}
              <div className="rounded-2xl border border-orange-200/80 bg-orange-50/70 p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Today's usage — {provider.senderEmail}</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {used.toLocaleString()}
                      <span className="text-sm font-normal text-gray-400"> / {limit.toLocaleString()} emails</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-0.5">Remaining</p>
                    <p className={`text-2xl font-bold ${isDanger ? "text-red-600" : isWarning ? "text-amber-600" : "text-emerald-600"}`}>
                      {remaining.toLocaleString()}
                    </p>
                  </div>
                </div>
                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>0</span>
                    <span className={`font-semibold ${isDanger ? "text-red-600" : isWarning ? "text-amber-600" : "text-emerald-600"}`}>
                      {pct}% used
                    </span>
                    <span>{limit}</span>
                  </div>
                  <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: barColor }}
                    />
                  </div>
                </div>
                {isDanger && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertCircle size={13} /> Quota almost exhausted — emails may not be delivered today.
                  </div>
                )}
                {isWarning && !isDanger && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertCircle size={13} /> Over 70% quota used — use email sparingly today.
                  </div>
                )}
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Hourly today */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Today — By Hour</p>
                  {hourly.length > 0 ? (
                    <ResponsiveContainer width="100%" height={120}>
                      <BarChart data={hourly} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                        <XAxis dataKey="hour" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 8 }} allowDecimals={false} />
                        <Tooltip contentStyle={{ fontSize: "10px", borderRadius: "8px" }} />
                        <Bar dataKey="sent" name="Sent" radius={[3, 3, 0, 0]}>
                          {hourly.map((_: any, i: number) => (
                            <Cell key={i} fill="#f97316" fillOpacity={0.8} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-28 flex items-center justify-center text-xs text-gray-400">No emails sent today yet</div>
                  )}
                </div>
                {/* 7-day trend */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Last 7 Days</p>
                  {daily.length > 0 ? (
                    <ResponsiveContainer width="100%" height={120}>
                      <BarChart data={daily} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                        <XAxis dataKey="day" tick={{ fontSize: 8 }} tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 8 }} allowDecimals={false} />
                        <Tooltip contentStyle={{ fontSize: "10px", borderRadius: "8px" }} labelFormatter={(v) => `Date: ${v}`} />
                        <Bar dataKey="sent" name="Sent" radius={[3, 3, 0, 0]}>
                          {daily.map((_: any, i: number) => (
                            <Cell key={i} fill="#8b5cf6" fillOpacity={0.8} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-28 flex items-center justify-center text-xs text-gray-400">No email history yet</div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <p className="text-center text-[10px] text-gray-400">
                Gmail SMTP · Resets daily at midnight IST · Auto-refreshes every 60s
              </p>
            </CardContent>
          </Card>
          </TiltCard>
        );
      })()}

      {/* ── 3-column section ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Sign-up trend chart */}
        <TiltCard className="lg:col-span-1">
        <Card className="border-[#E5E7EB] bg-white shadow-sm lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp size={14} className="text-emerald-500" /> 7-Day Signup Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gStudents" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gAdmins" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                  <Area type="monotone" dataKey="Students" stroke="#8b5cf6" fill="url(#gStudents)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="Admins" stroke="#3b82f6" fill="url(#gAdmins)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-xs">No signup data yet</div>
            )}
            <div className="flex gap-4 mt-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-violet-500" /> Students
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-blue-500" /> Teachers
              </div>
            </div>
          </CardContent>
        </Card>
        </TiltCard>

        {/* Teacher leaderboard */}
        <TiltCard>
        <Card className="border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Trophy size={14} className="text-amber-500" /> Top Teachers
              </CardTitle>
              <Link href="/super-admin/teacher-performance">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground">
                  See all <ArrowRight size={11} />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {(d.topTeachers ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No teacher activity yet</p>
            ) : (
              <div className="space-y-1">
                {(d.topTeachers ?? []).map((t: any, i: number) => (
                  <TeacherRow key={t.id} teacher={t} rank={i + 1} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </TiltCard>

        {/* Pending approvals */}
        <TiltCard>
        <Card className="border-amber-200/70 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock size={14} className="text-amber-500" /> Pending Approvals
                {d.pendingStudents > 0 && (
                  <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {d.pendingStudents}
                  </span>
                )}
              </CardTitle>
              <Link href="/super-admin/students">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground">
                  All <ArrowRight size={11} />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {(d.pendingApprovals ?? []).length === 0 ? (
              <div className="flex flex-col items-center py-5 text-muted-foreground gap-1.5">
                <CheckCircle size={24} className="text-emerald-500 opacity-60" />
                <p className="text-xs">All caught up!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(d.pendingApprovals ?? []).slice(0, 5).map((student: any) => (
                  <div key={student.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
                    <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-700 dark:text-amber-300 text-xs font-bold shrink-0">
                      {getInitials(student.fullName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{student.fullName}</p>
                      <p className="text-[10px] text-muted-foreground">@{student.username}</p>
                    </div>
                    <Button
                      size="sm"
                      className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 shrink-0"
                      disabled={approvingId === student.id}
                      onClick={() => handleApprove(student.id, student.fullName)}
                    >
                      {approvingId === student.id ? (
                        <span className="w-2.5 h-2.5 border border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <CheckCircle size={10} className="mr-0.5" />
                      )}
                      Approve
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </TiltCard>
      </div>

      {/* ── Bottom row: recent people ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Recent admins */}
        <TiltCard>
        <Card className="border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield size={14} className="text-blue-500" /> Recent Teachers
              </CardTitle>
              <Link href="/super-admin/admins">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground">
                  Manage <ArrowRight size={11} />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {(d.recentAdmins ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No teachers added yet</p>
            ) : (
              (d.recentAdmins ?? []).map((admin: any) => (
                <div key={admin.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/50 transition-colors" data-testid={`admin-item-${admin.id}`}>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {getInitials(admin.fullName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{admin.fullName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      @{admin.username}{admin.subject ? ` · ${formatExamDisplayName(admin.subject) || admin.subject}` : ""}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[9px] shrink-0">Admin</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        </TiltCard>

        {/* Recent students */}
        <TiltCard>
        <Card className="border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <GraduationCap size={14} className="text-violet-500" /> Recent Students
              </CardTitle>
              <Link href="/super-admin/students">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground">
                  All <ArrowRight size={11} />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {(d.recentStudents ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No students yet</p>
            ) : (
              (d.recentStudents ?? []).map((student: any) => (
                <div key={student.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/50 transition-colors" data-testid={`student-item-${student.id}`}>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {getInitials(student.fullName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{student.fullName}</p>
                    <p className="text-[10px] text-muted-foreground">@{student.username}</p>
                  </div>
                  <Badge
                    className="text-[9px] shrink-0"
                    variant={student.status === "approved" ? "default" : student.status === "pending" ? "outline" : "destructive"}
                  >
                    {student.status === "approved" && <CheckCircle size={9} className="mr-0.5" />}
                    {student.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        </TiltCard>
      </div>

      {/* ── AI API Keys Card ── */}
      <AiApiKeysCard />

    </div>
    </DashboardScene>
  );
}

/* ─── AI API Keys Card ──────────────────────────────────────────────────────── */
const PROVIDERS = [
  { value: "openrouter", label: "OpenRouter", icon: "🔗", placeholder: "sk-or-...", hint: "openrouter.ai — Claude, Gemini, GPT sab ek key se" },
  { value: "openai",     label: "OpenAI",     icon: "🤖", placeholder: "sk-...",    hint: "platform.openai.com — GPT-4o-mini" },
  { value: "anthropic",  label: "Anthropic",  icon: "🧠", placeholder: "sk-ant-...", hint: "console.anthropic.com — Claude 3.5 Haiku" },
  { value: "google",     label: "Google",     icon: "✨", placeholder: "AIza...",   hint: "aistudio.google.com — Gemini 2.0 Flash" },
  { value: "groq",       label: "Groq",       icon: "⚡", placeholder: "gsk_...",   hint: "console.groq.com — Llama 3.3 70B (fast, free)" },
];

interface SavedKey { id: string; label: string; provider: string; masked: string; priority: number; }

function AiApiKeysCard() {
  const [keys, setKeys] = useState<SavedKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("openrouter");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl(`/api/ai-config/apikeys`), { credentials: "include" });
      if (res.ok) setKeys(await res.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) { setError("API key empty nahi ho sakti"); return; }
    setError(null); setSaving(true);
    try {
      const res = await fetch(buildApiUrl(`/api/ai-config/apikeys`), {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ label: label.trim() || undefined, apiKey: apiKey.trim(), provider }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setLabel(""); setApiKey("");
        await load();
        toast({ title: "API key saved" });
      } else { setError(data.error || "Failed to save"); }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(buildApiUrl(`/api/ai-config/apikeys/${id}`), { method: "DELETE", credentials: "include" });
      await load();
    } finally { setDeleting(null); }
  };

  const providerBadge: Record<string, string> = {
    openrouter: "bg-purple-100 text-purple-700",
    openai:     "bg-green-100 text-green-700",
    anthropic:  "bg-orange-100 text-orange-700",
    google:     "bg-blue-100 text-blue-700",
    groq:       "bg-yellow-100 text-yellow-700",
  };

  const sel = PROVIDERS.find((p) => p.value === provider)!;

  return (
    <TiltCard>
    <Card className="border-violet-200/70 bg-white shadow-[0_20px_48px_rgba(15,23,42,0.14)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles size={14} className="text-violet-500" /> AI API Keys
          <span className="ml-1 text-xs font-normal text-slate-400">(Question Metadata Generator ke liye)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {/* Existing keys */}
        {loading ? (
          <p className="text-xs text-slate-400 py-2">Loading…</p>
        ) : keys.length > 0 ? (
          <div className="space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-xl border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${providerBadge[k.provider] ?? "bg-gray-100 text-gray-700"}`}>{k.provider}</span>
                <span className="flex-1 min-w-0 text-xs font-medium text-slate-700 truncate">{k.label}</span>
                <span className="font-mono text-[11px] text-slate-400">{k.masked}</span>
                <button onClick={() => handleDelete(k.id)} disabled={deleting === k.id}
                  className="p-1 rounded hover:bg-red-50 hover:text-red-500 text-slate-300 transition-colors disabled:opacity-50">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-1">Koi key configure nahi hai abhi tak.</p>
        )}

        {/* Add new key */}
        <div className="rounded-2xl border border-violet-200/80 bg-violet-50/40 p-4 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">New Key Add Karo</p>

          {/* Provider tabs */}
          <div className="flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => (
              <button key={p.value} type="button" onClick={() => setProvider(p.value)}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${provider === p.value ? "border-violet-400 bg-violet-100 text-violet-700" : "border-[#E5E7EB] text-slate-500 hover:bg-white"}`}>
                <span>{p.icon}</span>{p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 rounded-lg bg-white/70 px-3 py-1.5">{sel.hint}</p>

          <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)"
              className="w-32 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-300" />
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={sel.placeholder} required autoComplete="off"
              className="flex-1 min-w-[160px] rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-mono placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-300" />
            <button type="submit" disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
              {saving ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />} Add
            </button>
          </form>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </CardContent>
    </Card>
    </TiltCard>
  );
}
