/** An analytics mirror must not make an already-persisted answer/test look failed. */
export async function recordActivitySafely(work: () => Promise<unknown>) {
  try { await work(); }
  catch (error) { console.error('Daily activity recording failed after successful submission', error); }
}
