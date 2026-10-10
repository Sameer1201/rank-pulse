import { useMemo } from "react";
import { ArrowLeft, BookmarkCheck, CheckCircle2, Circle, Tag, XCircle } from "lucide-react";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { stripRichHtmlToText } from "@/lib/richContent";
import { useAuth } from "@/contexts/AuthContext";
import { AiPracticeLibrary } from "@/components/student/AiSimilarPractice";
import { isStudentPendingVerification } from "@/lib/student-access";
import StudentPreviewLockBanner from "@/components/student/StudentPreviewLockBanner";
import { Button } from "@/components/ui/button";
import {
  formatDifficultyLabel,
  getQuestionAttempted,
  getQuestionSolved,
  getQuestionDifficultyTone,
  type StudentSavedQuestion,
  useStudentSavedQuestions,
} from "@/pages/student/question-bank/api";

function getQuestionPreview(content: string) {
  return stripRichHtmlToText(content) || "Image-based question";
}

export default function StudentSavedQuestions() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isPreviewMode = isStudentPendingVerification(user);
  const {
    data,
    isLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useStudentSavedQuestions(!isPreviewMode);
  const savedQuestions = useMemo(() => data?.pages.flatMap((page) => page.questions) ?? [], [data]);

  const saveMutation = useMutation({
    mutationFn: async (questionId: number) =>
      api.post<{ saved: boolean }>(`/question-bank-questions/${questionId}/save`),
    onMutate: async (questionId: number) => {
      const queryKey = ["student-question-bank-saved-questions", user?.id] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<InfiniteData<{
        questions: StudentSavedQuestion[];
        nextCursor: string | null;
      }>>(queryKey);

      if (previous) {
        queryClient.setQueryData<InfiniteData<{
          questions: StudentSavedQuestion[];
          nextCursor: string | null;
        }>>(queryKey, {
          ...previous,
          pages: previous.pages.map((page) => ({
            ...page,
            questions: page.questions.filter((question) => question.id !== questionId),
          })),
        });
      }

      return { previous, queryKey };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-question-bank-saved-count"] });
      queryClient.invalidateQueries({ queryKey: ["student-question-bank-exams"] });
      toast({
        title: "Bookmark removed",
        description: "The question was removed from your saved list.",
      });
    },
    onError: (mutationError: Error, _questionId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({
        title: "Could not update bookmark",
        description: mutationError.message,
        variant: "destructive",
      });
    },
    onSettled: (_data, _error, _questionId, context) => {
      queryClient.invalidateQueries({ queryKey: context?.queryKey ?? ["student-question-bank-saved-questions", user?.id] });
    },
  });

  if (isPreviewMode) {
    return (
      <div className="space-y-6">
        <Header onBack={() => navigate("/student/question-bank")} />
        <StudentPreviewLockBanner
          title="Saved questions are locked"
          description="Your bookmarked questions will be available after your account is approved."
          onCheckStatus={() => navigate("/student/pending-approval")}
          onOpenLocked={() => navigate("/student/pending-approval")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header onBack={() => navigate("/student/question-bank")} />

      <div>
        <div className="flex items-center gap-2">
          <BookmarkCheck className="h-5 w-5 text-amber-600" />
          <h1 className="text-2xl font-bold text-foreground">Saved Questions</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Questions you bookmarked for quick revision.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
          Loading saved questions...
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
          {(error as Error)?.message || "Could not load saved questions."}
        </div>
      ) : savedQuestions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center shadow-sm">
          <BookmarkCheck className="mx-auto h-9 w-9 text-amber-500" />
          <p className="mt-3 font-semibold text-foreground">No bookmarked questions yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap the bookmark icon on any question to save it here.
          </p>
          <Link
            to="/student/question-bank"
            className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Browse Question Bank
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {savedQuestions.map((question) => (
            <div
              key={question.id}
              onClick={() =>
                navigate(
                  `/student/question-bank/exam/${question.examKey}/subject/${question.subjectId}/chapter/${question.chapterId}/question/${question.id}?saved=1`,
                )
              }
              className="group cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md sm:p-5"
              data-testid={`saved-question-${question.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {getQuestionSolved(question) ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="Correct" />
                  ) : getQuestionAttempted(question) ? (
                    <XCircle className="h-5 w-5 text-red-500" aria-label="Wrong" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/50" aria-label="Not visited" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      {question.examLabel}
                    </span>
                    <span className="text-xs text-muted-foreground">{question.subjectTitle}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{question.chapterTitle}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getQuestionDifficultyTone(question.difficulty)}`}>
                      {formatDifficultyLabel(question.difficulty)}
                    </span>
                    {question.topicTag ? (
                      <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        <Tag className="h-2.5 w-2.5" />
                        {question.topicTag}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveMutation.mutate(question.id);
                      }}
                      disabled={saveMutation.isPending}
                      className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
                      title="Remove bookmark"
                      aria-label="Remove bookmark"
                    >
                      <BookmarkCheck className="h-3 w-3" />
                      Remove
                    </button>
                  </div>
                  <p className="line-clamp-2 break-words text-sm text-foreground">
                    {getQuestionPreview(question.question)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {question.points ?? 1} {(question.points ?? 1) === 1 ? "mark" : "marks"} · Click to practise
                  </p>
                </div>
              </div>
            </div>
          ))}
          {hasNextPage && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Loading saved questions..." : "Load more saved questions"}
            </Button>
          )}
        </div>
      )}
      <AiPracticeLibrary source="question-bank" savedOnly />
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </button>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/student/question-bank" className="hover:text-primary">
          My Question Banks
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground">Saved Questions</span>
      </div>
    </div>
  );
}
