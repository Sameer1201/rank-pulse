import { useMemo } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Activity,
  ArrowUpRight,
  Bookmark,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  Clock3,
  Eye,
  Flame,
  Globe2,
  GraduationCap,
  Hash,
  LogIn,
  Landmark,
  MessageCircle,
  Mail,
  MapPin,
  PenLine,
  Percent,
  Phone,
  Search,
  Shield,
  Target,
  Trophy,
  TrendingUp,
  User,
  UserCheck,
  XCircle,
} from "lucide-react";
import { formatExamDisplayName, formatExamDisplayNames } from "@/lib/exam-display";

const ACTIVITY_COLORS = ["#f59e0b", "#fb923c", "#fcd34d", "#fdba74"];
const HEATMAP_COLORS = ["#e2e8f0", "#fde68a", "#fb923c", "#f97316", "#c2410c"];

export interface StudentProfileInsights {
  student: {
    id: number;
    username: string;
    fullName: string;
    email: string;
    phone: string | null;
    status: string;
    subject: string | null;
    additionalExams: string[];
    avatarUrl: string | null;
    onboardingComplete: boolean;
    approvedAt: string | null;
    approverName: string | null;
    rejectionReason: string | null;
    createdAt: string;
    profileDetails: Record<string, unknown> | null;
  };
  overview: {
    testsAttempted: number;
    averageScore: number;
    bestScore: number;
    latestScore: number;
    passRate: number;
    savedQuestions: number;
    solvedQuestions: number;
    trackedPracticeQuestions: number;
    practiceAccuracy: number;
    totalPracticeAttempts: number;
    activeDaysLast7: number;
    accountAgeDays: number;
    lastActiveAt: string | null;
  };
  profileCompletion: {
    percent: number;
    completedSteps: number;
    totalSteps: number;
    steps: Array<{
      key: string;
      label: string;
      complete: boolean;
    }>;
  };
  scoreTrend: Array<{
    label: string;
    title: string;
    percentage: number;
    score: number;
    totalPoints: number;
    submittedAt: string | null;
    passed: boolean;
  }>;
  testHistory: Array<{
    id: number;
    testId: number;
    title: string;
    score: number;
    totalPoints: number | null;
    percentage: number;
    passed: boolean | null;
    submittedAt: string | null;
  }>;
  testsPaymentHistory: Array<{
    paidAt: string;
    amount: number;
    orderId: string;
    paymentId: string;
    cycle: number;
  }>;
  testsLockEvents: Array<{
    lockedAt: string;
    lockedByAdminId: number | null;
    cycle: number;
  }>;
  activityTrend: Array<{
    label: string;
    count: number;
    date: string;
  }>;
  activityBreakdown: Array<{
    name: string;
    value: number;
  }>;
  recentActivity: Array<{
    id: number;
    action: string;
    page: string | null;
    detail: string | null;
    createdAt: string;
  }>;
  studyStreak: {
    heatmap: Array<{
      date: string;
      count: number;
      level: number;
    }>;
    currentStreak: number;
    longestStreak: number;
    totalActiveDays: number;
  };
  questionBankPerformance: Array<{
    key?: string;
    subject: string;
    attempted: number;
    correct: number;
    accuracy: number;
  }>;
  pyqPerformance?: Array<{
    key: string;
    exam: string;
    subject: string;
    attempted: number;
    correct: number;
    accuracy: number;
  }>;
  pyqPerformanceUnavailable?: string[];
  sessionsHistory: Array<{
    id: number;
    startedAt: string;
    lastActiveAt: string;
    endedAt: string | null;
    totalSeconds: number;
    isActive: boolean;
    ipAddress: string | null;
    locationLabel: string | null;
    browserName: string | null;
    deviceType: string | null;
  }>;
  emailHistory: Array<{
    id: number;
    providerKey: string;
    providerName: string;
    senderEmail: string;
    recipientEmail: string;
    subject: string;
    messageType: string;
    status: string;
    sentAt: string;
  }>;
  preparationSnapshot: {
    dateOfBirth: string | null;
    whatsappOnSameNumber: boolean;
    whatsappNumber: string;
    address: {
      country: string;
      state: string;
      district: string;
      street: string;
      city: string;
      pincode: string;
    };
    preparation: {
      classLevel: string;
      board: string;
      targetYear: string;
      targetExam: string;
      institutionName: string;
      collegeName: string;
      universityName: string;
    };
    learningMode: {
      mode: string;
      provider: string;
    };
    hearAboutUs: string;
  };
}

function formatDateSafe(value: string | null | undefined, pattern = "MMM d, yyyy") {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Not available" : format(parsed, pattern);
}

function formatRelativeSafe(value: string | null | undefined) {
  if (!value) return "No recent activity";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "No recent activity" : formatDistanceToNowStrict(parsed, { addSuffix: true });
}

function formatDurationShort(totalSeconds: number | null | undefined) {
  const safeSeconds = Math.max(0, totalSeconds ?? 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${safeSeconds}s`;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getStatusVariant(status: string): "default" | "outline" | "destructive" | "secondary" {
  if (status === "approved" || status === "active") return "default";
  if (status === "pending") return "outline";
  return "destructive";
}

function getPreparationInstitutionMeta(preparation: StudentProfileInsights["preparationSnapshot"]["preparation"]) {
  const collegeStages = new Set(["Clg 1st", "Clg 2nd", "Clg 3rd", "Clg 4th", "Graduated", "College 1st Year", "College 2nd Year", "College 3rd Year", "College 4th Year", "Graduate"]);
  const isCollegePreparation = collegeStages.has(preparation.classLevel.trim()) || preparation.board.trim() === "UG University";
  const institutionValue = preparation.collegeName.trim() || preparation.institutionName.trim() || "Not provided";

  return {
    isUgUniversity: isCollegePreparation,
    institutionLabel: isCollegePreparation ? "College" : "School / College",
    institutionValue,
    universityValue: isCollegePreparation ? (preparation.universityName.trim() || "Not provided") : "",
  };
}

function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function StatCard({
  label,
  value,
  helper,
  icon,
  iconColor = "#f97316",
  iconBg = "#f9731620",
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
  iconColor?: string;
  iconBg?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">{label}</p>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: iconBg, color: iconColor }}>
          {icon}
        </div>
      </div>
      <p className="text-3xl font-black leading-none tracking-tight text-slate-900">{value}</p>
      <p className="mt-2 text-xs text-slate-400">{helper}</p>
      <div className="absolute bottom-0 right-0 h-20 w-20 translate-x-6 translate-y-6 rounded-full opacity-5" style={{ backgroundColor: iconColor }} />
    </div>
  );
}

function AccuracyBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
    </div>
  );
}

function PyqPerformanceCard({ insights }: { insights: StudentProfileInsights }) {
  const rows = insights.pyqPerformance ?? [];
  const unavailable = insights.pyqPerformanceUnavailable ?? [];
  const attempted = rows.reduce((sum, row) => sum + row.attempted, 0);
  const correct = rows.reduce((sum, row) => sum + row.correct, 0);
  const accuracy = attempted ? Math.round(correct / attempted * 1000) / 10 : 0;
  return (
    <SectionCard
      title="PYQ Performance"
      subtitle={unavailable.length ? `${attempted} recorded attempts · available data` : `${attempted} attempts · ${accuracy}% overall accuracy`}
      icon={<BookOpen className="h-4 w-4" />}
      color="#8b5cf6"
      bg="#8b5cf620"
      badge={<span className="inline-flex items-center gap-1.5 rounded-full border border-teal-100 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-600"><CheckCheck className="h-3 w-3" /> {correct} correct</span>}
    >
      {unavailable.length > 0 && <p role="status" className="border-b px-6 py-3 text-xs text-muted-foreground">Some PYQ data is temporarily unavailable: {unavailable.join(", ")}. Reopen the profile to retry.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="PYQ performance by exam and subject">
          <thead>
            <tr className="border-b bg-slate-50">
              {["Exam", "Subject", "Attempted", "Correct", "Accuracy"].map((header, index) => (
                <th key={header} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 ${index === 2 || index === 3 ? "text-right" : "text-left"}`}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">{unavailable.length ? "PYQ performance could not be fully loaded." : "PYQ performance will appear after practice attempts."}</td></tr>
            ) : rows.map((item, index) => {
              const color = ACTIVITY_COLORS[index % ACTIVITY_COLORS.length];
              return (
                <tr key={item.key} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3.5 text-xs text-muted-foreground">{item.exam}</td>
                  <td className="px-4 py-3.5 font-semibold text-foreground"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />{item.subject}</div></td>
                  <td className="px-4 py-3.5 text-right font-semibold text-foreground">{item.attempted}</td>
                  <td className="px-4 py-3.5 text-right font-semibold" style={{ color }}>{item.correct}</td>
                  <td className="px-4 py-3.5"><div className="flex min-w-[100px] items-center gap-3"><div className="flex-1"><AccuracyBar value={item.accuracy} color={color} /></div><span className="text-right text-xs font-bold text-muted-foreground">{item.accuracy}%</span></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function SectionCard({
  title,
  subtitle,
  icon,
  color,
  bg,
  badge,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: bg, color }}>
            {icon}
          </div>
          <div>
            <h2 className="font-bold text-slate-800">{title}</h2>
            {subtitle ? <p className="text-xs text-slate-400">{subtitle}</p> : null}
          </div>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

function SnapshotTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value || "Not provided"}</p>
    </div>
  );
}

function ReviewField({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-amber-200/70 bg-white/90 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {icon ? (
          <div className="mt-0.5 text-amber-600">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">{label}</p>
          <p className="mt-2 break-words text-sm font-semibold leading-6 text-slate-900">{value || "Not provided"}</p>
        </div>
      </div>
    </div>
  );
}

function ReviewSummaryRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3">
      <div className="grid items-start gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
        <div className="flex items-center gap-2 text-amber-700">
          {icon ? <span className="shrink-0">{icon}</span> : null}
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em]">{label}</p>
        </div>
        <p className="min-w-0 break-words text-sm font-semibold leading-6 text-slate-900">
          {value || "Not provided"}
        </p>
      </div>
    </div>
  );
}

export function StudentProfileInsightsPanel({
  insights,
  viewerLabel = "Verification review",
  mode = "full",
}: {
  insights: StudentProfileInsights;
  viewerLabel?: string;
  mode?: "full" | "submittedOnly";
}) {
  const primaryExam = useMemo(
    () => formatExamDisplayName(insights.preparationSnapshot.preparation.targetExam.trim() || insights.student.subject?.trim() || ""),
    [insights.preparationSnapshot.preparation.targetExam, insights.student.subject],
  );
  const exams = useMemo(
    () => formatExamDisplayNames([primaryExam, ...(insights.student.additionalExams ?? [])]),
    [insights.student.additionalExams, primaryExam],
  );
  const additionalExamLabels = useMemo(
    () => formatExamDisplayNames(insights.student.additionalExams ?? []),
    [insights.student.additionalExams],
  );
  const learningProvider = useMemo(
    () =>
      insights.preparationSnapshot.learningMode.provider
      || (insights.preparationSnapshot.learningMode.mode === "Self Study using Free Resources"
        ? "Self Study using Free Resources"
        : ""),
    [insights.preparationSnapshot.learningMode.mode, insights.preparationSnapshot.learningMode.provider],
  );
  const preparationInstitution = useMemo(
    () => getPreparationInstitutionMeta(insights.preparationSnapshot.preparation),
    [insights.preparationSnapshot.preparation],
  );

  const location = [
    insights.preparationSnapshot.address.street,
    insights.preparationSnapshot.address.city,
    insights.preparationSnapshot.address.district,
    insights.preparationSnapshot.address.state,
    insights.preparationSnapshot.address.country,
  ]
    .filter(Boolean)
    .join(", ");
  const isSubmittedOnly = mode === "submittedOnly";

  const completionStepDetails = useMemo(() => {
    const detailMap: Record<string, Array<{ label: string; value: string }>> = {
      personal: [
        { label: "Full name", value: insights.student.fullName },
        { label: "Email", value: insights.student.email },
        { label: "Phone", value: insights.student.phone || "Not provided" },
        { label: "Date of birth", value: formatDateSafe(insights.preparationSnapshot.dateOfBirth, "dd MMM yyyy") },
        {
          label: "WhatsApp",
          value: insights.preparationSnapshot.whatsappOnSameNumber
            ? `Same as phone${insights.student.phone ? ` (${insights.student.phone})` : ""}`
            : insights.preparationSnapshot.whatsappNumber || "Not provided",
        },
      ],
      address: [
        { label: "Country", value: insights.preparationSnapshot.address.country || "Not provided" },
        { label: "State", value: insights.preparationSnapshot.address.state || "Not provided" },
        { label: "District", value: insights.preparationSnapshot.address.district || "Not provided" },
        { label: "Street", value: insights.preparationSnapshot.address.street || "Not provided" },
        { label: "City", value: insights.preparationSnapshot.address.city || "Not provided" },
        { label: "Pincode", value: insights.preparationSnapshot.address.pincode || "Not provided" },
      ],
      preparation: [
        { label: "Stage", value: insights.preparationSnapshot.preparation.classLevel || "Not provided" },
        { label: preparationInstitution.institutionLabel, value: preparationInstitution.institutionValue },
        ...(preparationInstitution.isUgUniversity
          ? [{ label: "University", value: preparationInstitution.universityValue }]
          : []),
        { label: "Target year", value: insights.preparationSnapshot.preparation.targetYear || "Not provided" },
        { label: "Target exam", value: formatExamDisplayName(insights.preparationSnapshot.preparation.targetExam) || "Not provided" },
      ],
      learning: [
        { label: "Mode", value: insights.preparationSnapshot.learningMode.mode || "Not provided" },
        { label: "Provider", value: insights.preparationSnapshot.learningMode.provider || "Not provided" },
      ],
      discovery: [
        { label: "Lead source", value: insights.preparationSnapshot.hearAboutUs || "Not provided" },
        { label: "Joined", value: formatDateSafe(insights.student.createdAt) },
      ],
    };

    return insights.profileCompletion.steps.map((step) => ({
      ...step,
      details: detailMap[step.key] ?? [],
    }));
  }, [insights, preparationInstitution.institutionLabel, preparationInstitution.institutionValue, preparationInstitution.isUgUniversity, preparationInstitution.universityValue]);

  const heatmapWeeks = useMemo(
    () => {
      const days = insights.studyStreak.heatmap.slice(-28);
      return Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7));
    },
    [insights.studyStreak.heatmap],
  );

  const heatmapWeekLabels = useMemo(
    () => heatmapWeeks.map((week) => formatDateSafe(week[0]?.date, "MMM d")),
    [heatmapWeeks],
  );

  const emailSummary = useMemo(() => ({
    totalSent: insights.emailHistory.filter((item) => item.status === "sent").length,
    failed: insights.emailHistory.filter((item) => item.status !== "sent").length,
    passwordResets: insights.emailHistory.filter((item) => item.messageType === "password_reset").length,
    approvalEmails: insights.emailHistory.filter((item) => item.messageType === "student_approved").length,
  }), [insights.emailHistory]);

  const scoreMomentumData = useMemo(
    () =>
      insights.scoreTrend.map((item) => ({
        ...item,
        avg: insights.overview.averageScore,
        score: item.percentage,
      })),
    [insights.overview.averageScore, insights.scoreTrend],
  );

  const activityTimeline = useMemo(
    () =>
      insights.recentActivity.map((item) => {
        const action = item.action.toLowerCase();
        const isLogin = action.includes("login");
        return {
          ...item,
          icon: isLogin ? LogIn : Eye,
          color: isLogin ? "#8b5cf6" : "#0ea5e9",
          title: item.action.replace(/_/g, " "),
          detailText: [item.page, item.detail].filter(Boolean).join(" · ") || "No extra details",
        };
      }),
    [insights.recentActivity],
  );

  const questionBankTotals = useMemo(() => {
    const attempted = insights.questionBankPerformance.reduce((sum, item) => sum + item.attempted, 0);
    const correct = insights.questionBankPerformance.reduce((sum, item) => sum + item.correct, 0);
    return {
      attempted,
      correct,
      accuracy: attempted > 0 ? Math.round((correct / attempted) * 1000) / 10 : 0,
    };
  }, [insights.questionBankPerformance]);

  if (isSubmittedOnly) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.15fr]">
          <Card className="overflow-hidden border-amber-200/80 bg-gradient-to-br from-white via-amber-50/55 to-orange-50/70 shadow-sm">
            <CardContent className="p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <Avatar className="h-24 w-24 ring-4 ring-amber-100">
                  <AvatarImage src={insights.student.avatarUrl ?? undefined} alt={insights.student.fullName} />
                  <AvatarFallback className="bg-gradient-to-br from-amber-500 to-orange-600 text-2xl font-bold text-white">
                    {getInitials(insights.student.fullName)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1 space-y-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-3xl font-black tracking-tight text-slate-900">{insights.student.fullName}</h2>
                      <Badge variant={getStatusVariant(insights.student.status)} className="capitalize">
                        {insights.student.status}
                      </Badge>
                      {insights.student.onboardingComplete ? (
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                          Setup complete
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">@{insights.student.username}</p>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Student-submitted application details for approval review.
                    </p>
                  </div>

                  <div className="grid items-start gap-3 xl:grid-cols-[0.95fr_1.05fr]">
                    <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-700">Exam focus</p>
                      <div className="mt-3 space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {exams.length > 0 ? (
                            exams.map((exam) => (
                              <Badge
                                key={exam}
                                variant="secondary"
                                className="rounded-full bg-amber-100 px-3 py-1 text-amber-800 hover:bg-amber-100"
                              >
                                {exam}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">Target exam not provided</span>
                          )}
                        </div>

                        <ReviewSummaryRow
                          label="Primary exam"
                          value={primaryExam || "Not provided"}
                          icon={<Target size={15} />}
                        />
                        <ReviewSummaryRow
                          label="Selected exams"
                          value={exams.length > 0 ? `${exams.length} exam${exams.length > 1 ? "s" : ""} selected` : "No exam added"}
                          icon={<CheckCheck size={15} />}
                        />
                        <ReviewSummaryRow
                          label="Additional exams"
                          value={exams.slice(1).join(", ") || "No additional exams"}
                          icon={<Bookmark size={15} />}
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-700">Quick review</p>
                      <div className="mt-3 space-y-3">
                        <ReviewSummaryRow
                          label="Target year"
                          value={insights.preparationSnapshot.preparation.targetYear || "Not provided"}
                          icon={<CalendarDays size={15} />}
                        />
                        <ReviewSummaryRow
                          label="Learning mode"
                          value={
                            [insights.preparationSnapshot.learningMode.mode, learningProvider]
                              .map((item) => item.trim())
                              .filter((item, index, all) => Boolean(item) && all.indexOf(item) === index)
                              .join(" · ")
                            || "Not provided"
                          }
                          icon={<BookOpen size={15} />}
                        />
                        <ReviewSummaryRow
                          label="Current stage"
                          value={insights.preparationSnapshot.preparation.classLevel || "Not provided"}
                          icon={<GraduationCap size={15} />}
                        />
                        <ReviewSummaryRow
                          label={preparationInstitution.institutionLabel}
                          value={preparationInstitution.institutionValue}
                          icon={<Building2 size={15} />}
                        />
                        {preparationInstitution.isUgUniversity ? (
                          <ReviewSummaryRow
                            label="University"
                            value={preparationInstitution.universityValue}
                            icon={<Landmark size={15} />}
                          />
                        ) : null}
                        <ReviewSummaryRow
                          label="Lead source"
                          value={insights.preparationSnapshot.hearAboutUs || "Not provided"}
                          icon={<Search size={15} />}
                        />
                      </div>
                    </div>
                  </div>

                  {insights.student.rejectionReason ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-900">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-600">Previous rejection reason</p>
                      <p className="mt-2 leading-6">{insights.student.rejectionReason}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200/80 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target size={18} className="text-amber-600" />
                <span>Review summary</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-3xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-4xl font-black tracking-tight text-slate-900">{insights.profileCompletion.percent}%</p>
                    <p className="text-sm text-muted-foreground">
                      {insights.profileCompletion.completedSteps} of {insights.profileCompletion.totalSteps} blocks completed
                    </p>
                  </div>
                  <Badge variant="secondary" className="bg-white text-amber-700 hover:bg-white">
                    {viewerLabel}
                  </Badge>
                </div>
                <Progress value={insights.profileCompletion.percent} className="mt-4 h-3 bg-amber-100" />
              </div>

              <div className="space-y-2">
                {completionStepDetails.map((step) => (
                  <div
                    key={step.key}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
                      step.complete
                        ? "border-emerald-200 bg-emerald-50/70"
                        : "border-amber-200/70 bg-amber-50/60"
                    }`}
                  >
                    <span className="text-sm font-semibold text-slate-900">{step.label}</span>
                    <Badge
                      variant="secondary"
                      className={
                        step.complete
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                          : "bg-amber-100 text-amber-700 hover:bg-amber-100"
                      }
                    >
                      {step.complete ? "Ready" : "Missing"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User size={18} className="text-amber-600" />
                <span>Contact details</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <ReviewField label="Email" value={insights.student.email} icon={<Mail size={18} />} />
                </div>
                <ReviewField label="Phone number" value={insights.student.phone || "Not provided"} icon={<Phone size={18} />} />
                <ReviewField
                  label="WhatsApp number"
                  value={
                    insights.preparationSnapshot.whatsappOnSameNumber
                      ? `Same as phone${insights.student.phone ? ` (${insights.student.phone})` : ""}`
                      : insights.preparationSnapshot.whatsappNumber || "Not provided"
                  }
                  icon={<MessageCircle size={18} />}
                />
                <ReviewField
                  label="Date of birth"
                  value={formatDateSafe(insights.preparationSnapshot.dateOfBirth, "dd MMM yyyy")}
                  icon={<CalendarDays size={18} />}
                />
                <ReviewField label="Username" value={`@${insights.student.username}`} icon={<User size={18} />} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap size={18} className="text-amber-600" />
                <span>College & target</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                <ReviewField
                  label="Current stage"
                  value={insights.preparationSnapshot.preparation.classLevel || "Not provided"}
                  icon={<GraduationCap size={18} />}
                />
                <ReviewField
                  label={preparationInstitution.institutionLabel}
                  value={preparationInstitution.institutionValue}
                  icon={<Building2 size={18} />}
                />
                {preparationInstitution.isUgUniversity ? (
                  <ReviewField
                    label="University"
                    value={preparationInstitution.universityValue}
                    icon={<Landmark size={18} />}
                  />
                ) : null}
                <ReviewField label="Target exam" value={primaryExam || "Not provided"} icon={<Target size={18} />} />
                <ReviewField
                  label="Target year"
                  value={insights.preparationSnapshot.preparation.targetYear || "Not provided"}
                  icon={<CalendarDays size={18} />}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin size={18} className="text-amber-600" />
                <span>Address details</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="xl:col-span-3">
                  <ReviewField label="Full location" value={location || "Not provided"} icon={<MapPin size={18} />} />
                </div>
                <ReviewField
                  label="Street / village"
                  value={insights.preparationSnapshot.address.street || "Not provided"}
                  icon={<MapPin size={18} />}
                />
                <ReviewField
                  label="City / town"
                  value={insights.preparationSnapshot.address.city || "Not provided"}
                  icon={<Building2 size={18} />}
                />
                <ReviewField
                  label="District"
                  value={insights.preparationSnapshot.address.district || "Not provided"}
                  icon={<Building2 size={18} />}
                />
                <ReviewField
                  label="State"
                  value={insights.preparationSnapshot.address.state || "Not provided"}
                  icon={<MapPin size={18} />}
                />
                <ReviewField
                  label="Country"
                  value={insights.preparationSnapshot.address.country || "Not provided"}
                  icon={<Globe2 size={18} />}
                />
                <ReviewField
                  label="Pincode"
                  value={insights.preparationSnapshot.address.pincode || "Not provided"}
                  icon={<Hash size={18} />}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity size={18} className="text-amber-600" />
                <span>Learning & source</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                <ReviewField
                  label="Learning mode"
                  value={insights.preparationSnapshot.learningMode.mode || "Not provided"}
                  icon={<Activity size={18} />}
                />
                <ReviewField
                  label="Provider"
                  value={learningProvider || "Not provided"}
                  icon={<BookOpen size={18} />}
                />
                <ReviewField
                  label="Additional exams"
                  value={additionalExamLabels.length > 0 ? additionalExamLabels.join(", ") : "Not provided"}
                  icon={<Target size={18} />}
                />
                <ReviewField
                  label="Lead source"
                  value={insights.preparationSnapshot.hearAboutUs || "Not provided"}
                  icon={<Search size={18} />}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="overflow-hidden rounded-[28px]" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)" }}>
        <div className="relative px-6 py-8">
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-10" style={{ backgroundColor: "#f97316" }} />
          <div className="absolute bottom-0 left-1/3 h-56 w-56 translate-y-20 rounded-full opacity-5" style={{ backgroundColor: "#0ea5e9" }} />

          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-5">
              <div className="relative">
                <Avatar className="h-20 w-20 border-4 border-white/15">
                  <AvatarImage src={insights.student.avatarUrl ?? undefined} alt={insights.student.fullName} />
                  <AvatarFallback className="bg-orange-500 text-2xl font-black text-white">
                    {getInitials(insights.student.fullName)}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-slate-900 bg-emerald-400" />
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight text-white">{insights.student.fullName}</h1>
                  <span className="text-sm text-slate-400">@{insights.student.username}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge className="border-0 bg-emerald-500 text-xs font-semibold text-white hover:bg-emerald-500">
                    {insights.student.status === "approved" ? "Approved" : insights.student.status}
                  </Badge>
                  {insights.student.onboardingComplete ? (
                    <Badge className="border-0 bg-slate-700 text-xs text-slate-200 hover:bg-slate-700">Setup complete</Badge>
                  ) : null}
                  {primaryExam ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-orange-400">
                      <Flame className="h-3.5 w-3.5" /> {primaryExam} focus
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5 text-slate-500" /> {formatRelativeSafe(insights.overview.lastActiveAt)}</span>
                  <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-slate-500" /> Joined {formatDateSafe(insights.student.createdAt)}</span>
                  <span className="flex items-center gap-1"><UserCheck className="h-3.5 w-3.5 text-slate-500" /> {insights.student.approverName || "Awaiting reviewer"}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 text-sm lg:text-right">
              <a href={`mailto:${insights.student.email}`} className="flex items-center gap-2 text-slate-300 transition-colors hover:text-white lg:justify-end">
                <Mail className="h-4 w-4 shrink-0 text-slate-500" /> {insights.student.email}
              </a>
              <span className="flex items-center gap-2 text-slate-300 lg:justify-end">
                <Phone className="h-4 w-4 shrink-0 text-slate-500" /> {insights.student.phone || "Phone not added"}
              </span>
              <span className="flex items-center gap-2 text-slate-400 lg:justify-end">
                <MapPin className="h-4 w-4 shrink-0 text-slate-500" /> {location || "Location not added"}
              </span>
            </div>
          </div>

          <div className="relative mt-6 flex items-center gap-4 rounded-xl p-4" style={{ backgroundColor: "rgba(255,255,255,0.06)" }}>
            <div className="flex-1">
              <div className="mb-2 flex justify-between text-xs font-medium">
                <span className="text-slate-300">Profile Completion</span>
                <span className="font-bold text-orange-400">{insights.profileCompletion.percent}% · {insights.profileCompletion.completedSteps}/{insights.profileCompletion.totalSteps} blocks</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                <div className="h-2 rounded-full" style={{ width: `${insights.profileCompletion.percent}%`, background: "linear-gradient(90deg, #f97316, #f59e0b)" }} />
              </div>
            </div>
            <Badge className="whitespace-nowrap border border-amber-500/30 bg-amber-500/20 text-xs text-amber-300 hover:bg-amber-500/20">
              {viewerLabel}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Tests Taken" value={String(insights.overview.testsAttempted)} helper="All attempts" icon={<BookOpen className="h-4 w-4" />} iconColor="#f97316" iconBg="#f9731620" />
        <StatCard label="Avg Score" value={`${insights.overview.averageScore}%`} helper={`Pass rate ${insights.overview.passRate}%`} icon={<TrendingUp className="h-4 w-4" />} iconColor="#0ea5e9" iconBg="#0ea5e920" />
        <StatCard label="Best Score" value={`${insights.overview.bestScore}%`} helper={`Latest ${insights.overview.latestScore}%`} icon={<Trophy className="h-4 w-4" />} iconColor="#8b5cf6" iconBg="#8b5cf620" />
        <StatCard label="Q Attempted" value={String(questionBankTotals.attempted)} helper="Across all subjects" icon={<PenLine className="h-4 w-4" />} iconColor="#10b981" iconBg="#10b98120" />
        <StatCard label="Q Accuracy" value={`${questionBankTotals.accuracy}%`} helper={`${questionBankTotals.correct}/${questionBankTotals.attempted} correct`} icon={<Percent className="h-4 w-4" />} iconColor="#14b8a6" iconBg="#14b8a620" />
        <StatCard label="Saved" value={String(insights.overview.savedQuestions)} helper={`${insights.studyStreak.totalActiveDays} active days`} icon={<Bookmark className="h-4 w-4" />} iconColor="#f59e0b" iconBg="#f59e0b20" />
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: "#f9731620", color: "#f97316" }}>
              <Flame className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800">Study Streak</h2>
              <p className="text-xs text-slate-400">Last 4 weeks of activity</p>
            </div>
          </div>
          <div className="hidden items-center gap-4 text-xs text-slate-400 md:flex">
            <span className="flex items-center gap-1.5">
              Less
              {HEATMAP_COLORS.map((color) => (
                <span key={color} className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
              ))}
              More
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="flex min-w-fit gap-1" aria-label="Study activity for the last 4 weeks">
            {heatmapWeeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-1">
                {week.map((cell) => (
                  <div
                    key={cell.date}
                    title={`${cell.date} · ${cell.count} actions`}
                    className="h-4 w-4 rounded-sm"
                    style={{ backgroundColor: HEATMAP_COLORS[cell.level] ?? HEATMAP_COLORS[0] }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1 flex min-w-fit gap-1">
            {heatmapWeekLabels.map((label) => (
              <div
                key={label}
                className="w-4 text-center text-[8px] text-slate-400"
                style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", height: 32, lineHeight: "32px" }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-6 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#f97316" }} />
            <span className="text-slate-500">Current Streak: <span className="font-bold text-slate-700">{insights.studyStreak.currentStreak} days</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#fb923c" }} />
            <span className="text-slate-500">Longest Streak: <span className="font-bold text-slate-700">{insights.studyStreak.longestStreak} days</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#fde68a" }} />
            <span className="text-slate-500">Total Active Days: <span className="font-bold text-slate-700">{insights.studyStreak.totalActiveDays}</span></span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard
            title="Test History"
            subtitle={`${insights.scoreTrend.length} tests attempted`}
            icon={<BookOpen className="h-4 w-4" />}
            color="#f97316"
            bg="#f9731620"
            badge={<span className="rounded-full border bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400">Best: {insights.overview.bestScore}%</span>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    {["#", "Test Name", "Date", "Score", "Accuracy", "Status"].map((header, index) => (
                      <th
                        key={header}
                        className={`py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 ${
                          index === 0 ? "px-6 text-left" : index <= 2 ? "px-4 text-left" : index === 5 ? "px-6 text-center" : "px-4 text-right"
                        }`}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {insights.scoreTrend.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-sm text-slate-400">No test attempts yet.</td>
                    </tr>
                  ) : (
                    insights.scoreTrend.map((item, index) => (
                      <tr key={`${item.title}-${item.label}`} className="border-b transition-colors last:border-0 hover:bg-slate-50/70">
                        <td className="px-6 py-3.5"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{index + 1}</span></td>
                        <td className="px-4 py-3.5 font-medium text-slate-700">{item.title}</td>
                        <td className="px-4 py-3.5 text-xs text-slate-400 whitespace-nowrap">{formatDateSafe(item.submittedAt)}</td>
                        <td className="px-4 py-3.5 text-right font-bold" style={{ color: item.percentage >= 60 ? "#10b981" : "#f97316" }}>{item.score}/{item.totalPoints}</td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex min-w-[80px] flex-col items-end gap-1">
                            <span className="text-xs font-semibold text-slate-600">{item.percentage}%</span>
                            <AccuracyBar value={item.percentage} color={item.percentage >= 60 ? "#10b981" : "#f97316"} />
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          {item.passed ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                              <CheckCheck className="h-3 w-3" /> Pass
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-orange-100 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-600">
                              <ArrowUpRight className="h-3 w-3" /> Improve
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            title="Question Bank Performance"
            subtitle={`${questionBankTotals.attempted} questions · ${questionBankTotals.accuracy}% overall accuracy`}
            icon={<PenLine className="h-4 w-4" />}
            color="#0ea5e9"
            bg="#0ea5e920"
            badge={
              <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-100 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-600">
                <CheckCheck className="h-3 w-3" /> {questionBankTotals.correct} correct
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    {["Subject", "Attempted", "Correct", "Accuracy"].map((header, index) => (
                      <th key={header} className={`py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 ${index === 0 || index === 3 ? "px-6 text-left" : "px-4 text-right"}`}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {insights.questionBankPerformance.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">Question bank performance will appear after practice attempts.</td>
                    </tr>
                  ) : (
                    insights.questionBankPerformance.map((item, index) => {
                      const color = ACTIVITY_COLORS[index % ACTIVITY_COLORS.length];
                      return (
                        <tr key={item.key ?? item.subject} className="border-b transition-colors last:border-0 hover:bg-slate-50/70">
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                              <span className="font-semibold text-foreground">{item.subject?.trim() || "Subject unavailable"}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right font-semibold text-slate-700">{item.attempted}</td>
                          <td className="px-4 py-3.5 text-right font-semibold" style={{ color }}>{item.correct}</td>
                          <td className="px-6 py-3.5">
                            <div className="flex min-w-[120px] items-center gap-3">
                              <div className="flex-1"><AccuracyBar value={item.accuracy} color={color} /></div>
                              <span className="w-8 text-right text-xs font-bold text-slate-600">{item.accuracy}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <PyqPerformanceCard insights={insights} />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: "#8b5cf620", color: "#8b5cf6" }}>
                  <TrendingUp className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Score Momentum</h3>
                  <p className="text-xs text-slate-400">{insights.scoreTrend.length} tests over time</p>
                </div>
              </div>
              <div className="mb-3 flex gap-4 text-xs">
                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: "#8b5cf6" }} /> Your Score</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-px w-3 border-t-2 border-dashed" style={{ borderColor: "#0ea5e9" }} /> Avg Score</span>
              </div>
              {scoreMomentumData.length === 0 ? (
                <EmptyChartState message="No submitted tests yet for this student." />
              ) : (
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={scoreMomentumData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(value) => `${value}%`} />
                      <ReferenceLine y={60} stroke="#e2e8f0" strokeDasharray="4 4" />
                      <RechartsTooltip
                        formatter={(value: number, name: string) => [`${value}%`, name === "score" ? "Score" : "Average"]}
                        labelFormatter={(_, payload) => {
                          const point = payload?.[0]?.payload as { title?: string; submittedAt?: string | null } | undefined;
                          return point ? `${point.title} · ${formatDateSafe(point.submittedAt)}` : "";
                        }}
                        contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}
                      />
                      <Line type="monotone" dataKey="avg" stroke="#0ea5e9" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                      <Line type="monotone" dataKey="score" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 4, fill: "#8b5cf6", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: "#f9731620", color: "#f97316" }}>
                  <Activity className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Engagement Pulse</h3>
                  <p className="text-xs text-slate-400">Daily activity this week</p>
                </div>
              </div>
              {insights.activityTrend.every((item) => item.count === 0) ? (
                <EmptyChartState message="No tracked activity in the last 7 days." />
              ) : (
                <div className="h-[188px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={insights.activityTrend} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
                      <RechartsTooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
                      <Bar dataKey="count" fill="#f97316" radius={[6, 6, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <SectionCard
            title="Login History"
            subtitle={`Last ${Math.min(insights.sessionsHistory.length, 5)} sessions`}
            icon={<Shield className="h-4 w-4" />}
            color="#8b5cf6"
            bg="#8b5cf620"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    {["Started", "IP Address", "Location", "Device", "Last Active", "Status"].map((header, index) => (
                      <th
                        key={header}
                        className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 ${
                          index === 0 ? "pl-6" : ""
                        } ${index === 5 ? "pr-6 text-center" : ""}`}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {insights.sessionsHistory.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-sm text-slate-400">No session history recorded yet.</td>
                    </tr>
                  ) : (
                    insights.sessionsHistory.map((session) => (
                      <tr key={session.id} className="border-b transition-colors last:border-0 hover:bg-slate-50/70">
                        <td className="px-4 pl-6 py-3.5">
                          <div className="text-xs font-medium text-slate-700">{formatDateSafe(session.startedAt)}</div>
                          <div className="text-xs text-slate-400">{formatDateSafe(session.startedAt, "h:mm a")}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-mono text-xs font-medium text-slate-700">{session.ipAddress || "Unknown IP"}</div>
                          <div className="text-xs text-slate-400">{session.ipAddress && session.ipAddress !== "Unknown IP" ? "Captured on login" : "Not available"}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-start gap-2">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                            <div className="text-xs leading-5 text-slate-600">{session.locationLabel || "Unknown location"}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="text-xs font-semibold text-slate-700">{session.deviceType || "Unknown device"}</div>
                          <div className="text-xs text-slate-400">{session.browserName || "Unknown browser"}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="text-xs font-medium text-slate-700">{formatRelativeSafe(session.lastActiveAt)}</div>
                          <div className="text-xs text-slate-400">{formatDurationShort(session.totalSeconds)} session</div>
                        </td>
                        <td className="px-4 pr-6 py-3.5 text-center">
                          {session.isActive ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                              <CheckCircle2 className="h-3 w-3" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500">
                              <Clock3 className="h-3 w-3" /> Closed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            title="Activity Mix & Timeline"
            subtitle={`${insights.activityBreakdown.reduce((sum, item) => sum + item.value, 0)} total actions recorded`}
            icon={<Activity className="h-4 w-4" />}
            color="#0ea5e9"
            bg="#0ea5e920"
          >
            <div className="flex flex-col md:flex-row">
              <div className="border-b p-5 md:w-56 md:border-b-0 md:border-r">
                {insights.activityBreakdown.length === 0 ? (
                  <EmptyChartState message="No activity captured yet." />
                ) : (
                  <>
                    <div className="relative h-[150px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={insights.activityBreakdown} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value">
                            {insights.activityBreakdown.map((item, index) => (
                              <Cell key={item.name} fill={ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-black text-slate-800">{insights.activityBreakdown.reduce((sum, item) => sum + item.value, 0)}</span>
                        <span className="text-xs text-slate-400">actions</span>
                      </div>
                    </div>
                    <div className="mt-2 w-full space-y-2">
                      {insights.activityBreakdown.map((item, index) => (
                        <div key={item.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length] }} />
                            <span className="text-slate-500">{item.name}</span>
                          </div>
                          <span className="font-bold text-slate-700">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="flex-1 p-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Logs</p>
                <div className="space-y-1">
                  {activityTimeline.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">No recent activity captured for this student.</p>
                  ) : (
                    activityTimeline.map((item, index) => {
                      const Icon = item.icon;
                      return (
                        <div key={item.id} className="flex gap-3 text-sm">
                          <div className="w-14 shrink-0 pt-2 text-xs tabular-nums text-slate-400">{formatDateSafe(item.createdAt, "h:mm a")}</div>
                          <div className="relative flex flex-col items-center">
                            <div className="z-10 mt-1 flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: `${item.color}18` }}>
                              <Icon className="h-3 w-3" style={{ color: item.color }} />
                            </div>
                            {index < activityTimeline.length - 1 ? <div className="mt-1 w-px flex-1 bg-slate-100" /> : null}
                          </div>
                          <div className="pb-4">
                            <div className="text-xs font-semibold capitalize text-slate-700">{item.title}</div>
                            <div className="mt-0.5 inline-block rounded border border-slate-100 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                              {item.detailText}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="font-bold text-slate-800">Profile Completion</h2>
              <span className="text-sm font-black text-orange-500">{insights.profileCompletion.percent}%</span>
            </div>
            <div className="px-5 pb-1 pt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-2 rounded-full" style={{ width: `${insights.profileCompletion.percent}%`, background: "linear-gradient(90deg, #f97316, #f59e0b)" }} />
              </div>
              <p className="mb-3 mt-2 text-xs text-slate-400">{insights.profileCompletion.completedSteps} of {insights.profileCompletion.totalSteps} onboarding blocks complete</p>
            </div>
            <div className="space-y-2 px-4 pb-4">
              {completionStepDetails.map((step) => {
                const iconMap = {
                  personal: User,
                  address: MapPin,
                  preparation: GraduationCap,
                  learning: BookOpen,
                  discovery: Search,
                } as const;
                const Icon = iconMap[step.key as keyof typeof iconMap] ?? User;
                const detailPreview = step.details
                  .map((item) => item.value)
                  .filter((value) => value && value !== "Not provided")
                  .slice(0, 2)
                  .join(" · ") || "Not provided";

                return (
                  <div key={step.key} className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${step.complete ? "border-emerald-100 bg-emerald-50/50" : "border-red-100 bg-red-50/60"}`}>
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${step.complete ? "bg-emerald-100" : "bg-red-100"}`}>
                      <Icon className={`h-3.5 w-3.5 ${step.complete ? "text-emerald-600" : "text-red-500"}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs font-semibold ${step.complete ? "text-slate-700" : "text-red-800"}`}>{step.label}</div>
                      <div className={`mt-0.5 truncate text-xs ${step.complete ? "text-slate-400" : "text-red-500"}`}>{detailPreview}</div>
                    </div>
                    {step.complete ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-red-400" />}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center gap-2.5 border-b px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: "#0ea5e920", color: "#0ea5e9" }}>
                <Mail className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800">Email History</h2>
                <p className="text-xs text-slate-400">{insights.emailHistory.length} emails sent to student · {emailSummary.passwordResets} password reset emails</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 border-b bg-slate-50 px-5 py-3">
              {[
                { label: "Total Sent", value: emailSummary.totalSent, color: "#0ea5e9" },
                { label: "Failed", value: emailSummary.failed, color: "#f97316" },
                { label: "Password Resets", value: emailSummary.passwordResets, color: "#f43f5e" },
                { label: "Approvals", value: emailSummary.approvalEmails, color: "#10b981" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5 text-xs">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-slate-400">{item.label}:</span>
                  <span className="font-bold" style={{ color: item.color }}>{item.value}</span>
                </div>
              ))}
            </div>
            <div className="divide-y">
              {insights.emailHistory.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-400">No email logs recorded for this student yet.</p>
              ) : (
                insights.emailHistory.map((item) => {
                  const statusColor = item.status === "sent" ? "#10b981" : "#f97316";
                  return (
                    <div key={item.id} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${statusColor}18`, color: statusColor }}>
                        <Mail className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-slate-700">{item.subject}</div>
                        <div className="mt-0.5 text-xs text-slate-400">{formatDateSafe(item.sentAt)} · {item.providerKey}</div>
                      </div>
                      <span className="mt-1 shrink-0 text-xs font-semibold capitalize" style={{ color: statusColor }}>{item.status}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b px-5 py-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: "#f9731620", color: "#f97316" }}>
                <GraduationCap className="h-3.5 w-3.5" />
              </div>
              <h2 className="font-bold text-slate-800">Preparation Snapshot</h2>
            </div>
            <div className="space-y-4 p-5 text-sm">
                <div>
                  <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400"><GraduationCap className="h-3 w-3 text-orange-500" /> Academics</p>
                  <div className="grid grid-cols-2 gap-2">
                    <SnapshotTile label="Stage" value={insights.preparationSnapshot.preparation.classLevel} />
                    <SnapshotTile label={preparationInstitution.institutionLabel} value={preparationInstitution.institutionValue} />
                    {preparationInstitution.isUgUniversity ? (
                      <SnapshotTile label="University" value={preparationInstitution.universityValue} />
                    ) : null}
                    <SnapshotTile label="Target Exam" value={primaryExam} />
                    <SnapshotTile label="Target Year" value={insights.preparationSnapshot.preparation.targetYear} />
                  </div>
                </div>

              <div>
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400"><BookOpen className="h-3 w-3 text-sky-500" /> Learning</p>
                <div className="space-y-2 rounded-xl border bg-slate-50 p-3">
                  <div className="flex justify-between gap-3 text-xs"><span className="text-slate-400">Mode</span><span className="text-right font-semibold text-slate-700">{insights.preparationSnapshot.learningMode.mode || "Not provided"}</span></div>
                  <div className="flex justify-between gap-3 text-xs"><span className="text-slate-400">Provider</span><span className="text-right font-semibold text-slate-700">{learningProvider || "Not provided"}</span></div>
                </div>
              </div>

              <div>
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400"><User className="h-3 w-3 text-emerald-500" /> Personal</p>
                <div className="space-y-2 rounded-xl border bg-slate-50 p-3">
                  <div className="flex justify-between gap-3 text-xs"><span className="text-slate-400">Date of Birth</span><span className="text-right font-semibold text-slate-700">{formatDateSafe(insights.preparationSnapshot.dateOfBirth, "dd MMM yyyy")}</span></div>
                  <div className="flex justify-between gap-3 text-xs"><span className="text-slate-400">WhatsApp</span><span className="text-right font-semibold text-slate-700">{insights.preparationSnapshot.whatsappOnSameNumber ? `Same as phone${insights.student.phone ? ` (${insights.student.phone})` : ""}` : insights.preparationSnapshot.whatsappNumber || "Not provided"}</span></div>
                  <div className="flex justify-between gap-3 text-xs"><span className="text-slate-400">Lead Source</span><span className="text-right font-semibold text-slate-700">{insights.preparationSnapshot.hearAboutUs || "Not provided"}</span></div>
                </div>
              </div>

              <div>
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400"><Globe2 className="h-3 w-3 text-amber-500" /> Location</p>
                <div className="grid grid-cols-2 gap-2">
                  <SnapshotTile label="Country" value={insights.preparationSnapshot.address.country} />
                  <SnapshotTile label="State" value={insights.preparationSnapshot.address.state} />
                  <SnapshotTile label="City" value={insights.preparationSnapshot.address.city} />
                  <SnapshotTile label="Pincode" value={insights.preparationSnapshot.address.pincode} />
                  <SnapshotTile label="District" value={insights.preparationSnapshot.address.district} />
                  <SnapshotTile label="Street" value={insights.preparationSnapshot.address.street} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
