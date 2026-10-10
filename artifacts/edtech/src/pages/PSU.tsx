import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ClipboardList,
  FileUp,
  Flag,
  History,
  Plus,
  RefreshCw,
  Upload,
  Users,
  BookOpen,
  ArrowLeft,
} from "lucide-react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { parsePyqHtml, type ParsedPyqImport } from "@/lib/pyqImport";
import { parsePsuTestHtml, type PsuTestBundle } from "@/lib/psuTestImport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import TestResultDetailCard from "@/components/student/TestResultDetailCard";
import { useToast } from "@/hooks/use-toast";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatExamDisplayName } from "@/lib/exam-display";
import { normalizeAdminExamKey, readAdminExamSelection } from "@/lib/admin-exam-selection";
import { isJamChemistryExam, readStudentExamSelection } from "@/lib/student-exam-selection";

type PSU = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isPublished: boolean;
  testCount: number;
  questionCount: number;
};
type PsuTest = {
  id: number;
  title: string;
  description: string | null;
  durationMinutes: number;
  questionCount: number;
  isPublished: boolean;
  exam?: string | null;
  examType?: string | null;
};
type PsuSubject = {
  exam: string;
  subject: string;
  questionCount: number;
  chapterCount: number;
};
type PsuDetail = PSU & {
  tests: PsuTest[];
  questionBank: { subjects: PsuSubject[]; questionCount: number };
};
type PsuReport = {
  id: number;
  questionId: number;
  reportedBy?: number;
  reporterName?: string;
  createdAt?: string | null;
  reason: string;
  status: string;
  questionText: string;
  exam: string;
  subject: string;
  chapter: string;
  year: number;
};
type PsuTestReport = {
  id: number;
  testId: number;
  testTitle: string;
  questionIndex: number;
  reason: string;
  questionText: string;
  reporterName?: string;
  createdAt?: string | null;
};
type PsuTestProgress = {
  testId: number;
  attemptNumber: number;
  score: number;
  totalPoints: number;
  percentage: number;
  submittedAt: string | null;
};
type PsuSubmissionAnalytics = {
  summary: { totalSubmissions: number; students: number; testsWithSubmissions: number; averagePercentage: number };
  tests: Array<{
    testId: number;
    title: string;
    submissions: number;
    students: number;
    averageScore: number;
    topScore: number;
    totalPoints: number;
    averagePercentage: number;
    averageTimeSeconds: number;
    correct: number;
    wrong: number;
    skipped: number;
    scoreDistribution: Array<{ range: string; count: number }>;
  }>;
};

function hasPsuTestDraft(psuId: number, testId: number) {
  if (typeof window === "undefined") return false;
  try {
    const draft = JSON.parse(localStorage.getItem(`educonnect-test-draft-psu-${psuId}-${testId}`) ?? "null");
    return Boolean(draft && Number(draft.savedAt) > 0 && draft.answers && typeof draft.answers === "object");
  } catch {
    return false;
  }
}

function psuExamMatchesSelection(storedExam: string | null | undefined, selectedExam: string) {
  const target = normalizeAdminExamKey(selectedExam);
  const stored = normalizeAdminExamKey(storedExam);
  if (!target || !stored) return true;
  if (target === "gate" || target.startsWith("gate-")) {
    // PSU folders contain organisations such as ISRO/BHEL and their source
    // exam is not the same thing as the user's GATE workspace. All PSU
    // preparation belongs to GATE; only JAM is intentionally excluded.
    return true;
  }
  if (target === "jam-chemistry") {
    return stored === "jam-chemistry" || (stored.includes("jam") && !stored.includes("gate"));
  }
  return stored === target
    || stored.startsWith(`${target}-`)
    || target.startsWith(`${stored}-`)
    || stored.includes(target)
    || target.includes(stored);
}

export default function PSUPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [location, navigate] = useLocation();
  const setLocation = (path: string) => {
    const match = path.match(/^\/student\/tests\?testId=(\d+)$/);
    const questionBankMatch = path.match(/^\/student\/pyq\?psuId=(\d+)$/);
    navigate(
      match && selectedId !== null
        ? `/student/psu/${selectedId}/tests/${match[1]}`
        : questionBankMatch
          ? `/student/psu/${questionBankMatch[1]}/question-bank`
          : path,
    );
  };
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedExamKey, setSelectedExamKey] = useState(() => readAdminExamSelection(location));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedResultTestId, setSelectedResultTestId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"tests" | "questions">("tests");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [testImport, setTestImport] = useState<{
    name: string;
    bundle: PsuTestBundle;
  } | null>(null);
  const [testImportProgress, setTestImportProgress] = useState<{
    uploaded: number;
    total: number;
    phase: "starting" | "uploading" | "finishing";
  } | null>(null);
  const [questionImport, setQuestionImport] = useState<{
    name: string;
    parsed: ParsedPyqImport;
  } | null>(null);
  const testInputRef = useRef<HTMLInputElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const syncExam = () => setSelectedExamKey(readAdminExamSelection(location));
    window.addEventListener("admin-exam-changed", syncExam);
    window.addEventListener("storage", syncExam);
    syncExam();
    return () => {
      window.removeEventListener("admin-exam-changed", syncExam);
      window.removeEventListener("storage", syncExam);
    };
  }, [location]);

  useEffect(() => {
    if (!isAdmin && isJamChemistryExam(readStudentExamSelection(user))) {
      navigate("/student/dashboard");
    }
  }, [isAdmin, navigate, user]);

  useEffect(() => {
    const psuId = Number(new URLSearchParams(location.split("?")[1] ?? "").get("psuId"));
    if (Number.isInteger(psuId) && psuId > 0) setSelectedId(psuId);
  }, [location]);

  const psusQuery = useQuery({
    queryKey: ["psus", isAdmin ? "admin" : "student"],
    queryFn: () => api.get<PSU[]>("/psus"),
  });
  const psuExamQueries = useQueries({
    queries: (psusQuery.data ?? []).map((psu) => ({
      queryKey: ["psu-exam-catalog", psu.id, selectedExamKey],
      enabled: isAdmin && Boolean(selectedExamKey),
      queryFn: () => api.get<PsuDetail>(`/psus/${psu.id}`),
      staleTime: 30_000,
    })),
  });
  const detailQuery = useQuery({
    queryKey: ["psu", selectedId],
    enabled: selectedId !== null,
    queryFn: () => api.get<PsuDetail>(`/psus/${selectedId}`),
  });
  const reportsQuery = useQuery({
    queryKey: ["psu-qbank-reports", selectedId],
    enabled: isAdmin && selectedId !== null && activeTab === "questions",
    queryFn: () =>
      api.get<{ reports: PsuReport[] }>(
        `/psus/${selectedId}/question-bank/reports?status=open`,
      ),
  });
  const testReportsQuery = useQuery({
    queryKey: ["psu-test-reports", selectedId],
    enabled: isAdmin && selectedId !== null && activeTab === "tests",
    queryFn: () => api.get<{ reports: PsuTestReport[] }>(`/psus/${selectedId}/tests/reports`),
  });
  const submissionsQuery = useQuery({
    queryKey: ["psu-test-submissions", selectedId],
    enabled: isAdmin && selectedId !== null && activeTab === "tests",
    queryFn: () => api.get<PsuSubmissionAnalytics>(`/psus/${selectedId}/submissions`),
  });
  const studentProgressQuery = useQuery({
    queryKey: ["psu-student-progress", selectedId],
    enabled: !isAdmin && selectedId !== null,
    queryFn: () => api.get<{ progress: PsuTestProgress[] }>(`/psus/${selectedId}/student-progress`),
  });
  const resultSummaryQuery = useQuery<{
    test: { id: number; title: string; description: string | null; examHeader: string | null; examSubheader: string | null; durationMinutes: number; totalQuestions: number };
    submission: { score: number; totalPoints: number; percentage: number; passed: boolean; submittedAt: string | null; visitedQuestionIds?: number[] };
    perQuestion: Array<{ id: number; myAnswer: unknown; isCorrect: boolean; isSkipped: boolean }>;
  }>({
    queryKey: ["psu-test-result-summary", selectedId, selectedResultTestId],
    enabled: !isAdmin && selectedId !== null && selectedResultTestId !== null,
    queryFn: () => api.get(`/psus/${selectedId}/tests/${selectedResultTestId}/analysis`),
  });
  const selected = detailQuery.data;
  const examPsuCards = (psusQuery.data ?? []).map((psu, index) => {
    const detail = psuExamQueries[index]?.data;
    const subjects = detail?.questionBank.subjects.filter((subject) =>
      psuExamMatchesSelection(subject.exam, selectedExamKey),
    ) ?? [];
    const tests = detail?.tests.filter((test) =>
      psuExamMatchesSelection(test.exam ?? test.examType, selectedExamKey),
    ) ?? [];
    return {
      ...psu,
      testCount: tests.length,
      questionCount: subjects.reduce((sum, subject) => sum + subject.questionCount, 0),
      hasSelectedExamContent: subjects.length > 0 || tests.length > 0,
    };
  });
  const visiblePsuCards = isAdmin && selectedExamKey
    ? examPsuCards.filter((psu) => psu.hasSelectedExamContent)
    : examPsuCards;
  const psuExamCatalogLoading = isAdmin && Boolean(selectedExamKey) && (psusQuery.data ?? []).some((_psu, index) => !psuExamQueries[index]?.data && !psuExamQueries[index]?.isError);
  const selectedExamSubjects = selected?.questionBank.subjects.filter((subject) =>
    psuExamMatchesSelection(subject.exam, selectedExamKey),
  ) ?? [];
  const selectedExamTests = selected?.tests.filter((test) =>
    psuExamMatchesSelection(test.exam ?? test.examType, selectedExamKey),
  ) ?? [];
  const selectedExamQuestionCount = selectedExamSubjects.reduce((sum, subject) => sum + subject.questionCount, 0);
  const visiblePsuReports = reportsQuery.data?.reports.filter((report) =>
    psuExamMatchesSelection(report.exam, selectedExamKey),
  ) ?? [];

  useEffect(() => {
    if (!isAdmin || !selected || !selectedExamKey || selectedExamSubjects.length > 0 || selectedExamTests.length > 0) return;
    setSelectedId(null);
  }, [isAdmin, selected, selectedExamKey, selectedExamSubjects.length, selectedExamTests.length]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<PSU>("/psus", { name: newName, description: newDescription }),
    onSuccess: (created) => {
      setNewName("");
      setNewDescription("");
      setShowCreate(false);
      setSelectedId(created.id);
      queryClient.invalidateQueries({ queryKey: ["psus"] });
      toast({
        title: "PSU created",
        description: "Now add its tests and question bank.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not create PSU",
        description: error.message,
        variant: "destructive",
      }),
  });
  const publishMutation = useMutation({
    mutationFn: (isPublished: boolean) =>
      api.patch(`/psus/${selectedId}`, { isPublished }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["psus"] });
      queryClient.invalidateQueries({ queryKey: ["psu", selectedId] });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update PSU",
        description: error.message,
        variant: "destructive",
      }),
  });
  const importQuestionMutation = useMutation({
    mutationFn: () =>
      api.post<{ imported: number }>(
        `/psus/${selectedId}/question-bank/import`,
        questionImport?.parsed
          ? {
              ...questionImport.parsed,
              exam: formatExamDisplayName(selectedExamKey) || questionImport.parsed.exam,
            }
          : questionImport?.parsed,
      ),
    onSuccess: (result) => {
      setQuestionImport(null);
      queryClient.invalidateQueries({ queryKey: ["psu", selectedId] });
      toast({
        title: "Question bank imported",
        description: `${result.imported} questions are now inside this PSU.`,
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Question bank import failed",
        description: error.message,
        variant: "destructive",
      }),
  });
  const importTestMutation = useMutation({
    mutationFn: async () => {
      if (!testImport?.bundle || selectedId === null)
        throw new Error("Select a PSU first");
      const bundle = testImport.bundle;
      const questions = bundle.test.questions;
      setTestImportProgress({ uploaded: 0, total: questions.length, phase: "starting" });
      const started = await api.post<{ id: number; totalQuestions: number }>(
        `/psus/${selectedId}/tests/import/start`,
        { ...bundle, test: { ...bundle.test, questions: [], questionCount: questions.length } },
      );
      const chunkSize = 5;
      let uploaded = 0;
      for (let offset = 0; offset < questions.length; offset += chunkSize) {
        const chunk = questions.slice(offset, offset + chunkSize);
        await api.post(`/psus/${selectedId}/tests/${started.id}/import-chunk`, {
          questions: chunk,
          offset,
          totalQuestions: questions.length,
        });
        uploaded += chunk.length;
        setTestImportProgress({ uploaded, total: questions.length, phase: "uploading" });
      }
      setTestImportProgress({ uploaded: questions.length, total: questions.length, phase: "finishing" });
      return api.post<{ id: number; questionCount: number }>(
        `/psus/${selectedId}/tests/${started.id}/import-complete`,
        { totalQuestions: questions.length },
      );
    },
    onSuccess: (result) => {
      setTestImport(null);
      setTestImportProgress(null);
      queryClient.invalidateQueries({ queryKey: ["psu", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      toast({
        title: "PSU test imported",
        description: `${result.questionCount ?? 0} questions imported as a draft.`,
      });
    },
    onError: (error: Error) => {
      setTestImportProgress(null);
      toast({
        title: "Test import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  const rejectReportMutation = useMutation({
    mutationFn: (reportId: number) =>
      api.patch(`/psus/${selectedId}/question-bank/reports/${reportId}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["psu-qbank-reports", selectedId],
      });
      toast({ title: "Report marked reviewed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update report",
        description: error.message,
        variant: "destructive",
      }),
  });
  const resolveTestReportMutation = useMutation({
    mutationFn: (reportId: number) => api.patch(`/psus/${selectedId}/tests/reports/${reportId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["psu-test-reports", selectedId] }),
    onError: (error: Error) => toast({ title: "Could not resolve report", description: error.message, variant: "destructive" }),
  });

  async function handleTestFile(file: File | undefined) {
    if (!file) return;
    try {
      setTestImport({
        name: file.name,
        bundle: parsePsuTestHtml(await file.text(), file.name),
      });
    } catch (error) {
      toast({
        title: "Invalid test HTML",
        description:
          error instanceof Error ? error.message : "Could not read file",
        variant: "destructive",
      });
    }
  }
  async function handleQuestionFile(file: File | undefined) {
    if (!file) return;
    try {
      setQuestionImport({
        name: file.name,
        parsed: parsePyqHtml(await file.text(), file.name),
      });
    } catch (error) {
      toast({
        title: "Invalid question bank HTML",
        description:
          error instanceof Error ? error.message : "Could not read file",
        variant: "destructive",
      });
    }
  }

  if (selectedId === null) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                <Building2 />
              </span>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  PSU Preparation
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  {isAdmin
                    ? "Create PSU folders and manage their PYQ tests and question banks."
                    : "Choose a PSU to practise its tests and question bank."}
                </p>
              </div>
            </div>
          </div>
          {isAdmin ? (
            <Button onClick={() => setShowCreate((value) => !value)}>
              <Plus className="mr-2 h-4 w-4" /> Add PSU
            </Button>
          ) : null}
        </div>
        {showCreate ? (
          <Card>
            <CardHeader>
              <CardTitle>Add PSU</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:max-w-xl">
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="PSU name e.g. BHEL"
              />
              <Textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="Short description (optional)"
                rows={3}
              />
              <div>
                <Button
                  disabled={!newName.trim() || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? "Creating..." : "Create PSU"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
        {psusQuery.isLoading || psuExamCatalogLoading ? (
          <Loading text="Loading PSUs..." />
        ) : psusQuery.isError ? (
          <ErrorBox message={(psusQuery.error as Error).message} />
        ) : visiblePsuCards.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePsuCards.map((psu) => (
              <button
                key={psu.id}
                type="button"
                onClick={() => setSelectedId(psu.id)}
                className="rounded-2xl border border-indigo-100 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Building2 className="h-5 w-5" />
                  </span>
                  {isAdmin ? (
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${psu.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                    >
                      {psu.isPublished ? "Published" : "Draft"}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-4 text-lg font-bold text-slate-900">
                  {psu.name}
                </h2>
                <p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-500">
                  {psu.description || "PYQ tests and question bank"}
                </p>
                <div className="mt-4 flex gap-2 text-xs font-semibold text-slate-600">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">
                    {psu.testCount} tests
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">
                {psu.questionCount} questions
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            text={
              isAdmin
                ? selectedExamKey
                  ? `No PSU question-bank content is available for ${formatExamDisplayName(selectedExamKey) || selectedExamKey}.`
                  : "No PSUs yet. Add the first PSU to start importing content."
                : "No PSU content is published yet."
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
            <ArrowLeft className="mr-1 h-4 w-4" /> PSUs
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {selected?.name ?? "PSU"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {selected?.description || "PYQ tests and question bank"}
            </p>
          </div>
        </div>
        {isAdmin && selected ? (
          <Button
            variant="outline"
            onClick={() => publishMutation.mutate(!selected.isPublished)}
            disabled={publishMutation.isPending}
          >
            {selected.isPublished ? "Unpublish" : "Publish PSU"}
          </Button>
        ) : !isAdmin && selected ? (
          <Button variant="outline" onClick={() => navigate(`/student/psu/${selected.id}/review-bucket`)}>
            Review Bucket
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setActiveTab("tests")}
          className={`rounded-2xl border p-5 text-left transition ${activeTab === "tests" ? "border-indigo-300 bg-indigo-50 shadow-sm" : "border-slate-200 bg-white"}`}
        >
          <div className="flex items-center gap-3">
            <ClipboardList className="text-indigo-600" />
            <div>
              <p className="font-bold text-slate-900">PYQ Tests</p>
              <p className="text-sm text-slate-500">
                {selected?.tests.length ?? 0} tests
              </p>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("questions")}
          className={`rounded-2xl border p-5 text-left transition ${activeTab === "questions" ? "border-orange-300 bg-orange-50 shadow-sm" : "border-slate-200 bg-white"}`}
        >
          <div className="flex items-center gap-3">
            <BookOpen className="text-orange-600" />
            <div>
              <p className="font-bold text-slate-900">Question Bank</p>
              <p className="text-sm text-slate-500">
                {selectedExamQuestionCount} questions · {selectedExamSubjects.length} subjects
              </p>
            </div>
          </div>
        </button>
      </div>
      {detailQuery.isLoading ? (
        <Loading text="Loading PSU content..." />
      ) : detailQuery.isError ? (
        <ErrorBox message={(detailQuery.error as Error).message} />
      ) : activeTab === "tests" ? (
        <>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-indigo-600" /> PYQ Tests
            </CardTitle>
            {isAdmin ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => testInputRef.current?.click()}
                >
                  <FileUp className="mr-2 h-4 w-4" /> Import Test HTML
                </Button>
                <input
                  ref={testInputRef}
                  className="hidden"
                  type="file"
                  accept=".html,.htm,text/html"
                  onChange={(event) => {
                    void handleTestFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </>
            ) : null}
          </CardHeader>
          <CardContent>
            {testImport ? (
              <ImportPreview
                label="test"
                name={testImport.name}
                detail={`${testImport.bundle.test.title} · ${testImport.bundle.test.questions.length} questions · ${testImport.bundle.test.metadata.exam || "Custom"}${testImport.bundle.test.metadata.subject ? ` ${testImport.bundle.test.metadata.subject}` : ""}${testImport.bundle.test.metadata.year ? ` ${testImport.bundle.test.metadata.year}` : ""} · +${testImport.bundle.test.defaultPositiveMarks} / −${testImport.bundle.test.defaultNegativeMarks} · ${testImport.bundle.test.metadata.sourceFormat}`}
                pending={importTestMutation.isPending}
                progress={testImportProgress}
                onCancel={() => {
                  setTestImport(null);
                  setTestImportProgress(null);
                }}
                onImport={() => importTestMutation.mutate()}
              />
            ) : null}
            {selected && selectedExamTests.length ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {selectedExamTests.map((test) => (
                  <div
                    key={test.id}
                    className="flex h-full flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {test.title}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {test.questionCount} questions · {test.durationMinutes}{" "}
                        minutes
                      </p>
                      {!isAdmin && studentProgressQuery.data?.progress.find((entry) => entry.testId === test.id) ? (() => {
                        const latest = studentProgressQuery.data.progress.find((entry) => entry.testId === test.id)!;
                        return <p className="mt-2 text-xs font-medium text-indigo-700">Last attempt: {latest.score.toFixed(2)} / {latest.totalPoints.toFixed(2)} · {latest.percentage.toFixed(1)}%</p>;
                      })() : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isAdmin ? (
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ${test.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                        >
                          {test.isPublished ? "Published" : "Draft"}
                        </span>
                      ) : (
                        (() => {
                          const hasDraft = hasPsuTestDraft(selected.id, test.id);
                          const latest = studentProgressQuery.data?.progress.find((entry) => entry.testId === test.id);
                          return <>
                            <Button size="sm" onClick={() => hasDraft || !latest ? navigate(`/student/psu/${selected.id}/tests/${test.id}`) : setSelectedResultTestId(test.id)}>
                              {hasDraft ? "Resume test" : latest ? "View result" : "Start test"}
                            </Button>
                          </>;
                        })()
                      )}
                      {isAdmin ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(`/admin/psu/${selected.id}/tests/${test.id}/builder`)
                          }
                        >
                          Build test
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : !testImport ? (
              <Empty
                text={
                  isAdmin
                    ? "No tests in this PSU. Import a saved test HTML file."
                    : "No published tests in this PSU yet."
                }
              />
            ) : null}
          </CardContent>
        </Card>
        {isAdmin ? (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Flag className="h-4 w-4 text-rose-500" /> Test question reports <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">{testReportsQuery.data?.reports.length ?? 0} open</span></CardTitle></CardHeader>
            <CardContent>
              {testReportsQuery.isLoading ? <p className="py-3 text-sm text-slate-500">Loading reports...</p> : testReportsQuery.data?.reports.length ? <div className="space-y-3">{testReportsQuery.data.reports.map((report) => <div key={report.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50/40 p-4"><div><p className="text-xs font-semibold text-rose-700">{report.testTitle} · Q{report.questionIndex + 1}</p><p className="mt-2 text-sm font-medium text-slate-800">{report.questionText}</p><p className="mt-2 text-sm text-rose-800">{report.reason}</p><p className="mt-2 text-xs text-slate-500">Submitted by {report.reporterName ?? "Student"}{report.createdAt ? ` · ${new Date(report.createdAt).toLocaleString()}` : ""}</p></div><Button size="sm" variant="outline" disabled={resolveTestReportMutation.isPending} onClick={() => resolveTestReportMutation.mutate(report.id)}>Mark reviewed</Button></div>)}</div> : <p className="py-3 text-sm text-slate-500">No open reports for PSU tests.</p>}
            </CardContent>
          </Card>
        ) : null}
        {isAdmin ? (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-5 w-5 text-indigo-600" /> Test performance analytics</CardTitle></CardHeader>
            <CardContent>
              {submissionsQuery.isLoading ? <p className="py-3 text-sm text-slate-500">Loading test analytics...</p> : submissionsQuery.isError ? <p className="py-3 text-sm text-rose-600">Could not load analytics: {(submissionsQuery.error as Error).message}</p> : submissionsQuery.data?.summary.totalSubmissions ? <div className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-3">
                  <AnalyticsStat label="Submissions" value={submissionsQuery.data.summary.totalSubmissions} />
                  <AnalyticsStat label="Students participated" value={submissionsQuery.data.summary.students} />
                  <AnalyticsStat label="Average score" value={`${submissionsQuery.data.summary.averagePercentage.toFixed(1)}%`} />
                </div>
                <div className="h-72 w-full rounded-xl border border-slate-100 bg-white p-3 pt-5">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={submissionsQuery.data.tests.map((test) => ({ ...test, average: Number(test.averagePercentage.toFixed(1)), highest: test.totalPoints ? Number((test.topScore / test.totalPoints * 100).toFixed(1)) : 0 }))} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="title" tick={{ fontSize: 11 }} tickFormatter={(value: string) => value.length > 16 ? `${value.slice(0, 16)}…` : value} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(value: number) => `${value}%`} />
                      <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
                      <Legend />
                      <Bar dataKey="average" name="Average score" fill="#4F46E5" radius={[5, 5, 0, 0]} />
                      <Bar dataKey="highest" name="Top score" fill="#10B981" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {submissionsQuery.data.tests.map((test) => <div key={test.testId} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold text-slate-900">{test.title}</h3><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{test.submissions} submissions</span></div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Students</p><p className="mt-1 font-semibold">{test.students}</p></div><div><p className="text-xs text-slate-500">Average score</p><p className="mt-1 font-semibold">{test.averageScore.toFixed(2)} / {test.totalPoints.toFixed(2)} ({test.averagePercentage.toFixed(1)}%)</p></div><div><p className="text-xs text-slate-500">Top score</p><p className="mt-1 font-semibold">{test.topScore.toFixed(2)} / {test.totalPoints.toFixed(2)}</p></div><div><p className="text-xs text-slate-500">Average time</p><p className="mt-1 font-semibold">{Math.floor(test.averageTimeSeconds / 60)}m {Math.round(test.averageTimeSeconds % 60)}s</p></div></div>
                    <div className="mt-4"><p className="mb-2 text-xs font-semibold text-slate-500">Score distribution</p><div className="flex h-3 overflow-hidden rounded-full bg-slate-100">{test.scoreDistribution.map((bucket, index) => <div key={bucket.range} title={`${bucket.range}: ${bucket.count}`} className={index < 2 ? "bg-rose-400" : index === 2 ? "bg-amber-400" : "bg-emerald-400"} style={{ width: `${test.submissions ? bucket.count / test.submissions * 100 : 0}%` }} />)}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">{test.scoreDistribution.map((bucket) => <span key={bucket.range}>{bucket.range}: {bucket.count}</span>)}</div></div>
                  </div>)}
                </div>
              </div> : <p className="py-3 text-sm text-slate-500">No PSU test submissions yet. Analytics will appear after students submit tests.</p>}
            </CardContent>
          </Card>
        ) : null}
        </>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-orange-600" /> Question Bank
            </CardTitle>
            {isAdmin ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => questionInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" /> Import HTML
                </Button>
                <input
                  ref={questionInputRef}
                  className="hidden"
                  type="file"
                  accept=".html,.htm,text/html"
                  onChange={(event) => {
                    void handleQuestionFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </>
            ) : null}
          </CardHeader>
          <CardContent>
            {questionImport ? (
              <ImportPreview
                label="question bank"
                name={questionImport.name}
                detail={`${questionImport.parsed.subject} · ${questionImport.parsed.questions.length} questions`}
                pending={importQuestionMutation.isPending}
                onCancel={() => setQuestionImport(null)}
                onImport={() => importQuestionMutation.mutate()}
              />
            ) : null}
            {selectedExamSubjects.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {selectedExamSubjects.map((subject) => (
                  <div
                    key={`${subject.exam}-${subject.subject}`}
                    className="rounded-xl border border-orange-100 bg-orange-50/40 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-orange-600" />
                      <h3 className="font-semibold text-slate-900">
                        {subject.subject}
                      </h3>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {subject.exam}
                    </p>
                    <div className="mt-3 flex gap-2 text-xs font-semibold text-slate-600">
                      <span className="rounded-full bg-white px-2 py-1">
                        {subject.chapterCount} chapters
                      </span>
                      <span className="rounded-full bg-white px-2 py-1">
                        {subject.questionCount} questions
                      </span>
                    </div>
                    {!isAdmin ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() =>
                          setLocation(`/student/pyq?psuId=${selected?.id}`)
                        }
                      >
                        Open question bank
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : !questionImport ? (
              <Empty
                text={
                  isAdmin
                    ? "No questions in this PSU. Import question bank HTML."
                    : "No question bank content in this PSU yet."
                }
              />
            ) : null}
          </CardContent>
        </Card>
      )}
      {isAdmin && activeTab === "questions" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flag className="h-4 w-4 text-rose-500" /> Student reports
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
                {visiblePsuReports.length} open
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reportsQuery.isLoading ? (
              <p className="py-4 text-sm text-slate-500">Loading reports...</p>
            ) : reportsQuery.isError ? (
              <p className="py-4 text-sm text-rose-600">Could not load reports.</p>
            ) : visiblePsuReports.length ? (
              <div className="space-y-3">
                {visiblePsuReports.map((report) => (
                  <div key={report.id} className="rounded-xl border border-rose-100 bg-rose-50/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-rose-700">{report.subject} · {report.chapter} · {report.year}</p>
                        <p className="mt-2 text-sm font-medium text-slate-800">{report.questionText}</p>
                        <p className="mt-2 text-sm text-rose-800">{report.reason}</p>
                        <p className="mt-2 text-xs text-slate-500">Submitted by {report.reporterName ?? "Student"}{report.createdAt ? ` · ${new Date(report.createdAt).toLocaleString()}` : ""}</p>
                      </div>
                      <Button size="sm" variant="outline" disabled={rejectReportMutation.isPending} onClick={() => rejectReportMutation.mutate(report.id)}>Mark reviewed</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-sm text-slate-500">No open reports for this PSU.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Dialog
        open={selectedResultTestId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedResultTestId(null);
        }}
      >
        <DialogContent
          hideClose
          className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[20px] border-0 bg-transparent p-0 shadow-none sm:max-h-[calc(100dvh-2rem)] sm:max-w-[540px]"
        >
          {resultSummaryQuery.data ? (
            <TestResultDetailCard
              title={resultSummaryQuery.data.test.title}
              description={resultSummaryQuery.data.test.description}
              examHeader={resultSummaryQuery.data.test.examHeader}
              examSubheader={resultSummaryQuery.data.test.examSubheader}
              durationMinutes={resultSummaryQuery.data.test.durationMinutes}
              submission={{
                ...resultSummaryQuery.data.submission,
                submittedAt: resultSummaryQuery.data.submission.submittedAt ?? new Date().toISOString(),
                answers: JSON.stringify(Object.fromEntries(resultSummaryQuery.data.perQuestion.map((question) => [question.id, question.myAnswer]))),
              }}
              questionCount={resultSummaryQuery.data.perQuestion.length}
              answeredCount={resultSummaryQuery.data.perQuestion.filter((question) => !question.isSkipped).length}
              analysisQs={resultSummaryQuery.data.perQuestion}
              categoryLabel="PSU PYQ"
              subjectLabel={resultSummaryQuery.data.test.examSubheader}
              onClose={() => setSelectedResultTestId(null)}
              onFullAnalysis={() => {
                const testId = selectedResultTestId;
                setSelectedResultTestId(null);
                if (selectedId !== null && testId !== null) navigate(`/student/psu/${selectedId}/tests/${testId}/analysis`);
              }}
            />
          ) : resultSummaryQuery.isError ? (
            <div className="rounded-2xl bg-white p-6 text-sm text-rose-600">Could not load the result summary: {(resultSummaryQuery.error as Error).message}</div>
          ) : (
            <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500"><RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin" />Loading result...</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImportPreview({
  label,
  name,
  detail,
  pending,
  progress,
  onCancel,
  onImport,
}: {
  label: string;
  name: string;
  detail: string;
  pending: boolean;
  progress?: { uploaded: number; total: number; phase: "starting" | "uploading" | "finishing" } | null;
  onCancel: () => void;
  onImport: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div>
        <p className="font-semibold text-emerald-900">{label} ready</p>
        <p className="text-xs text-emerald-800">
          {name} · {detail}
        </p>
        {progress ? (
          <div className="mt-3 min-w-[280px] max-w-xl">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-emerald-800">
              <span>{progress.phase === "starting" ? "Preparing import..." : progress.phase === "finishing" ? "Finishing import..." : `Importing questions ${progress.uploaded}/${progress.total}`}</span>
              <span>{Math.round((progress.uploaded / Math.max(1, progress.total)) * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-emerald-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${(progress.uploaded / Math.max(1, progress.total)) * 100}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={onImport} disabled={pending}>
          <Upload className="mr-1 h-4 w-4" />
          {pending ? (progress ? `${progress.phase === "finishing" ? "Finishing..." : `Importing ${progress.uploaded}/${progress.total}`}` : "Preparing...") : "Import"}
        </Button>
      </div>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
      <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
      {text}
    </div>
  );
}
function AnalyticsStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p></div>;
}
function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 py-12 text-center text-sm text-red-700">
      {message}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
      <Users className="mx-auto mb-2 h-6 w-6 text-slate-300" />
      {text}
    </div>
  );
}
