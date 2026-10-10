import { type CSSProperties, type TouchEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { choiceIndex, choiceIndexes, choicesMatch } from "../../../../../api-server/src/lib/choice-answer";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Calculator,
  Flag,
  MoreHorizontal,
  Sparkles,
  Tag,
  Timer,
  Trophy,
} from "lucide-react";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { TcsCalculator } from "@/components/student/TcsCalculator";
import { PracticeAnswerFields, PracticeAnswerReview, PracticeActionBar, PracticeQuestionText, practiceCardClass, practiceHeaderClass } from "@/components/student/PracticeQuestionControls";
import { AiHint } from "@/components/student/AiHint";
import AiSimilarPractice from "@/components/student/AiSimilarPractice";
import { useToast } from "@/hooks/use-toast";
import { useQuestionReport } from "@/hooks/use-question-report";
import { usePracticeStreak } from "@/hooks/use-practice-streak";
import { type PracticeStreakStore } from "@/lib/practice-streak";
import { api } from "@/lib/api";
import { questionTimerStorageKey, readQuestionTimerSeconds, writeQuestionTimerSeconds } from "@/lib/question-timer";
import { OfflinePackLoader, useBufferedPractice } from "@/components/student/OfflinePractice";
import { loadOfflineQBank } from "@/lib/offline-qbank";
import { practiceBufferIds } from "@/lib/practice-network";
import { bufferedQuestionView } from "@/lib/practice-transport";
import { matchesQuestionBankFilter, questionBankFilterSearch, readQuestionBankFilter } from "@/lib/question-bank-filter";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  isStudentFeatureLocked,
  isStudentPendingVerification,
  isStudentRejectedVerification,
} from "@/lib/student-access";
import { buildStudentUnlockPath } from "@/lib/student-unlock";
import {
  applyPendingPreviewLocksToStructure,
  formatDifficultyLabel,
  getQuestionAttempted,
  getQuestionDifficultyTone,
  getQuestionSolved,
  type QuestionType,
  type StudentQBChapterQuestionsResponse,
  type StudentSavedQuestion,
  type StudentQuestionBankQuestion,
  useStudentChapterQuestions,
  useStudentQuestionContent,
  useStudentQuestionBankStructure,
  useStudentQuestionImage,
} from "@/pages/student/question-bank/api";

function isPreviewAnswerCorrect(
  questionType: QuestionType,
  answer: number | number[] | string,
  question: StudentQuestionBankQuestion,
) {
  if (questionType === "integer") {
    const parsed = Number(String(answer).trim());
    if (
      question.correctAnswerMin != null &&
      question.correctAnswerMax != null
    ) {
      return (
        Number.isFinite(parsed) &&
        parsed >= question.correctAnswerMin &&
        parsed <= question.correctAnswerMax
      );
    }
    const exactTarget =
      question.correctAnswerMin ??
      question.correctAnswerMax ??
      question.correctAnswer ??
      question.answer;
    return exactTarget !== null && parsed === Number(exactTarget);
  }

  if (questionType === "multi") {
    return choicesMatch(answer, question.correctAnswerMulti, true) ?? false;
  }

  return choicesMatch(answer, question.correctAnswer) ?? false;
}

type QuestionBankAttemptVariables = {
  questionId: number;
  answer: number | number[] | string;
  firstSubmissionTime: number | null;
  timerExamKey: string;
  attemptId: number;
  store: PracticeStreakStore;
  preview: boolean;
  predictedCorrect: boolean;
  chapterId: number;
  examId: string;
};

function getCheerCopy(streak: number) {
  if (streak >= 10) {
    return {
      title: `${streak} correct in a row`,
      description: "Brilliant streak. You are on fire.",
    };
  }

  if (streak === 5) {
    return {
      title: "5 correct in a row",
      description: "Great momentum. Keep the run going.",
    };
  }

  return {
    title: "3 correct in a row",
    description: "Nice streak. Keep it up.",
  };
}

type CheerTier = 3 | 5 | 10;

function formatTimerDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function getCheerTier(streak: number): CheerTier {
  if (streak >= 10) return 10;
  if (streak >= 5) return 5;
  return 3;
}

const CHEER_SPARK_COUNTS: Record<CheerTier, number> = {
  3: 9,
  5: 13,
  10: 19,
};

const CHEER_SPARK_PALETTES: Record<CheerTier, string[]> = {
  3: ["#38BDF8", "#818CF8", "#C084FC", "#FDE68A"],
  5: ["#FB923C", "#FACC15", "#4ADE80", "#38BDF8", "#C084FC"],
  10: ["#FDE68A", "#FACC15", "#FB923C", "#C084FC", "#67E8F9", "#86EFAC"],
};

function CheerConstellationBurst({ streak }: { streak: number | null }) {
  if (streak === null) return null;
  const tier = getCheerTier(streak);
  const sparkCount = CHEER_SPARK_COUNTS[tier];
  const palette = CHEER_SPARK_PALETTES[tier];

  return (
    <div className={`rankpulse-cheer-burst rankpulse-cheer-burst-${tier}`} aria-hidden="true">
      <span className="rankpulse-cheer-halo rankpulse-cheer-halo-one" />
      <span className="rankpulse-cheer-halo rankpulse-cheer-halo-two" />
      <span className="rankpulse-cheer-orbit rankpulse-cheer-orbit-one" />
      <span className="rankpulse-cheer-orbit rankpulse-cheer-orbit-two" />
      <span className="rankpulse-cheer-core" />
      {Array.from({ length: sparkCount }, (_, index) => {
        const angle = (index * 360) / sparkCount + (tier === 10 ? 7 : 0);
        const style = {
          "--spark-angle": `${angle}deg`,
          "--spark-delay": `${index * (tier === 10 ? 34 : 44)}ms`,
          "--spark-distance": `${tier === 10 ? 25 + (index % 5) * 5 : 19 + (index % 4) * 5}vmin`,
          "--spark-color": palette[index % palette.length],
        } as CSSProperties;
        return <span key={`${tier}-${index}`} className={`rankpulse-cheer-spark ${index % 3 === 0 ? "is-diamond" : ""}`} style={style} />;
      })}
      {tier === 10 ? <span className="rankpulse-cheer-crown">✦</span> : null}
    </div>
  );
}

type BrowserWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export default function StudentQuestionBankQuestionPage() {
  const { examId, subjectId, chapterId, questionId } = useParams<{
    examId: string;
    subjectId: string;
    chapterId: string;
    questionId: string;
  }>();
  const [, navigate] = useLocation();
  const search = useSearch();
  const savedOnly = new URLSearchParams(search).get("saved") === "1";
  const practiceFilter = readQuestionBankFilter(search);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isPreviewMode = isStudentPendingVerification(user);
  const isQuestionBankFeatureLocked = isStudentFeatureLocked(
    user,
    "question-bank",
  );
  // Structure gives exam/subject/chapter metadata (fast, no questions)
  const { data: liveStructure, isLoading: structureLoading } = useStudentQuestionBankStructure(examId);
  const structure = useMemo(() => {
    if (!liveStructure) return null;
    return isPreviewMode ? applyPendingPreviewLocksToStructure(liveStructure) : liveStructure;
  }, [isPreviewMode, liveStructure]);

  const chapterIdNum = parseInt(chapterId, 10);
  // Reuse only the lightweight navigation/progress index from ChapterPage.
  const { data: chapterQuestionsData, isLoading: questionsLoading } = useStudentChapterQuestions(
    chapterIdNum,
    Boolean(structure),
    savedOnly,
  );
  // On a direct refresh the structure usually resolves before the chapter
  // questions request. Do not treat that short gap as a missing question;
  // otherwise the page flashes "Not found" and sends the student home.

  // Resolve the current question id early so lazy image fetch can start
  const currentQuestionId = useMemo(() => {
    const q = chapterQuestionsData?.questions.find((q) => String(q.id) === questionId);
    return q?.id;
  }, [chapterQuestionsData, questionId]);
  const { data: questionContent, isLoading: contentLoading, isError: contentError, error: contentFailure, refetch: retryContent } = useStudentQuestionContent(
    chapterIdNum, currentQuestionId ? [currentQuestionId] : [], Boolean(structure),
  );

  // Lazy-load imageData and optionImages only when this question is visible
  const { data: liveQuestionImage } = useStudentQuestionImage(currentQuestionId);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<number[]>([]);
  const [integerAnswer, setIntegerAnswer] = useState("");
  const practice = usePracticeStreak(JSON.stringify([user?.id, examId, chapterId, isPreviewMode]));
  const buffered=useBufferedPractice();
  const contentStatus=Number((contentFailure as {status?:number}|null)?.status);
  const contentDenied=contentStatus>=400&&contentStatus<500&&![408,429].includes(contentStatus);
  const validBuffer=buffered.pack?.source==='question-bank'&&buffered.pack.context===`qb:${String(examId).toLowerCase()}:${chapterId}`&&
    Date.now()-buffered.pack.createdAt<30*86400000&&user?.role==='student'&&!isPreviewMode&&!isStudentRejectedVerification(user)&&!isQuestionBankFeatureLocked&&!contentDenied;
  const bufferQuestion=validBuffer?buffered.pack?.questions.find(q=>String(q.id)===questionId):undefined;
  const questionImage=liveQuestionImage??(bufferQuestion?{imageData:bufferQuestion.imageData,optionImages:bufferQuestion.optionImages}:undefined);
  const bufferedAttempt=bufferQuestion?buffered.attempts.find(a=>a.packId===buffered.pack?.id&&a.questionId===bufferQuestion.id&&a.exam===bufferQuestion.exam):undefined;
  const currentAttempt = practice.attempts.find(entry =>
    String(entry.questionId) === questionId && (entry.status === "pending" || entry.status === "confirmed"))
    ?? (bufferedAttempt?{...bufferedAttempt,status:'confirmed' as const}:undefined);
  const revealed = Boolean(currentAttempt);
  const result = currentAttempt ? { isCorrect: currentAttempt.isCorrect } : null;
  const correctStreak = practice.count;
  const [cheerStreak, setCheerStreak] = useState<number | null>(null);
  const seenCelebration = useRef({ store: practice.store, id: practice.celebration?.id });
  const cheerAudioContextRef = useRef<AudioContext | null>(null);
  const hasInteractedRef = useRef(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [showCalculator, setShowCalculator] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timeSpentSeconds, setTimeSpentSeconds] = useState(0);
  const timeSpentRef = useRef(0);
  const lastSavedTimeRef = useRef(0);
  const timerSavePendingRef = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const wheelNavigationLocked = useRef(false);
  const wheelResetTimer = useRef<number | null>(null);
  const wheelDeltaAccumulator = useRef(0);

  const playCheerSound = useCallback((streak: number) => {
    if (typeof window === "undefined") return;

    const AudioContextCtor = window.AudioContext || (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = cheerAudioContextRef.current ?? new AudioContextCtor();
    cheerAudioContextRef.current = context;

    const play = () => {
      const tier = getCheerTier(streak);
      const notes = tier === 10
        ? [
            [523.25, 0],
            [659.25, 0.12],
            [783.99, 0.24],
            [1046.5, 0.39],
          ]
        : tier === 5
          ? [[587.33, 0], [739.99, 0.14], [880, 0.28]]
          : [[659.25, 0], [880, 0.15]];
      const endAt = context.currentTime + (tier === 10 ? 0.92 : tier === 5 ? 0.68 : 0.52);
      const master = context.createGain();
      master.gain.setValueAtTime(0.0001, context.currentTime);
      master.gain.exponentialRampToValueAtTime(tier === 10 ? 0.045 : 0.035, context.currentTime + 0.025);
      master.gain.exponentialRampToValueAtTime(0.0001, endAt);
      master.connect(context.destination);

      notes.forEach(([frequency, offset], index) => {
        const oscillator = context.createOscillator();
        oscillator.type = index % 2 === 0 ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, context.currentTime + offset);
        oscillator.connect(master);
        oscillator.start(context.currentTime + offset);
        oscillator.stop(context.currentTime + (tier === 10 ? 0.72 : 0.48) + offset);
      });

      window.setTimeout(() => master.disconnect(), 1100);
    };

    if (context.state === "suspended") {
      if (!hasInteractedRef.current) return;
      void context.resume().then(play).catch(() => {});
      return;
    }
    play();
  }, []);

  useEffect(() => {
    const warmAudio = () => {
      hasInteractedRef.current = true;
      if (cheerAudioContextRef.current?.state === "suspended") {
        void cheerAudioContextRef.current.resume().catch(() => {});
      }
    };

    window.addEventListener("pointerdown", warmAudio, { passive: true });
    window.addEventListener("keydown", warmAudio);
    return () => {
      window.removeEventListener("pointerdown", warmAudio);
      window.removeEventListener("keydown", warmAudio);
    };
  }, []);
  const saveMutation = useMutation({
    mutationFn: async (id: number) =>
      api.post<{ saved: boolean }>(`/question-bank-questions/${id}/save`),
    onMutate: async (questionId: number) => {
      const chapterQueryKey = ["student-qb-chapter-questions", chapterIdNum, savedOnly, user?.id] as const;
      const savedQueryKey = ["student-question-bank-saved-questions", user?.id] as const;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: chapterQueryKey }),
        queryClient.cancelQueries({ queryKey: savedQueryKey }),
      ]);
      const previous = queryClient.getQueryData<StudentQBChapterQuestionsResponse>(chapterQueryKey);
      const previousSaved = queryClient.getQueryData<InfiniteData<{
        questions: StudentSavedQuestion[];
        nextCursor: string | null;
      }>>(savedQueryKey);
      const currentQuestion = previous?.questions.find((item) => item.id === questionId);
      if (previous && currentQuestion) {
        queryClient.setQueryData<StudentQBChapterQuestionsResponse>(
          chapterQueryKey,
          {
            ...previous,
            questions: previous.questions.map((item) =>
              item.id === questionId ? { ...item, isSaved: !item.isSaved } : item,
            ),
          },
        );
      }
      if (previousSaved && currentQuestion?.isSaved) {
        queryClient.setQueryData<InfiniteData<{
          questions: StudentSavedQuestion[];
          nextCursor: string | null;
        }>>(savedQueryKey, {
          ...previousSaved,
          pages: previousSaved.pages.map((page) => ({
            ...page,
            questions: page.questions.filter((question) => question.id !== questionId),
          })),
        });
      }
      return { previous, previousSaved, chapterQueryKey, savedQueryKey };
    },
    onSuccess: ({ saved }, id) => {
      queryClient.setQueriesData<StudentQBChapterQuestionsResponse>({ queryKey: ["student-qb-chapter-questions", chapterIdNum] },
        data => data ? { ...data, questions: data.questions.map(item => item.id === id ? { ...item, isSaved: saved } : item) } : data);
      queryClient.invalidateQueries({ queryKey: ["student-question-bank-saved-count"] });
      queryClient.invalidateQueries({ queryKey: ["student-question-bank-saved-questions"] });
      toast({
        title: saved ? "Question bookmarked" : "Bookmark removed",
        description: saved
          ? "You can find this question in your saved question bank."
          : "This question was removed from your saved list.",
      });
      if (!saved && savedOnly) {
        navigate("/student/question-bank/saved");
      }
    },
    onError: (error: Error, _questionId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          context.chapterQueryKey,
          context.previous,
        );
      }
      if (context?.previousSaved) {
        queryClient.setQueryData(context.savedQueryKey, context.previousSaved);
      }
      toast({
        title: "Could not update bookmark",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: (_data, _error, _questionId, context) => {
      queryClient.invalidateQueries({ queryKey: context?.savedQueryKey ?? ["student-question-bank-saved-questions", user?.id] });
    },
  });

  const reportState = useQuestionReport(`/question-bank-questions/${questionId}/report`, showReport, () => {
      setShowReport(false);
      setReportReason("");
  });
  const reportMutation = reportState.mutation;

  const exam = structure?.exam;
  const subject = structure?.subjects.find(
    (entry) => String(entry.id) === subjectId,
  );
  const chapterMeta = subject?.chapters.find(
    (entry) => String(entry.id) === chapterId,
  );
  const questionState = chapterQuestionsData?.questions.find(
    (entry) => String(entry.id) === questionId,
  );
  const bufferedView=useMemo(()=>bufferQuestion?bufferedQuestionView(bufferQuestion,bufferedAttempt):undefined,[bufferQuestion,bufferedAttempt]);
  const loadedQuestion = contentDenied ? undefined : (questionContent?.questions.find(entry => String(entry.id) === questionId)
    ?? bufferedView) as StudentQuestionBankQuestion|undefined;
  const question = useMemo(() => loadedQuestion && questionState ? {
    ...loadedQuestion,
    ...(buffered.offline&&bufferQuestion?{question:bufferQuestion.question,options:bufferQuestion.options,explanation:bufferQuestion.explanation}:{}),
    progress: loadedQuestion.progress ?? questionState.progress,
    isSaved: questionState.isSaved,
    timeSpentSeconds: Math.max(questionState.timeSpentSeconds ?? 0, loadedQuestion.timeSpentSeconds ?? 0),
  } : undefined, [loadedQuestion, questionState,buffered.offline,bufferQuestion]);
  const timerExamKey = String(exam?.key ?? examId ?? "").toLowerCase();
  const timerEnabled = !isPreviewMode && Boolean(question) && (timerExamKey === "gate" || timerExamKey.includes("jam"));
  const timerLocked = (question?.progress?.attemptCount ?? 0) > 0;
  const timerStorageKey = questionTimerStorageKey(user?.id, "question-bank", timerExamKey, question?.id ?? 0);
  const saveQuestionTimer = useCallback(async (recordVisit = false) => {
    const seconds = Math.floor(timeSpentRef.current);
    if (!timerEnabled || !question || timerLocked) return;
    writeQuestionTimerSeconds(timerStorageKey, seconds);
    if ((!recordVisit && seconds <= lastSavedTimeRef.current) || timerSavePendingRef.current) return;
    timerSavePendingRef.current = true;
    try {
      const saved = await api.post<{ timeSpentSeconds: number }>(`/question-bank/questions/${question.id}/time`, {
        exam: timerExamKey,
        timeSpentSeconds: seconds,
      });
      lastSavedTimeRef.current = Math.max(seconds, Number(saved.timeSpentSeconds ?? seconds));
      timeSpentRef.current = Math.max(timeSpentRef.current, lastSavedTimeRef.current);
      setTimeSpentSeconds(timeSpentRef.current);
      writeQuestionTimerSeconds(timerStorageKey, lastSavedTimeRef.current);
      queryClient.setQueryData<StudentQBChapterQuestionsResponse>(
        ["student-qb-chapter-questions", chapterIdNum, savedOnly, user?.id],
        (current) => current ? {
          ...current,
          questions: current.questions.map((entry) => entry.id === question.id
            ? { ...entry, timeSpentSeconds: lastSavedTimeRef.current }
            : entry),
        } : current,
      );
    } catch {
      // Keep the local total and try again on the next autosave/pause.
    } finally {
      timerSavePendingRef.current = false;
    }
  }, [chapterIdNum, question?.id, queryClient, savedOnly, timerEnabled, timerExamKey, timerLocked, timerStorageKey, user?.id]);

  const chapterQuestions = useMemo(() => {
    const locallyAttempted = new Set(practice.attempts.filter(attempt => attempt.status === "pending" || attempt.status === "confirmed").map(attempt => attempt.questionId));
    if (validBuffer) for (const attempt of buffered.attempts) {
      if (attempt.packId === buffered.pack?.id) locallyAttempted.add(attempt.questionId);
    }
    // Keep the opened question in place so submitting it does not hide its result
    // or break Next. Every other navigation target must still match the filter.
    return (chapterQuestionsData?.questions ?? []).filter(entry => String(entry.id) === questionId
      || matchesQuestionBankFilter(entry, practiceFilter, locallyAttempted.has(entry.id)));
  }, [chapterQuestionsData, questionId, practiceFilter, practice.attempts, validBuffer, buffered.attempts, buffered.pack?.id]);
  const currentIndex = chapterQuestions.findIndex(
    (entry) => String(entry.id) === questionId,
  );
  const prevQuestion =
    currentIndex > 0 ? chapterQuestions[currentIndex - 1] : null;
  const nextQuestion =
    currentIndex >= 0 && currentIndex < chapterQuestions.length - 1
      ? chapterQuestions[currentIndex + 1]
      : null;
  const chapterPath = `/student/question-bank/exam/${examId}/subject/${subjectId}/chapter/${chapterId}`;
  const questionPath = (id: number) => `${chapterPath}/question/${id}${questionBankFilterSearch(practiceFilter, savedOnly)}`;
  const backPath = savedOnly ? "/student/question-bank/saved" : `${chapterPath}${questionBankFilterSearch(practiceFilter)}`;
  const navigateToQuestion = (entry: { id: number } | null) => {
    if (!entry) return;
    navigate(questionPath(entry.id));
  };
  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 70 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    if (deltaX < 0) navigateToQuestion(nextQuestion);
    if (deltaX > 0) navigateToQuestion(prevQuestion);
  };
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const rawHorizontalDelta = event.deltaX;
    const horizontalDelta = Math.abs(rawHorizontalDelta);
    const verticalDelta = Math.abs(event.deltaY);
    const isHorizontalGesture = horizontalDelta > 0 && horizontalDelta >= verticalDelta * 0.8;
    if (!isHorizontalGesture || wheelNavigationLocked.current) {
      if (!wheelNavigationLocked.current && verticalDelta > horizontalDelta) {
        wheelDeltaAccumulator.current = 0;
      }
      return;
    }

    // Trackpads often emit many small horizontal wheel events. Accumulate
    // them instead of requiring one large delta, which made two-finger
    // navigation unreliable on laptops.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerWidth : 1;
    wheelDeltaAccumulator.current += rawHorizontalDelta * scale;
    event.preventDefault();
    if (Math.abs(wheelDeltaAccumulator.current) < 36) return;

    const direction = wheelDeltaAccumulator.current < 0 ? "next" : "previous";
    wheelDeltaAccumulator.current = 0;
    wheelNavigationLocked.current = true;
    if (wheelResetTimer.current !== null) window.clearTimeout(wheelResetTimer.current);
    wheelResetTimer.current = window.setTimeout(() => {
      wheelNavigationLocked.current = false;
      wheelResetTimer.current = null;
    }, 450);

    if (direction === "next") navigateToQuestion(nextQuestion);
    if (direction === "previous") navigateToQuestion(prevQuestion);
  };
  const rawQuestionType = String(question?.questionType ?? "").trim().toLowerCase();
  const hasUsableOptions = (question?.options ?? []).some((option) => String(option ?? "").trim().length > 0);
  const questionType: QuestionType =
    rawQuestionType === "integer" || rawQuestionType === "nat" || rawQuestionType === "numerical"
      ? "integer"
      : rawQuestionType === "multi" || rawQuestionType === "msq" || rawQuestionType === "multiple"
        ? "multi"
        : !hasUsableOptions
          ? "integer"
          : "mcq";

  useEffect(() => {
    if (!isQuestionBankFeatureLocked || !exam || !subject || !chapterMeta) return;
    navigate(
      buildStudentUnlockPath({
        feature: "question-bank",
        kind: "chapter",
        label: chapterMeta.title,
        examLabel: exam.label,
        subjectLabel: subject.title,
        returnTo: questionPath(Number(questionId)),
      }),
    );
  }, [
    chapterMeta,
    chapterId,
    exam,
    examId,
    isQuestionBankFeatureLocked,
    navigate,
    questionId,
    subject,
    subjectId,
    savedOnly,
  ]);

  const attemptMutation = useMutation({
    networkMode: 'always',
    mutationFn: async ({ questionId: submittedQuestionId, answer, preview, predictedCorrect, firstSubmissionTime, timerExamKey: submittedExamKey }: QuestionBankAttemptVariables) => {
      if (preview) return { isCorrect: predictedCorrect, progress: undefined };
      if (firstSubmissionTime !== null) {
        await api.post(`/question-bank/questions/${submittedQuestionId}/time`, {
          exam: submittedExamKey,
          timeSpentSeconds: firstSubmissionTime,
        });
      }
      return api.post<{ isCorrect: boolean; progress?: StudentQuestionBankQuestion["progress"] }>(
        `/question-bank-questions/${submittedQuestionId}/attempt`,
        { answer },
      );
    },
    onSuccess: (payload, variables) => {
      // Settle the exact submitted attempt, even after navigation or unmount.
      variables.store.settle(variables.attemptId, payload.isCorrect);
      if (!variables.preview) {
        if (payload.progress) {
          queryClient.setQueriesData<StudentQBChapterQuestionsResponse>({
            queryKey: ["student-qb-chapter-questions", variables.chapterId],
          }, (data) => data ? { ...data, questions: data.questions.map((item) =>
            item.id === variables.questionId ? {
              ...item,
              progress: payload.progress,
              timeSpentSeconds: variables.firstSubmissionTime === null
                ? item.timeSpentSeconds
                : Math.max(item.timeSpentSeconds ?? 0, variables.firstSubmissionTime),
            } : item) } : data);
        }
        // Mark summaries stale for the next visit without rereading every
        // question/count while the student is still answering this chapter.
        queryClient.invalidateQueries({
          queryKey: ["student-qb-chapter-questions", variables.chapterId],
          refetchType: payload.progress ? "none" : "active",
        });
        // Also invalidate structure (attempted counts) and dashboard summary
        queryClient.invalidateQueries({
          queryKey: ["student-qb-structure", variables.examId],
          refetchType: "none",
        });
        queryClient.invalidateQueries({
          queryKey: ["student-question-bank-exams"],
          refetchType: "none",
        });
        queryClient.invalidateQueries({
          queryKey: ["dashboard-question-bank-progress"],
          refetchType: "none",
        });
      }
    },
    onError: (error: Error, variables) => {
      variables.store.settle(variables.attemptId, null);
      toast({
        title: "Could not submit answer",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const saved = practice.store.getSnapshot().attempts.find(entry =>
      String(entry.questionId) === questionId && (entry.status === "pending" || entry.status === "confirmed")) ?? bufferedAttempt;
    setSelected(questionType === "mcq" ? choiceIndex(saved?.answer) : null);
    setSelectedMulti(questionType === "multi" ? choiceIndexes(saved?.answer) ?? [] : []);
    setIntegerAnswer(questionType === "integer" && saved ? String(saved.answer) : "");
  }, [questionId, questionType, practice.store, bufferedAttempt?.id]);

  const refreshedResult = currentAttempt?.status === "confirmed" && question
    ? questionType === "integer"
      ? (question.correctAnswerMin != null || question.correctAnswerMax != null || question.correctAnswer != null || question.answer != null)
        ? isPreviewAnswerCorrect(questionType, currentAttempt.answer, question) : null
      : choicesMatch(currentAttempt.answer, questionType === "multi" ? question.correctAnswerMulti : question.correctAnswer, questionType === "multi")
    : null;
  useEffect(() => {
    if (currentAttempt && typeof currentAttempt.id==='number' && refreshedResult !== null) practice.store.regrade(currentAttempt.id, refreshedResult);
  }, [currentAttempt?.id, refreshedResult, practice.store]);

  useEffect(() => {
    if (question) window.dispatchEvent(new Event("rankpulse:collapse-sidebar"));
  }, [question?.id]);

  useEffect(() => {
    const serverSeconds = Math.max(0, Number(question?.timeSpentSeconds ?? 0));
    const localSeconds = readQuestionTimerSeconds(timerStorageKey);
    const seconds = timerLocked ? serverSeconds : Math.max(serverSeconds, localSeconds);
    timeSpentRef.current = seconds;
    lastSavedTimeRef.current = serverSeconds;
    setTimeSpentSeconds(seconds);
    // Record even a zero-second visit; an opened question is not an answer.
    if (!timerLocked) void saveQuestionTimer(true);
  }, [question?.id, timerLocked]);

  useEffect(() => {
    if (!timerEnabled || revealed || timerLocked) {
      setTimerRunning(false);
      return;
    }
    if (!timerRunning) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const next = timeSpentRef.current + 1;
      timeSpentRef.current = next;
      setTimeSpentSeconds(next);
      writeQuestionTimerSeconds(timerStorageKey, next);
      if (next - lastSavedTimeRef.current >= 30) void saveQuestionTimer();
    }, 1000);
    return () => {
      window.clearInterval(interval);
      void saveQuestionTimer();
    };
  }, [revealed, saveQuestionTimer, timerEnabled, timerLocked, timerRunning, timerStorageKey]);

  useEffect(() => {
    setTimerRunning(timerEnabled && !revealed && !timerLocked);
  }, [question?.id, timerEnabled, revealed, timerLocked]);

  useEffect(() => {
    if (seenCelebration.current.store !== practice.store) {
      seenCelebration.current = { store: practice.store, id: practice.celebration?.id };
      setCheerStreak(null);
      return;
    }
    if (practice.celebration && seenCelebration.current.id === practice.celebration.id) return;
    seenCelebration.current.id = practice.celebration?.id;
    setCheerStreak(practice.celebration?.count ?? null);
    if (!practice.celebration) return;
    playCheerSound(practice.celebration.count);
    const timer = window.setTimeout(() => setCheerStreak(null), practice.celebration.count >= 10 ? 6200 : 4900);
    return () => window.clearTimeout(timer);
  }, [playCheerSound, practice.celebration, practice.store]);

  const submittedMulti = useMemo(
    () => [...selectedMulti].sort((left, right) => left - right),
    [selectedMulti],
  );

  useEffect(() => () => {
    if (wheelResetTimer.current !== null) window.clearTimeout(wheelResetTimer.current);
  }, []);

  if (structureLoading || questionsLoading || (contentLoading && !question)) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Loading question...
      </div>
    );
  }

  if (contentError && !question) {
    return <div className="py-20 text-center text-muted-foreground">Could not load question. <button className="text-primary underline" onClick={() => retryContent()}>Retry</button></div>;
  }

  if (isQuestionBankFeatureLocked) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Redirecting to unlock payment...
      </div>
    );
  }

  if (
    !exam ||
    !subject ||
    !chapterMeta ||
    !question ||
    subject.isLocked ||
    chapterMeta.isLocked
  ) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Not found.{" "}
        <Link to="/student/question-bank" className="text-primary underline">
          Go home
        </Link>
      </div>
    );
  }

  const handleReveal = () => {
    const submit = (answer: number | number[] | string) => {
      if (!question || revealed) return;

      // The question already contains its answer metadata, so show the result
      // immediately. The progress write continues in the background.
      const isCorrect = isPreviewAnswerCorrect(questionType, answer, question);
      const attemptId = practice.store.begin(question.id, answer, isCorrect);
      if (attemptId === null) return;
      attemptMutation.mutate({ questionId: question.id, answer, firstSubmissionTime: timerEnabled && !timerLocked ? Math.floor(timeSpentRef.current) : null, timerExamKey, attemptId, store: practice.store,
        preview: isPreviewMode, predictedCorrect: isCorrect, chapterId: chapterIdNum, examId });
    };

    if (questionType === "integer") {
      if (!integerAnswer.trim()) return;
      submit(integerAnswer.trim());
      return;
    }

    if (questionType === "multi") {
      if (submittedMulti.length === 0) return;
      submit(submittedMulti);
      return;
    }

    if (selected === null) return;
    submit(selected);
  };

  const toggleMulti = (index: number) => {
    if (revealed) return;
    setSelectedMulti((current) =>
      current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((left, right) => left - right),
    );
  };

  const mcqCorrectIndex = question.correctAnswer ?? 0;
  const multiCorrectIndexes = [...(question.correctAnswerMulti ?? [])].sort(
    (left, right) => left - right,
  );
  const integerRangeText =
    question.correctAnswerMin != null && question.correctAnswerMax != null
      ? `${question.correctAnswerMin} to ${question.correctAnswerMax}`
      : question.correctAnswer != null
        ? String(question.correctAnswer)
        : question.answer?.trim() || null;



  const isCorrect = refreshedResult ?? result?.isCorrect ?? false;
  const cheerCopy = cheerStreak ? getCheerCopy(cheerStreak) : null;
  const questionProgress = (
    <div className="flex gap-1">
      {chapterQuestions.map((entry, index) => (
        <button
          key={entry.id}
          aria-label={`Open question ${index + 1}`}
          onClick={() => navigate(questionPath(entry.id))}
          className={`h-1.5 flex-1 rounded-full transition-all ${index === currentIndex ? "bg-primary" : getQuestionSolved(entry) ? "bg-emerald-400" : getQuestionAttempted(entry) ? "bg-red-500" : "bg-muted"}`}
        />
      ))}
    </div>
  );

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onWheelCapture={handleWheel} className="touch-pan-y overscroll-x-none space-y-6">
      <OfflinePackLoader source="question-bank" title={`${subject?.title ?? "Question Bank"} · ${chapterMeta?.title ?? "Practice"}`}
        context={`qb:${timerExamKey}:${chapterId}`} exam={timerExamKey}
        questionIds={practiceBufferIds(chapterQuestions.map(q=>q.id),currentIndex)}
        load={(ids,signal,onReady)=>loadOfflineQBank(chapterIdNum,ids,timerExamKey,signal,onReady)} />
      <CheerConstellationBurst key={practice.celebration?.id} streak={cheerStreak} />
      {cheerCopy ? (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4 sm:top-24">
          <div className="animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
            <div className="relative overflow-hidden rounded-full border border-[#FDE68A] bg-gradient-to-r from-[#FFF7E8] via-white to-[#ECFCCB] px-4 py-3 shadow-[0_12px_32px_rgba(217,119,6,0.16)]">
              <div className="absolute -left-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-[#F59E0B]/15 blur-xl" />
              <div className="absolute -right-1 top-1 h-8 w-8 rounded-full bg-[#22C55E]/15 blur-lg" />
              <div className="relative flex items-center gap-3">
                <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#F59E0B]/15 text-[#D97706]">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F59E0B]/20" />
                  <Trophy className="relative h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 animate-pulse text-[#D97706]" />
                    <p className="text-sm font-bold text-[#111827]">
                      {cheerCopy.title}
                    </p>
                  </div>
                  <p className="text-xs font-medium text-[#6B7280]">
                    {cheerCopy.description}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Link
          to={backPath}
        >
          <button className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </Link>
        <div className="flex w-full items-center gap-1.5 overflow-x-auto text-xs text-muted-foreground sm:w-auto sm:overflow-hidden">
          <Link
            to={`/student/question-bank/exam/${examId}`}
            className="shrink-0 hover:text-primary"
          >
            {exam.label}
          </Link>
          <span className="shrink-0">/</span>
          <Link
            to={`/student/question-bank/exam/${examId}/subject/${subjectId}`}
            className="max-w-[80px] shrink-0 truncate hover:text-primary"
          >
            {subject.title}
          </Link>
          <span className="shrink-0">/</span>
          <Link
            to={`/student/question-bank/exam/${examId}/subject/${subjectId}/chapter/${chapterId}`}
            className="max-w-[80px] shrink-0 truncate hover:text-primary"
          >
            {chapterMeta.title}
          </Link>
        </div>
        <div className="hidden shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground sm:ml-auto sm:block">
          {currentIndex + 1} / {chapterQuestions.length}
        </div>
      </div>

      <div className="hidden sm:block">{questionProgress}</div>

      <div className={practiceCardClass} data-question-navigation-card>
        <button type="button" aria-label="Previous question" title="Previous question" disabled={!prevQuestion} onClick={() => navigateToQuestion(prevQuestion)} className="absolute inset-y-2 left-0 z-10 hidden w-6 cursor-pointer items-center justify-center rounded-l-xl text-primary/0 transition hover:bg-primary/5 hover:text-primary/70 disabled:cursor-default lg:flex disabled:hover:bg-transparent disabled:hover:text-transparent"><ArrowLeft className="h-4 w-4" /></button>
        <button type="button" aria-label="Next question" title="Next question" disabled={!nextQuestion} onClick={() => navigateToQuestion(nextQuestion)} className="absolute inset-y-2 right-0 z-10 hidden w-6 cursor-pointer items-center justify-center rounded-r-xl text-primary/0 transition hover:bg-primary/5 hover:text-primary/70 disabled:cursor-default lg:flex disabled:hover:bg-transparent disabled:hover:text-transparent"><ArrowRight className="h-4 w-4" /></button>
        <div className={practiceHeaderClass}>
          <div className="pb-4 pt-1 sm:hidden">{questionProgress}</div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 max-w-[45%] truncate text-xs text-muted-foreground sm:max-w-none">
              {chapterMeta.title}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${getQuestionDifficultyTone(question.difficulty)}`}
            >
              {formatDifficultyLabel(question.difficulty)}
            </span>
            {questionType === "multi" ? (
              <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
                MSQ
              </span>
            ) : null}
            {question.topicTag ? (
              <span className="flex min-w-0 max-w-[28%] items-center gap-1 truncate rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground sm:max-w-[220px]">
                <Tag className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{question.topicTag}</span>
              </span>
            ) : null}
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              {question.points ?? 1}{" "}
              {(question.points ?? 1) === 1 ? "mark" : "marks"}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm" aria-label="More question actions"><MoreHorizontal className="h-5 w-5" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {!isPreviewMode ? <AiSimilarPractice mobileMenu key={question.id} source="question-bank" sourceQuestionId={question.id} exam={exam.label} subject={subject.title} chapter={chapterMeta.title} question={question.question} options={question.options} questionType={questionType} hasDiagram={Boolean(question.hasImage || question.hasOptionImages)} solved={revealed} /> : null}
                {!isPreviewMode ? <DropdownMenuItem disabled><span className="w-4 text-center text-xs font-semibold text-muted-foreground">#</span> {question.progress?.attemptCount ?? 0} attempt{(question.progress?.attemptCount ?? 0) === 1 ? "" : "s"}</DropdownMenuItem> : null}
                {timerEnabled ? <DropdownMenuItem disabled><Timer className="h-4 w-4 text-orange-600" /> Time spent · {formatTimerDuration(timeSpentSeconds)}</DropdownMenuItem> : null}
                <DropdownMenuItem onSelect={() => setShowCalculator(true)}><Calculator className="h-4 w-4 text-sky-600" /> Calculator</DropdownMenuItem>
                {!isPreviewMode ? <DropdownMenuItem onSelect={() => saveMutation.mutate(question.id)}><Bookmark className="h-4 w-4 text-amber-600" /> {question.isSaved ? "Remove bookmark" : "Save question"}</DropdownMenuItem> : null}
                {!isPreviewMode ? <DropdownMenuItem onSelect={() => { setShowReport(true); setReportReason(""); }}><Flag className="h-4 w-4 text-rose-600" /> Report question</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
              </div>
              <div className="hidden flex-nowrap items-center gap-1.5 whitespace-nowrap sm:flex sm:gap-2">
          {timerEnabled ? <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 text-xs font-semibold tabular-nums text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300" title={revealed ? "Timer stopped after answer submission" : "Question time"} aria-label={`Time spent ${formatTimerDuration(timeSpentSeconds)}`}><Timer className="h-3.5 w-3.5" /><span>{formatTimerDuration(timeSpentSeconds)}</span></div> : null}
          {!isPreviewMode ? (
            <AiSimilarPractice
              key={question.id}
              source="question-bank"
              sourceQuestionId={question.id}
              exam={exam.label}
              subject={subject.title}
              chapter={chapterMeta.title}
              question={question.question}
              options={question.options}
              questionType={questionType}
              hasDiagram={Boolean(question.hasImage || question.hasOptionImages)}
              solved={revealed}
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setShowCalculator(true)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 p-0 text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 active:scale-95"
                aria-label="Open scientific calculator"
                data-testid="button-question-bank-calculator"
              >
                <Calculator className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Calculator</TooltipContent>
          </Tooltip>
          {!isPreviewMode ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => saveMutation.mutate(question.id)}
                    disabled={saveMutation.isPending}
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border p-0 transition active:scale-95 disabled:cursor-wait disabled:opacity-60 ${
                      question.isSaved
                        ? "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                        : "border-border bg-card text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                    }`}
                    aria-label={question.isSaved ? "Remove bookmark" : "Bookmark this question"}
                  >
                    {question.isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{question.isSaved ? "Remove bookmark" : "Bookmark"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { setShowReport(true); setReportReason(""); }}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 p-0 text-red-600 transition hover:border-red-400 hover:bg-red-100 hover:text-red-700 active:scale-95"
                    aria-label="Report this question"
                  >
                    <Flag className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Report</TooltipContent>
              </Tooltip>
            </div>
          ) : null}
              </div>
            </div>
          </div>
        </div>

        {(question.hasImage || question.imageData) ? (
          <div className="mb-4 overflow-hidden rounded-xl border border-border bg-muted/30 p-3">
            {(questionImage?.imageData ?? question.imageData) ? (
              <img
                src={questionImage?.imageData ?? question.imageData ?? ""}
                alt="Question"
                className="max-h-[180px] w-full object-contain sm:max-h-[320px]"
              />
            ) : (
              <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">Loading image…</div>
            )}
          </div>
        ) : null}

        <PracticeQuestionText content={question.question} />

        <AiHint question={question.question} options={question.options} source="question-bank" />

        <PracticeAnswerFields questionId={question.id} questionType={questionType} options={question.options} optionImages={questionImage?.optionImages ?? question.optionImages} selected={selected} selectedMulti={selectedMulti} integerAnswer={integerAnswer} revealed={revealed} correctIndexes={questionType === "multi" ? multiCorrectIndexes : [mcqCorrectIndex]} onSelect={index => questionType === "multi" ? toggleMulti(index) : setSelected(index)} onIntegerChange={setIntegerAnswer} />
        {revealed ? <PracticeAnswerReview isCorrect={isCorrect} answerLabel={questionType === "integer" ? integerRangeText ?? "Not available" : (questionType === "multi" ? multiCorrectIndexes : [mcqCorrectIndex]).map(index => String.fromCharCode(65 + index)).join(", ")} answerContent={questionType === "mcq" ? question.options[mcqCorrectIndex] : null} explanation={question.explanation} /> : null}

      </div>

      <TcsCalculator
        open={showCalculator}
        onClose={() => setShowCalculator(false)}
      />

      {/* Report Dialog */}
      <Dialog
        open={showReport}
        onOpenChange={(open) => {
          if (!open && !reportMutation.isPending) {
            setShowReport(false);
            setReportReason("");
          }
        }}
      >
        <DialogContent className="max-w-md rounded-[24px] border border-[#E2E8F0] bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.18)]" hideClose>
          <div className="p-6">
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="text-xl font-semibold text-[#111827]">Report this question?</DialogTitle>
              <DialogDescription className="text-sm leading-6 text-[#64748B]">
                Your report goes directly to the teacher who created this question.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#64748B]">
                  {chapterMeta.title}
                </div>
                <RichQuestionContent
                  content={question.question}
                  className="line-clamp-3 text-sm leading-7 text-[#111827]"
                />
              </div>

              <div className="space-y-2">
                {reportState.message ? <p role="status" className="text-sm text-muted-foreground">{reportState.message}</p> : null}
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">What should the teacher check?</p>
                <Textarea
                  value={reportReason}
                  disabled={reportState.blocked || reportMutation.isPending}
                  onChange={(e) => setReportReason(e.target.value)}
                  placeholder="Example: image is wrong, option mismatch, solution is incorrect, or question text has an issue."
                  className="min-h-[120px] rounded-2xl border-[#D6DFEA] bg-white text-sm leading-6"
                />
              </div>
            </div>

            <DialogFooter className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowReport(false); setReportReason(""); }}
                disabled={reportMutation.isPending}
                className="rounded-full border-[#D6DFEA] px-5"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (question) {
                    reportMutation.mutate({ questionId: question.id, reason: reportReason.trim() });
                  }
                }}
                disabled={reportState.blocked || !reportReason.trim() || reportMutation.isPending}
                className="rounded-full bg-[#111827] px-5 text-white hover:bg-[#0F172A]"
              >
                {reportMutation.isPending ? "Sending..." : "Send Report"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <PracticeActionBar revealed={revealed} canSubmit={questionType === "integer" ? integerAnswer.trim() !== "" : questionType === "multi" ? selectedMulti.length > 0 : selected !== null} hasPrevious={Boolean(prevQuestion)} hasNext={Boolean(nextQuestion)} streak={correctStreak} onPrevious={() => navigateToQuestion(prevQuestion)} onNext={() => navigateToQuestion(nextQuestion)} onFinish={() => navigate(backPath)} onSubmit={handleReveal} />
    </div>
  );
}
