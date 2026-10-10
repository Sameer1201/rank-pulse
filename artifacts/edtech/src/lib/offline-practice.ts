import { buildApiUrl } from "./api-origin";
import { addOffline, listOffline, readOffline, writeOffline, updateOffline } from "./offline-store";
import { practiceDeadline, practiceNetworkSlow, practiceNetworkHealthy, weakPracticeConnection, PRACTICE_DOWNLOAD_WAIT_MS } from './practice-network';

export type OfflineAnswer = number | number[] | string;
export type OfflineQuestion = {
  bufferedAt?: number;
  view?: Record<string, unknown>;
  id: number; exam: string; question: string; questionType: string; options: string[];
  imageData?: string | null; optionImages?: (string | null)[]; explanation?: string | null;
  correctAnswer: number | null; correctAnswerMulti?: number[]; answerText?: string | null;
  answerMin?: number | null; answerMax?: number | null;
  timeSpentSeconds?: number; attempted?: boolean; jamSolutionMode?: boolean;
  jamSubmitted?: boolean; jamSubmittedAnswer?: OfflineAnswer | null; jamSubmittedCorrect?: boolean;
};
export type OfflinePack = {
  id: string; userId: number; source: "question-bank" | "pyq"; context: string;
  title: string; createdAt: number; questions: OfflineQuestion[];
};
export type BufferQuestionLoader = (ids:number[],signal?:AbortSignal,onReady?:(question:OfflineQuestion)=>Promise<void>)=>Promise<OfflineQuestion[]>;
export type OfflineAttempt = {
  id: string; userId: number; packId: string; source: OfflinePack["source"];
  questionId: number; exam: string; answer: OfflineAnswer; attemptedAt: number;
  firstSubmissionTime: number | null; jamSolutionMode: boolean;
  isCorrect: boolean | null; status: "pending" | "synced"; error?: string;
};
export const OFFLINE_LIMIT = 15;
export const packKey = (userId: number) => `${userId}:pack`;
export const attemptKey = (userId: number, packId: string, questionId: number) => `${userId}:attempt:${packId}-${questionId}`;
export const offlineChanged = () => window.dispatchEvent(new Event("offline-practice-changed"));
export const getOfflinePack = (userId: number) => readOffline<OfflinePack>(packKey(userId));
export const getOfflineAttempts = (userId: number) => listOffline<OfflineAttempt>(`${userId}:attempt:`);

export function gradeOffline(question: OfflineQuestion, answer: OfflineAnswer): boolean | null {
  if (question.questionType === "integer") {
    const value = Number(String(answer).trim());
    if (!Number.isFinite(value) || !String(answer).trim()) return false;
    if (question.answerMin != null && question.answerMax != null) return value >= question.answerMin && value <= question.answerMax;
    const raw = question.answerMin ?? question.answerMax ?? question.correctAnswer ?? question.answerText;
    if (raw == null || String(raw).trim() === "") return null;
    const expected = Number(raw);
    return Number.isFinite(expected) ? Math.abs(value - expected) < 1e-9 : null;
  }
  const expected = question.questionType === "multi" ? question.correctAnswerMulti ?? [] : [question.correctAnswer];
  if (!expected.length || expected.some(x => x == null)) return null;
  const selected = Array.isArray(answer) ? answer : [Number(answer)];
  return JSON.stringify([...new Set(selected)].sort((a,b) => a-b)) === JSON.stringify([...new Set(expected)].sort((a,b) => Number(a)-Number(b)));
}

/** Images are embedded in the user-scoped pack, not a shared HTTP/API cache. */
async function embedMedia(questions: OfflineQuestion[], signal?: AbortSignal) {
  const media = new Map<string, Promise<string>>();
  let bytes = 0;
  const load = (url: string) => {
    if (/^data:image\//i.test(url)) return Promise.resolve(url);
    if (!media.has(url)) media.set(url, (async () => {
      const parsed = new URL(url, location.href);
      if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Unsupported offline image");
      const blob = await practiceDeadline(async requestSignal=>{
        const response = await fetch(parsed.href, { signal: requestSignal, credentials: parsed.origin === location.origin ? "same-origin" : "omit" });
        if (!response.ok) throw new Error("An image could not be downloaded. Background loading will retry.");
        return response.blob();
      },PRACTICE_DOWNLOAD_WAIT_MS,signal);
      bytes += blob.size;
      if (blob.size > 8_000_000 || bytes > 30_000_000 || !blob.type.startsWith("image/")) throw new Error("Images are too large or unavailable for offline practice");
      return new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
    })());
    return media.get(url)!;
  };
  const html = async (value: string) => {
    if (!/<img\b/i.test(value)) return value;
    const doc = new DOMParser().parseFromString(value, "text/html");
    for (const img of doc.querySelectorAll("img")) {
      if (img.getAttribute("src")) img.setAttribute("src", await load(img.getAttribute("src")!));
      img.removeAttribute("srcset"); img.removeAttribute("loading");
    }
    return doc.body.innerHTML;
  };
  const result: OfflineQuestion[] = [];
  for (const q of questions) result.push({ ...q, question: await html(q.question),
    options: await Promise.all(q.options.map(html)), explanation: q.explanation ? await html(q.explanation) : null,
    imageData: q.imageData ? await load(q.imageData) : null,
    optionImages: await Promise.all((q.optionImages ?? []).map(src => src ? load(src) : null)),
  });
  return result;
}

export async function prepareOfflinePack(input: Omit<OfflinePack, "id" | "createdAt">, isCurrent = () => true) {
  if (!navigator.onLine) throw new Error("Connect to the internet to prepare questions");
  if (!input.questions.length) throw new Error("No questions available to prepare");
  const old = await getOfflinePack(input.userId);
  const selected = input.questions.slice(0, OFFLINE_LIMIT);
  const same = old?.source === input.source && old.context === input.context &&
    JSON.stringify(old.questions.map(q=>q.id)) === JSON.stringify(selected.map(q=>q.id));
  const questions = await embedMedia(selected);
  if (JSON.stringify(questions).length > 40_000_000) throw new Error("This offline pack is too large");
  const pack: OfflinePack = { ...input, questions, id: same ? old!.id : crypto.randomUUID(), createdAt: Date.now() };
  if (!isCurrent()) throw new Error("Offline preparation cancelled");
  await writeOffline(packKey(input.userId), pack);
  offlineChanged();
  return pack;
}

/** Sliding look-ahead window: reuse downloaded questions, fetch only gaps, and
 * persist the current question before waiting for the rest of the buffer. */
export async function prepareOfflineBuffer(
  input: Omit<OfflinePack, "id" | "createdAt" | "questions"> & { questionIds: number[] },
  load: BufferQuestionLoader,
  isCurrent = () => true,
  signal?: AbortSignal,
) {
  if (!navigator.onLine) throw new Error("Connect to the internet to prepare questions");
  const ids = [...new Set(input.questionIds)].slice(0, OFFLINE_LIMIT);
  if (!ids.length) throw new Error("No questions available to prepare");
  const old = await getOfflinePack(input.userId);
  const reuse = old?.source === input.source && old.context === input.context && Date.now()-old.createdAt < 30*86400000;
  const cached = new Map((reuse ? old!.questions : []).filter(q=>ids.includes(q.id)).map(q=>[q.id,q]));
  const {questionIds: _ids, ...metadata} = input;
  const id = reuse ? old!.id : crypto.randomUUID();
  let pack: OfflinePack | undefined;
  const save = async () => {
    if (!isCurrent()||signal?.aborted) throw new Error("Offline preparation cancelled");
    if (!cached.has(ids[0])) return;
    const questions = ids.flatMap(q=>cached.has(q)?[cached.get(q)!]:[]);
    if (JSON.stringify(questions).length > 40_000_000) throw new Error("This offline pack is too large");
    pack = {...metadata,id,createdAt:Date.now(),questions};
    await updateOffline<OfflinePack>(packKey(input.userId),latest=>{
      if(!isCurrent()||signal?.aborted)return latest;
      // Concurrent online submission must survive a background refill.
      if(latest?.id===id)pack={...pack!,questions:pack!.questions.map(q=>{
        const saved=latest.questions.find(item=>item.id===q.id&&item.exam===q.exam);
        return saved?.attempted&&!q.attempted?{...q,attempted:true,timeSpentSeconds:saved.timeSpentSeconds,view:{...q.view,progress:saved.view?.progress},
          jamSubmitted:saved.jamSubmitted,jamSubmittedAnswer:saved.jamSubmittedAnswer,jamSubmittedCorrect:saved.jamSubmittedCorrect}:q;
      })};
      return pack;
    });
    offlineChanged();
  };
  await save();
  const missing = ids.filter(id=>!cached.has(id));
  // Refresh old content after filling gaps, not on every Next click.
  missing.push(...ids.filter(id=>cached.has(id)&&Date.now()-(cached.get(id)!.bufferedAt??old!.createdAt)>5*60000));
  while (missing.length) {
    if (!isCurrent()||signal?.aborted) throw new Error("Offline preparation cancelled");
    // Prioritize the displayed question; refill the look-ahead in small batches.
    const batch = missing.splice(0,cached.has(ids[0])&&!weakPracticeConnection()?4:1);
    const stored=new Set<number>();
    const storeReady=async(q:OfflineQuestion,requestSignal?:AbortSignal)=>{
      if(!batch.includes(q.id)||stored.has(q.id))return;
      if(!isCurrent()||signal?.aborted||requestSignal?.aborted)throw new Error('Offline preparation cancelled');
      const [ready]=await embedMedia([q],requestSignal??signal);
      if(!isCurrent()||signal?.aborted||requestSignal?.aborted)throw new Error('Offline preparation cancelled');
      cached.set(q.id,{...ready,bufferedAt:Date.now()});stored.add(q.id);
      await save();
    };
    const loaded = await practiceDeadline(requestSignal=>load(batch,requestSignal,q=>storeReady(q,requestSignal)),PRACTICE_DOWNLOAD_WAIT_MS,signal);
    if (!isCurrent()||signal?.aborted) throw new Error("Offline preparation cancelled");
    for (const q of loaded.filter(q=>batch.includes(q.id))) {
      // Persist each complete question immediately, not after another question's slow diagram.
      await storeReady(q);
    }
    if (batch.some(id=>!loaded.some(q=>q.id===id))) throw new Error("Some questions could not be loaded. Background loading will retry.");
  }
  return pack!;
}

export async function submitOffline(pack: OfflinePack, question: OfflineQuestion, answer: OfflineAnswer, seconds: number, receiptId?: string, attemptedAt?: number) {
  if (Date.now()-pack.createdAt > 30*86400000) throw new Error("This offline pack has expired. Refresh it online.");
  const existing = await readOffline<OfflineAttempt>(attemptKey(pack.userId,pack.id,question.id));
  if (existing) return existing;
  if ((await getOfflineAttempts(pack.userId)).filter(a=>a.status === "pending").length >= OFFLINE_LIMIT) throw new Error("15 answers are waiting to sync. Connect before attempting more.");
  if (question.jamSubmitted) throw new Error("This question was already submitted");
  const attempt: OfflineAttempt = { id: receiptId ?? `${pack.id}-${question.id}`, userId: pack.userId, packId: pack.id,
    source: pack.source, questionId: question.id, exam: question.exam, answer, attemptedAt: attemptedAt ?? Date.now(),
    firstSubmissionTime: question.attempted || !/gate|jam/i.test(question.exam) ? null : Math.max(0,Math.floor(seconds)),
    jamSolutionMode: Boolean(question.jamSolutionMode), isCorrect: gradeOffline(question,answer), status: "pending" };
  const saved = await addOffline(attemptKey(pack.userId,pack.id,question.id),attempt,{pendingPrefix:`${pack.userId}:attempt:`,count:OFFLINE_LIMIT});
  offlineChanged();
  return saved;
}

class SyncError extends Error { constructor(message: string, public status: number) { super(message); } }
async function syncRequest(path: string, body?: unknown) {
  return practiceDeadline(async signal=>{
  const response = await fetch(buildApiUrl(`/api${path}`), { credentials: "include", signal,
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new SyncError(data.error ?? "Could not sync answer", response.status);
  return data;
  },PRACTICE_DOWNLOAD_WAIT_MS);
}
let syncing: Promise<void> | undefined;
const syncRetryAt = new Map<number,number>();
/** Verify the cookie's user before EACH replay; never send another account's answers. */
export function syncOffline(userId: number) {
  if (syncing) return syncing;
  return syncing = (async () => {
    if (!navigator.onLine || Date.now()<(syncRetryAt.get(userId)??0)) return;
    const pending = (await getOfflineAttempts(userId)).filter(a=>a.status === "pending").sort((a,b)=>a.attemptedAt-b.attemptedAt);
    for (const attempt of pending) {
      try {
        const current = await syncRequest("/auth/me");
        if (Number(current.id) !== userId) throw new SyncError("Sign in to the original account to sync these answers",401);
        if (attempt.firstSubmissionTime !== null) await syncRequest(attempt.source === "pyq" ? `/pyq/questions/${attempt.questionId}/time` : `/question-bank/questions/${attempt.questionId}/time`,
          { exam: attempt.exam, timeSpentSeconds: attempt.firstSubmissionTime, offlineUserId: userId, offlineSubmissionId: attempt.id, attemptedAt: attempt.attemptedAt });
        const endpoint = attempt.source === "question-bank" ? `/question-bank-questions/${attempt.questionId}/attempt`
          : `/pyq/questions/${attempt.questionId}/${attempt.jamSolutionMode ? "jam-submit" : "attempt"}`;
        const result = await syncRequest(endpoint, { answer: attempt.answer, exam: attempt.exam, offlineSubmissionId: attempt.id, attemptedAt: attempt.attemptedAt, offlineUserId: userId });
        await writeOffline(attemptKey(userId,attempt.packId,attempt.questionId), { ...attempt, answer: result.answer ?? attempt.answer, status: "synced", isCorrect: result.isCorrect, error: undefined });
        syncRetryAt.delete(userId);practiceNetworkHealthy();
        window.dispatchEvent(new Event("offline-practice-synced"));
      } catch (error) {
        await writeOffline(attemptKey(userId,attempt.packId,attempt.questionId), { ...attempt, error: error instanceof SyncError ? error.message : "Connection interrupted. Your answer is safe; sync will retry." });
        if (!(error instanceof SyncError) || [401,403,408,429].includes(error.status) || error.status >= 500) {
          syncRetryAt.set(userId,Date.now()+15000);
          if(!(error instanceof SyncError)||error.status>=500||[408,429].includes(error.status))practiceNetworkSlow();
          break;
        }
      }
    }
    offlineChanged();
  })().finally(()=>{ syncing = undefined; });
}

let serviceWorkerReady: Promise<void> | undefined;
export function prepareOfflineShell() {
  return serviceWorkerReady ??= (async () => {
    if (!("serviceWorker" in navigator)) throw new Error("Offline reload is not supported by this browser");
    await navigator.serviceWorker.register("/practice-sw.js", { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve,reject)=>{
      const changed=()=>{if(navigator.serviceWorker.controller){clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',changed);resolve();}};
      const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',changed);reject(new Error('Offline app activation timed out'));},20000);
      navigator.serviceWorker.addEventListener('controllerchange',changed);changed();
    });
    await new Promise<void>((resolve,reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(()=>reject(new Error("Offline app preparation timed out")),20000);
      channel.port1.onmessage = event => { clearTimeout(timer); event.data.ok ? resolve() : reject(new Error("Could not cache the offline app")); };
      registration.active!.postMessage({ type: "PREPARE_SHELL", entry: document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute("src"), assets: [...performance.getEntriesByType("resource").map(r=>r.name),...Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map(s=>s.src),...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"],link[rel="modulepreload"]')).map(l=>l.href)] },[channel.port2]);
    });
  })().catch(error=>{ serviceWorkerReady = undefined; throw error; });
}
