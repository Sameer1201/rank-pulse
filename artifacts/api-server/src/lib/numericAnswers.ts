export type NumericRange = {
  min: number | null;
  max: number | null;
};

export type ExtractedNumericAnswer = NumericRange & {
  exact: number | null;
};

const NUMERIC_TOKEN =
  "[-−]?(?:(?:(?:\\d{1,3}(?:,\\d{3})+)|\\d+)(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const RANGE_PATTERN = new RegExp(
  `(${NUMERIC_TOKEN})\\s*(?:-|—|–|−|to)\\s*(${NUMERIC_TOKEN})`,
  "i",
);
const BETWEEN_PATTERN = new RegExp(
  `between\\s+(${NUMERIC_TOKEN})\\s+and\\s+(${NUMERIC_TOKEN})`,
  "i",
);
const NUMBER_PATTERN = new RegExp(NUMERIC_TOKEN, "g");

export function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, "").replace(/−/g, "-"));
  return Number.isFinite(parsed) ? parsed : null;
}

function toPlainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&minus;/gi, "−")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ");
}

function firstMeaningfulLine(value: string): string {
  return toPlainText(value)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

export function extractNumericRange(value: unknown): NumericRange {
  if (Array.isArray(value) && value.length >= 2) {
    const min = parseNumericValue(value[0]);
    const max = parseNumericValue(value[1]);
    if (min !== null && max !== null) return { min, max };
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const min = parseNumericValue(
      record.min ?? record.minimum ?? record.low ?? record.from ?? record.start,
    );
    const max = parseNumericValue(
      record.max ?? record.maximum ?? record.high ?? record.to ?? record.end,
    );
    if (min !== null && max !== null) return { min, max };
  }

  if (typeof value !== "string") return { min: null, max: null };

  const text = firstMeaningfulLine(value);
  const directMatch = text.match(RANGE_PATTERN) ?? text.match(BETWEEN_PATTERN);
  if (!directMatch) return { min: null, max: null };

  return {
    min: parseNumericValue(directMatch[1]),
    max: parseNumericValue(directMatch[2]),
  };
}

/**
 * Teacher solutions use the first meaningful line as the answer key. Examples:
 * `1.3 (1.0 - 1.5)` is a range answer, while `0.125` is an exact answer.
 */
export function extractNumericAnswerFromSolution(
  value: unknown,
): ExtractedNumericAnswer {
  if (typeof value !== "string" || !value.trim()) {
    return { exact: null, min: null, max: null };
  }

  const line = firstMeaningfulLine(value);
  if (!line) return { exact: null, min: null, max: null };

  const range = extractNumericRange(line);
  const numbers = line.match(NUMBER_PATTERN) ?? [];
  const exact = parseNumericValue(numbers[0]);

  return {
    exact,
    min: range.min,
    max: range.max,
  };
}