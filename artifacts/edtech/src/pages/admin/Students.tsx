import { useEffect, useState } from "react";
import {
  getListUsersQueryKey,
  useApproveStudent,
  useListUsers,
  type User,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isSameDay, startOfDay, subDays } from "date-fns";
import {
  Activity,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  GraduationCap,
  Mail,
  RotateCcw,
  Search,
  Settings,
  ShieldOff,
  Trash2,
  TrendingUp,
  UserCheck,
  UserX,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { StudentProfileInsightsPanel, type StudentProfileInsights } from "@/components/student/StudentProfileInsightsPanel";
import { StudentProfileInsightsHeader } from "@/components/student/StudentProfileInsightsHeader";
import { StudentVerificationReviewDialog } from "@/components/student/StudentVerificationReviewDialog";
import { formatExamDisplayName } from "@/lib/exam-display";
import { buildApiUrl } from "@/lib/api-origin";
import { readAdminExamSelection, testBelongsToAdminExam } from "@/lib/admin-exam-selection";
import { StudentActivitySort, StudentActivityCounts, useStudentActivity } from "@/components/student/StudentActivitySort";
import { sortStudents, type StudentSortKey, type StudentSortDirection } from "@/lib/student-activity-sorting";
import {StudentTestResetDialog} from '@/components/admin/StudentTestResetDialog';

type StudentUiStatus = "pending" | "approved" | "revoked";

interface StudentViewModel {
  id: number;
  name: string;
  username: string;
  email: string;
  targetExam: string;
  status: StudentUiStatus;
  onboardingComplete: boolean;
  avatarUrl?: string | null;
  avatarInitials: string;
  joinedAt: string;
  createdAt: string;
  rejectionReason?: string | null;
}

const COLORS = {
  approved: "#6366f1",
  pending: "#f59e0b",
  revoked: "#f43f5e",
} as const;

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function toStudentUiStatus(status: User["status"]): StudentUiStatus {
  if (status === "pending") return "pending";
  if (status === "rejected") return "revoked";
  return "approved";
}

function getStudentTargetExam(student: User) {
  const profileTargetExam = typeof (student as User & {
    profileDetails?: { preparation?: { targetExam?: string | null } | null } | null;
  }).profileDetails?.preparation?.targetExam === "string"
    ? (student as User & {
        profileDetails?: { preparation?: { targetExam?: string | null } | null } | null;
      }).profileDetails?.preparation?.targetExam?.trim()
    : "";

  return formatExamDisplayName(profileTargetExam || student.subject?.trim()) || "Not set";
}

function buildStudentViewModel(student: User): StudentViewModel {
  const onboardingComplete = (student as User & { onboardingComplete?: boolean }).onboardingComplete === true;
  const avatarUrl = (student as User & { avatarUrl?: string | null }).avatarUrl ?? null;
  return {
    id: student.id,
    name: student.fullName,
    username: `@${student.username}`,
    email: student.email,
    targetExam: getStudentTargetExam(student),
    status: toStudentUiStatus(student.status),
    onboardingComplete,
    avatarUrl,
    avatarInitials: getInitials(student.fullName || student.username),
    joinedAt: format(new Date(student.createdAt), "MMM d, yyyy"),
    createdAt: student.createdAt,
    rejectionReason: student.rejectionReason ?? null,
  };
}

function buildWeeklyRegistrationData(students: User[]) {
  const today = startOfDay(new Date());

  return Array.from({ length: 7 }, (_, index) => {
    const day = subDays(today, 6 - index);
    return {
      day: format(day, "EEE"),
      students: students.filter((student) => isSameDay(new Date(student.createdAt), day)).length,
    };
  });
}

function renderLoadingCard() {
  return <div className="h-36 rounded-2xl border border-slate-100 bg-white shadow-sm animate-pulse" />;
}

async function fetchStudentInsights(studentId: number) {
  const response = await fetch(buildApiUrl(`/api/users/${studentId}/profile-insights`), { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? "Failed to load student profile");
  }
  return response.json() as Promise<StudentProfileInsights>;
}

export default function AdminStudents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedExamKey, setSelectedExamKey] = useState(() => readAdminExamSelection());
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<StudentSortKey>("activity");
  const [sortDirection, setSortDirection] = useState<StudentSortDirection>("desc");
  const studentActivity = useStudentActivity();
  const activityMetrics = new Map(studentActivity.data?.students.map(row => [row.studentId, row]));
  const [selectedStudent, setSelectedStudent] = useState<StudentViewModel | null>(null);
  const [profileStudent, setProfileStudent] = useState<StudentViewModel | null>(null);
  const [profileTab,setProfileTab]=useState<'profile'|'settings'>('profile');
  const [resetStudent,setResetStudent]=useState<StudentViewModel|null>(null);
  const [rejectionDialog, setRejectionDialog] = useState<StudentViewModel | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const activeInsightsStudent = profileStudent ?? selectedStudent;
  const { data: studentRecords = [], isLoading } = useListUsers({ role: "student" });
  useEffect(() => {
    const syncExam = () => setSelectedExamKey(readAdminExamSelection());
    window.addEventListener("admin-exam-changed", syncExam);
    window.addEventListener("storage", syncExam);
    syncExam();
    return () => {
      window.removeEventListener("admin-exam-changed", syncExam);
      window.removeEventListener("storage", syncExam);
    };
  }, []);
  const studentInsightsQuery = useQuery<StudentProfileInsights>({
    queryKey: ["admin-student-insights", activeInsightsStudent?.id],
    enabled: !!activeInsightsStudent,
    queryFn: () => fetchStudentInsights(activeInsightsStudent!.id),
    staleTime: 30_000,
  });
  const approveStudent = useApproveStudent();
  const deleteStudentMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(buildApiUrl(`/api/users/${id}`), { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to delete student");
      }
    },
    onSuccess: () => {
      refreshStudentData();
      toast({ title: "Student deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });
  const examStudentRecords = selectedExamKey
    ? studentRecords.filter((student) => {
        const profileTargetExam = (student as User & {
          profileDetails?: { preparation?: { targetExam?: string | null } | null } | null;
        }).profileDetails?.preparation?.targetExam;
        const additionalExams = (student as User & { additionalExams?: string[] | null }).additionalExams ?? [];
        const exams = [student.subject, ...additionalExams, profileTargetExam];
        return exams.some((exam) => testBelongsToAdminExam({ title: exam }, selectedExamKey));
      })
    : studentRecords;
  const students = examStudentRecords.map(buildStudentViewModel);
  const reviewableStudents = students.filter((student) => student.onboardingComplete);
  const pendingApprovals = reviewableStudents.filter((student) => student.status === "pending");
  const managedStudents = reviewableStudents.filter((student) => student.status !== "pending");
  const approvedCount = managedStudents.filter((student) => student.status === "approved").length;
  const revokedCount = managedStudents.filter((student) => student.status === "revoked").length;
  const pendingCount = pendingApprovals.length;
  const totalPopulation = managedStudents.length + pendingCount || 1;
  const weeklyRegistrationData = buildWeeklyRegistrationData(examStudentRecords);
  const weeklyRegistrationsTotal = weeklyRegistrationData.reduce((total, day) => total + day.students, 0);
  const weeklyPeakRegistrations = Math.max(...weeklyRegistrationData.map((day) => day.students), 0);
  const weeklyActiveDays = weeklyRegistrationData.filter((day) => day.students > 0).length;

  const filteredStudents = sortStudents(managedStudents.filter((student) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      student.name.toLowerCase().includes(query) ||
      student.email.toLowerCase().includes(query) ||
      student.username.toLowerCase().includes(query) ||
      student.targetExam.toLowerCase().includes(query)
    );
  }), sortKey, sortDirection, activityMetrics, student => student.name);

  const donutData = [
    { name: "Approved", value: approvedCount || 0.001, color: COLORS.approved },
    { name: "Pending", value: pendingCount || 0.001, color: COLORS.pending },
    { name: "Revoked", value: revokedCount || 0.001, color: COLORS.revoked },
  ];

  const refreshStudentData = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-student-activity"] });
    void queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ role: "student" }) });
    void queryClient.invalidateQueries({ queryKey: ["admin-student-insights"] });
  };

  const prefetchStudentInsights = (studentId: number) => {
    void queryClient.prefetchQuery({
      queryKey: ["admin-student-insights", studentId],
      queryFn: () => fetchStudentInsights(studentId),
      staleTime: 30_000,
    });
  };

  const openStudentReview = (student: StudentViewModel) => {
    setProfileTab('profile');
    prefetchStudentInsights(student.id);
    if (student.status === "pending") {
      setProfileStudent(null);
      setSelectedStudent(student);
      return;
    }

    setSelectedStudent(null);
    setProfileStudent(student);
  };

  const handleStudentStatusChange = (
    student: StudentViewModel,
    status: "approved" | "rejected",
    title: string,
    description?: string,
    reason?: string,
  ) => {
    approveStudent.mutate(
      { id: student.id, data: { status, reason } },
      {
        onSuccess: () => {
          refreshStudentData();
          toast({ title, description });
          setRejectionDialog(null);
          setRejectionReason("");
        },
        onError: (error: Error) => {
          toast({ title: "Update failed", description: error.message, variant: "destructive" });
        },
      },
    );
  };

  const handleDeleteStudent = (student: StudentViewModel) => {
    deleteStudentMutation.mutate(student.id, {
      onSuccess: () => {
        refreshStudentData();
        if (selectedStudent?.id === student.id) {
          setSelectedStudent(null);
        }
        if (profileStudent?.id === student.id) {
          setProfileStudent(null);
        }
        toast({
          title: "Student removed",
          description: "All student data has been permanently deleted.",
        });
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index}>{renderLoadingCard()}</div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div className="h-80 rounded-2xl border border-slate-100 bg-white shadow-sm animate-pulse" />
            <div className="h-48 rounded-2xl border border-slate-100 bg-white shadow-sm animate-pulse" />
          </div>
          <div className="space-y-5">
            <div className="h-72 rounded-2xl border border-slate-100 bg-white shadow-sm animate-pulse" />
            <div className="h-56 rounded-2xl border border-slate-100 bg-white shadow-sm animate-pulse" />
          </div>
        </div>
        <div className="h-[32rem] rounded-2xl border border-slate-100 bg-white shadow-sm animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Students</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
              <GraduationCap className="w-4 h-4 text-indigo-500" />
            </div>
          </div>
          <div>
            <p className="text-3xl font-black text-slate-900">{managedStudents.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">enrolled</p>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full" style={{ width: "100%" }} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Approved</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
          </div>
          <div>
            <p className="text-3xl font-black text-slate-900">{approvedCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">active access</p>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${(approvedCount / totalPopulation) * 100}%` }}
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-500" />
            </div>
          </div>
          <div>
            <p className="text-3xl font-black text-slate-900">{pendingCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">awaiting review</p>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all"
              style={{ width: `${(pendingCount / totalPopulation) * 100}%` }}
            />
          </div>
        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-full min-h-[360px]">
            <div className="px-5 pt-5 pb-4 border-b border-slate-50">
              <div className="flex flex-wrap items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm shadow-indigo-200 shrink-0">
                  <UserCheck className="w-4.5 h-4.5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-bold text-slate-800 leading-none">Student Approvals</h2>
                  <p className="mt-1 text-[11px] leading-4 text-slate-400">Review student registration requests</p>
                </div>
                <div className="shrink-0 sm:ml-auto">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap bg-indigo-50 text-indigo-600 text-xs font-bold px-3 py-1.5 rounded-full border border-indigo-100">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    {pendingCount} pending
                  </span>
                </div>
              </div>
            </div>

            {pendingApprovals.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 gap-3 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-indigo-300" />
                </div>
                <p className="text-sm font-semibold text-slate-600">All caught up!</p>
                <p className="text-xs text-slate-400 leading-relaxed max-w-[220px]">
                  No pending approvals right now.
                </p>
              </div>
            ) : (
              <div className="p-4 space-y-3 flex-1">
                {pendingApprovals.map((student) => (
                  <div
                    key={student.id}
                    className="flex flex-col gap-4 p-4 rounded-xl bg-indigo-50/40 border border-indigo-100"
                    data-testid={`pending-student-${student.id}`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <Avatar className="h-10 w-10 ring-2 ring-indigo-200 shrink-0">
                        <AvatarImage src={student.avatarUrl ?? undefined} alt={student.name} className="object-cover" />
                        <AvatarFallback className="bg-indigo-600 text-white font-bold text-sm">
                          {student.avatarInitials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm leading-tight">{student.name}</p>
                        <p className="text-xs text-slate-400 truncate mt-1">{student.email}</p>
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium mt-2 inline-flex">
                          {student.targetExam}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-full">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 text-xs border-amber-200 text-amber-700 hover:bg-amber-50 col-span-2"
                        onMouseEnter={() => prefetchStudentInsights(student.id)}
                        onFocus={() => prefetchStudentInsights(student.id)}
                        onClick={() => openStudentReview(student)}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Review details
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 text-xs text-red-500 border-red-200 hover:bg-red-50"
                        onClick={() => {
                          setRejectionDialog(student);
                          setRejectionReason(student.rejectionReason ?? "");
                        }}
                        disabled={approveStudent.isPending}
                        data-testid={`button-reject-${student.id}`}
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="h-9 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                        onClick={() =>
                          handleStudentStatusChange(
                            student,
                            "approved",
                            "Student approved",
                            `${student.name} can now log in.`,
                          )
                        }
                        disabled={approveStudent.isPending}
                        data-testid={`button-approve-${student.id}`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Approve
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col h-full min-h-[360px]">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-indigo-500" />
              <h3 className="text-sm font-bold text-slate-800">Student Breakdown</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">Status distribution overview</p>
            <div className="flex-1 flex flex-col justify-between">
            <div className="h-52 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={76}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {donutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [value < 0.01 ? 0 : value, name]}
                    contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-slate-800">{managedStudents.length + pendingCount}</span>
                <span className="text-xs text-slate-400">total</span>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { label: "Approved", count: approvedCount, color: "bg-indigo-500" },
                { label: "Pending", count: pendingCount, color: "bg-amber-400" },
                { label: "Revoked", count: revokedCount, color: "bg-rose-400" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                    <span className="text-[11px] font-medium text-slate-500">{item.label}</span>
                  </div>
                  <span className="mt-2 block text-lg font-black text-slate-800">{item.count}</span>
                </div>
              ))}
            </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col h-full min-h-[360px]">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-violet-500" />
              <h3 className="text-sm font-bold text-slate-800">Weekly New Students</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">New registrations this week</p>
            <div className="flex-1 flex flex-col justify-between">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyRegistrationData} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: "#f8fafc" }}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 11 }}
                  />
                  <Bar dataKey="students" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] font-medium text-slate-500">This Week</p>
                <p className="mt-2 text-lg font-black text-slate-800">{weeklyRegistrationsTotal}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] font-medium text-slate-500">Peak Day</p>
                <p className="mt-2 text-lg font-black text-slate-800">{weeklyPeakRegistrations}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] font-medium text-slate-500">Active Days</p>
                <p className="mt-2 text-lg font-black text-slate-800">{weeklyActiveDays}</p>
              </div>
            </div>
            </div>
          </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-50">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-sm shadow-emerald-200 shrink-0">
              <GraduationCap className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">All Students</h2>
              <p className="text-xs text-slate-400">{managedStudents.length} enrolled students</p>
            </div>
          </div>
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              type="search"
              placeholder="Search by name, email or username..."
              className="pl-9 h-9 text-xs w-full border-slate-200 rounded-xl bg-slate-50 focus:bg-white"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              data-testid="input-search-students"
            />
          </div>
          <div className="mt-3">
            <StudentActivitySort sortKey={sortKey} direction={sortDirection} onSortKey={setSortKey} onDirection={setSortDirection}
              loading={studentActivity.isLoading} unavailable={studentActivity.isError || !!studentActivity.data?.unavailableSources.length} />
          </div>
        </div>

        <div className="hidden md:grid md:grid-cols-12 px-6 py-2.5 bg-slate-50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          <div className="col-span-4">Student</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-2">Target Exam</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {filteredStudents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
              <UserX className="w-6 h-6 text-slate-300" />
            </div>
            <p className="text-sm text-slate-400">
              {searchQuery ? "No students match your search." : "No students enrolled yet."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filteredStudents.map((student, index) => (
              <div key={student.id} data-testid={`row-student-${student.id}`}>
                <div
                  className={`md:hidden px-4 py-4 transition-colors hover:bg-slate-50/60 ${
                    student.status === "revoked" ? "opacity-60" : ""
                  }`}
                >
                  <div className="mb-2.5 flex items-center gap-3">
                    <button
                      onMouseEnter={() => prefetchStudentInsights(student.id)}
                      onFocus={() => prefetchStudentInsights(student.id)}
                      onClick={() => openStudentReview(student)}
                      className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1.5 py-1.5 text-left transition-colors hover:bg-orange-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
                      data-testid={`button-view-profile-${student.id}`}
                    >
                      <Avatar className="h-10 w-10 shrink-0 ring-2 ring-offset-1 ring-indigo-100 transition-all group-hover:ring-orange-200">
                        <AvatarImage src={student.avatarUrl ?? undefined} alt={student.name} className="object-cover" />
                        <AvatarFallback
                          className={`text-sm font-bold ${
                            student.status === "revoked"
                              ? "bg-slate-200 text-slate-500"
                              : index % 2 === 0
                                ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white"
                                : "bg-gradient-to-br from-emerald-400 to-teal-500 text-white"
                          }`}
                        >
                          {student.avatarInitials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-tight text-slate-800 transition-colors group-hover:text-orange-700">{student.name}</p>
                        <p className="text-xs font-mono text-slate-400">{student.username}</p>
                        <StudentActivityCounts metrics={activityMetrics.get(student.id)} />
                      </div>
                    </button>
                    {student.status === "approved" ? (
                      <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs bg-rose-50 text-rose-600 border border-rose-200 px-2 py-0.5 rounded-full font-semibold shrink-0">
                        <ShieldOff className="w-3 h-3" />
                        Revoked
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-3 pl-1">
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <Mail className="w-3 h-3 shrink-0" />
                      <span className="truncate max-w-[180px]">{student.email}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 rounded-lg font-medium">
                      <GraduationCap className="w-3 h-3" />
                      {student.targetExam}
                    </span>
                    {student.rejectionReason && (
                      <p className="w-full rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
                        Reason: {student.rejectionReason}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {student.status === "approved" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs border-orange-200 text-orange-600 hover:bg-orange-50 rounded-lg"
                        onClick={() =>
                          (() => {
                            setRejectionDialog(student);
                            setRejectionReason(student.rejectionReason ?? "");
                          })()
                        }
                        disabled={approveStudent.isPending}
                        data-testid={`button-revoke-${student.id}`}
                      >
                        <Ban className="mr-1 h-3 w-3" />
                        Revoke
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-xs border-emerald-200 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                        onClick={() =>
                          handleStudentStatusChange(
                            student,
                            "approved",
                            "Access restored",
                            `${student.name} can log in again.`,
                          )
                        }
                        disabled={approveStudent.isPending}
                        data-testid={`button-restore-${student.id}`}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Restore
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-8 text-xs border-red-200 text-red-500 hover:bg-red-50 rounded-lg"
                          data-testid={`button-delete-${student.id}`}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Delete All Data
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-2xl border-slate-100 shadow-2xl mx-4">
                        <AlertDialogHeader>
                          <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-2 mx-auto">
                            <Trash2 className="w-7 h-7 text-red-400" />
                          </div>
                          <AlertDialogTitle className="text-center text-slate-800">Delete student?</AlertDialogTitle>
                          <AlertDialogDescription className="text-center text-slate-500 text-sm">
                            This permanently removes <span className="font-semibold text-slate-700">{student.name}</span>
                            {" "}and all related data. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="mt-2 gap-2 sm:flex-row">
                          <AlertDialogCancel className="flex-1 rounded-xl">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteStudent(student)}
                            className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                          >
                            Delete All Data
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <div
                  className={`hidden md:grid md:grid-cols-12 items-center px-6 py-4 hover:bg-slate-50/60 transition-colors ${
                    student.status === "revoked" ? "opacity-60" : ""
                  }`}
                >
                  <div className="col-span-4 flex items-center gap-3">
                    <button
                      onMouseEnter={() => prefetchStudentInsights(student.id)}
                      onFocus={() => prefetchStudentInsights(student.id)}
                      onClick={() => openStudentReview(student)}
                      className="group flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-orange-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
                      data-testid={`button-view-profile-desktop-${student.id}`}
                    >
                      <Avatar className="h-9 w-9 shrink-0 ring-2 ring-offset-1 ring-indigo-100 transition-all group-hover:ring-orange-200">
                        <AvatarImage src={student.avatarUrl ?? undefined} alt={student.name} className="object-cover" />
                        <AvatarFallback
                          className={`text-xs font-bold ${
                            student.status === "revoked"
                              ? "bg-slate-200 text-slate-500"
                              : index % 2 === 0
                                ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white"
                                : "bg-gradient-to-br from-emerald-400 to-teal-500 text-white"
                          }`}
                        >
                          {student.avatarInitials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 text-left">
                        <p className="text-sm font-semibold text-slate-800 leading-tight transition-colors group-hover:text-orange-700">
                          {student.name}
                        </p>
                        <p className="text-xs text-slate-400 font-mono">{student.username}</p>
                        <StudentActivityCounts metrics={activityMetrics.get(student.id)} />
                        <p className="mt-1 text-[11px] font-medium text-orange-600 opacity-0 transition-opacity group-hover:opacity-100">
                          View full profile details
                        </p>
                      </div>
                    </button>
                  </div>
                  <div className="col-span-3">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Mail className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      <span className="truncate">{student.email}</span>
                    </div>
                    {student.rejectionReason && (
                      <p className="mt-1 text-[11px] text-rose-600 truncate">Reason: {student.rejectionReason}</p>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2.5 py-1 rounded-lg font-medium">
                      <GraduationCap className="w-3 h-3" />
                      {student.targetExam}
                    </span>
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {student.status === "approved" ? (
                      <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs bg-rose-50 text-rose-600 border border-rose-200 px-2 py-0.5 rounded-full font-semibold">
                        <ShieldOff className="w-3 h-3" />
                        Revoked
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2">
                    {student.status === "approved" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-orange-200 text-orange-600 hover:bg-orange-50 hover:border-orange-300 rounded-lg px-3"
                        onClick={() =>
                          (() => {
                            setRejectionDialog(student);
                            setRejectionReason(student.rejectionReason ?? "");
                          })()
                        }
                        disabled={approveStudent.isPending}
                        data-testid={`button-revoke-${student.id}`}
                      >
                        <Ban className="mr-1 h-3 w-3" />
                        Revoke
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-300 rounded-lg px-3"
                        onClick={() =>
                          handleStudentStatusChange(
                            student,
                            "approved",
                            "Access restored",
                            `${student.name} can log in again.`,
                          )
                        }
                        disabled={approveStudent.isPending}
                        data-testid={`button-restore-${student.id}`}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Restore
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 rounded-lg px-3"
                          data-testid={`button-delete-${student.id}`}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-2xl border-slate-100 shadow-2xl">
                        <AlertDialogHeader>
                          <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-2 mx-auto">
                            <Trash2 className="w-7 h-7 text-red-400" />
                          </div>
                          <AlertDialogTitle className="text-center text-slate-800">Delete student?</AlertDialogTitle>
                          <AlertDialogDescription className="text-center text-slate-500 text-sm">
                            This permanently removes <span className="font-semibold text-slate-700">{student.name}</span>
                            {" "}and all related data. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2 mt-2">
                          <AlertDialogCancel className="flex-1 rounded-xl">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteStudent(student)}
                            className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                          >
                            Delete All Data
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-5 py-3 border-t border-slate-50 bg-slate-50/50 flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-slate-400">
            Showing {filteredStudents.length} of {managedStudents.length} students
          </p>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-slate-400">Last updated: just now</span>
          </div>
        </div>
      </div>

      {selectedStudent?.status === "pending" ? (
        <StudentVerificationReviewDialog
          open={!!selectedStudent}
          onOpenChange={(open) => {
            if (!open) setSelectedStudent(null);
          }}
          student={
            selectedStudent
              ? {
                  fullName: selectedStudent.name,
                  username: selectedStudent.username,
                  status: selectedStudent.status,
                  onboardingComplete: selectedStudent.onboardingComplete,
                  rejectionReason: selectedStudent.rejectionReason,
                  targetExam: selectedStudent.targetExam,
                  email: selectedStudent.email,
                  avatarUrl: selectedStudent.avatarUrl,
                  initials: selectedStudent.avatarInitials,
                }
              : null
          }
          insights={studentInsightsQuery.data}
          isLoading={studentInsightsQuery.isLoading}
          errorMessage={studentInsightsQuery.isError ? (studentInsightsQuery.error instanceof Error ? studentInsightsQuery.error.message : "Could not load student profile.") : null}
          onPrimaryAction={
            selectedStudent
              ? () =>
                  handleStudentStatusChange(
                    selectedStudent,
                    "approved",
                    "Student approved",
                    `${selectedStudent.name} can now log in.`,
                  )
              : undefined
          }
          onSecondaryAction={
            selectedStudent
              ? () => {
                  setRejectionDialog(selectedStudent);
                  setRejectionReason(selectedStudent.rejectionReason ?? "");
                }
              : undefined
          }
          primaryActionDisabled={approveStudent.isPending}
          secondaryActionDisabled={approveStudent.isPending}
          settingsContent={selectedStudent?<div className="space-y-4"><h3 className="text-lg font-bold">Student Settings</h3><Button variant="outline" size="icon" title="Reset attempted test" aria-label={`Reset attempted test for ${selectedStudent.name}`} onClick={()=>setResetStudent(selectedStudent)} data-testid={`button-reset-student-tests-${selectedStudent.id}`}><RotateCcw className="h-4 w-4"/></Button></div>:undefined}
        />
      ) : (
        <Dialog open={!!profileStudent} onOpenChange={(open) => !open && setProfileStudent(null)}>
          <DialogContent className="max-w-[min(calc(100vw-0.75rem),72rem)] overflow-hidden p-0">
            <StudentProfileInsightsHeader username={profileStudent?.username} />
            <div className="flex gap-2 border-b bg-card px-4 py-3 sm:px-6" role="tablist" aria-label="Student profile">
              <Button id="student-profile-tab" role="tab" aria-selected={profileTab==='profile'} aria-controls="student-profile-content" variant={profileTab==='profile'?'default':'outline'} size="sm" onClick={()=>setProfileTab('profile')}>Profile</Button>
              <Button id="student-settings-tab" role="tab" aria-selected={profileTab==='settings'} aria-controls="student-profile-content" variant={profileTab==='settings'?'default':'outline'} size="sm" onClick={()=>setProfileTab('settings')}><Settings className="mr-1.5 h-4 w-4"/>Settings</Button>
            </div>

            <div id="student-profile-content" role="tabpanel" aria-labelledby={profileTab==='settings'?'student-settings-tab':'student-profile-tab'} className="max-h-[calc(100dvh-11rem)] overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
              {profileTab==='settings'?<div className="space-y-4"><div><h3 className="text-lg font-bold">Student Settings</h3><p className="mt-1 text-sm text-muted-foreground">Manage this student's test attempts.</p></div><Button variant="outline" size="icon" title="Reset attempted test" aria-label={`Reset attempted test for ${profileStudent?.name}`} onClick={()=>profileStudent&&setResetStudent(profileStudent)} data-testid={`button-reset-student-tests-${profileStudent?.id}`}><RotateCcw className="h-4 w-4"/></Button></div>:studentInsightsQuery.isLoading ? (
                <div className="space-y-4">
                  <div className="h-52 animate-pulse rounded-3xl bg-muted" />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="h-72 animate-pulse rounded-3xl bg-muted" />
                    <div className="h-72 animate-pulse rounded-3xl bg-muted" />
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="h-80 animate-pulse rounded-3xl bg-muted" />
                    <div className="h-80 animate-pulse rounded-3xl bg-muted" />
                  </div>
                </div>
              ) : studentInsightsQuery.isError ? (
                <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-muted-foreground">
                  {studentInsightsQuery.error instanceof Error
                    ? studentInsightsQuery.error.message
                    : "Could not load student profile."}
                </div>
              ) : studentInsightsQuery.data ? (
                <StudentProfileInsightsPanel
                  insights={studentInsightsQuery.data}
                  viewerLabel="Admin review"
                  mode="full"
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <StudentTestResetDialog student={resetStudent?{id:resetStudent.id,name:resetStudent.name}:null} onClose={()=>setResetStudent(null)}/>
      <Dialog
        open={!!rejectionDialog}
        onOpenChange={(open) => {
          if (!open) {
            setRejectionDialog(null);
            setRejectionReason("");
          }
        }}
      >
        <DialogContent className="max-w-[min(calc(100vw-0.75rem),28rem)]">
          <DialogHeader>
            <DialogTitle>Reject application</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Student ko rejection reason dikhega aur same reason email se bhi jayega.
            </p>
            <Textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              rows={4}
              placeholder="Why is this application being rejected?"
            />
            <Button
              className="w-full bg-rose-600 hover:bg-rose-700"
              disabled={rejectionReason.trim().length < 5 || approveStudent.isPending || !rejectionDialog}
              onClick={() =>
                rejectionDialog && handleStudentStatusChange(
                  rejectionDialog,
                  "rejected",
                  "Application rejected",
                  `${rejectionDialog.name} can review the reason and resubmit.`,
                  rejectionReason.trim(),
                )
              }
            >
              Submit rejection
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
