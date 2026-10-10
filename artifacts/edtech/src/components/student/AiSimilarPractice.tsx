import { useEffect, useState } from "react";
import CircuitDiagram, { type Diagram } from "./PracticeDiagram";
import { ArrowUp, Bookmark, BookmarkCheck, CheckCircle2, LoaderCircle, MoreHorizontal, Sparkles, Trash2, XCircle } from "lucide-react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Difficulty = "easy" | "mid" | "hard";
type Context = { source: "pyq" | "question-bank"; exam?: string; subject?: string; chapter?: string; sourceQuestionId?: number };
type Seed = Context & { sourceQuestionId: number; chapter: string; question: string; options: string[]; questionType: "mcq" | "multi" | "integer"; hasDiagram?: boolean; previousDifficulty?: Difficulty };

type SimilarQuestion = Seed & {
  id: number; difficulty: Difficulty; correctAnswer: number | null; correctAnswerMulti: number[];
  answerText: string | null; explanation: string; diagram?: Diagram | null; isSaved: boolean;
  solvedAt?: number | null; lastAnswer?: number | number[] | string | null;
};
type Page = { questions: SimilarQuestion[]; nextCursor: number | null };
const levels: Difficulty[] = ["easy", "mid", "hard"];
const label = (level: Difficulty) => level === "mid" ? "Mid" : level === "hard" ? "Hard" : "Easy";

function usePracticeAccess() {
  const { user } = useAuth();
  const status = useQuery<{ aiAccess?: boolean; priorityAccess?: boolean }>({
    queryKey: ["ai-practice-access", user?.id], enabled: user?.role === "student",
    queryFn: () => api.get("/auth/registration-status"), refetchInterval: 15000, staleTime: 5000,
  });
  const allowed = user?.role === "student" && (status.data
    ? Boolean(status.data.aiAccess || status.data.priorityAccess)
    : Boolean(user.priorityAccess || (user as { aiAccess?: boolean }).aiAccess));
  return { allowed, userId: user?.id };
}

function useCreatePractice(seed?: Seed, onCreated?: (question: SimilarQuestion) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (difficulty: Difficulty) => {
      if (!seed) throw new Error("Choose a source question first.");
      // Keep the request limited to the source-question fields. Generated rows
      // also contain answer/review fields that must never be sent back as input.
      return api.post<{ question: SimilarQuestion }>("/ai/similar-question", {
        source: seed.source,
        sourceQuestionId: Number(seed.sourceQuestionId) > 0 ? Number(seed.sourceQuestionId) : undefined,
        exam: seed.exam || "AI Practice",
        subject: seed.subject,
        chapter: seed.chapter,
        question: seed.question,
        options: seed.options,
        questionType: seed.questionType,
        hasDiagram: Boolean(seed.hasDiagram),
        previousDifficulty: seed.previousDifficulty,
        difficulty,
      });
    },
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ["ai-similar-questions"] });
      client.invalidateQueries({ queryKey: ["ai-similar-latest"] });
      onCreated?.(result.question);
    },
  });
}

function GeneratedCard({ item, onCreated, libraryMode = false, autoExpand = false, onOpen, onDeleted }: { item: SimilarQuestion; onCreated?: (question: SimilarQuestion) => void; libraryMode?: boolean; autoExpand?: boolean; onOpen?: () => void; onDeleted?: () => void }) {
  const [answer, setAnswer] = useState<number | number[] | string | null>(item.lastAnswer ?? null);
  const [showReview, setShowReview] = useState(item.lastAnswer != null);
  const [expanded, setExpanded] = useState(autoExpand);
  const [isSaved, setIsSaved] = useState(Boolean(item.isSaved));
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["ai-similar-questions"] });
    void client.invalidateQueries({ queryKey: ["ai-similar-latest"] });
  };
  const save = useMutation<{ saved: boolean }, Error>({
    mutationFn: () => api.post<{ saved: boolean }>(`/ai/similar-question/${item.id}/save`),
    onSuccess: ({ saved }) => {
      setIsSaved(saved);
      refresh();
    },
    onError: () => setIsSaved(Boolean(item.isSaved)),
  });
  const remove = useMutation({ mutationFn: () => api.delete(`/ai/similar-question/${item.id}`), onSuccess: () => { void refresh(); onDeleted?.(); } });
  const attempt = useMutation({
    mutationFn: () => api.post<{ isCorrect: boolean }>(`/ai/similar-question/${item.id}/attempt`, { answer }),
    onSuccess: () => { setShowReview(true); void refresh(); },
  });
  const create = useCreatePractice({
    source: item.source,
    sourceQuestionId: Number(item.sourceQuestionId) > 0 ? Number(item.sourceQuestionId) : item.id,
    exam: item.exam || "AI Practice",
    subject: item.subject,
    chapter: item.chapter,
    question: item.question,
    options: item.options,
    questionType: item.questionType,
    hasDiagram: Boolean(item.diagram),
    previousDifficulty: item.difficulty,
  }, onCreated);
  const nextLevel = item.difficulty === "easy" ? "mid" : item.difficulty === "mid" ? "hard" : null;
  const isCorrect = attempt.data?.isCorrect ?? (item.questionType === "multi"
    ? Array.isArray(answer) && answer.length === item.correctAnswerMulti.length && answer.every((v) => item.correctAnswerMulti.includes(v))
    : item.questionType === "integer" ? answer !== null && Math.abs(Number(answer) - Number(item.answerText)) <= 1e-9 : answer === item.correctAnswer);
  const canLevelUp = Boolean(item.solvedAt || (showReview && isCorrect));
  const ready = item.questionType === "multi" ? Array.isArray(answer) && answer.length > 0 : answer !== null && String(answer).trim() !== "";
  const answerLabel = item.questionType === "integer" ? item.answerText : (item.questionType === "multi" ? item.correctAnswerMulti : [item.correctAnswer!]).map((index) => String.fromCharCode(65 + index)).join(", ");
  const error = attempt.error || save.error || remove.error || create.error;

  return <article className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-foreground sm:p-5">
    <div className="mb-3 flex items-center gap-2">
      <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-600 dark:text-violet-300">{label(item.difficulty)}</span>
      {item.solvedAt ? <CheckCircle2 aria-label="Solved" className="h-4 w-4 text-emerald-500" /> : null}
      {libraryMode ? <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300" aria-label="Delete AI question" title="Delete AI question">
        {remove.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete
      </button> : <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-60" aria-label={isSaved ? "Unsave AI question" : "Save AI question"}>
        {save.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : isSaved ? <BookmarkCheck className="h-4 w-4 text-amber-500" /> : <Bookmark className="h-4 w-4" />}{isSaved ? "Saved" : "Save"}
      </button>}
    </div>
    <div role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen} onKeyDown={onOpen ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } } : undefined} className={onOpen ? "cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet-500" : undefined} title={onOpen ? "Open question" : undefined}>
      <RichQuestionContent content={item.question} className="text-sm leading-7" />
    </div>
    {!onOpen ? <div className="mt-3 flex flex-wrap items-center gap-3">
      {!autoExpand ? <button type="button" onClick={() => setExpanded(!expanded)} className="text-sm font-semibold text-violet-600 dark:text-violet-300" aria-expanded={expanded}>{expanded ? "Collapse practice" : "Solve question"}</button> : null}
      {canLevelUp && nextLevel ? <Button variant="outline" size="sm" className="gap-1.5 text-violet-600 dark:text-violet-300" disabled={create.isPending} onClick={() => create.mutate(nextLevel)}>{create.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}Level up to {label(nextLevel)}</Button> : null}
    </div> : null}
    {expanded ? <div className="mt-3">
      <CircuitDiagram diagram={item.diagram} />
      {item.questionType === "integer" ? <input aria-label="Numeric answer" inputMode="decimal" value={typeof answer === "string" || typeof answer === "number" ? answer : ""} disabled={attempt.isPending} onChange={(event) => { setAnswer(event.target.value); setShowReview(false); }} placeholder="Enter numeric answer" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        : <div className="space-y-2">{item.questionType === "multi" ? <p className="text-xs text-muted-foreground">Select all correct options.</p> : null}{item.options.map((option, index) => {
          const selected = Array.isArray(answer) ? answer.includes(index) : answer === index;
          return <button type="button" key={index} aria-pressed={selected} disabled={attempt.isPending} onClick={() => { setAnswer(item.questionType === "multi" ? (Array.isArray(answer) && answer.includes(index) ? answer.filter((v) => v !== index) : [...(Array.isArray(answer) ? answer : []), index]) : index); setShowReview(false); }} className={`flex w-full items-start gap-2 rounded-xl border p-3 text-left text-sm ${selected ? "border-violet-500 bg-violet-500/10" : "border-border bg-background"}`}><span className="font-bold">{String.fromCharCode(65 + index)}.</span><RichQuestionContent content={option} className="min-w-0" /></button>;
        })}</div>}
      <Button className="mt-3" size="sm" disabled={!ready || attempt.isPending || showReview} onClick={() => attempt.mutate()}>{attempt.isPending ? "Checking…" : "Check answer"}</Button>
      {showReview ? <div className="mt-4 rounded-xl bg-muted/40 p-3 text-sm">
        <p className={`flex items-center gap-2 font-semibold ${isCorrect ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{isCorrect ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{isCorrect ? "Correct! Ready for the next challenge?" : "Try again after reviewing the solution."}</p>
        <p className="my-2 font-semibold">Correct answer: {answerLabel}</p>
        <RichQuestionContent content={item.explanation} className="leading-7" />
      </div> : null}
    </div> : null}
    {canLevelUp && !nextLevel ? <p className="mt-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400">Hard challenge completed!</p> : null}
    {create.isSuccess ? <p role="status" className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">Level up complete — your {label(nextLevel ?? item.difficulty)} challenge is ready. Save it to add it to your chapter.</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{(error as Error).message}</p> : null}
  </article>;
}

export function AiPracticeLibrary({ source, exam, subject, chapter, sourceQuestionId, savedOnly = true, revealEmpty = false, embedded = false, onQuestionsChange }: Context & { savedOnly?: boolean; revealEmpty?: boolean; embedded?: boolean; onQuestionsChange?: (count: number) => void }) {
  const { allowed, userId } = usePracticeAccess();
  const [openQuestion, setOpenQuestion] = useState<SimilarQuestion | null>(null);
  const params = new URLSearchParams({ source });
  if (exam) params.set("exam", exam);
  if (subject) params.set("subject", subject);
  if (chapter) params.set("chapter", chapter);
  if (sourceQuestionId) params.set("sourceQuestionId", String(sourceQuestionId));
  params.set("saved", "1");
  const query = useInfiniteQuery({
    queryKey: ["ai-similar-questions", userId, params.toString()], enabled: allowed,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => api.get<Page>(`/ai/similar-question?${params}${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (page) => page.nextCursor ?? undefined, staleTime: 10000,
  });
  const questions = query.data?.pages.flatMap((page) => page.questions) ?? [];
  useEffect(() => {
    if (!query.isLoading && !query.isFetching && !query.isError) onQuestionsChange?.(questions.length);
  }, [onQuestionsChange, query.isError, query.isFetching, query.isLoading, questions.length]);
  if (!allowed || (!revealEmpty && !questions.length && !query.isError)) return null;
  return <><section className={embedded ? "mt-2 space-y-3 pt-1" : "mt-6 space-y-3 border-t-2 border-dashed border-violet-500/30 pt-5"}>
    <div><h2 className="flex items-center gap-2 text-base font-semibold text-foreground"><Sparkles className="h-4 w-4 text-violet-500" />{savedOnly ? "Saved AI practice" : "Your AI practice"}</h2><p className="mt-1 text-xs text-muted-foreground">Only visible to you · {savedOnly ? "Your bookmarked challenges" : "Kept separately from the chapter question bank"}</p></div>
    {query.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading your practice…</p> : null}
    {query.isError ? <p role="alert" className="text-sm text-rose-600">{(query.error as Error).message} <button onClick={() => query.refetch()} className="underline">Retry</button></p> : null}
    {!query.isLoading && !query.isError && !questions.length ? <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">{savedOnly ? "Save an AI question to find it here." : "Open a chapter question and tap Practice similar to create your first Easy challenge."}</p> : null}
    {questions.map((item) => <GeneratedCard key={item.id} item={item} libraryMode onOpen={() => setOpenQuestion(item)} />)}
    {query.hasNextPage ? <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>{query.isFetchingNextPage ? "Loading…" : "Load more AI questions"}</Button> : null}
  </section><Dialog open={Boolean(openQuestion)} onOpenChange={(open) => { if (!open) setOpenQuestion(null); }}><DialogContent className="min-w-0 max-h-[calc(100dvh-1rem)] max-w-3xl overflow-x-auto overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-2rem)]"><DialogHeader className="sr-only"><DialogTitle>AI practice question</DialogTitle><DialogDescription>Solve your AI practice question</DialogDescription></DialogHeader>{openQuestion ? <GeneratedCard key={openQuestion.id} item={openQuestion} libraryMode={Boolean(openQuestion.isSaved)} autoExpand onCreated={setOpenQuestion} onDeleted={() => setOpenQuestion(null)} /> : null}</DialogContent></Dialog></>;
}

export default function AiSimilarPractice(props: Seed & { solved?: boolean; mobileMenu?: boolean }) {
  const { allowed, userId } = usePracticeAccess();
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [opened, setOpened] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<SimilarQuestion | null>(null);
  const openKey = `ai-practice-open:${props.source}:${props.sourceQuestionId}`;
  const create = useCreatePractice(props);
  const latestParams = new URLSearchParams({ source: props.source, exam: props.exam || "AI Practice", subject: props.subject || "", chapter: props.chapter });
  latestParams.set("sourceQuestionId", String(props.sourceQuestionId));
  latestParams.set("view", "current");
  const latest = useQuery<Page>({
    queryKey: ["ai-similar-latest", userId, props.source, props.sourceQuestionId],
    enabled: allowed && opened,
    queryFn: () => api.get<Page>(`/ai/similar-question?${latestParams}`),
    staleTime: 10000,
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    setOpened(window.sessionStorage.getItem(openKey) === "1");
  }, [openKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (opened) window.sessionStorage.setItem(openKey, "1");
    else window.sessionStorage.removeItem(openKey);
  }, [openKey, opened]);
  useEffect(() => {
    if (!activeQuestion && !create.isPending && !create.isError && latest.data?.questions[0]) {
      setActiveQuestion(latest.data.questions[0]);
    }
  }, [activeQuestion, create.isError, create.isPending, latest.data]);
  useEffect(() => {
    if (create.data?.question) setActiveQuestion(create.data.question);
  }, [create.data]);
  if (!allowed) return null;
  const triggerPractice = () => {
    setOpened(true);
    setActiveQuestion(null);
    create.reset();
    create.mutate(difficulty);
  };
  return <>
    {props.mobileMenu ? (
      <button type="button" onClick={triggerPractice} disabled={create.isPending} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium outline-none transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50">
        {create.isPending ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-500" /> : <Sparkles className="h-4 w-4 text-violet-500" />}
        AI practice
      </button>
    ) : <div className="flex items-center gap-1.5">
      <Tooltip><TooltipTrigger asChild><button type="button" title={`Practice similar · ${label(difficulty)}`} aria-label={`Generate ${label(difficulty)} similar question`} disabled={create.isPending} onClick={() => { setOpened(true); setActiveQuestion(null); create.reset(); create.mutate(difficulty); }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-sm transition hover:scale-105 disabled:opacity-60 sm:h-8 sm:w-8 sm:rounded-xl">{create.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" /> : <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}</button></TooltipTrigger><TooltipContent className="max-w-xs bg-[#111827] text-white"><p>Generate a private {label(difficulty)} AI practice question based on this question.</p></TooltipContent></Tooltip>
      <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Choose practice difficulty" title="Practice difficulty" className="rounded-lg border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-violet-700 hover:bg-violet-200 dark:border-violet-500/50 dark:bg-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/30"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end">{levels.map((level) => <DropdownMenuItem key={level} onSelect={() => setDifficulty(level)}>{label(level)}{level === difficulty ? " ✓" : ""}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    </div>}
    <Dialog open={opened} onOpenChange={setOpened}>
      <DialogContent className="min-w-0 max-h-[calc(100dvh-1rem)] max-w-3xl overflow-x-auto overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-2rem)]">
        <DialogHeader className="sr-only"><DialogTitle>AI practice question</DialogTitle><DialogDescription>Generate a private AI practice question</DialogDescription></DialogHeader>
        {create.isPending && !activeQuestion ? <p role="status" className="text-sm text-muted-foreground">Creating your question and worked solution…</p> : null}
        {create.isError ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{(create.error as Error).message} Click the sparkles icon to retry.</div> : null}
        {!create.isPending && !create.isError && activeQuestion ? <GeneratedCard key={activeQuestion.id} item={activeQuestion} onCreated={setActiveQuestion} /> : null}
        {!create.isPending && !create.isError && !activeQuestion && latest.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading your practice question…</p> : null}
      </DialogContent>
    </Dialog>
  </>;
}
