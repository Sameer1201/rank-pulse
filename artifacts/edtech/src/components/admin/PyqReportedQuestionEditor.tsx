import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichQuestionEditor } from "@/components/admin/RichQuestionEditor";
import { RichQuestionContent } from "@/components/ui/rich-question-content";

type Question = {
  id: number; exam: string; subject: string; chapter: string; year: number;
  question: string; questionType: string; options: string[]; correctAnswer: number | null;
  correctAnswerMulti: number[]; answerText: string | null; answerMin: number | null; answerMax: number | null;
  explanation: string | null; imageData: string | null; updatedAt: string;
};
type Report = { questionId: number; exam: string; reason: string };

/** Always load the exact exam/shard's current revision, never the truncated report preview. */
export function PyqReportedQuestionEditor({ report, onClose }: { report: Report; onClose: () => void }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const endpoint = `/pyq/questions/${report.questionId}?exam=${encodeURIComponent(report.exam)}`;
  const [draft, setDraft] = useState<Question | null>(null);
  const [preview, setPreview] = useState(false);
  const query = useQuery({ queryKey: ["pyq-edit", report.exam, report.questionId], queryFn: () => api.get<{ question: Question }>(endpoint, { networkOnly: true }), retry: false, staleTime: 0, refetchOnWindowFocus: false });
  useEffect(() => { if (query.data) setDraft(query.data.question); }, [query.data]);
  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Load the question first");
      return api.patch<{ ok: boolean; regradedStudents: number }>(endpoint, {
        expectedUpdatedAt: draft.updatedAt, question: draft.question, questionType: draft.questionType,
        options: draft.options, correctAnswer: draft.correctAnswer, correctAnswerMulti: draft.correctAnswerMulti,
        answerText: draft.answerText, answerMin: draft.answerMin, answerMax: draft.answerMax, explanation: draft.explanation,
      });
    },
    onSuccess: () => {
      for (const key of ["pyq-reports", "pyq-questions", "pyq-admin-progress", "pyq-progress", "pyq-subjects", "pyq-chapters", "dashboard"]) void client.invalidateQueries({ queryKey: [key] });
      client.removeQueries({ queryKey: ["pyq-edit", report.exam, report.questionId] });
      toast({ title: "Question fixed", description: "Reports resolved. Saved student answers have been checked against the corrected answer." });
      onClose();
    },
  });
  const update = (changes: Partial<Question>) => setDraft(current => current ? { ...current, ...changes } : current);
  const numerical = draft?.questionType === "integer";
  const multi = draft?.questionType === "multi";
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="flex max-h-[92dvh] w-[calc(100vw_-_1.5rem)] max-w-4xl flex-col overflow-hidden p-4 sm:p-6" onEscapeKeyDown={event => { if (save.isPending) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Fix reported PYQ</DialogTitle>
        <DialogDescription>{draft ? `${draft.exam} · ${draft.subject} · ${draft.chapter} · ${draft.year}` : report.exam}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto px-1 pb-2">
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm"><span className="font-semibold">Student report: </span><span className="whitespace-pre-wrap break-words">{report.reason}</span></div>
        {query.isPending ? <p>Loading current question…</p> : query.isError ? <p role="alert" className="text-destructive">{(query.error as Error).message}</p> : null}
        {draft ? <fieldset disabled={save.isPending || query.isFetching} className="min-w-0 space-y-4">
          <label className="block text-sm font-medium">Question type<select aria-label="Question type" className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3" value={draft.questionType} onChange={event => update({ questionType: event.target.value })}><option value="mcq">MCQ — single correct</option><option value="multi">MSQ — multiple correct</option><option value="integer">NAT — numerical</option></select></label>
          <div><h3 className="mb-2 text-sm font-semibold">Question</h3><RichQuestionEditor value={draft.question} onChange={question => update({ question })} ariaLabel="Reported PYQ question" /></div>
          {draft.imageData ? <img src={draft.imageData} alt="Question figure" className="max-h-64 max-w-full rounded-lg object-contain" /> : null}
          {numerical ? <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Enter an exact answer, or both bounds for an accepted range.</p>
            <label className="block text-sm">Exact answer<Input aria-label="Exact answer" inputMode="decimal" value={draft.answerText ?? ""} onChange={event => update({ answerText: event.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3">{(["answerMin", "answerMax"] as const).map((key, index) => <label key={key} className="text-sm">{index ? "Maximum" : "Minimum"}<Input aria-label={index ? "Maximum answer" : "Minimum answer"} type="number" step="any" value={draft[key] ?? ""} onChange={event => update({ [key]: event.target.value === "" ? null : Number(event.target.value) })} /></label>)}</div>
          </div> : <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Select the correct {multi ? "options" : "option"} and edit option text below.</p>
            {draft.options.map((option, index) => <div key={index} className="rounded-lg border p-3">
              <label className="mb-2 flex items-center gap-2 text-sm font-medium"><input aria-label={`Correct option ${String.fromCharCode(65 + index)}`} type={multi ? "checkbox" : "radio"} name="pyq-correct" checked={multi ? draft.correctAnswerMulti.includes(index) : draft.correctAnswer === index} onChange={() => update(multi ? { correctAnswerMulti: draft.correctAnswerMulti.includes(index) ? draft.correctAnswerMulti.filter(v => v !== index) : [...draft.correctAnswerMulti, index] } : { correctAnswer: index })} />Option {String.fromCharCode(65 + index)}</label>
              <RichQuestionEditor compact value={option} ariaLabel={`Reported PYQ option ${String.fromCharCode(65 + index)}`} onChange={value => update({ options: draft.options.map((text, i) => i === index ? value : text) })} />
            </div>)}
            {draft.options.length < 8 ? <Button type="button" variant="outline" onClick={() => update({ options: [...draft.options, ""] })}>Add option</Button> : null}
          </div>}
          <div><h3 className="mb-2 text-sm font-semibold">Solution</h3><RichQuestionEditor value={draft.explanation ?? ""} onChange={explanation => update({ explanation })} ariaLabel="Reported PYQ solution" /></div>
          <Button type="button" variant="outline" onClick={() => setPreview(value => !value)}>{preview ? "Hide preview" : "Preview changes"}</Button>
          {preview ? <div className="space-y-3 rounded-lg border bg-muted/20 p-3"><RichQuestionContent content={draft.question} />{!numerical ? draft.options.map((option, i) => <div key={i}><span>{String.fromCharCode(65 + i)}. </span><RichQuestionContent content={option} /></div>) : <p>Answer: {draft.answerMin != null && draft.answerMax != null ? `${draft.answerMin} – ${draft.answerMax}` : draft.answerText}</p>}<RichQuestionContent content={draft.explanation ?? ""} /></div> : null}
        </fieldset> : null}
        {save.isError ? <p role="alert" className="text-sm text-destructive">{(save.error as Error).message}</p> : null}
        <p className="text-xs text-muted-foreground">Saving resolves open reports for this question and rechecks saved answers. Attempt counts stay unchanged. No question is deleted.</p>
      </div>
      <DialogFooter className="gap-2 border-t pt-3">
        <Button type="button" variant="outline" disabled={save.isPending || query.isFetching} onClick={() => { save.reset(); void query.refetch(); }}>Reload question</Button>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={!draft || save.isPending || query.isFetching || query.isError} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save & resolve report"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
