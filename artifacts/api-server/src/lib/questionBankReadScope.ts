/** Shared by the production Worker and the development API. Never let an
 * invalid focused request silently fall back to loading a complete chapter. */
export function questionBankReadScope(params: URLSearchParams) {
  const positiveId = (value: string) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error("Invalid question id");
    }
    return Number(value);
  };
  const single = params.get("questionId");
  const batch = params.get("questionIds");
  if (single !== null && batch !== null) throw new Error("Use questionId or questionIds, not both");
  const ids = single !== null ? [positiveId(single)] : batch !== null ? batch.split(",").map(positiveId) : null;
  if (ids && ids.length > 20) throw new Error("At most 20 questions can be loaded together");
  const indexOnly = params.get("indexOnly") === "1";
  if (indexOnly && ids) throw new Error("Question index cannot include a content filter");
  return { ids: ids ? [...new Set(ids)] : null, indexOnly };
}
