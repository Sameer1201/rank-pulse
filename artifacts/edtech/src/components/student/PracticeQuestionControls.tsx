import { ArrowLeft, ArrowRight, Check, CheckCircle2, Trophy, XCircle } from "lucide-react";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { looksLikeRichHtmlContent } from "@/lib/richContent";
import { reflowPracticeQuestion } from "@/lib/practice-question-content";
import { useMemo } from "react";

export const practiceCardClass = "relative rounded-xl border border-border bg-card p-3 shadow-sm sm:p-6";
export const practiceHeaderClass = "practice-sticky-header -mx-3 -mt-3 mb-3 rounded-t-xl border-b border-border bg-card px-3 pb-2.5 pt-3 sm:mx-0 sm:mt-0 sm:mb-4 sm:rounded-none sm:bg-transparent sm:px-0 sm:pb-3 sm:pt-0";

export function PracticeQuestionText({ content }: { content: string }) {
  const flowingContent = useMemo(() => reflowPracticeQuestion(content), [content]);
  // Source HTML indentation is not question spacing. Plain-text line breaks
  // and semantic paragraphs, tables, figures and equations remain intact.
  const whitespace = looksLikeRichHtmlContent(flowingContent) ? "whitespace-normal [&_p]:whitespace-normal [&_div]:whitespace-normal" : "";
  return <RichQuestionContent content={flowingContent} className={`w-full text-sm font-medium leading-6 text-foreground sm:text-base sm:leading-relaxed ${whitespace}`} />;
}

type AnswerFieldsProps = {
  questionId: number;
  questionType: "mcq" | "multi" | "integer";
  options: string[];
  optionImages?: (string | null)[] | null;
  selected: number | null;
  selectedMulti: number[];
  integerAnswer: string;
  revealed: boolean;
  correctIndexes: number[];
  onSelect: (index: number) => void;
  onIntegerChange: (value: string) => void;
};

export function PracticeAnswerFields({ questionId, questionType, options, optionImages, selected, selectedMulti, integerAnswer, revealed, correctIndexes, onSelect, onIntegerChange }: AnswerFieldsProps) {
  if (questionType === "integer") return <div className="mt-6"><input type="text" inputMode="decimal" value={integerAnswer} onChange={event => !revealed && onIntegerChange(event.target.value)} placeholder="Enter numeric answer" aria-label="Numeric answer" className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" disabled={revealed} /></div>;
  const multi = questionType === "multi";
  return <div className="mt-6 space-y-2.5">
    {multi ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><p className="font-medium text-sky-700 dark:text-sky-300">{revealed ? "MSQ · Submitted answer (locked)" : "MSQ · Select all correct options"}</p><span role="status" className="text-muted-foreground">{selectedMulti.length} selected</span></div> : null}
    {options.map((option, index) => {
      const chosen = multi ? selectedMulti.includes(index) : selected === index;
      const right = revealed && correctIndexes.includes(index);
      const wrong = revealed && chosen && !right;
      const tone = right ? "border-emerald-400 bg-emerald-50 font-medium text-emerald-700" : wrong ? "border-red-400 bg-red-50 text-red-700" : revealed ? "border-border bg-card text-muted-foreground" : chosen ? "border-primary bg-primary/5 font-medium text-primary" : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/3";
      return <button type="button" key={`${questionId}-${index}`} role={multi ? "checkbox" : undefined} aria-checked={multi ? chosen : undefined} aria-pressed={!multi ? chosen : undefined} aria-label={multi ? `Option ${String.fromCharCode(65 + index)}` : undefined} aria-describedby={`practice-option-${questionId}-${index}`} disabled={revealed} onClick={() => !revealed && onSelect(index)} className={`w-full cursor-pointer rounded-xl border p-3.5 text-left text-sm transition-all disabled:cursor-default ${tone}`}>
        <div className="flex items-start gap-3">
          {multi ? <><span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${chosen ? "border-primary bg-primary text-primary-foreground" : "border-current bg-card"}`}>{chosen ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}</span><span aria-hidden="true" className="mt-0.5 shrink-0 text-xs font-semibold">{String.fromCharCode(65 + index)}.</span></> : <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold">{String.fromCharCode(65 + index)}</span>}
          <div id={`practice-option-${questionId}-${index}`} className="min-w-0 flex-1 space-y-2">{optionImages?.[index] ? <img src={optionImages[index]!} alt={`Option ${String.fromCharCode(65 + index)}`} className="max-h-32 max-w-full rounded-md object-contain sm:max-h-44" /> : null}<RichQuestionContent content={option} className="text-sm leading-6 sm:text-base sm:leading-7 [&_img]:mx-auto [&_img]:w-auto [&_img]:max-h-[12rem] sm:[&_img]:max-h-[18rem]" /></div>
          {right ? <CheckCircle2 className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : wrong ? <XCircle className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : null}
        </div>
      </button>;
    })}
  </div>;
}

export function PracticeAnswerReview({ isCorrect, answerLabel, answerContent, explanation }: { isCorrect: boolean; answerLabel: string; answerContent?: string | null; explanation?: string | null }) {
  return <div className={`mt-4 rounded-xl border p-4 ${isCorrect ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100" : "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"}`} role="status" data-practice-answer-review>
    <div className="flex items-center gap-2 text-sm font-semibold">{isCorrect ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{isCorrect ? "Correct! Well done." : "Incorrect"}</div>
    {!isCorrect ? <div className="mt-1 text-sm">Correct answer: <span className="font-semibold">{answerLabel}</span>{answerContent ? <RichQuestionContent content={answerContent} className="mt-1 font-semibold" /> : null}</div> : null}
    {explanation ? <div className="mt-3 border-t border-current/15 pt-3 text-sm"><p className="mb-1 font-semibold">Explanation</p><RichQuestionContent content={explanation} /></div> : null}
  </div>;
}

export function PracticeActionBar({ revealed, canSubmit, pending = false, hasPrevious, hasNext, streak = 0, onPrevious, onNext, onFinish, onSubmit }: { revealed: boolean; canSubmit: boolean; pending?: boolean; hasPrevious: boolean; hasNext: boolean; streak?: number; onPrevious: () => void; onNext: () => void; onFinish: () => void; onSubmit: () => void }) {
  const navigationClass = "flex min-h-12 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0";
  return <>
    <div className="h-[calc(4.75rem+env(safe-area-inset-bottom)+1.5rem)] sm:hidden" />
    <div data-practice-action-bar className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.85rem)] pt-3 shadow-[0_-10px_24px_rgba(15,23,42,0.06)] backdrop-blur sm:static sm:inset-x-auto sm:bottom-auto sm:z-auto sm:border-t-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0 sm:shadow-none sm:backdrop-blur-0">
      {streak > 0 ? <div className="mb-2 flex justify-center sm:justify-end"><div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300"><Trophy className="h-3.5 w-3.5" />{streak} in a row</div></div> : null}
      <div className={`grid gap-3 ${revealed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[56px_minmax(0,1fr)_56px]"} sm:flex sm:items-center sm:justify-between`}>
        <button type="button" onClick={onPrevious} disabled={!hasPrevious} className={navigationClass} aria-label="Previous question"><ArrowLeft className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" /><span className="hidden sm:inline">Previous</span></button>
        <button type="button" onClick={revealed ? hasNext ? onNext : onFinish : onSubmit} disabled={!revealed && (!canSubmit || pending)} className="min-h-12 w-full whitespace-nowrap rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0">{revealed ? hasNext ? "Next Question" : "Finish Chapter" : pending ? "Saving…" : "Submit Answer"}</button>
        {!revealed ? <button type="button" onClick={onNext} disabled={!hasNext} className={navigationClass} aria-label="Next question"><span className="hidden sm:inline">Next</span><ArrowRight className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" /></button> : null}
      </div>
    </div>
  </>;
}
