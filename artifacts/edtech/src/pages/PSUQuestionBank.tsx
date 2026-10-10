import { useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Flag,
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuestionReport } from "@/hooks/use-question-report";

type Subject = {
  exam: string;
  subject: string;
  questionCount: number;
  chapterCount: number;
};
type Question = {
  id: number;
  chapter: string;
  year: number;
  paper: string | null;
  question: string;
  questionType: string;
  options: string[];
  correctAnswer: number | null;
  correctAnswerMulti: number[];
  answerText: string | null;
  explanation: string | null;
  marks: string | null;
  isSaved?: boolean;
};

export default function PSUQuestionBank() {
  const [, navigate] = useLocation();
  const [match, params] = useRoute<{ psuId: string }>(
    "/student/psu/:psuId/question-bank",
  );
  const psuId = Number(params?.psuId);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [chapter, setChapter] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const [reportQuestion, setReportQuestion] = useState<Question | null>(null);
  const [reportReason, setReportReason] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const subjects = useQuery({
    queryKey: ["psu-qbank-subjects", psuId],
    enabled: match,
    queryFn: () => api.get<Subject[]>(`/psus/${psuId}/question-bank/subjects`),
  });
  const questions = useQuery({
    queryKey: [
      "psu-qbank-questions",
      psuId,
      subject?.exam,
      subject?.subject,
      chapter,
      showSaved,
    ],
    enabled: Boolean(subject) || showSaved,
    queryFn: () => {
      if (showSaved)
        return api.get<Question[]>(
          `/psus/${psuId}/question-bank/questions?saved=1`,
        );
      return api.get<Question[]>(
        `/psus/${psuId}/question-bank/questions?exam=${encodeURIComponent(subject!.exam)}&subject=${encodeURIComponent(subject!.subject)}${chapter ? `&chapter=${encodeURIComponent(chapter)}` : ""}`,
      );
    },
  });
  const saveMutation = useMutation({
    mutationFn: (questionId: number) =>
      api.post<{ saved: boolean }>(
        `/psus/${psuId}/question-bank/questions/${questionId}/save`,
      ),
    onSuccess: ({ saved }) => {
      queryClient.invalidateQueries({
        queryKey: ["psu-qbank-questions", psuId],
      });
      toast({
        title: saved ? "Question bookmarked" : "Bookmark removed",
        description: saved
          ? "You can find it in Saved questions."
          : "Removed from Saved questions.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update bookmark",
        description: error.message,
        variant: "destructive",
      }),
  });
  const reportState = useQuestionReport(`/psus/${psuId}/question-bank/questions/${reportQuestion?.id}/report`, Boolean(reportQuestion), () => {
      setReportQuestion(null);
      setReportReason("");
  });
  const reportMutation = reportState.mutation;
  const chapters = [
    ...new Set((questions.data ?? []).map((item) => item.chapter)),
  ];
  const openReport = (question: Question) => {
    setReportQuestion(question);
    setReportReason("");
  };
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => navigate(`/student/psu/${psuId}`)}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to PSU
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            PSU Question Bank
          </h1>
          <p className="text-sm text-slate-500">
            Practice subject-wise PYQ questions.
          </p>
        </div>
        <Button
          className="ml-auto"
          variant={showSaved ? "default" : "outline"}
          onClick={() => {
            setShowSaved((value) => !value);
            setSubject(null);
            setChapter("");
          }}
        >
          <BookmarkCheck className="mr-2 h-4 w-4" /> Saved questions
        </Button>
      </div>
      {showSaved ? (
        <QuestionCards
          questions={questions.data ?? []}
          loading={questions.isLoading}
          onSave={(id) => saveMutation.mutate(id)}
          onReport={openReport}
          emptyText="No bookmarked PSU questions yet."
        />
      ) : !subject ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.data?.map((item) => (
            <button
              type="button"
              key={`${item.exam}-${item.subject}`}
              onClick={() => {
                setSubject(item);
                setChapter("");
              }}
              className="rounded-2xl border border-orange-100 bg-white p-5 text-left shadow-sm hover:border-orange-300"
            >
              <BookOpen className="mb-3 text-orange-600" />
              <h2 className="font-bold text-slate-900">{item.subject}</h2>
              <p className="mt-1 text-sm text-slate-500">{item.exam}</p>
              <p className="mt-3 text-xs font-semibold text-slate-600">
                {item.questionCount} questions · {item.chapterCount} chapters
              </p>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSubject(null)}
            >
              All subjects
            </Button>
            <span className="text-sm font-semibold text-slate-800">
              {subject.subject}
            </span>
            {chapters.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setChapter(chapter === item ? "" : item)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${chapter === item ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-700"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <QuestionCards
            questions={questions.data ?? []}
            loading={questions.isLoading}
            onSave={(id) => saveMutation.mutate(id)}
            onReport={openReport}
            emptyText="No questions found."
          />
        </>
      )}
      <Dialog
        open={Boolean(reportQuestion)}
        onOpenChange={(open) => {
          if (!open) {
            setReportQuestion(null);
            setReportReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report this PSU question?</DialogTitle>
            <DialogDescription>
              Tell the admin what is incorrect in the question, answer or
              explanation.
            </DialogDescription>
          </DialogHeader>
          {reportState.message ? <p role="status" className="text-sm text-muted-foreground">{reportState.message}</p> : null}
          <Textarea
            disabled={reportState.blocked || reportMutation.isPending}
            value={reportReason}
            onChange={(event) => setReportReason(event.target.value)}
            placeholder="Write the issue..."
            rows={4}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReportQuestion(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!reportReason.trim() || reportState.blocked || reportMutation.isPending}
              onClick={() =>
                reportQuestion &&
                reportMutation.mutate({
                  questionId: reportQuestion.id,
                  reason: reportReason.trim(),
                })
              }
            >
              {reportMutation.isPending ? "Sending..." : "Send report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuestionCards({
  questions,
  loading,
  onSave,
  onReport,
  emptyText,
}: {
  questions: Question[];
  loading: boolean;
  onSave: (id: number) => void;
  onReport: (question: Question) => void;
  emptyText: string;
}) {
  if (loading)
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Loading questions...
      </div>
    );
  if (!questions.length)
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        {emptyText}
      </div>
    );
  return (
    <div className="space-y-4">
      {questions.map((item, index) => (
        <div
          key={item.id}
          className="rounded-2xl border border-slate-200 bg-white p-5"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span>Q{index + 1}</span>
            <span>{item.chapter}</span>
            <span>{item.year}</span>
            <span>{item.marks || "1 mark"}</span>
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={item.isSaved ? "secondary" : "outline"}
                onClick={() => onSave(item.id)}
              >
                <span className="mr-1.5">
                  {item.isSaved ? (
                    <BookmarkCheck className="h-3.5 w-3.5" />
                  ) : (
                    <Bookmark className="h-3.5 w-3.5" />
                  )}
                </span>
                {item.isSaved ? "Saved" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onReport(item)}
              >
                <Flag className="mr-1.5 h-3.5 w-3.5 text-rose-500" />
                Report
              </Button>
            </div>
          </div>
          <RichQuestionContent
            content={item.question}
            className="text-sm leading-7 text-slate-800"
          />
          {item.options.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {item.options.map((option, optionIndex) => (
                <div
                  key={optionIndex}
                  className="rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <b>{String.fromCharCode(65 + optionIndex)}.</b>{" "}
                  <RichQuestionContent content={option} className="inline" />
                </div>
              ))}
            </div>
          ) : null}
          {item.explanation ? (
            <details className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-slate-700">
                View explanation
              </summary>
              <RichQuestionContent
                content={item.explanation}
                className="mt-2 text-slate-600"
              />
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}
