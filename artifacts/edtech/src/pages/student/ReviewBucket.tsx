import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flag,
  Trash2,
} from "lucide-react";
import { QuestionAnalysisSummary } from "@/components/student/QuestionAnalysisSummary";
import { AiHint } from "@/components/student/AiHint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { SubjectSectionIcon } from "@/components/ui/subject-section-icon";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  addReviewBucketRemovedQuestionId,
  filterReviewBucketEntries,
  getReviewBucketRemovedQuestionIds,
  setReviewBucketRemovedQuestionIds,
} from "@/lib/reviewBucket";
import { isStudentFeatureLocked } from "@/lib/student-access";
import { buildStudentUnlockPath } from "@/lib/student-unlock";
import { buildApiUrl } from "@/lib/api-origin";

type BucketQuestion = {
  id: number;
  question: string;
  questionType: string;
  questionCode?: string | null;
  options: string[];
  optionImages?: (string | null)[] | null;
  optionSelectionCounts?: number[] | null;
  optionSelectionPercentages?: number[] | null;
  points: number;
  negativeMarks?: number | null;
  imageData?: string | null;
  solutionText?: string | null;
  solutionImageData?: string | null;
  meta?: Record<string, unknown> | null;
};

type BucketEntry = {
  analytics?: {
    allottedTimeSeconds?: number | null;
    averageTimeSeconds?: number | null;
    gotRightPercent?: number | null;
    gotWrongPercent?: number | null;
    myTimeSeconds?: number | null;
    skippedPercent?: number | null;
  } | null;
  testId: number;
  questionId: number;
  questionIndex: number;
  status: "incorrect" | "unattempted";
  subjectLabel: string;
  chapterName: string;
  topicTag?: string | null;
  sectionLabel: string;
  yourAnswerLabel: string;
  correctAnswerLabel: string;
  report?: QuestionReport | null;
  question: BucketQuestion;
};

type QuestionReport = {
  id: number;
  questionId: number;
  testId: number;
  reportedBy: number;
  teacherId: number;
  reason: string;
  status: "open" | "resolved" | "rejected";
  teacherNote?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  reporterName?: string;
};

type FilterKey = "all" | "incorrect" | "unattempted";

type SubjectAccent = {
  line: string;
  border: string;
  text: string;
  bg: string;
};

type FilterAccent = {
  line: string;
  border: string;
  text: string;
  badgeBg: string;
  badgeText: string;
};

const SUBJECT_ACCENTS: SubjectAccent[] = [
  { line: "#F97316", border: "#F97316", text: "#EA580C", bg: "#FFF7ED" },
  { line: "#22C55E", border: "#22C55E", text: "#15803D", bg: "#F0FDF4" },
  { line: "#4B8BFF", border: "#4B8BFF", text: "#2563EB", bg: "#EEF4FF" },
];

const FILTER_ACCENTS: Record<FilterKey, FilterAccent> = {
  all: {
    line: "#4F46E5",
    border: "#4F46E5",
    text: "#4F46E5",
    badgeBg: "#EEF2FF",
    badgeText: "#4F46E5",
  },
  incorrect: {
    line: "#F43F5E",
    border: "#F43F5E",
    text: "#64748B",
    badgeBg: "#FFE4E6",
    badgeText: "#F43F5E",
  },
  unattempted: {
    line: "#64748B",
    border: "#64748B",
    text: "#475569",
    badgeBg: "#F1F5F9",
    badgeText: "#334155",
  },
};

function normalizeDifficulty(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "Moderate";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getTopicLine(entry: BucketEntry) {
  const meta = entry.question.meta && typeof entry.question.meta === "object" ? entry.question.meta : null;
  const chapter =
    typeof meta?.chapterName === "string" && meta.chapterName.trim()
      ? meta.chapterName.trim()
      : entry.chapterName?.trim() || "";
  const topic =
    typeof meta?.topicName === "string" && meta.topicName.trim()
      ? meta.topicName.trim()
      : typeof entry.topicTag === "string" && entry.topicTag.trim()
        ? entry.topicTag.trim()
        : "";

  if (chapter && topic) return `${chapter} • ${topic}`;
  return chapter || topic || entry.sectionLabel;
}

function isCorrectOption(entry: BucketEntry, optionIndex: number) {
  return entry.correctAnswerLabel
    .split(",")
    .map((item) => item.trim())
    .includes(String.fromCharCode(65 + optionIndex));
}

function isChosenOption(entry: BucketEntry, optionIndex: number) {
  return entry.yourAnswerLabel
    .split(",")
    .map((item) => item.trim())
    .includes(String.fromCharCode(65 + optionIndex));
}

function getOptionMarkedPercentage(entry: BucketEntry, optionIndex: number) {
  const percentages = Array.isArray(entry.question.optionSelectionPercentages) ? entry.question.optionSelectionPercentages : [];
  const value = Number(percentages[optionIndex] ?? 0);
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function matchesFilter(entry: BucketEntry, filter: FilterKey) {
  if (filter === "all") return true;
  return entry.status === filter;
}

function getSubjectAccent(label: string, index: number): SubjectAccent {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("general aptitude") || normalized.includes("aptitude")) {
    return SUBJECT_ACCENTS[0];
  }
  if (
    normalized.includes("technical") ||
    normalized.includes("core") ||
    normalized.includes("engineering math") ||
    normalized.includes("mathematics")
  ) {
    return SUBJECT_ACCENTS[1];
  }
  return SUBJECT_ACCENTS[index % SUBJECT_ACCENTS.length];
}

function getQuestionButtonClass(active: boolean) {
  if (active) {
    return "h-10 w-10 rounded-[10px] border border-[#1F2A37] bg-[#1F2A37] text-sm font-semibold text-white shadow-[inset_0_-3px_0_0_#111827]";
  }
  return "h-10 w-10 rounded-[10px] border border-[#E5EBF5] bg-[#F7FAFF] text-sm font-semibold text-[#334155] transition hover:border-[#DCE5F2] hover:bg-[#EEF4FF] hover:text-[#1F2937] hover:shadow-[inset_0_-3px_0_0_#1F2937]";
}

function getReportStatusMeta(status?: string | null) {
  if (status === "resolved") {
    return {
      label: "Report fixed",
      chipClass: "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]",
      buttonClass: "border-[#BBF7D0] bg-white text-[#15803D] hover:bg-[#F0FDF4]",
    };
  }
  if (status === "rejected") {
    return {
      label: "Report rejected",
      chipClass: "border-[#FDE68A] bg-[#FFF7D6] text-[#B45309]",
      buttonClass: "border-[#FDE68A] bg-white text-[#B45309] hover:bg-[#FFF7D6]",
    };
  }
  return {
    label: "Report issue",
    chipClass: "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]",
    buttonClass: "border-[#D6DFEA] bg-white text-[#334155] hover:bg-[#F8FAFC]",
  };
}

export default function StudentReviewBucket() {
  const [, psuRouteParams] = useRoute<{ psuId: string }>("/student/psu/:psuId/review-bucket");
  const psuId = psuRouteParams ? Number(psuRouteParams.psuId) : null;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isTestsLocked = isStudentFeatureLocked(user, "tests");
  const reviewBucketPageQueryKey = ["student-review-bucket-page", psuId] as const;
  const reviewBucketCountQueryKey = ["student-review-bucket-count", psuId] as const;
  const solutionRef = useRef<HTMLDivElement | null>(null);
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const [activeSubject, setActiveSubject] = useState("");
  const [activeChapter, setActiveChapter] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [hoveredFilter, setHoveredFilter] = useState<FilterKey | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(null);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [isAtSolutionSection, setIsAtSolutionSection] = useState(false);
  const [removedQuestionIds, setRemovedQuestionIds] = useState<number[]>(() => getReviewBucketRemovedQuestionIds());
  useEffect(()=>{
    const sync=()=>{setRemovedQuestionIds(getReviewBucketRemovedQuestionIds());setSelectedQuestionId(null);};
    window.addEventListener('student-test-attempt-reset',sync);
    return()=>window.removeEventListener('student-test-attempt-reset',sync);
  },[]);
  const [pendingRemovalEntry, setPendingRemovalEntry] = useState<BucketEntry | null>(null);
  const [pendingReportEntry, setPendingReportEntry] = useState<BucketEntry | null>(null);
  const [reportReason, setReportReason] = useState("");

  useEffect(() => {
    if (!isTestsLocked) return;
    setLocation(buildStudentUnlockPath({
      feature: "tests",
      kind: "feature",
      returnTo: psuId ? `/student/psu/${psuId}/review-bucket` : "/student/tests/review-bucket",
    }));
  }, [isTestsLocked, setLocation]);

  if (isTestsLocked) {
    return <div className="py-20 text-center text-muted-foreground">Redirecting to unlock payment...</div>;
  }

  const bucketQuery = useQuery<BucketEntry[]>({
    queryKey: reviewBucketPageQueryKey,
    queryFn: async () => {
      const endpoint = psuId ? `/api/psus/${psuId}/review-bucket` : "/api/tests/review-bucket";
      const response = await fetch(buildApiUrl(endpoint), { credentials: "include" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to load review bucket");
      }
      return response.json();
    },
  });

  const removeQuestionMutation = useMutation({
    mutationFn: async (questionId: number) => {
      const endpoint = psuId ? `/api/psus/${psuId}/review-bucket/${questionId}/remove` : `/api/tests/review-bucket/${questionId}/remove`;
      const response = await fetch(buildApiUrl(endpoint), {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to remove question");
      }
      return response.json();
    },
    onMutate: async (questionId) => {
      const previousRemovedQuestionIds = getReviewBucketRemovedQuestionIds();
      const nextRemovedQuestionIds = addReviewBucketRemovedQuestionId(questionId);
      setRemovedQuestionIds(nextRemovedQuestionIds);

      await queryClient.cancelQueries({ queryKey: reviewBucketPageQueryKey });
      await queryClient.cancelQueries({ queryKey: reviewBucketCountQueryKey });

      const previousPageEntries = queryClient.getQueryData<BucketEntry[]>(reviewBucketPageQueryKey) ?? [];
      const previousCountEntries = queryClient.getQueryData<any[]>(reviewBucketCountQueryKey) ?? [];

      const nextPageEntries = previousPageEntries.filter((entry) => entry.questionId !== questionId);
      const nextCountEntries = previousCountEntries.filter((entry) => entry.questionId !== questionId);

      queryClient.setQueryData(reviewBucketPageQueryKey, nextPageEntries);
      queryClient.setQueryData(reviewBucketCountQueryKey, nextCountEntries);

      return { previousPageEntries, previousCountEntries, previousRemovedQuestionIds };
    },
    onError: (error, _questionId, context) => {
      const restoredRemovedIds = setReviewBucketRemovedQuestionIds(context?.previousRemovedQuestionIds ?? []);
      setRemovedQuestionIds(restoredRemovedIds);
      queryClient.setQueryData(reviewBucketPageQueryKey, context?.previousPageEntries ?? []);
      queryClient.setQueryData(reviewBucketCountQueryKey, context?.previousCountEntries ?? []);
      toast({
        title: "Unable to remove question",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      setPendingRemovalEntry(null);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: reviewBucketPageQueryKey });
      await queryClient.invalidateQueries({ queryKey: reviewBucketCountQueryKey });
    },
  });

  const reportQuestionMutation = useMutation({
    mutationFn: async ({ questionId, reason }: { questionId: number; reason: string }) => {
      const endpoint = psuId && pendingReportEntry
        ? `/api/psus/${psuId}/tests/${pendingReportEntry.testId}/questions/${pendingReportEntry.questionIndex}/report`
        : `/api/tests/questions/${questionId}/report`;
      const response = await fetch(buildApiUrl(endpoint), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to submit report");
      }
      return payload as QuestionReport;
    },
    onSuccess: (report, variables) => {
      queryClient.setQueryData<BucketEntry[]>(reviewBucketPageQueryKey, (current) =>
        (current ?? []).map((entry) =>
          entry.questionId === variables.questionId
            ? { ...entry, report }
            : entry,
        ),
      );
      setPendingReportEntry(null);
      setReportReason("");
      toast({
        title: "Report sent",
        description: "The teacher has been notified about this question.",
      });
    },
    onError: (error) => {
      toast({
        title: "Unable to send report",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: reviewBucketPageQueryKey });
    },
  });

  const filteredBucketEntries = useMemo(
    () => filterReviewBucketEntries(bucketQuery.data ?? [], removedQuestionIds),
    [bucketQuery.data, removedQuestionIds],
  );

  const grouped = useMemo(() => {
    const subjectMap = new Map<
      string,
      {
        label: string;
        items: BucketEntry[];
        chapters: Map<string, BucketEntry[]>;
      }
    >();

    for (const entry of filteredBucketEntries) {
      const subjectKey = entry.subjectLabel?.trim() || "General";
      const chapterKey = entry.chapterName?.trim() || "General";
      if (!subjectMap.has(subjectKey)) {
        subjectMap.set(subjectKey, {
          label: subjectKey,
          items: [],
          chapters: new Map<string, BucketEntry[]>(),
        });
      }
      const subject = subjectMap.get(subjectKey)!;
      subject.items.push(entry);
      const chapterItems = subject.chapters.get(chapterKey) ?? [];
      chapterItems.push(entry);
      subject.chapters.set(chapterKey, chapterItems);
    }

    return [...subjectMap.values()].map((subject) => ({
      label: subject.label,
      items: subject.items.sort((a, b) => a.questionIndex - b.questionIndex || a.questionId - b.questionId),
      chapters: [...subject.chapters.entries()]
        .map(([chapter, items]) => ({
          label: chapter,
          items: items.sort((a, b) => a.questionIndex - b.questionIndex || a.questionId - b.questionId),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }, [filteredBucketEntries]);

  useEffect(() => {
    if (!grouped.length) {
      setActiveSubject("");
      return;
    }
    setActiveSubject((current) => (grouped.some((subject) => subject.label === current) ? current : grouped[0].label));
  }, [grouped]);

  const selectedSubject = useMemo(
    () => grouped.find((subject) => subject.label === activeSubject) ?? grouped[0] ?? null,
    [activeSubject, grouped],
  );

  const chapterOptions = useMemo(() => {
    if (!selectedSubject) return [];
    return selectedSubject.chapters.map((chapter) => ({
      ...chapter,
      filteredItems: chapter.items.filter((entry) => matchesFilter(entry, filter)),
    }));
  }, [filter, selectedSubject]);

  useEffect(() => {
    if (!chapterOptions.length) {
      setActiveChapter("");
      return;
    }
    const firstChapter = chapterOptions.find((chapter) => chapter.filteredItems.length > 0) ?? chapterOptions[0];
    setActiveChapter((current) => (chapterOptions.some((chapter) => chapter.label === current) ? current : firstChapter.label));
  }, [chapterOptions]);

  const selectedChapter = useMemo(() => {
    if (!chapterOptions.length) return null;
    return (
      chapterOptions.find((chapter) => chapter.label === activeChapter) ??
      chapterOptions.find((chapter) => chapter.filteredItems.length > 0) ??
      chapterOptions[0]
    );
  }, [activeChapter, chapterOptions]);

  const visibleItems = useMemo(() => selectedChapter?.filteredItems ?? [], [selectedChapter]);

  useEffect(() => {
    if (!visibleItems.length) {
      setSelectedQuestionId(null);
      return;
    }
    setSelectedQuestionId((current) =>
      visibleItems.some((entry) => entry.questionId === current) ? current : visibleItems[0].questionId,
    );
  }, [visibleItems]);

  const currentEntry = useMemo(
    () => visibleItems.find((entry) => entry.questionId === selectedQuestionId) ?? visibleItems[0] ?? null,
    [selectedQuestionId, visibleItems],
  );

  const currentIndex = currentEntry ? visibleItems.findIndex((entry) => entry.questionId === currentEntry.questionId) : -1;
  const previousEntry = currentIndex > 0 ? visibleItems[currentIndex - 1] : null;
  const nextEntry = currentIndex >= 0 && currentIndex < visibleItems.length - 1 ? visibleItems[currentIndex + 1] : null;

  useEffect(() => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) return;

    const syncSolutionPosition = () => {
      if (!solutionRef.current) {
        setIsAtSolutionSection(false);
        return;
      }
      const threshold = Math.max(solutionRef.current.offsetTop - 72, 0);
      setIsAtSolutionSection(scrollRegion.scrollTop >= threshold);
    };

    syncSolutionPosition();
    scrollRegion.addEventListener("scroll", syncSolutionPosition, { passive: true });
    return () => scrollRegion.removeEventListener("scroll", syncSolutionPosition);
  }, [currentEntry?.questionId]);

  const subjectSummary = useMemo(() => {
    const items = selectedSubject?.items ?? [];
    return {
      all: items.length,
      incorrect: items.filter((entry) => entry.status === "incorrect").length,
      unattempted: items.filter((entry) => entry.status === "unattempted").length,
    };
  }, [selectedSubject]);

  const selectedAccent = useMemo(() => {
    const selectedIndex = grouped.findIndex((subject) => subject.label === selectedSubject?.label);
    return getSubjectAccent(selectedSubject?.label ?? "General", selectedIndex >= 0 ? selectedIndex : 0);
  }, [grouped, selectedSubject]);
  const filterAccent = FILTER_ACCENTS[filter];

  if (bucketQuery.isLoading) {
    return (
      <div className="review-bucket-page min-h-[100dvh] bg-[#F8FAFC] text-[#111827]">
        <div className="flex h-full min-h-0 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#4B8BFF] border-t-transparent" />
            <p className="text-sm text-[#64748B]">Loading review bucket...</p>
          </div>
        </div>
      </div>
    );
  }

  if (bucketQuery.isError) {
    return (
      <div className="review-bucket-page min-h-[100dvh] bg-[#F8FAFC] px-4 py-10 text-[#111827] sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-[24px] border border-[#FECACA] bg-[#FFF7F7] p-8 text-center">
          <p className="text-lg font-semibold text-[#111827]">Unable to load Review Bucket</p>
          <p className="mt-2 text-sm text-[#B91C1C]">
            {bucketQuery.error instanceof Error ? bucketQuery.error.message : "Something went wrong while loading the page."}
          </p>
          <Button className="chip-orange-solid mt-6 rounded-full" onClick={() => setLocation("/student/tests")}>
            Back to Tests
          </Button>
        </div>
      </div>
    );
  }

  if (!grouped.length) {
    return (
      <div className="review-bucket-page min-h-[100dvh] bg-[#F8FAFC] px-4 py-10 text-[#111827] sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-[24px] border border-[#E2E8F0] bg-white p-10 text-center shadow-sm">
          <p className="text-lg font-semibold">Nothing to review yet</p>
          <p className="mt-2 text-sm text-[#64748B]">Incorrect and unattempted questions will appear here after you submit a test.</p>
          <Button className="chip-orange-solid mt-6 rounded-full" onClick={() => setLocation("/student/tests")}>
            Back to Tests
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="review-bucket-page h-[100dvh] overflow-hidden bg-[#F8FAFC] text-[#111827]">
      <div className="flex h-full min-h-0 flex-col overflow-hidden font-sans">
        <header className="border-b border-[#E2E8F0] bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setLocation("/student/tests")}
                className="rounded-full p-1 text-[#64748B] transition hover:bg-[#EEF4FF] hover:text-[#245BDB]"
                aria-label="Back to Tests"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#64748B]">Review Bucket</p>
                <h1 className="truncate text-sm font-semibold text-[#111827] sm:text-base">All review questions</h1>
              </div>
            </div>

          </div>
        </header>

        <div className="relative flex flex-1 overflow-hidden">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="relative bg-white px-3 pt-3">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]" style={{ backgroundColor: selectedAccent.line }} />
              <div className="no-scrollbar relative flex gap-2 overflow-x-auto pb-0">
                {grouped.map((subject, index) => {
                  const active = subject.label === selectedSubject?.label;
                  const accent = getSubjectAccent(subject.label, index);
                  return (
                    <button
                      key={subject.label}
                      type="button"
                      onClick={() => setActiveSubject(subject.label)}
                      className={`relative -mb-[2px] flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-t-[16px] border-2 border-b-0 px-5 py-2 text-sm font-semibold transition ${
                        active ? "" : "border-transparent bg-transparent text-[#64748B] hover:text-[#111827]"
                      }`}
                      style={
                        active
                          ? {
                              borderColor: accent.border,
                              backgroundColor: "white",
                              color: accent.text,
                            }
                          : undefined
                      }
                    >
                      <SubjectSectionIcon label={subject.label} className="h-[18px] w-[18px] flex-shrink-0" />
                      {subject.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {currentEntry ? (
              <>
                <div className="flex flex-col gap-3 border-b border-[#E2E8F0] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-bold text-[#111827]">Q{Math.max(currentIndex + 1, 1)}</span>
                    <span className="rounded bg-[#F1F5F9] px-2 py-0.5 text-xs font-medium uppercase tracking-[0.08em] text-[#475569]">
                      {normalizeDifficulty(currentEntry.question.meta?.difficulty)}
                    </span>
                    {currentEntry.report ? (
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getReportStatusMeta(currentEntry.report.status).chipClass}`}>
                        {getReportStatusMeta(currentEntry.report.status).label}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPendingReportEntry(currentEntry);
                        setReportReason("");
                      }}
                      disabled={currentEntry.report?.status === "open" || reportQuestionMutation.isPending}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${getReportStatusMeta(currentEntry.report?.status).buttonClass}`}
                    >
                      <Flag className="h-3.5 w-3.5" />
                      {currentEntry.report?.status === "open" ? "Reported" : currentEntry.report ? "Report again" : "Report"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRemovalEntry(currentEntry)}
                      disabled={removeQuestionMutation.isPending && pendingRemovalEntry?.questionId === currentEntry.questionId}
                      className="inline-flex items-center gap-2 rounded-full border border-[#FECACA] bg-white px-3 py-1.5 text-xs font-semibold text-[#DC2626] transition hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                </div>

                <div ref={scrollRegionRef} className="no-scrollbar flex-1 overflow-y-auto bg-white pb-36 sm:pb-28" id="review-bucket-scroll-region">
                  <div className="px-4 py-5 sm:px-5">
                    <RichQuestionContent content={currentEntry.question.question} className="text-base font-medium leading-7 text-[#111827] sm:text-xl sm:leading-9" />
                  </div>

                  {currentEntry.question.imageData ? (
                    <div className="px-4 pb-4 sm:px-5">
                      <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                        <img src={currentEntry.question.imageData} alt="" className="max-h-[24rem] rounded object-contain" />
                      </div>
                    </div>
                  ) : null}

                  <div className="px-4 pb-4 sm:px-5">
                    {currentEntry.status === "unattempted" ? (
                      <span className="rounded bg-[#EEF2FF] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#4338CA]">
                        You didn&apos;t attempt this question
                      </span>
                    ) : (
                      <span className="rounded bg-[#FEF2F2] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#B91C1C]">
                        Your answer: {currentEntry.yourAnswerLabel || "Not attempted"}
                      </span>
                    )}
                  </div>

                  {String(currentEntry.question.questionType ?? "mcq").toLowerCase() !== "integer" && currentEntry.question.options?.length > 0 ? (
                    <div className="grid gap-3 px-4 pb-6 sm:gap-4 sm:px-5 lg:grid-cols-2">
                      {currentEntry.question.options.map((option, optionIndex) => {
                        const correct = isCorrectOption(currentEntry, optionIndex);
                        const chosen = isChosenOption(currentEntry, optionIndex);
                        const optionImage = currentEntry.question.optionImages?.[optionIndex] ?? null;

                        let tone = "border-[#E2E8F0] bg-[#F8FAFC]";
                        if (correct) tone = "border-[#BBF7D0] bg-[#F0FDF4]";
                        else if (chosen && currentEntry.status === "incorrect") tone = "border-[#FECACA] bg-[#FEF2F2]";

                        return (
                          <div key={`${currentEntry.questionId}-${optionIndex}`} className={`relative rounded-2xl border p-3 sm:p-4 ${tone}`}>
                            <div className="flex items-start gap-3 sm:gap-4">
                              <div
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                                  correct ? "bg-[#22C55E] text-white" : "bg-white text-[#334155] border border-[#D6DFEA]"
                                }`}
                              >
                                {String.fromCharCode(65 + optionIndex)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <RichQuestionContent content={option} className="text-base leading-7 text-[#111827] sm:text-lg sm:leading-8" />
                                <div className="mt-1 text-sm font-semibold text-[#4F46E5]">
                                  {getOptionMarkedPercentage(currentEntry, optionIndex)}% marked this
                                </div>
                                {optionImage ? (
                                  <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-white p-3">
                                    <img src={optionImage} alt="" className="max-h-32 rounded object-contain" />
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            {correct ? (
                              <div className="absolute right-4 top-4 flex items-center gap-1 text-xs font-semibold text-[#15803D]">
                                Correct
                                <CheckCircle2 className="h-4 w-4" />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid gap-4 px-4 pb-6 sm:px-5 md:grid-cols-2">
                      <div className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#B91C1C]">Your Answer</p>
                        <p className="mt-2 text-lg font-semibold text-[#111827]">{currentEntry.yourAnswerLabel || "Not attempted"}</p>
                      </div>
                      <div className="rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#15803D]">Correct Answer</p>
                        <p className="mt-2 text-lg font-semibold text-[#111827]">{currentEntry.correctAnswerLabel}</p>
                      </div>
                    </div>
                  )}

                  <div className="px-4 pb-4 sm:px-5">
                    <AiHint question={currentEntry.question.question} options={currentEntry.question.options} source="test" />
                  </div>

                  <div className="border-t border-[#E2E8F0] px-4 py-5 sm:px-5">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">Chapter & Topic</div>
                    <div className="mt-2 text-sm font-medium text-[#111827]">{getTopicLine(currentEntry)}</div>
                  </div>

                  <div ref={solutionRef} className="border-t border-[#E2E8F0] px-4 pb-8 pt-5 sm:px-5">
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                      <BookOpen className="h-4 w-4 text-[#4B8BFF]" />
                      Teacher Solution
                    </div>
                    {currentEntry.question.solutionText?.trim() || currentEntry.question.solutionImageData ? (
                      <div className="space-y-4">
                        {currentEntry.question.solutionText?.trim() ? (
                          <RichQuestionContent content={currentEntry.question.solutionText} className="text-sm leading-8 text-[#334155]" />
                        ) : null}
                        {currentEntry.question.solutionImageData ? (
                          <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                            <img src={currentEntry.question.solutionImageData} alt="" className="max-h-[28rem] rounded object-contain" />
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-[#64748B]">No teacher solution was attached to this question.</p>
                    )}
                  </div>

                  <QuestionAnalysisSummary
                    myTimeSeconds={currentEntry.analytics?.myTimeSeconds ?? 0}
                    allottedTimeSeconds={currentEntry.analytics?.allottedTimeSeconds ?? 0}
                    averageTimeSeconds={currentEntry.analytics?.averageTimeSeconds ?? 0}
                    gotRightPercent={currentEntry.analytics?.gotRightPercent ?? 0}
                    gotWrongPercent={currentEntry.analytics?.gotWrongPercent ?? 0}
                    skippedPercent={currentEntry.analytics?.skippedPercent ?? 0}
                  />
                </div>

                <div className="review-bucket-bottom-bar absolute inset-x-0 bottom-0 z-20 border-t border-[#E2E8F0] bg-[rgba(255,255,255,0.98)] px-4 py-3 backdrop-blur-sm sm:px-5 sm:py-4">
                  <div className="mx-auto grid max-w-[34rem] grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-center sm:gap-4">
                    <button
                      type="button"
                      onClick={() => previousEntry && setSelectedQuestionId(previousEntry.questionId)}
                      disabled={!previousEntry}
                      className="min-w-0 rounded-full border border-[#D6DFEA] bg-white px-4 py-2.5 text-xs font-semibold text-[#6B7280] transition hover:bg-[#F8FAFC] hover:text-[#334155] disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[9.5rem] sm:px-6 sm:py-3 sm:text-sm"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (isAtSolutionSection) {
                          scrollRegionRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                          return;
                        }
                        solutionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className="col-span-2 inline-flex min-w-0 items-center justify-center gap-2 rounded-full border border-[#171717] bg-[#171717] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#111111] sm:min-w-[13.5rem] sm:px-6 sm:py-3 sm:text-sm"
                    >
                      {isAtSolutionSection ? "View Question" : "View Solution"}
                      {isAtSolutionSection ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => nextEntry && setSelectedQuestionId(nextEntry.questionId)}
                      disabled={!nextEntry}
                      className="min-w-0 rounded-full border border-[#D6DFEA] bg-white px-4 py-2.5 text-xs font-semibold text-[#334155] transition hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[9.5rem] sm:px-6 sm:py-3 sm:text-sm"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center bg-white px-6 text-sm text-[#64748B]">
                No questions match the selected filter.
              </div>
            )}
          </div>

          {showRightPanel ? (
            <aside className="hidden w-72 shrink-0 border-l border-[#E2E8F0] bg-white lg:flex lg:flex-col">
              <div className="flex items-center justify-between border-b border-[#E2E8F0] px-3 py-3">
                <span className="text-sm font-semibold text-[#111827]">All {selectedSubject?.label ?? "Review"} Questions</span>
                <button
                  type="button"
                  onClick={() => setShowRightPanel(false)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#4B8BFF] transition hover:text-[#245BDB]"
                >
                  HIDE
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                    <rect x="1" y="2" width="10" height="1.5" rx="0.75" />
                    <rect x="1" y="5.25" width="10" height="1.5" rx="0.75" />
                    <rect x="1" y="8.5" width="10" height="1.5" rx="0.75" />
                  </svg>
                </button>
              </div>

              <div
                className="flex items-end gap-3 border-b-[3px] border-[#D7E1F1] px-1 pt-2"
                style={{ borderBottomColor: filterAccent.line }}
              >
                {(
                  [
                    { key: "all", label: "All", count: subjectSummary.all },
                    { key: "incorrect", label: "Incorrect", count: subjectSummary.incorrect },
                    { key: "unattempted", label: "Unattempted", count: subjectSummary.unattempted },
                  ] as const
                ).map((tab) => {
                  const active = filter === tab.key;
                  const hovered = hoveredFilter === tab.key;
                  const emphasized = active || hovered;
                  const tabAccent = FILTER_ACCENTS[tab.key];
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setFilter(tab.key)}
                      onMouseEnter={() => setHoveredFilter(tab.key)}
                      onMouseLeave={() => setHoveredFilter((current) => (current === tab.key ? null : current))}
                      className={`relative z-10 flex-1 rounded-t-[22px] px-1 pb-2.5 pt-2 transition-colors ${
                        emphasized ? "border-[3px] border-b-0 bg-white -mb-[3px]" : "border-[3px] border-transparent"
                      }`}
                      style={emphasized ? { borderColor: tabAccent.border, borderBottomColor: "white" } : undefined}
                    >
                      <div
                        className="text-[11px] font-semibold transition-colors"
                        style={{ color: active ? tabAccent.text : "#64748B" }}
                      >
                        {tab.label}
                      </div>
                      <div className="mt-1.5 flex justify-center">
                        <span
                          className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
                          style={{ backgroundColor: tabAccent.badgeBg, color: tabAccent.badgeText }}
                        >
                          {tab.count}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="no-scrollbar flex-1 space-y-5 overflow-y-auto px-3 py-3">
                {chapterOptions.map((chapter) => {
                  const items = chapter.filteredItems;
                  if (!items.length) return null;
                  return (
                    <section key={chapter.label}>
                      <div className="mb-3 text-xs font-semibold text-[#111827]">{chapter.label}</div>
                      <div className="grid grid-cols-5 gap-2">
                        {items.map((entry, itemIndex) => (
                          <button
                            key={`${entry.testId}-${entry.questionId}`}
                            type="button"
                            onClick={() => {
                              setActiveChapter(chapter.label);
                              setSelectedQuestionId(entry.questionId);
                            }}
                            className={getQuestionButtonClass(entry.questionId === currentEntry?.questionId)}
                          >
                            {itemIndex + 1}
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </aside>
          ) : (
            <button
              type="button"
              onClick={() => setShowRightPanel(true)}
              className="absolute right-0 top-1/2 hidden -translate-y-1/2 rounded-l-lg border border-r-0 border-[#D6DFEA] bg-white px-1 py-3 text-xs text-[#334155] shadow-sm lg:block"
            >
              ◁
            </button>
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(pendingReportEntry)}
        onOpenChange={(open) => {
          if (!open && !reportQuestionMutation.isPending) {
            setPendingReportEntry(null);
            setReportReason("");
          }
        }}
      >
        <DialogContent className="max-w-md rounded-[24px] border border-[#E2E8F0] bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.18)]" hideClose>
          <div className="p-6">
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-xl font-semibold text-[#111827]">Report this question?</DialogTitle>
              <DialogDescription className="text-sm leading-6 text-[#64748B]">
                Your report goes directly to the teacher who created this test question.
              </DialogDescription>
            </DialogHeader>

            {pendingReportEntry ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#64748B]">
                    <span>{pendingReportEntry.subjectLabel}</span>
                    <span className="text-[#CBD5E1]">•</span>
                    <span>{pendingReportEntry.chapterName || "General"}</span>
                  </div>
                  <RichQuestionContent
                    content={pendingReportEntry.question.question}
                    className="line-clamp-3 text-sm leading-7 text-[#111827]"
                  />
                </div>

                {pendingReportEntry.report ? (
                  <div className={`rounded-2xl border px-4 py-3 text-sm ${getReportStatusMeta(pendingReportEntry.report.status).chipClass}`}>
                    <p className="font-semibold">{getReportStatusMeta(pendingReportEntry.report.status).label}</p>
                    <p className="mt-1 text-xs opacity-80">{pendingReportEntry.report.reason}</p>
                    {pendingReportEntry.report.teacherNote ? (
                      <p className="mt-2 text-xs font-medium opacity-90">Teacher note: {pendingReportEntry.report.teacherNote}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">What should the teacher check?</p>
                  <Textarea
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                    placeholder="Example: image is wrong, option mismatch, solution is incorrect, or question text has an issue."
                    className="min-h-[120px] rounded-2xl border-[#D6DFEA] bg-white text-sm leading-6"
                  />
                </div>
              </div>
            ) : null}

            <DialogFooter className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPendingReportEntry(null);
                  setReportReason("");
                }}
                disabled={reportQuestionMutation.isPending}
                className="rounded-full border-[#D6DFEA] px-5"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (pendingReportEntry) {
                    reportQuestionMutation.mutate({
                      questionId: pendingReportEntry.questionId,
                      reason: reportReason.trim(),
                    });
                  }
                }}
                disabled={!pendingReportEntry || reportQuestionMutation.isPending}
                className="rounded-full bg-[#111827] px-5 text-white hover:bg-[#0F172A]"
              >
                {reportQuestionMutation.isPending ? "Sending..." : "Send Report"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingRemovalEntry)}
        onOpenChange={(open) => {
          if (!open && !removeQuestionMutation.isPending) {
            setPendingRemovalEntry(null);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-[24px] border border-[#E2E8F0] bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.18)]" hideClose>
          <div className="p-6">
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-xl font-semibold text-[#111827]">Remove from Review Bucket?</DialogTitle>
              <DialogDescription className="text-sm leading-6 text-[#64748B]">
                This question will be removed from your review bucket and the total bucket count will update immediately.
              </DialogDescription>
            </DialogHeader>

            {pendingRemovalEntry ? (
              <div className="mt-5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#64748B]">
                  <span>{pendingRemovalEntry.subjectLabel}</span>
                  <span className="text-[#CBD5E1]">•</span>
                  <span>{pendingRemovalEntry.chapterName || "General"}</span>
                </div>
                <RichQuestionContent
                  content={pendingRemovalEntry.question.question}
                  className="line-clamp-3 text-sm leading-7 text-[#111827]"
                />
              </div>
            ) : null}

            <DialogFooter className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingRemovalEntry(null)}
                disabled={removeQuestionMutation.isPending}
                className="rounded-full border-[#D6DFEA] px-5"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (pendingRemovalEntry) {
                    removeQuestionMutation.mutate(pendingRemovalEntry.questionId);
                  }
                }}
                disabled={!pendingRemovalEntry || removeQuestionMutation.isPending}
                className="rounded-full bg-[#DC2626] px-5 text-white hover:bg-[#B91C1C]"
              >
                {removeQuestionMutation.isPending ? "Removing..." : "Remove Question"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
