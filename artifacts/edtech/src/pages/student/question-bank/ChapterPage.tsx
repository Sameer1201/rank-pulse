import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bookmark, BookmarkCheck, CheckCircle2, Circle, Lock, Tag, XCircle } from "lucide-react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import PendingVerificationDialog from "@/components/student/PendingVerificationDialog";
import { PerformanceInsightButton } from "@/components/student/PerformanceInsightButton";
import { formatTimeSpent } from "@/lib/question-timer";
import { AiPracticeLibrary } from "@/components/student/AiSimilarPractice";
import { stripRichHtmlToText } from "@/lib/richContent";
import { useAuth } from "@/contexts/AuthContext";
import { isStudentFeatureLocked, isStudentPendingVerification } from "@/lib/student-access";
import { buildStudentUnlockPath } from "@/lib/student-unlock";
import { OfflinePackLoader } from "@/components/student/OfflinePractice";
import { loadOfflineQBank } from "@/lib/offline-qbank";
import { matchesQuestionBankFilter, questionBankFilterSearch, readQuestionBankFilter, type QuestionBankFilter } from "@/lib/question-bank-filter";
import {
  applyPendingPreviewLocksToStructure,
  formatDifficultyLabel,
  getQuestionAttempted,
  getQuestionSolved,
  getQuestionDifficultyTone,
  useStudentChapterQuestions,
  useStudentQuestionContent,
  QUESTION_BANK_PAGE_SIZE,
  type StudentQBChapterQuestionsResponse,
  useStudentQuestionBankStructure,
} from "@/pages/student/question-bank/api";

function getQuestionPreview(content: string) {
  const preview = stripRichHtmlToText(content);
  return preview || "Image-based question";
}

export default function StudentQuestionBankChapterPage() {
  const { examId, subjectId, chapterId } = useParams<{ examId: string; subjectId: string; chapterId: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isPreviewMode = isStudentPendingVerification(user);
  const isQuestionBankFeatureLocked = isStudentFeatureLocked(user, "question-bank");
  const filterAttempted = readQuestionBankFilter(useSearch());
  const chapterPath = `/student/question-bank/exam/${examId}/subject/${subjectId}/chapter/${chapterId}`;
  const setFilterAttempted = (filter: QuestionBankFilter) => navigate(`${chapterPath}${questionBankFilterSearch(filter)}`);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(0);

  // Structure gives us subjects/chapters metadata (fast, no questions)
  const { data: liveStructure, isLoading: structureLoading } = useStudentQuestionBankStructure(examId);
  const structure = useMemo(() => {
    if (!liveStructure) return null;
    return isPreviewMode ? applyPendingPreviewLocksToStructure(liveStructure) : liveStructure;
  }, [isPreviewMode, liveStructure]);

  const chapterIdNum = parseInt(chapterId, 10);

  // Questions are fetched lazily for this specific chapter only
  const { data: questionsData, isLoading: indexLoading, isError: indexError, refetch: retryIndex } = useStudentChapterQuestions(
    chapterIdNum,
    Boolean(structure), // only fetch questions once structure is loaded and not locked
  );
  const allQuestions = questionsData?.questions ?? [];
  const hasStarterQuestions = allQuestions.some(question => question.difficulty?.trim().toLowerCase() === "starter");
  const activeFilter = filterAttempted === "starter" && !hasStarterQuestions ? "all" : filterAttempted;
  const filteredQuestions = allQuestions.filter(question => matchesQuestionBankFilter(question, activeFilter));
  const questionPath = (id: number) => `${chapterPath}/question/${id}${questionBankFilterSearch(activeFilter)}`;
  const pageCount = Math.max(1, Math.ceil(filteredQuestions.length / QUESTION_BANK_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageEntries = filteredQuestions.slice(currentPage * QUESTION_BANK_PAGE_SIZE, (currentPage + 1) * QUESTION_BANK_PAGE_SIZE);
  const { data: pageContent, isLoading: contentLoading, isError: contentError, refetch: retryContent } = useStudentQuestionContent(
    chapterIdNum, pageEntries.map(question => question.id), Boolean(structure),
  );
  const questionsLoading = indexLoading || contentLoading;
  const visibleQuestions = pageEntries.flatMap(entry => {
    const content = pageContent?.questions.find(question => question.id === entry.id);
    return content ? [{ ...content, progress: entry.progress, isSaved: entry.isSaved, timeSpentSeconds: entry.timeSpentSeconds }] : [];
  });
  useEffect(() => { setPage(0); }, [chapterIdNum, filterAttempted]);
  useEffect(() => {
    if (questionsData && !hasStarterQuestions && filterAttempted === "starter") setFilterAttempted("all");
  }, [questionsData, hasStarterQuestions, filterAttempted]);
  const saveMutation = useMutation({
    mutationFn: async (questionId: number) =>
      api.post<{ saved: boolean }>(`/question-bank-questions/${questionId}/save`),
    onSuccess: ({ saved }, id) => {
      queryClient.invalidateQueries({ queryKey: ["student-question-bank-saved-count"] });
      queryClient.invalidateQueries({ queryKey: ["student-question-bank-saved-questions"], refetchType: "none" });
      queryClient.setQueriesData<StudentQBChapterQuestionsResponse>({ queryKey: ["student-qb-chapter-questions", chapterIdNum] },
        data => data ? { ...data, questions: data.questions.map(item => item.id === id ? { ...item, isSaved: saved } : item) } : data);
      toast({
        title: saved ? "Question bookmarked" : "Bookmark removed",
        description: saved ? "Question saved to your question bank." : "Question removed from your saved list.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not update bookmark", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = structureLoading;

  const exam = structure?.exam;
  const subject = structure?.subjects.find((entry) => String(entry.id) === subjectId);
  const chapterMeta = subject?.chapters.find((entry) => String(entry.id) === chapterId);

  useEffect(() => {
    if (!isQuestionBankFeatureLocked || !exam || !subject || !chapterMeta) return;
    navigate(buildStudentUnlockPath({
      feature: "question-bank",
      kind: "chapter",
      label: chapterMeta.title,
      examLabel: exam.label,
      subjectLabel: subject.title,
      returnTo: `/student/question-bank/exam/${examId}/subject/${subjectId}/chapter/${chapterId}`,
    }));
  }, [chapterMeta, chapterId, exam, examId, isQuestionBankFeatureLocked, navigate, subject, subjectId]);

  if (isLoading) {
    return <div className="py-20 text-center text-muted-foreground">Loading chapter...</div>;
  }

  if (!exam || !subject || !chapterMeta) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Not found.{" "}
        <Link to="/student/question-bank" className="text-primary underline">
          Go home
        </Link>
      </div>
    );
  }

  if (isQuestionBankFeatureLocked) {
    return <div className="py-20 text-center text-muted-foreground">Redirecting to unlock payment...</div>;
  }

  if (subject.isLocked || chapterMeta.isLocked) {
    return (
      <>
        <div className="space-y-6">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Link to={`/student/question-bank/exam/${examId}/subject/${subjectId}`}>
              <button className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            </Link>
          </div>

          <div className="rounded-2xl border border-[#F3D39A] bg-[linear-gradient(180deg,#FFF8ED_0%,#FFFFFF_100%)] p-6 shadow-sm">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#F3D39A] bg-[#FFF2D8] px-3 py-1 text-xs font-semibold text-[#B45309]">
                <Lock className="h-3.5 w-3.5" />
                Locked chapter
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">{chapterMeta.title}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                  Only one chapter inside the unlocked subject stays open in review mode. Complete verification to access the rest.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="rounded-full bg-[#F59E0B] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#EA580C]"
              >
                Unlock after verification
              </button>
            </div>
          </div>
        </div>

        <PendingVerificationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onCheckStatus={() => navigate("/student/pending-approval")}
        />
      </>
    );
  }

  const attemptedFromQuestions = allQuestions.filter((question) => getQuestionAttempted(question)).length;
  // The structure query already has the authoritative chapter-level progress
  // count. Keep the chapter header useful while the lazy question query is
  // loading, and prefer the larger value if an older question-cache payload
  // does not yet include all progress rows.
  const attempted = Math.max(chapterMeta.attemptedCount, attemptedFromQuestions);
  const totalTimeSpent = Math.max(chapterMeta.totalTimeSpentSeconds ?? 0, allQuestions.reduce((sum, question) => sum + (question.timeSpentSeconds ?? 0), 0));
  const totalQ = chapterMeta.questionCount; // from structure (fast)
  const progressPercent = totalQ > 0 ? Math.min(100, Math.round((attempted / totalQ) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Link to={`/student/question-bank/exam/${examId}/subject/${subjectId}`}>
          <button className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Link to="/student/question-bank" className="hover:text-primary">
            Dashboard
          </Link>
          <span>/</span>
          <Link to={`/student/question-bank/exam/${examId}`} className="hover:text-primary">
            {exam.label}
          </Link>
          <span>/</span>
          <Link to={`/student/question-bank/exam/${examId}/subject/${subjectId}`} className="hover:text-primary">
            {subject.title}
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground">{chapterMeta.title}</span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{chapterMeta.title}</h1>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {exam.label} · {subject.title}
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-3 text-center sm:w-auto sm:flex sm:gap-4">
            <div>
              <div className="text-xl font-bold text-foreground sm:text-2xl">{totalQ}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div>
              <div className="text-xl font-bold text-emerald-600 sm:text-2xl">{attempted}</div>
              <div className="text-xs text-muted-foreground">Attempted</div>
            </div>
            <div>
              <div className="text-xl font-bold text-foreground sm:text-2xl">{Math.max(0, totalQ - attempted)}</div>
              <div className="text-xs text-muted-foreground">Remaining</div>
            </div>
          </div>
        </div>
        {totalTimeSpent > 0 ? <div className="mt-3 text-xs text-muted-foreground">Total time spent · <span className="font-semibold tabular-nums text-foreground">{formatTimeSpent(totalTimeSpent)}</span></div> : null}
        {totalQ > 0 ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
              </div>
              <PerformanceInsightButton target={{ source: "question-bank", scope: "chapter", exam: examId, subjectId: subject.id, chapterId: chapterMeta.id, label: chapterMeta.title }} />
            </div>
          </div>
        ) : null}
      </div>

      <div>
        {!questionsLoading && filteredQuestions.length > 0 ? <OfflinePackLoader
          source="question-bank" title={`${subject.title} · ${chapterMeta.title}`}
          context={`qb:${exam.key}:${chapterId}`} exam={exam.key}
          questionIds={filteredQuestions.slice(0,15).map(q=>q.id)}
          load={(ids,signal,onReady)=>loadOfflineQBank(chapterIdNum,ids,exam.key,signal,onReady)}
        /> : null}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Questions
            {!questionsLoading && <span className="ml-2 text-sm font-normal text-muted-foreground">({filteredQuestions.length})</span>}
          </h2>
          <div className="-mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0 sm:pb-0">
            {(["all", "unattempted", "attempted", ...(hasStarterQuestions ? ["starter" as const] : [])] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={activeFilter === filter}
                onClick={() => { setPage(0); setFilterAttempted(filter); }}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                  activeFilter === filter
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {indexError || contentError ? (
          <div className="py-12 text-center text-muted-foreground">
            Could not load questions. <button className="text-primary underline" onClick={() => indexError ? retryIndex() : retryContent()}>Retry</button>
          </div>
        ) : questionsLoading ? (
          <div className="py-12 text-center text-muted-foreground">Loading questions...</div>
        ) : filteredQuestions.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No questions match the filter.</div>
        ) : (
          <div className="space-y-3">
            {visibleQuestions.map((question, index) => {
              const absoluteIndex = currentPage * QUESTION_BANK_PAGE_SIZE + index;
              const isStarterQuestion = String(question.difficulty ?? "").trim().toLowerCase() === "starter";
              const questionNumber = filteredQuestions
                .slice(0, absoluteIndex + 1)
                .filter((item) => (String(item.difficulty ?? "").trim().toLowerCase() === "starter") === isStarterQuestion)
                .length;

              return (
                <div
                  key={question.id}
                  onClick={() => navigate(questionPath(question.id))}
                  className={`group cursor-pointer rounded-xl border p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md ${
                    isStarterQuestion ? "border-sky-200 bg-sky-50/20" : "border-border bg-card"
                  }`}
                >
                  {isStarterQuestion
                    && (index === 0 || String(visibleQuestions[index - 1]?.difficulty ?? "").trim().toLowerCase() !== "starter") ? (
                    <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-800">Starter Questions</div>
                  ) : null}
                  {!isStarterQuestion && hasStarterQuestions
                    && (index === 0 || visibleQuestions[index - 1]?.difficulty?.trim().toLowerCase() === "starter") ? (
                    <div className="mb-3 rounded-lg border border-border bg-muted px-3 py-2 text-sm font-bold">Practice Questions</div>
                  ) : null}
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {getQuestionSolved(question) ? <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="Correct" /> : getQuestionAttempted(question) ? <XCircle className="h-5 w-5 text-red-500" aria-label="Wrong" /> : <Circle className="h-5 w-5 text-muted-foreground/50" aria-label="Not visited" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`text-xs font-semibold ${isStarterQuestion ? "text-sky-700" : "text-muted-foreground"}`}>
                        Q{questionNumber}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getQuestionDifficultyTone(question.difficulty)}`}>
                        {formatDifficultyLabel(question.difficulty)}
                      </span>
                      {question.topicTag ? (
                        <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                          <Tag className="h-2.5 w-2.5" />
                          {question.topicTag}
                        </span>
                      ) : null}
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        {question.points ?? 1} {(question.points ?? 1) === 1 ? "mark" : "marks"}
                      </span>
                      {(question.timeSpentSeconds ?? 0) > 0 ? <span className="text-[10px] text-muted-foreground">Time spent · {formatTimeSpent(question.timeSpentSeconds!)}</span> : null}
                      {!isPreviewMode ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            saveMutation.mutate(question.id);
                          }}
                          disabled={saveMutation.isPending}
                          className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                            question.isSaved
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-border bg-card text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                          }`}
                          title={question.isSaved ? "Remove bookmark" : "Bookmark this question"}
                          aria-label={question.isSaved ? "Remove bookmark" : "Bookmark this question"}
                        >
                          {question.isSaved ? <BookmarkCheck className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
                          {question.isSaved ? "Saved" : "Save"}
                        </button>
                      ) : null}
                    </div>
                    <p className="line-clamp-2 break-words text-sm text-foreground">{getQuestionPreview(question.question)}</p>
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        )}

        {filteredQuestions.length > QUESTION_BANK_PAGE_SIZE && (
          <div className="mt-5 flex items-center justify-between gap-3 text-sm">
            <button className="rounded-lg border px-4 py-2 disabled:opacity-40" disabled={currentPage === 0 || questionsLoading} onClick={() => setPage(currentPage - 1)}>Previous</button>
            <span className="text-muted-foreground">{currentPage * QUESTION_BANK_PAGE_SIZE + 1}–{Math.min((currentPage + 1) * QUESTION_BANK_PAGE_SIZE, filteredQuestions.length)} of {filteredQuestions.length}</span>
            <button className="rounded-lg border px-4 py-2 disabled:opacity-40" disabled={currentPage + 1 >= pageCount || questionsLoading} onClick={() => setPage(currentPage + 1)}>Next</button>
          </div>
        )}

        {!questionsLoading && filteredQuestions.length > 0 && !allQuestions.every((question) => getQuestionAttempted(question)) ? (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => {
                const firstUnattempted = filteredQuestions.find((question) => !getQuestionAttempted(question));
                if (firstUnattempted) {
                  navigate(questionPath(firstUnattempted.id));
                }
              }}
              className="w-full rounded-xl bg-primary px-8 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 sm:w-auto"
            >
              Start Practising
            </button>
          </div>
        ) : null}
      </div>
      {!isPreviewMode ? <AiPracticeLibrary source="question-bank" exam={exam.label} subject={subject.title} chapter={chapterMeta.title} /> : null}
    </div>
  );
}
