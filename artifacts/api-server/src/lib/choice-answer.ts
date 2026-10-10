/** Shared with the practice UI: old imports store letters, newer clients use indexes. */
export function choiceIndex(value: unknown): number | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (/^[a-d]$/i.test(text)) return text.toUpperCase().charCodeAt(0) - 65;
    if (!/^\d+$/.test(text)) return null;
    value = Number(text);
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function choiceIndexes(value: unknown): number[] | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const indexes = value.map(choiceIndex);
  if (indexes.some(index => index === null)) return null;
  return [...new Set(indexes as number[])].sort((a, b) => a - b);
}

export function choicesMatch(answer: unknown, expected: unknown, multi = false): boolean | null {
  if (multi) {
    const key = choiceIndexes(expected);
    if (!key) return null;
    const selected = choiceIndexes(answer);
    return selected !== null && JSON.stringify(selected) === JSON.stringify(key);
  }
  const key = choiceIndex(expected);
  return key === null ? null : choiceIndex(answer) === key;
}
