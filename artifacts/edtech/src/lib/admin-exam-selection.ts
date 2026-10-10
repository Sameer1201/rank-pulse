export const ADMIN_EXAM_STORAGE_KEY = "admin-selected-exam";

function readQueryExam(value: string) {
  const query = value.includes("?") ? value.split("?")[1] ?? "" : "";
  return new URLSearchParams(query).get("exam")?.trim() ?? "";
}

export function readAdminExamQuery(location = "") {
  const fromLocation = readQueryExam(location);
  if (fromLocation) return fromLocation;
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("exam")?.trim() ?? "";
}

export function readStoredAdminExam() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(ADMIN_EXAM_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function readAdminExamSelection(location = "") {
  return readAdminExamQuery(location) || readStoredAdminExam();
}

export function persistAdminExam(examKey: string) {
  const normalized = examKey.trim();
  if (!normalized || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_EXAM_STORAGE_KEY, normalized);
  } catch {
    // localStorage is optional; the URL remains the source for the current page.
  }
  window.dispatchEvent(new CustomEvent("admin-exam-changed", { detail: normalized }));
}

export function adminExamPath(location: string) {
  return location.includes("?") ? location.split("?")[0] ?? location : location;
}

export function normalizeAdminExamKey(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (normalized === "jam" || normalized === "iit-jam" || normalized === "jam-chemistry") return "jam-chemistry";
  return normalized;
}

export function testBelongsToAdminExam(
  test: { examType?: string | null; examHeader?: string | null; examSubheader?: string | null; title?: string | null },
  examKey: string,
) {
  const target = normalizeAdminExamKey(examKey);
  if (!target) return true;
  const values = [test.examType, test.examHeader, test.examSubheader, test.title]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeAdminExamKey(value));
  if (target === "jam-chemistry") return values.some((value) => value.includes("jam") && !value.includes("gate"));
  return values.some((value) => value === target || value.startsWith(`${target}-`) || value.includes(target));
}
