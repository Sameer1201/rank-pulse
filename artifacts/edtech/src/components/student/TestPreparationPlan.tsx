import { BookOpen, Clock3, Flag, Target } from "lucide-react";

export interface PreparationPlan {
  totalQuestions: number;
  totalMarks: number;
  coveredMarks: number;
  sessionMinutes: number;
  blocks: {
    subject: string; topics: string[]; marks: number; questionCount: number;
    paperShare: number; practiceCount: number; practiceMinutes: number;
    targetCorrect: number; formats: string[]; technique: string;
  }[];
}

export default function TestPreparationPlan({ plan }: { plan: PreparationPlan }) {
  return <div className="space-y-4 text-foreground">
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Paper coverage</p>
        <p className="mt-1 text-xl font-black">{plan.coveredMarks}<span className="text-xs font-medium text-muted-foreground"> / {plan.totalMarks} marks</span></p>
        <p className="mt-1 text-xs text-muted-foreground">In the areas below</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Suggested session</p>
        <p className="mt-1 text-xl font-black">{plan.sessionMinutes}<span className="text-xs font-medium text-muted-foreground"> min</span></p>
        <p className="mt-1 text-xs text-muted-foreground">Recall → practise → review</p>
      </div>
    </div>

    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><Target className="h-4 w-4 text-orange-500" />Your starting order</div>
    <ol className="space-y-3">
      {plan.blocks.map((block, index) => <li key={block.subject} className="relative rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex items-start gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-600 text-xs font-black text-white">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300">{index === 0 ? "Start here" : "Build next"}</p>
            <h4 className="break-words text-sm font-bold">{block.subject}</h4>
          </div>
          <span className="shrink-0 text-sm font-black text-orange-600 dark:text-orange-300">{block.paperShare}%<span className="block text-[9px] font-medium text-muted-foreground">of marks</span></span>
        </div>
        <div className="my-2.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-orange-400" style={{ width: `${block.paperShare}%` }} /></div>
        <p className="text-xs text-muted-foreground">{block.questionCount} questions · {block.marks} marks · {block.formats.join(" / ")}</p>
        {block.topics.length ? <div className="mt-2 flex flex-wrap gap-1.5">{block.topics.map((topic) => <span key={topic} className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium">{topic}</span>)}</div> : null}
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/60 p-2.5 text-xs">
          <p><Clock3 className="mb-1 h-3.5 w-3.5 text-violet-500" /><strong>{block.practiceCount} questions</strong><span className="mt-0.5 block text-muted-foreground">Try in {block.practiceMinutes} min</span></p>
          <p><Flag className="mb-1 h-3.5 w-3.5 text-emerald-500" /><strong>Aim for {block.targetCorrect}/{block.practiceCount} correct</strong><span className="mt-0.5 block text-muted-foreground">Suggested first target</span></p>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">How to practise: </span>{block.technique}</p>
      </li>)}
    </ol>

    <div className="rounded-xl border border-border bg-card p-3">
      <p className="flex items-center gap-2 text-xs font-bold"><BookOpen className="h-4 w-4 text-violet-500" />Make this session count</p>
      <ol className="mt-3 space-y-2 text-xs leading-relaxed">
        <li><strong>1. Recall · 10 min</strong><p className="text-muted-foreground">Write the key formulas and concepts for the topics above from memory.</p></li>
        <li><strong>2. Practise · {Math.max(0, plan.sessionMinutes - 20)} min</strong><p className="text-muted-foreground">Work through each block before opening hints or solutions. Mark anything you guessed.</p></li>
        <li><strong>3. Review · 10 min</strong><p className="text-muted-foreground">For every miss, record: concept gap, calculation error or time pressure. Re-solve it unaided.</p></li>
      </ol>
      <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed"><strong>Next decision: </strong>Below your target? Revise that topic and try a fresh set. At target? Move to the next area, then take a timed mixed set.</p>
    </div>
  </div>;
}
