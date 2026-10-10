import { isStudentFeatureLocked, isStudentPendingVerification, isStudentRejectedVerification } from './student-access';

/** Resume only an existing student's unlocked practice view while the cookie is
 * revalidated. API checks still run; a real auth rejection clears the session. */
export function canResumeBufferedPractice(user: Parameters<typeof isStudentFeatureLocked>[0], path: string) {
  const feature=path.match(/^\/student\/(question-bank|pyq)(?:\/|$|\?)/)?.[1] as 'question-bank'|'pyq'|undefined;
  return Boolean(feature&&user?.role==='student'&&user.onboardingComplete&&
    !isStudentPendingVerification(user)&&!isStudentRejectedVerification(user)&&!isStudentFeatureLocked(user,feature));
}

// A connected Wi-Fi icon does not mean the connection can deliver a response.
export const PRACTICE_READ_WAIT_MS = 1500;
export const PRACTICE_WRITE_WAIT_MS = 2500;
export const PRACTICE_DOWNLOAD_WAIT_MS = 30000;
let weakUntil = 0;
export function weakPracticeConnection() {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } }).connection;
  return !navigator.onLine || Date.now() < weakUntil || Boolean(connection &&
    (connection.saveData || ['slow-2g','2g'].includes(connection.effectiveType ?? '') ||
      (connection.downlink !== undefined && connection.downlink < 0.5) || (connection.rtt ?? 0) > 800));
}
export function practiceNetworkSlow() {
  weakUntil = Date.now() + 60000;
  window.dispatchEvent(new Event('practice-network-unavailable'));
}
export function practiceNetworkHealthy() {
  const wasWeak = Date.now() < weakUntil;
  weakUntil = 0;
  if (wasWeak) window.dispatchEvent(new Event('practice-network-restored'));
}

/** Covers response BODY loading too, and settles even if a transport ignores abort. */
export async function practiceDeadline<T>(task: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal | null): Promise<T> {
  const controller = new AbortController();
  let rejectWait: (error: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectWait = reject; });
  const cancel = () => {
    const error = parent?.reason ?? new DOMException('Request cancelled', 'AbortError');
    controller.abort(error); rejectWait(error);
  };
  const timer = setTimeout(() => {
    const error = new DOMException('Connection is slow. Your buffered questions remain available.', 'TimeoutError');
    controller.abort(error); rejectWait(error);
  }, milliseconds);
  parent?.addEventListener('abort', cancel, {once:true});
  try {
    if (parent?.aborted) cancel();
    return await Promise.race([interrupted, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return task(controller.signal);
    })]);
  } finally {
    clearTimeout(timer); parent?.removeEventListener('abort', cancel);
  }
}

/** Keep current first, look ahead, and retain three previous questions for Back. */
export function practiceBufferIds(ids: number[], index: number) {
  const current = Math.max(0, index);
  const previous = ids.slice(Math.max(0,current-3),current).reverse();
  return [...ids.slice(current,current+15-previous.length),...previous];
}
