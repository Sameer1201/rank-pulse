import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle,
  CheckCircle2,
  Clock,
  Lock,
  LockOpen,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Users,
  XCircle,
  ClipboardList,
  Activity,
  Search,
  Star,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useMemo, useState } from "react";
import type { StudentProfileInsights } from "@/components/student/StudentProfileInsightsPanel";
import { StudentVerificationReviewDialog } from "@/components/student/StudentVerificationReviewDialog";
import { formatExamDisplayName } from "@/lib/exam-display";
import { buildApiUrl } from "@/lib/api-origin";
import { StudentActivitySort, StudentActivityCounts, useStudentActivity } from "@/components/student/StudentActivitySort";
import { sortStudents, type StudentSortKey, type StudentSortDirection } from "@/lib/student-activity-sorting";
import {StudentTestResetDialog} from '@/components/admin/StudentTestResetDialog';

interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  phone?: string;
  status: string;
  onboardingComplete?: boolean;
  subject?: string | null;
  approvedById?: number | null;
  approvedAt?: string | null;
  createdAt: string;
  avatarUrl?: string | null;
  approverName?: string;
  rejectionReason?: string | null;
  profileDetails?: {
    address?: {
      state?: string | null;
    } | null;
    preparation?: {
      targetExam?: string | null;
      collegeName?: string | null;
      institutionName?: string | null;
    } | null;
  } | null;
  studentFeatureAccess?: {
    testsLocked?: boolean;
    questionBankLocked?: boolean;
    analysisLocked?: boolean;
    pyqLocked?: boolean;
  } | null;
  studentFeaturePricing?: {
    testsAmount?: number | null;
    questionBankAmount?: number | null;
    analysisAmount?: number | null;
    pyqAmount?: number | null;
  } | null;
  priorityAccess?: boolean;
  // Activity metrics returned by /api/users?role=student
  testCount?: number;
  activityCount?: number;
  lastActivityAt?: string | null;
}

function getStudentTargetExam(student: User) {
  return formatExamDisplayName(student.profileDetails?.preparation?.targetExam?.trim() || student.subject?.trim()) || "";
}

function getStudentState(student: User) {
  return student.profileDetails?.address?.state?.trim() || "Not specified";
}

function getStudentCollege(student: User) {
  return (
    student.profileDetails?.preparation?.collegeName?.trim()
    || student.profileDetails?.preparation?.institutionName?.trim()
    || "Not specified"
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getStatusMarker(status: string) {
  if (status === "approved" || status === "active") {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <CheckCircle size={15} />
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        <Clock size={15} />
      </span>
    );
  }

  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-50 text-rose-600">
      <XCircle size={15} />
    </span>
  );
}

async function fetchStudentInsights(studentId: number) {
  const response = await fetch(buildApiUrl(`/api/users/${studentId}/profile-insights`), { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? "Failed to load student profile");
  }
  return response.json() as Promise<StudentProfileInsights>;
}

export default function SuperAdminStudents() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedStudent, setSelectedStudent] = useState<User | null>(null);
  const [resetStudent,setResetStudent]=useState<User|null>(null);
  const [rejectionDialog, setRejectionDialog] = useState<User | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [sortKey, setSortKey] = useState<StudentSortKey>("activity");
  const [sortDirection, setSortDirection] = useState<StudentSortDirection>("desc");
  const studentActivity = useStudentActivity();
  const activityMetrics = useMemo(() => new Map(studentActivity.data?.students.map(row => [row.studentId, row])), [studentActivity.data]);
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [collegeFilter, setCollegeFilter] = useState("all");
  const [testsUnlockAmount, setTestsUnlockAmount] = useState("");
  const [questionBankUnlockAmount, setQuestionBankUnlockAmount] = useState("");
  const [analysisUnlockAmount, setAnalysisUnlockAmount] = useState("");
  const [pyqUnlockAmount, setPyqUnlockAmount] = useState("");

  useEffect(() => {
    if (!selectedStudent) {
      setTestsUnlockAmount("");
      setQuestionBankUnlockAmount("");
      setAnalysisUnlockAmount("");
      setPyqUnlockAmount("");
      return;
    }

    setTestsUnlockAmount(
      selectedStudent.studentFeaturePricing?.testsAmount != null
        ? String(selectedStudent.studentFeaturePricing.testsAmount)
        : "",
    );
    setQuestionBankUnlockAmount(
      selectedStudent.studentFeaturePricing?.questionBankAmount != null
        ? String(selectedStudent.studentFeaturePricing.questionBankAmount)
        : "",
    );
    setAnalysisUnlockAmount(
      selectedStudent.studentFeaturePricing?.analysisAmount != null
        ? String(selectedStudent.studentFeaturePricing.analysisAmount)
        : "",
    );
    setPyqUnlockAmount(
      selectedStudent.studentFeaturePricing?.pyqAmount != null
        ? String(selectedStudent.studentFeaturePricing.pyqAmount)
        : "",
    );
  }, [
    selectedStudent?.id,
    selectedStudent?.studentFeaturePricing?.questionBankAmount,
    selectedStudent?.studentFeaturePricing?.testsAmount,
    selectedStudent?.studentFeaturePricing?.analysisAmount,
    selectedStudent?.studentFeaturePricing?.pyqAmount,
  ]);

  const { data: students = [], isLoading: isStudentsLoading } = useQuery<User[]>({
    queryKey: ["sa-students-with-approvers"],
    queryFn: async () => {
      const [studentsRes, adminsRes] = await Promise.all([
        fetch(buildApiUrl(`/api/users?role=student`), { credentials: "include" }),
        fetch(buildApiUrl(`/api/users?role=admin`), { credentials: "include" }),
      ]);
      const studentsData: User[] = await studentsRes.json();
      const adminsData: User[] = await adminsRes.json();
      const adminMap: Record<number, string> = {};
      for (const admin of adminsData) adminMap[admin.id] = admin.fullName;
      return studentsData.map((student) => ({
        ...student,
        approverName: student.approvedById ? (adminMap[student.approvedById] ?? `Admin #${student.approvedById}`) : undefined,
      }));
    },
  });

  const studentInsightsQuery = useQuery<StudentProfileInsights>({
    queryKey: ["sa-student-insights", selectedStudent?.id],
    enabled: !!selectedStudent,
    queryFn: () => fetchStudentInsights(selectedStudent!.id),
    staleTime: 30_000,
  });

  const refreshStudents = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-student-activity"] });
    queryClient.invalidateQueries({ queryKey: ["sa-students-with-approvers"] });
    queryClient.invalidateQueries({ queryKey: ["sa-student-insights"] });
    // Also refresh admin-facing student lists so status updates propagate
    queryClient.invalidateQueries({ queryKey: ["admin-students"] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
  };

  const revokeMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const response = await fetch(buildApiUrl(`/api/users/${id}/approve`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected", reason }),
      });
      if (!response.ok) throw new Error("Failed to revoke access");
    },
    onSuccess: () => {
      refreshStudents();
      setRejectionDialog(null);
      setRejectionReason("");
      toast({ title: "Application rejected", description: "Student can review the reason and resubmit." });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id }: { id: number; mode: "approve" | "restore"; name: string }) => {
      const response = await fetch(buildApiUrl(`/api/users/${id}/approve`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to approve student");
      }
      return response.json() as Promise<User>;
    },
    onSuccess: (updatedStudent, variables) => {
      refreshStudents();
      if (selectedStudent?.id === updatedStudent.id) setSelectedStudent(updatedStudent);
      toast({
        title: variables.mode === "approve" ? "Student approved" : "Access restored",
        description: variables.mode === "approve"
          ? `${variables.name} can now access the platform.`
          : `${variables.name} can log in again.`,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(buildApiUrl(`/api/users/${id}`), { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to delete student");
      }
    },
    onSuccess: (_, deletedId) => {
      if (selectedStudent?.id === deletedId) setSelectedStudent(null);
      refreshStudents();
      toast({ title: "Student deleted", description: "Student account and all related data were permanently removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const featureAccessMutation = useMutation({
    mutationFn: async ({
      id,
      testsLocked,
      questionBankLocked,
      analysisLocked,
      pyqLocked,
      testsAmount,
      questionBankAmount,
      analysisAmount,
      pyqAmount,
    }: {
      id: number;
      testsLocked?: boolean;
      questionBankLocked?: boolean;
      analysisLocked?: boolean;
      pyqLocked?: boolean;
      testsAmount?: number | null;
      questionBankAmount?: number | null;
      analysisAmount?: number | null;
      pyqAmount?: number | null;
    }) => {
      const response = await fetch(buildApiUrl(`/api/users/${id}/student-feature-access`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(testsLocked !== undefined ? { testsLocked } : {}),
          ...(questionBankLocked !== undefined ? { questionBankLocked } : {}),
          ...(analysisLocked !== undefined ? { analysisLocked } : {}),
          ...(pyqLocked !== undefined ? { pyqLocked } : {}),
          ...(testsAmount !== undefined ? { testsAmount } : {}),
          ...(questionBankAmount !== undefined ? { questionBankAmount } : {}),
          ...(analysisAmount !== undefined ? { analysisAmount } : {}),
          ...(pyqAmount !== undefined ? { pyqAmount } : {}),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to update student access");
      }
      return response.json() as Promise<User>;
    },
    onSuccess: (updatedStudent, variables) => {
      refreshStudents();
      if (selectedStudent?.id === updatedStudent.id) setSelectedStudent(updatedStudent);
      toast({
        title: "Student access updated",
        description:
          variables.testsAmount !== undefined || variables.questionBankAmount !== undefined || variables.analysisAmount !== undefined || variables.pyqAmount !== undefined
            ? "Student unlock amounts were updated."
            : variables.testsLocked !== undefined
            ? variables.testsLocked
              ? "Tests are now locked for this student."
              : "Tests are unlocked again for this student."
            : variables.questionBankLocked !== undefined
            ? variables.questionBankLocked
              ? "Question bank is now locked for this student."
              : "Question bank is unlocked again for this student."
            : variables.analysisLocked
            ? "Full analysis is now locked for this student."
            : variables.pyqLocked
            ? "PYQ access is now locked for this student."
            : variables.pyqLocked === false
            ? "PYQ access is unlocked again for this student."
            : "Full analysis is unlocked again for this student.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not update access", description: error.message, variant: "destructive" });
    },
  });

  const priorityAccessMutation = useMutation({
    mutationFn: async ({ id, priorityAccess }: { id: number; priorityAccess: boolean }) => {
      const response = await fetch(buildApiUrl(`/api/users/${id}/priority-access`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priorityAccess }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Failed to update priority access");
      return payload as User;
    },
    onSuccess: (updatedStudent) => {
      refreshStudents();
      if (selectedStudent?.id === updatedStudent.id) setSelectedStudent(updatedStudent);
      toast({
        title: updatedStudent.priorityAccess ? "Priority access enabled" : "Priority access removed",
        description: updatedStudent.priorityAccess
          ? `${updatedStudent.fullName} can continue during access pause windows.`
          : `${updatedStudent.fullName} will follow the standard access window.`,
      });
    },
    onError: (error: Error) => toast({ title: "Could not update priority access", description: error.message, variant: "destructive" }),
  });

  const reviewableStudents = students.filter((student) => student.onboardingComplete === true);
  const pending = reviewableStudents.filter((student) => student.status === "pending");
  const approved = reviewableStudents.filter((student) => student.status === "approved");

  const stateOptions = useMemo(
    () => Array.from(new Set(reviewableStudents.map(getStudentState))).sort((a, b) => a.localeCompare(b)),
    [reviewableStudents],
  );
  const collegeOptions = useMemo(
    () => Array.from(new Set(reviewableStudents.map(getStudentCollege))).sort((a, b) => a.localeCompare(b)),
    [reviewableStudents],
  );

  const sortedStudents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = reviewableStudents.filter((student) => {
      const matchesSearch = !query || [
        student.fullName,
        student.email,
        student.username,
        String(student.id),
      ].some((value) => value.toLowerCase().includes(query));
      const matchesState = stateFilter === "all" || getStudentState(student) === stateFilter;
      const matchesCollege = collegeFilter === "all" || getStudentCollege(student) === collegeFilter;
      return matchesSearch && matchesState && matchesCollege;
    });
    return sortStudents(list, sortKey, sortDirection, activityMetrics, student => student.fullName);
  }, [reviewableStudents, sortKey, sortDirection, activityMetrics, searchQuery, stateFilter, collegeFilter]);

  const prefetchStudentInsights = (studentId: number) => {
    void queryClient.prefetchQuery({
      queryKey: ["sa-student-insights", studentId],
      queryFn: () => fetchStudentInsights(studentId),
      staleTime: 30_000,
    });
  };

  const openStudentReview = (student: User) => {
    prefetchStudentInsights(student.id);
    setSelectedStudent(student);
  };

  const handleDelete = (student: User) => {
    if (!confirm(`Delete ${student.fullName} permanently? This will remove all data related to this student.`)) return;
    deleteMutation.mutate(student.id);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">All Students</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Super admin view for approvals, recovery, and deep student profile insights.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
              <Users size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold" data-testid="stat-total-students">{reviewableStudents.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-50">
              <Clock size={18} className="text-yellow-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold" data-testid="stat-pending-students">{pending.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
              <CheckCircle size={18} className="text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Approved</p>
              <p className="text-2xl font-bold" data-testid="stat-approved-students">{approved.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Student List</CardTitle>
          <StudentActivitySort sortKey={sortKey} direction={sortDirection} onSortKey={setSortKey} onDirection={setSortDirection}
            loading={studentActivity.isLoading} unavailable={studentActivity.isError || !!studentActivity.data?.unavailableSources.length} />
          <div className="flex w-full flex-col gap-3 md:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by name, email, username, or user ID"
                aria-label="Search students by name, email, username, or user ID"
                className="pl-9"
                data-testid="input-search-super-admin-students"
              />
            </div>
            <label className="sr-only" htmlFor="student-state-filter">Filter students by state</label>
            <select
              id="student-state-filter"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm md:w-48"
              data-testid="select-student-state"
            >
              <option value="all">All states</option>
              {stateOptions.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
            <label className="sr-only" htmlFor="student-college-filter">Filter students by college</label>
            <select
              id="student-college-filter"
              value={collegeFilter}
              onChange={(event) => setCollegeFilter(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm md:w-56"
              data-testid="select-student-college"
            >
              <option value="all">All colleges</option>
              {collegeOptions.map((college) => <option key={college} value={college}>{college}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {isStudentsLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, index) => (
                <div key={index} className="h-16 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : sortedStudents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {searchQuery || stateFilter !== "all" || collegeFilter !== "all"
                ? "No students match the selected search or filters."
                : "No students registered yet."}
            </p>
          ) : (
            <div className="space-y-2">
              {sortedStudents.map((student, rank) => (
                <div
                  key={student.id}
                  className="flex flex-col gap-3 rounded-lg border border-border p-4 xl:flex-row xl:items-start xl:justify-between"
                  data-testid={`student-row-${student.id}`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {/* Rank badge */}
                    <span className="mt-3 shrink-0 text-[11px] font-bold text-muted-foreground w-5 text-right leading-none">
                      {rank + 1}
                    </span>

                    <button
                      type="button"
                      className="shrink-0 rounded-full transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-amber-300"
                      onMouseEnter={() => prefetchStudentInsights(student.id)}
                      onFocus={() => prefetchStudentInsights(student.id)}
                      onClick={() => openStudentReview(student)}
                      aria-label={`Open ${student.fullName} profile`}
                    >
                      <Avatar className="h-12 w-12 border border-amber-200 ring-2 ring-amber-50">
                        <AvatarImage src={student.avatarUrl ?? undefined} alt={student.fullName} />
                        <AvatarFallback className="bg-gradient-to-br from-amber-500 to-orange-600 text-sm font-bold text-white">
                          {getInitials(student.fullName)}
                        </AvatarFallback>
                      </Avatar>
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{student.fullName}</p>
                        {student.priorityAccess && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            <Star size={10} className="fill-amber-500 text-amber-500" /> Priority
                          </span>
                        )}
                        {getStatusMarker(student.status)}
                      </div>

                      {/* Activity stats */}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Activity size={10} className="text-blue-500" />
                          {activityMetrics.get(student.id)?.activityCount ?? '—'} submissions
                        </span>
                        <span className="text-muted-foreground/40 text-[10px]">·</span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <ClipboardList size={10} className="text-orange-500" />
                          {activityMetrics.get(student.id)?.testCount ?? '—'} tests given
                        </span>
                        {student.lastActivityAt && (
                          <>
                            <span className="text-muted-foreground/40 text-[10px]">·</span>
                            <span className="text-[11px] text-muted-foreground">
                              Last seen {format(new Date(student.lastActivityAt), "dd MMM")}
                            </span>
                          </>
                        )}
                      </div>

                      <StudentActivityCounts metrics={activityMetrics.get(student.id)} />

                      {student.rejectionReason && (
                        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          Reason: {student.rejectionReason}
                        </p>
                      )}
                      {student.status === "approved" && student.approverName && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-green-700" data-testid={`approver-${student.id}`}>
                          <ShieldCheck size={11} />
                          Approved by <strong>{student.approverName}</strong>
                          {student.approvedAt && (
                            <span className="font-normal text-muted-foreground">
                              · {format(new Date(student.approvedAt), "MMM d, yyyy")}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    {student.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => approveMutation.mutate({ id: student.id, mode: "approve", name: student.fullName })}
                          disabled={approveMutation.isPending}
                          data-testid={`button-approve-${student.id}`}
                        >
                          <CheckCircle size={14} className="mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => {
                            setRejectionDialog(student);
                            setRejectionReason(student.rejectionReason ?? "");
                          }}
                          disabled={revokeMutation.isPending}
                          data-testid={`button-reject-${student.id}`}
                        >
                          <XCircle size={14} className="mr-1" />
                          Reject
                        </Button>
                      </>
                    )}

                    {student.status === "approved" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          setRejectionDialog(student);
                          setRejectionReason(student.rejectionReason ?? "");
                        }}
                        disabled={revokeMutation.isPending}
                        data-testid={`button-revoke-${student.id}`}
                      >
                        <ShieldOff size={14} className="mr-1" />
                        Revoke Access
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <StudentTestResetDialog student={resetStudent?{id:resetStudent.id,name:resetStudent.fullName}:null} onClose={()=>setResetStudent(null)}/>
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
              The rejection reason will be visible in the student dashboard and will also be sent by email.
            </p>
            <Textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              rows={4}
              placeholder="Why is this application being rejected?"
            />
            <Button
              className="w-full bg-rose-600 hover:bg-rose-700"
              disabled={rejectionReason.trim().length < 5 || revokeMutation.isPending || !rejectionDialog}
              onClick={() =>
                rejectionDialog && revokeMutation.mutate({
                  id: rejectionDialog.id,
                  reason: rejectionReason.trim(),
                })
              }
            >
              Submit rejection
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <StudentVerificationReviewDialog
        open={!!selectedStudent}
        onOpenChange={(open) => {
          if (!open) setSelectedStudent(null);
        }}
        student={
          selectedStudent
            ? {
                fullName: selectedStudent.fullName,
                username: selectedStudent.username,
                status: selectedStudent.status,
                onboardingComplete: selectedStudent.onboardingComplete,
                rejectionReason: selectedStudent.rejectionReason,
                targetExam: getStudentTargetExam(selectedStudent),
                email: selectedStudent.email,
              }
            : null
        }
        insights={studentInsightsQuery.data}
        isLoading={studentInsightsQuery.isLoading}
        errorMessage={studentInsightsQuery.isError ? (studentInsightsQuery.error instanceof Error ? studentInsightsQuery.error.message : "Could not load student profile.") : null}
        onPrimaryAction={
          selectedStudent?.status === "pending"
            ? () => approveMutation.mutate({ id: selectedStudent.id, mode: "approve", name: selectedStudent.fullName })
            : undefined
        }
        onSecondaryAction={
          selectedStudent?.status === "pending"
            ? () => {
                setRejectionDialog(selectedStudent);
                setRejectionReason(selectedStudent.rejectionReason ?? "");
              }
            : undefined
        }
        primaryActionLabel="Approve"
        secondaryActionLabel="Reject"
        primaryActionDisabled={approveMutation.isPending}
        secondaryActionDisabled={revokeMutation.isPending}
        settingsContent={
          selectedStudent ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Student Settings</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Manage student access and account-level actions from here.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Button variant="outline" size="icon" title="Reset attempted test" aria-label={`Reset attempted test for ${selectedStudent.fullName}`} onClick={()=>setResetStudent(selectedStudent)} data-testid={`button-reset-student-tests-${selectedStudent.id}`}><RotateCcw size={16}/></Button>
                <Button
                  variant="outline"
                  className={selectedStudent.priorityAccess
                    ? "justify-between border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    : "justify-between border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}
                  onClick={() => priorityAccessMutation.mutate({
                    id: selectedStudent.id,
                    priorityAccess: !Boolean(selectedStudent.priorityAccess),
                  })}
                  disabled={priorityAccessMutation.isPending}
                  data-testid={`button-priority-access-${selectedStudent.id}`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Star size={15} className={selectedStudent.priorityAccess ? "fill-amber-500 text-amber-500" : "text-slate-400"} />
                    {selectedStudent.priorityAccess ? "Remove Priority Access" : "Give Priority Access"}
                  </span>
                </Button>

                {selectedStudent.status === "approved" ? (
                  <Button
                    variant="outline"
                    className={selectedStudent.studentFeatureAccess?.testsLocked
                      ? "justify-between border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      : "justify-between border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"}
                    onClick={() => featureAccessMutation.mutate({
                      id: selectedStudent.id,
                      testsLocked: !Boolean(selectedStudent.studentFeatureAccess?.testsLocked),
                    })}
                    disabled={featureAccessMutation.isPending}
                    data-testid={`button-lock-tests-${selectedStudent.id}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {selectedStudent.studentFeatureAccess?.testsLocked ? <LockOpen size={15} /> : <Lock size={15} />}
                      {selectedStudent.studentFeatureAccess?.testsLocked ? "Unlock Tests" : "Lock Tests"}
                    </span>
                  </Button>
                ) : null}

                {selectedStudent.status === "approved" ? (
                  <Button
                    variant="outline"
                    className={selectedStudent.studentFeatureAccess?.pyqLocked
                      ? "justify-between border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      : "justify-between border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"}
                    onClick={() => featureAccessMutation.mutate({
                      id: selectedStudent.id,
                      pyqLocked: !Boolean(selectedStudent.studentFeatureAccess?.pyqLocked),
                    })}
                    disabled={featureAccessMutation.isPending}
                    data-testid={`button-lock-pyq-${selectedStudent.id}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {selectedStudent.studentFeatureAccess?.pyqLocked ? <LockOpen size={15} /> : <Lock size={15} />}
                      {selectedStudent.studentFeatureAccess?.pyqLocked ? "Unlock PYQ" : "Lock PYQ"}
                    </span>
                  </Button>
                ) : null}

                {selectedStudent.status === "approved" ? (
                  <Button
                    variant="outline"
                    className={selectedStudent.studentFeatureAccess?.questionBankLocked
                      ? "justify-between border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      : "justify-between border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"}
                    onClick={() => featureAccessMutation.mutate({
                      id: selectedStudent.id,
                      questionBankLocked: !Boolean(selectedStudent.studentFeatureAccess?.questionBankLocked),
                    })}
                    disabled={featureAccessMutation.isPending}
                    data-testid={`button-lock-question-bank-${selectedStudent.id}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {selectedStudent.studentFeatureAccess?.questionBankLocked ? <LockOpen size={15} /> : <Lock size={15} />}
                      {selectedStudent.studentFeatureAccess?.questionBankLocked ? "Unlock QBank" : "Lock QBank"}
                    </span>
                  </Button>
                ) : null}

                {selectedStudent.status === "approved" ? (
                  <Button
                    variant="outline"
                    className={selectedStudent.studentFeatureAccess?.analysisLocked
                      ? "justify-between border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      : "justify-between border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100"}
                    onClick={() => featureAccessMutation.mutate({
                      id: selectedStudent.id,
                      analysisLocked: !Boolean(selectedStudent.studentFeatureAccess?.analysisLocked),
                    })}
                    disabled={featureAccessMutation.isPending}
                    data-testid={`button-lock-analysis-${selectedStudent.id}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {selectedStudent.studentFeatureAccess?.analysisLocked ? <LockOpen size={15} /> : <Lock size={15} />}
                      {selectedStudent.studentFeatureAccess?.analysisLocked ? "Unlock Analysis" : "Lock Analysis"}
                    </span>
                  </Button>
                ) : null}

                {selectedStudent.status === "rejected" ? (
                  <Button
                    variant="outline"
                    className="justify-between border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    onClick={() => approveMutation.mutate({ id: selectedStudent.id, mode: "restore", name: selectedStudent.fullName })}
                    disabled={approveMutation.isPending}
                    data-testid={`button-restore-${selectedStudent.id}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <RotateCcw size={15} />
                      Restore Access
                    </span>
                  </Button>
                ) : null}

                <Button
                  variant="outline"
                  className="justify-between border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                  onClick={() => handleDelete(selectedStudent)}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-delete-${selectedStudent.id}`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Trash2 size={15} />
                    Delete All Data
                  </span>
                </Button>
              </div>

              {/* ── Test History ── */}
              {studentInsightsQuery.data && (() => {
                const history = (studentInsightsQuery.data as any).testHistory as Array<{
                  id: number; testId: number; title: string; score: number;
                  totalPoints: number | null; percentage: number; passed: boolean | null; submittedAt: string | null;
                }>;
                const payments = ((studentInsightsQuery.data as any).testsPaymentHistory ?? []) as Array<{
                  paidAt: string; amount: number; cycle: number; orderId: string; paymentId: string;
                }>;
                const lockEvents = ((studentInsightsQuery.data as any).testsLockEvents ?? []) as Array<{
                  lockedAt: string; lockedByAdminId: number | null; cycle: number;
                }>;
                const total = (studentInsightsQuery.data as any).overview?.testsAttempted ?? 0;

                type TimelineEvent = { type: "payment"; ts: number; data: typeof payments[0] } | { type: "lock"; ts: number; data: typeof lockEvents[0] };
                const events: TimelineEvent[] = [
                  ...payments.map((p) => ({ type: "payment" as const, ts: new Date(p.paidAt).getTime(), data: p })),
                  ...lockEvents.map((l) => ({ type: "lock" as const, ts: new Date(l.lockedAt).getTime(), data: l })),
                ].sort((a, b) => b.ts - a.ts);

                const rows: Array<{ kind: "test"; row: typeof history[0]; idx: number } | { kind: "event"; event: TimelineEvent }> = [];
                let evtPtr = 0;
                history.forEach((row, idx) => {
                  const ts = row.submittedAt ? new Date(row.submittedAt).getTime() : 0;
                  while (evtPtr < events.length && events[evtPtr].ts >= ts) {
                    rows.push({ kind: "event", event: events[evtPtr] });
                    evtPtr++;
                  }
                  rows.push({ kind: "test", row, idx });
                });
                while (evtPtr < events.length) {
                  rows.push({ kind: "event", event: events[evtPtr] });
                  evtPtr++;
                }

                return (
                  <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <ClipboardList size={16} className="text-orange-500" />
                        <h4 className="text-base font-bold text-slate-900">Test History</h4>
                      </div>
                      <div className="flex items-center gap-2">
                        {payments.length > 0 && (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                            {payments.length} payment{payments.length !== 1 ? "s" : ""}
                          </span>
                        )}
                        <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                          {total} attempted
                        </span>
                      </div>
                    </div>
                    {history.length === 0 && events.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-4">No tests attempted yet</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100">
                              <th className="text-left text-xs font-semibold text-slate-500 pb-2 pr-3">#</th>
                              <th className="text-left text-xs font-semibold text-slate-500 pb-2 pr-3">Test Name</th>
                              <th className="text-center text-xs font-semibold text-slate-500 pb-2 pr-3">Marks</th>
                              <th className="text-center text-xs font-semibold text-slate-500 pb-2 pr-3">%</th>
                              <th className="text-center text-xs font-semibold text-slate-500 pb-2 pr-3">Result</th>
                              <th className="text-left text-xs font-semibold text-slate-500 pb-2">Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((item, i) => {
                              if (item.kind === "event") {
                                const isPay = item.event.type === "payment";
                                return (
                                  <tr key={`evt-${i}`}>
                                    <td colSpan={6} className="py-1.5">
                                      <div className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold ${isPay ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"}`}>
                                        {isPay ? <CheckCircle size={11} /> : <Lock size={11} />}
                                        {isPay
                                          ? `💳 Payment received — Cycle #${(item.event.data as typeof payments[0]).cycle} — ₹${(item.event.data as typeof payments[0]).amount} — ${format(new Date((item.event.data as typeof payments[0]).paidAt), "dd MMM yyyy, hh:mm a")}`
                                          : `🔒 Locked by admin — Cycle #${(item.event.data as typeof lockEvents[0]).cycle} — ${format(new Date((item.event.data as typeof lockEvents[0]).lockedAt), "dd MMM yyyy, hh:mm a")}`}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }
                              const { row, idx } = item;
                              return (
                                <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50">
                                  <td className="py-2 pr-3 text-slate-400 text-xs">{idx + 1}</td>
                                  <td className="py-2 pr-3 max-w-[160px] truncate font-medium text-slate-800 text-xs">{row.title}</td>
                                  <td className="py-2 pr-3 text-center font-semibold text-slate-700 text-xs">
                                    {row.score}<span className="text-slate-400 font-normal">/{row.totalPoints ?? "—"}</span>
                                  </td>
                                  <td className="py-2 pr-3 text-center">
                                    <span className={`text-xs font-bold ${row.percentage >= 60 ? "text-emerald-600" : row.percentage >= 35 ? "text-amber-600" : "text-red-500"}`}>
                                      {row.percentage}%
                                    </span>
                                  </td>
                                  <td className="py-2 pr-3 text-center">
                                    {row.passed === true
                                      ? <CheckCircle2 size={13} className="mx-auto text-emerald-500" />
                                      : row.passed === false
                                        ? <XCircle size={13} className="mx-auto text-red-400" />
                                        : <span className="text-slate-300 text-xs">—</span>}
                                  </td>
                                  <td className="py-2 text-xs text-slate-500">
                                    {row.submittedAt ? format(new Date(row.submittedAt), "dd MMM yyyy") : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {selectedStudent.status === "approved" ? (
                <div className="rounded-3xl border border-[#F3E8D6] bg-[#FFF9F2] p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
                  <div className="mb-4">
                    <h4 className="text-base font-bold text-slate-900">One-time unlock amounts</h4>
                    <p className="mt-1 text-sm text-slate-500">
                      Set the payment amount this student will see when a locked feature or PYQ area is opened.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9A6B2C]">Tests unlock amount</span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={testsUnlockAmount}
                        onChange={(event) => setTestsUnlockAmount(event.target.value)}
                        placeholder="Enter tests amount"
                        className="h-11 rounded-2xl border-[#EBDCC4] bg-white"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9A6B2C]">PYQ unlock amount</span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={pyqUnlockAmount}
                        onChange={(event) => setPyqUnlockAmount(event.target.value)}
                        placeholder="Enter PYQ amount"
                        className="h-11 rounded-2xl border-[#EBDCC4] bg-white"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9A6B2C]">Question bank unlock amount</span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={questionBankUnlockAmount}
                        onChange={(event) => setQuestionBankUnlockAmount(event.target.value)}
                        placeholder="Enter question bank amount"
                        className="h-11 rounded-2xl border-[#EBDCC4] bg-white"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9A6B2C]">Analysis unlock amount</span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={analysisUnlockAmount}
                        onChange={(event) => setAnalysisUnlockAmount(event.target.value)}
                        placeholder="Enter analysis amount"
                        className="h-11 rounded-2xl border-[#EBDCC4] bg-white"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button
                      type="button"
                      className="rounded-full bg-[#D97706] px-5 text-white hover:bg-[#B45309]"
                      disabled={featureAccessMutation.isPending}
                      onClick={() => featureAccessMutation.mutate({
                        id: selectedStudent.id,
                        testsAmount: testsUnlockAmount.trim() ? Number(testsUnlockAmount) : null,
                        questionBankAmount: questionBankUnlockAmount.trim() ? Number(questionBankUnlockAmount) : null,
                        analysisAmount: analysisUnlockAmount.trim() ? Number(analysisUnlockAmount) : null,
                        pyqAmount: pyqUnlockAmount.trim() ? Number(pyqUnlockAmount) : null,
                      })}
                    >
                      Save unlock amounts
                    </Button>
                    <p className="self-center text-xs text-slate-500">
                      Leave a field empty if the amount should not be configured yet.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}
