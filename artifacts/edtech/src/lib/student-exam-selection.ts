import { formatExamDisplayName } from "@/lib/exam-display";

export const STUDENT_EXAM_STORAGE_KEY = "student-selected-exam";

export function normalizeStudentExamKey(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function normalizePyqWorkspaceKey(value: string | null | undefined) {
  const key = normalizeStudentExamKey(value);
  return key === "gate" || key.startsWith("gate-") ? "gate" : key;
}

export function getStudentExamOptions(user: { subject?: string | null; additionalExams?: unknown[] | null } | null | undefined) {
  const values = [user?.subject ?? "", ...(user?.additionalExams ?? [])]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeStudentExamKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readStudentExamSelection(user: { subject?: string | null; additionalExams?: unknown[] | null } | null | undefined) {
  const options = getStudentExamOptions(user);
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(STUDENT_EXAM_STORAGE_KEY) ?? "";
      const match = options.find((exam) => normalizeStudentExamKey(exam) === normalizeStudentExamKey(stored));
      if (match) return match;
    } catch {}
  }
  return options[0] ?? "";
}

export function persistStudentExam(exam: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STUDENT_EXAM_STORAGE_KEY, exam); } catch {}
  window.dispatchEvent(new CustomEvent("student-exam-changed", { detail: { exam } }));
}

export function isJamChemistryExam(exam: string | null | undefined) {
  const key = normalizeStudentExamKey(exam);
  return key === "jam-chemistry" || (key.includes("jam") && key.includes("chemistry"));
}

export function studentExamLabel(exam: string) {
  return formatExamDisplayName(exam) || exam;
}
