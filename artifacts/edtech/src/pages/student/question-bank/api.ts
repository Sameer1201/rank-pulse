import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatExamDisplayName } from "@/lib/exam-display";
import { useAuth } from "@/contexts/AuthContext";
import { readStudentExamSelection } from "@/lib/student-exam-selection";
import { useEffect, useState } from "react";
import { groupStarterQuestions } from "@/lib/question-bank-order";

export type QuestionType = "mcq" | "multi" | "integer";

export type QuestionProgress = {
  attemptCount: number;
  correctCount: number;
  incorrectCount: number;
  firstAttemptedAt: string;
  lastAttemptedAt: string;
  solvedAt: string | null;
  lastIsCorrect: boolean;
};

export type StudentQuestionBankQuestion = {
  id: number;
  question: string;
  questionType: QuestionType;
  options: string[];
  optionImages?: Array<string | null>;
  correctAnswer: number | null;
  answer?: string | null;
  correctAnswerMulti: number[];
  correctAnswerMin?: number | null;
  correctAnswerMax?: number | null;
  explanation?: string | null;
  topicTag?: string | null;
  difficulty?: string | null;
  points?: number | null;
  /** Stripped from the bulk tree. Use useStudentQuestionImage to load lazily. */
  imageData?: string | null;
  /** True if this question has an image (imageData was stripped from tree). */
  hasImage?: boolean;
  /** True if any option images exist (optionImages were stripped from tree). */
  hasOptionImages?: boolean;
  progress?: QuestionProgress | null;
  isSaved?: boolean;
  timeSpentSeconds?: number;
};

export type StudentQuestionBankChapter = {
  id: number;
  title: string;
  description?: string | null;
  targetQuestions?: number | null;
  totalTimeSpentSeconds?: number;
  isLocked?: boolean;
  questions: StudentQuestionBankQuestion[];
};

export type StudentQuestionBankSubject = {
  id: number;
  title: string;
  description?: string | null;
  isLocked?: boolean;
  chapters: StudentQuestionBankChapter[];
};

export type StudentQuestionBankExamSummary = {
  key: string;
  label: string;
  isLocked?: boolean;
  subjectCount: number;
  chapterCount: number;
  questionCount: number;
  targetQuestionCount?: number;
  pendingQuestionCount?: number;
  attemptedQuestionCount?: number;
};

export type StudentQuestionBankExamResponse = {
  exam: { key: string; label: string; isLocked?: boolean };
  subjects: StudentQuestionBankSubject[];
  savedBucket: StudentQuestionBankQuestion[];
};

export type StudentSavedQuestion = StudentQuestionBankQuestion & {
  subjectId: number;
  chapterId: number;
  examKey: string;
  examLabel: string;
  subjectTitle: string;
  chapterTitle: string;
};

function isGateExamKey(examKey?: string | null) {
  return String(examKey ?? "").trim().toLowerCase() === "gate";
}

function normalizeExamSummary(exam: StudentQuestionBankExamSummary): StudentQuestionBankExamSummary {
  return {
    ...exam,
    label: formatExamDisplayName(exam.label || exam.key) || exam.label,
  };
}

function normalizeExamResponse(data: StudentQuestionBankExamResponse): StudentQuestionBankExamResponse {
  return {
    ...data,
    exam: {
      ...data.exam,
      label: formatExamDisplayName(data.exam.label || data.exam.key) || data.exam.label,
    },
  };
}

export function applyPendingPreviewLocksToExamSummaries(exams: StudentQuestionBankExamSummary[]) {
  return exams.map((exam) => ({
    ...normalizeExamSummary(exam),
    isLocked: !isGateExamKey(exam.key),
  }));
}

export function applyPendingPreviewLocksToExam(data: StudentQuestionBankExamResponse): StudentQuestionBankExamResponse {
  const normalized = normalizeExamResponse(data);

  if (!isGateExamKey(normalized.exam.key)) {
    return {
      ...normalized,
      exam: {
        ...normalized.exam,
        isLocked: true,
      },
      subjects: normalized.subjects.map((subject) => ({
        ...subject,
        isLocked: true,
        chapters: subject.chapters.map((chapter) => ({
          ...chapter,
          isLocked: true,
        })),
      })),
    };
  }

  return {
    ...normalized,
    exam: {
      ...normalized.exam,
      isLocked: false,
    },
    subjects: normalized.subjects.map((subject, subjectIndex) => {
      const isUnlockedSubject = subjectIndex === 0;

      return {
        ...subject,
        isLocked: !isUnlockedSubject,
        chapters: subject.chapters.map((chapter, chapterIndex) => ({
          ...chapter,
          isLocked: !isUnlockedSubject || chapterIndex !== 0,
        })),
      };
    }),
  };
}

export function useStudentQuestionBankExams(enabled = true) {
  const { user } = useAuth();
  const [activeExam, setActiveExam] = useState(() => readStudentExamSelection(user));
  useEffect(() => {
    const sync = () => setActiveExam(readStudentExamSelection(user));
    window.addEventListener("student-exam-changed", sync);
    window.addEventListener("storage", sync);
    sync();
    return () => {
      window.removeEventListener("student-exam-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [user]);
  return useQuery<StudentQuestionBankExamSummary[]>({
    queryKey: ["student-question-bank-exams", activeExam],
    queryFn: async () => {
      const exams = await api.get<StudentQuestionBankExamSummary[]>(`/question-bank/exams?exam=${encodeURIComponent(activeExam)}`);
      return exams.map(normalizeExamSummary);
    },
    enabled: enabled && Boolean(activeExam),
    staleTime: 60_000,
  });
}

export function useStudentSavedQuestions(enabled = true) {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: ["student-question-bank-saved-questions", user?.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (pageParam) params.set("cursor", pageParam);
      return api.get<{ questions: StudentSavedQuestion[]; nextCursor: string | null }>(`/question-bank/saved-questions?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && Boolean(user?.id),
    staleTime: 60_000,
  });
}

export function useStudentSavedQuestionCount(enabled = true) {
  const { user } = useAuth();
  return useQuery<{ count: number }>({
    queryKey: ["student-question-bank-saved-count", user?.id],
    queryFn: () => api.get<{ count: number }>("/question-bank/saved-questions?countOnly=1"),
    enabled: enabled && Boolean(user?.id),
    staleTime: 60_000,
  });
}

export function useStudentQuestionBankExam(examKey: string, enabled = true) {
  return useQuery<StudentQuestionBankExamResponse>({
    queryKey: ["student-question-bank-exam", examKey],
    queryFn: async () => normalizeExamResponse(await api.get<StudentQuestionBankExamResponse>(`/question-bank/exams/${examKey}`)),
    enabled: enabled && Boolean(examKey),
    staleTime: 30_000,
  });
}

// ── Lean structure types (no question content) ──────────────────────────────

export type StudentQBChapterSummary = {
  id: number;
  title: string;
  description?: string | null;
  order?: number | null;
  isLocked?: boolean;
  targetQuestions?: number | null;
  questionCount: number;
  attemptedCount: number;
  totalTimeSpentSeconds?: number;
};

export type StudentQBSubjectSummary = {
  id: number;
  title: string;
  description?: string | null;
  isLocked?: boolean;
  chapters: StudentQBChapterSummary[];
};

export type StudentQBStructureResponse = {
  exam: { key: string; label: string; isLocked?: boolean };
  subjects: StudentQBSubjectSummary[];
};

function normalizeStructureResponse(data: StudentQBStructureResponse): StudentQBStructureResponse {
  return {
    ...data,
    exam: {
      ...data.exam,
      label: formatExamDisplayName(data.exam.label || data.exam.key) || data.exam.label,
    },
  };
}

/** Loads exam structure (subjects + chapters + counts) without fetching question content. Fast. */
export function useStudentQuestionBankStructure(examKey: string, enabled = true) {
  const { user } = useAuth();
  return useQuery<StudentQBStructureResponse>({
    networkMode: 'always', retry: false,
    queryKey: ["student-qb-structure", examKey, user?.id],
    queryFn: async () => normalizeStructureResponse(await api.get<StudentQBStructureResponse>(`/question-bank/exams/${examKey}/structure`)),
    enabled: enabled && Boolean(examKey),
    staleTime: 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

export type StudentQBQuestionIndex = Pick<StudentQuestionBankQuestion, "id" | "difficulty" | "progress" | "isSaved" | "timeSpentSeconds">;
export type StudentQBChapterQuestionsResponse = { questions: StudentQBQuestionIndex[] };

/** Lightweight navigation/progress index only: no question text, answers or images. */
export function useStudentChapterQuestions(chapterId: number | undefined, enabled = true, savedOnly = false) {
  const { user } = useAuth();
  return useQuery<StudentQBChapterQuestionsResponse>({
    networkMode: 'always', retry: false,
    queryKey: ["student-qb-chapter-questions", chapterId, savedOnly, user?.id],
    queryFn: async () => {
      const data = await api.get<StudentQBChapterQuestionsResponse>(`/question-bank/chapters/${chapterId}/questions?indexOnly=1${savedOnly ? "&saved=1" : ""}`);
      return { ...data, questions: groupStarterQuestions(data.questions) };
    },
    enabled: enabled && Boolean(chapterId),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

export const QUESTION_BANK_PAGE_SIZE = 20;

/** Fetch only visible card content (or one question in practice mode). */
export function useStudentQuestionContent(chapterId: number | undefined, ids: number[], enabled = true) {
  const { user } = useAuth();
  return useQuery<{ questions: StudentQuestionBankQuestion[] }>({
    networkMode: 'always', retry: false,
    queryKey: ["student-qb-question-content", chapterId, ids, user?.id],
    // Revalidate visible content so a teacher correction reaches an open page.
    refetchInterval: query => {
      const status=Number((query.state.error as {status?:number}|null)?.status);
      if(!navigator.onLine)return false;
      return query.state.status==='error'?(!status||status===408||status===429||status>=500?15000:false):60000;
    },
    queryFn: () => {
      if (ids.length > QUESTION_BANK_PAGE_SIZE) throw new Error("Question batch is too large");
      const params = new URLSearchParams(ids.length === 1
        ? { questionId: String(ids[0]) }
        : { questionIds: ids.join(",") });
      return api.get<{ questions: StudentQuestionBankQuestion[] }>(`/question-bank/chapters/${chapterId}/questions?${params}`);
    },
    enabled: enabled && Boolean(chapterId) && ids.length > 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

export function applyPendingPreviewLocksToStructure(data: StudentQBStructureResponse): StudentQBStructureResponse {
  if (!isGateExamKey(data.exam.key)) {
    return {
      ...data,
      exam: { ...data.exam, isLocked: true },
      subjects: data.subjects.map((s) => ({
        ...s,
        isLocked: true,
        chapters: s.chapters.map((c) => ({ ...c, isLocked: true })),
      })),
    };
  }
  return {
    ...data,
    exam: { ...data.exam, isLocked: false },
    subjects: data.subjects.map((s, si) => ({
      ...s,
      isLocked: si !== 0,
      chapters: s.chapters.map((c, ci) => ({ ...c, isLocked: si !== 0 || ci !== 0 })),
    })),
  };
}

export function getChapterDifficultyLabelFromCounts(_chapter: StudentQBChapterSummary): "Easy" | "Medium" | "Hard" {
  // Without question content we can't compute difficulty — fall back to Medium
  return "Medium";
}

export type QuestionImageData = {
  imageData: string | null;
  optionImages: Array<string | null>;
};

/** Lazily fetches imageData and optionImages for a single question. */
export function useStudentQuestionImage(questionId: number | undefined, enabled = true) {
  const {user}=useAuth();
  return useQuery<QuestionImageData>({
    networkMode: 'always', retry: false,
    queryKey: ["question-image", questionId, user?.id],
    queryFn: () => api.get<QuestionImageData>(`/question-bank/questions/${questionId}/image`),
    enabled: enabled && Boolean(questionId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: query => navigator.onLine && ![401,403,404].includes(Number((query.state.error as {status?:number}|null)?.status)) ? 60000 : false,
    gcTime: 10 * 60_000,
  });
}

export function getQuestionAttempted(question: Pick<StudentQuestionBankQuestion, "progress">) {
  return (question.progress?.attemptCount ?? 0) > 0;
}

export function getQuestionSolved(question: Pick<StudentQuestionBankQuestion, "progress">) {
  return Boolean(question.progress?.solvedAt || question.progress?.lastIsCorrect);
}

export function formatDifficultyLabel(value?: string | null) {
  const normalized = String(value ?? "medium").trim().toLowerCase();
  if (normalized === "starter") return "Starter Questions";
  if (normalized === "easy") return "Easy";
  if (normalized === "hard") return "Hard";
  return "Medium";
}

export function getQuestionDifficultyTone(value?: string | null) {
  const label = formatDifficultyLabel(value);
  if (label === "Starter Questions") return "bg-sky-100 text-sky-700";
  if (label === "Easy") return "bg-emerald-100 text-emerald-700";
  if (label === "Hard") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

export function getChapterDifficultyLabel(chapter: StudentQuestionBankChapter) {
  const questions = chapter.questions ?? [];
  if (questions.length === 0) return "Medium";

  const score = questions.reduce((total, question) => {
    const label = formatDifficultyLabel(question.difficulty);
    if (label === "Easy") return total + 1;
    if (label === "Hard") return total + 3;
    return total + 2;
  }, 0);

  const average = score / questions.length;
  if (average >= 2.4) return "Hard";
  if (average <= 1.4) return "Easy";
  return "Medium";
}
