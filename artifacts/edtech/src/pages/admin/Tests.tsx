import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { looksLikeRichHtmlContent, sanitizeRichHtml, stripRichHtmlToText } from "@/lib/richContent";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import {
  ClipboardList, Plus, Trash2, CheckCircle2,
  ToggleLeft, ToggleRight, Clock, Hash,
  Calculator, Flag,
  TrendingUp, PencilLine, Download, Upload, FileText, X,
  Monitor, DatabaseZap, Loader2, AlertCircle, Settings2,
  SquareCheck, Square, Layers, GripVertical, Sparkles,
  Eye, ChevronLeft, ChevronRight, Info, Search, HelpCircle, BookOpen
} from "lucide-react";
import { format } from "date-fns";
import { parseQuestionsFromHTML, type ParsedQuestion } from "@/lib/questionParser";
import { buildApiUrl } from "@/lib/api-origin";
import { readAdminExamSelection, testBelongsToAdminExam } from "@/lib/admin-exam-selection";

// ── Admin Student-View helpers ────────────────────────────────────────────────
type TestCategory = "mock" | "subject-wise" | "multi-subject" | "pyq";

function getAdminTestCategory(test: { title: string; description?: string | null; examHeader?: string | null; examSubheader?: string | null; subjectName?: string | null; chapterName?: string | null }): TestCategory {
  const text = [test.title, test.description, test.examHeader, test.examSubheader]
    .filter(Boolean).join(" ").toLowerCase();
  if (/pyq|previous[\s-]?year|past[\s-]?year/.test(text)) return "pyq";
  if (/multi[\s-]?subject|combined subject/.test(text)) return "multi-subject";
  if (/subject[\s-]?wise|chapter[\s-]?wise|chapter test/.test(text)) return "subject-wise";
  if (/mock|grand test|full test|full syllabus/.test(text)) return "mock";
  if (test.chapterName?.trim() || test.subjectName?.trim()) return "subject-wise";
  return "mock";
}

function getAdminTestCategoryLabel(cat: TestCategory) {
  if (cat === "subject-wise") return "Subject Wise";
  if (cat === "multi-subject") return "Chapter Wise";
  if (cat === "pyq") return "PYQ";
  return "Mock Test";
}

function getAdminTestCategoryTone(cat: TestCategory) {
  if (cat === "subject-wise") return { pill: "border-[#A5F3FC] bg-[#ECFEFF] text-[#0E7490]" };
  if (cat === "multi-subject") return { pill: "border-[#C4B5FD] bg-[#F5F3FF] text-[#7C3AED]" };
  if (cat === "pyq") return { pill: "border-[#6EE7B7] bg-[#ECFDF5] text-[#047857]" };
  return { pill: "border-[#FCA5A5] bg-[#FFF1F2] text-[#BE123C]" };
}

function getAdminTestSubject(test: { subjectName?: string | null; chapterName?: string | null; className?: string | null }) {
  return test.subjectName?.trim() || test.chapterName?.trim() || test.className?.trim() || "";
}

function getAdminTestAccent(subject: string) {
  const palette = [
    { line: "bg-[#6366F1]", dot: "bg-[#6366F1]" },
    { line: "bg-[#10B981]", dot: "bg-[#10B981]" },
    { line: "bg-[#F59E0B]", dot: "bg-[#F59E0B]" },
    { line: "bg-[#EC4899]", dot: "bg-[#EC4899]" },
    { line: "bg-[#3B82F6]", dot: "bg-[#3B82F6]" },
  ];
  if (!subject) return palette[0];
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = ((hash * 31) + subject.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function getAdminVisibleDescription(description: string | null | undefined) {
  if (typeof description !== "string") return null;
  const trimmed = description.trim();
  if (!trimmed) return null;
  if (/^imported from saved html\s*:/i.test(trimmed)) return null;
  return trimmed;
}
// ─────────────────────────────────────────────────────────────────────────────

type QuestionType = "mcq" | "multi" | "integer";
type ExamType = string;
type QuestionBulkImportMode = "metadata" | "answers";

function getDefaultTemplateInstructions(templateName: string, durationMinutes: number) {
  const safeName = templateName.trim() || "the examination";
  const safeDuration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 180;
  return [
    `The duration of ${safeName} is ${safeDuration} minutes. The countdown timer at the top right-hand corner of your screen displays the remaining time.`,
    "When the timer reaches zero, the test will be submitted automatically.",
    "Read every question carefully before selecting or entering your response.",
    "Use Save & Next to save the current response and move ahead.",
    "Use Mark for Review & Next when you want to revisit a question before final submission.",
    "You can jump to any question from the question palette without losing the current screen context.",
    "Use Clear Response to remove the selected answer from the current question.",
    "MCQ uses single selection, MSQ uses multiple selections, and integer questions require a numeric answer.",
  ].join("\n");
}

interface SectionDraft {
  id: string;
  title: string;
  description: string;
  subjectLabel: string;
  questionCount: string;
  marksPerQuestion: string;
  negativeMarks: string;
  preferredQuestionType: QuestionType;
}

interface Test {
  id: number; classId: number | null; title: string; description: string | null;
  examType?: ExamType | string | null;
  examHeader?: string | null; examSubheader?: string | null;
  instructions?: string | null;
  examConfig?: Record<string, unknown> | null;
  defaultPositiveMarks?: number | null;
  defaultNegativeMarks?: number | null;
  questionCount?: number | null;
  chapterId: number | null; durationMinutes: number; passingScore: number | null; isPublished: boolean;
  scheduledAt: string | null; className: string | null; chapterName?: string | null; subjectName?: string | null;
}

interface PublishSyncQuestion {
  questionId: number;
  questionNo: string;
}

interface PublishReviewQuestion extends PublishSyncQuestion {
  reason: string;
  subjectName: string | null;
  chapterName: string | null;
}

interface PublishSyncSummary {
  linkedCount: number;
  createdQuestionBankClassCount: number;
  createdSubjectCount: number;
  createdChapterCount: number;
  skippedNoSubjectCount: number;
  skippedNoQuestionBankClassCount: number;
  skippedInvalidQuestionCount: number;
  skippedDuplicateCount: number;
  duplicateQuestions?: PublishSyncQuestion[];
  reviewQuestions?: PublishReviewQuestion[];
  warnings?: string[];
}

interface PublishResultDialogState {
  testId: number;
  testTitle: string;
  summary: PublishSyncSummary;
}

interface UnpublishCleanupSummary {
  detachedCount: number;
  removedQuestionCount: number;
  removedChapterCount?: number;
  removedSubjectCount?: number;
  reviewBucketCleared: boolean;
  warnings?: string[];
}

interface Question {
  id: number; question: string; questionType: QuestionType; options: string[];
  sectionId?: number | null;
  questionCode?: string | null;
  sourceType?: string | null;
  subjectLabel?: string | null;
  difficulty?: string | null;
  idealTimeSeconds?: number | null;
  optionImages?: (string | null)[] | null;
  correctAnswer: number; correctAnswerMulti: number[] | null;
  correctAnswerMin?: number | null; correctAnswerMax?: number | null;
  points: number; negativeMarks?: number | null; order: number; imageData?: string | null; meta?: Record<string, unknown> | null;
  solutionText?: string | null;
  solutionImageData?: string | null;
  reports?: Array<{ status?: "open" | "resolved" | "rejected" | null }> | null;
  openReportCount?: number | null;
  totalReportCount?: number | null;
}
interface TestSection {
  id: number;
  testId: number;
  title: string;
  description: string | null;
  subjectLabel: string | null;
  questionCount?: number | null;
  marksPerQuestion?: number | null;
  negativeMarks?: number | null;
  meta?: Record<string, unknown> | null;
  order: number;
}

interface ExamTemplate {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  examHeader?: string | null;
  examSubheader?: string | null;
  instructions?: string | null;
  customInstructions?: string | null;
  durationMinutes: number;
  passingScore: number | null;
  defaultPositiveMarks: number;
  defaultNegativeMarks: number;
  sections: Array<{
    title: string;
    description?: string | null;
    subjectLabel?: string | null;
    questionCount?: number | null;
    marksPerQuestion?: number | null;
    negativeMarks?: number | null;
    preferredQuestionType?: QuestionType;
  }>;
}

function normalizeExamConfigObject(value: unknown) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function getCalculatorEnabledFromExamConfig(value: unknown) {
  return Boolean(normalizeExamConfigObject(value).calculatorEnabled);
}

function normalizeTestCategory(value: unknown): TestCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "mock" || normalized === "mock-test") return "mock";
  if (normalized === "subject-wise" || normalized === "subject wise" || normalized === "subject") return "subject-wise";
  if (normalized === "multi-subject" || normalized === "multi subject" || normalized === "multi-subject-wise") return "multi-subject";
  if (normalized === "pyq" || normalized === "previous year" || normalized === "previous-year") return "pyq";
  return null;
}

function getTestCategoryLabel(value: TestCategory) {
  if (value === "subject-wise") return "Subject Wise Test";
  if (value === "multi-subject") return "Chapter Wise Test";
  if (value === "pyq") return "PYQ";
  return "Mock Test";
}

function getTestCategoryTone(value: TestCategory) {
  if (value === "subject-wise") return "border-[#A5F3FC] bg-[#ECFEFF] text-[#0E7490]";
  if (value === "multi-subject") return "border-[#C4B5FD] bg-[#F5F3FF] text-[#7C3AED]";
  if (value === "pyq") return "border-[#6EE7B7] bg-[#ECFDF5] text-[#047857]";
  return "border-[#FCA5A5] bg-[#FFF1F2] text-[#BE123C]";
}

function getShowOnStudentDashboard(value: unknown): boolean {
  return Boolean(normalizeExamConfigObject(value).showOnStudentDashboard);
}

function getSyncWithQuestionBank(value: unknown): boolean {
  return Boolean(normalizeExamConfigObject(value).syncWithQuestionBank);
}

function getResolvedTestCategory(
  test: Pick<Test, "title" | "description" | "examHeader" | "examSubheader" | "subjectName" | "chapterName" | "examConfig">,
  sections: Array<Pick<TestSection, "title" | "subjectLabel">> = [],
): TestCategory {
  const stored = normalizeTestCategory(normalizeExamConfigObject(test.examConfig).testCategory);
  if (stored) return stored;

  const text = [
    test.title,
    test.description,
    test.examHeader,
    test.examSubheader,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/pyq|previous[\s-]?year|past[\s-]?year/.test(text)) return "pyq";
  if (/multi[\s-]?subject|combined subject/.test(text)) return "multi-subject";
  if (/subject[\s-]?wise|chapter[\s-]?wise|chapter test/.test(text)) return "subject-wise";
  if (/mock|grand test|full test|full syllabus/.test(text)) return "mock";

  const sectionLabels = new Set(
    sections
      .map((section) => section.subjectLabel?.trim() || section.title?.trim() || "")
      .map((value) => value.toLowerCase().replace(/\s+/g, " ").trim())
      .filter((value) => value && !/^section\b/.test(value)),
  );

  if (test.chapterName?.trim() || test.subjectName?.trim()) return "subject-wise";
  if (sectionLabels.size > 1) return "multi-subject";
  return "mock";
}
interface ExportedTestBundle {
  version: number;
  exportedAt: string;
  source?: {
    testId: number;
    title: string;
    examType?: string | null;
  };
  test: {
    title: string;
    description?: string | null;
    examType?: string | null;
    examHeader?: string | null;
    examSubheader?: string | null;
    instructions?: string | null;
    examConfig?: Record<string, unknown> | null;
    durationMinutes?: number;
    passingScore?: number | null;
    defaultPositiveMarks?: number | null;
    defaultNegativeMarks?: number | null;
    scheduledAt?: string | null;
    displayOrder?: number | null;
    sections: Array<Record<string, unknown>>;
    questions: Array<Record<string, unknown>>;
  };
}

/** Extract the leading numeric prefix from a filename, e.g. "002_Advance Level...html" → 2. Returns null if none found. */
function extractFilenameOrder(filename: string): number | null {
  const match = /^(\d+)[_\s-]/.exec(filename);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

interface PdfExportSectionPayload {
  id?: number | string | null;
  exportRef?: string | null;
  order?: number | null;
}

interface PdfExportQuestionPayload {
  question: string;
  imageData?: string | null;
  order?: number | null;
  sectionId?: number | string | null;
  sectionRef?: string | null;
}

interface PdfExportQuestionItem {
  question: string;
  imageData?: string | null;
}

function getPdfSectionKey(section: TestSection | PdfExportSectionPayload, fallbackIndex: number) {
  if (section.id !== undefined && section.id !== null) return String(section.id);
  if ("exportRef" in section && section.exportRef) return String(section.exportRef);
  return `section-${fallbackIndex}`;
}

function getPdfQuestionSectionKey(question: Question | PdfExportQuestionPayload) {
  if (question.sectionId !== undefined && question.sectionId !== null) return String(question.sectionId);
  if ("sectionRef" in question && question.sectionRef) return String(question.sectionRef);
  return "__unsectioned__";
}
async function fetchBuilderTestDetail(testId: number) {
  const response = await fetch(buildApiUrl(`/api/tests/${testId}`), { credentials: "include" });
  if (!response.ok) throw new Error("Failed to load test");
  return response.json();
}

async function fetchExamTemplatesList() {
  const response = await fetch(buildApiUrl(`/api/planner/exam-templates`), { credentials: "include" });
  if (!response.ok) throw new Error("Failed to load exam templates");
  return response.json();
}

function formatDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function formatApiErrorMessage(rawMessage: string, fallbackMessage: string) {
  const trimmed = rawMessage.trim();
  if (!trimmed) return fallbackMessage;

  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // Non-JSON error bodies are handled below.
  }

  let normalized = trimmed;
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    if (typeof DOMParser !== "undefined") {
      const parsed = new DOMParser().parseFromString(trimmed, "text/html");
      normalized = parsed.body?.textContent?.replace(/\s+/g, " ").trim() || trimmed;
    } else {
      normalized = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  if (/Cannot POST\s+\/api\/tests\/\d+\/import-question-metadata/i.test(normalized)) {
    return "The metadata import route is currently unavailable. Restart the backend server and try again.";
  }

  return normalized || fallbackMessage;
}

function normalizeExamTypeSelection(value: unknown, templates: ExamTemplate[]) {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = value.trim().toLowerCase();
  const matched = templates.find((template) => {
    const candidates = [
      template.key,
      template.name,
      template.examHeader ?? "",
      template.examSubheader ?? "",
    ];
    return candidates.some((candidate) => candidate.trim().toLowerCase() === normalized);
  });
  return matched?.key ?? "";
}

function getOpenReportCount(question: Pick<Question, "openReportCount" | "reports">) {
  if (typeof question.openReportCount === "number" && Number.isFinite(question.openReportCount)) {
    return Math.max(0, question.openReportCount);
  }
  return (question.reports ?? []).filter((report) => report?.status === "open").length;
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image blob."));
    reader.readAsDataURL(blob);
  });
}

async function resolveImageDataUrl(source: string) {
  if (!source) return "";
  if (source.startsWith("data:image/")) return source;
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to load image (${response.status}).`);
  }
  return readBlobAsDataUrl(await response.blob());
}

function getImageFormat(imageDataUrl: string) {
  if (/^data:image\/png/i.test(imageDataUrl)) return "PNG";
  if (/^data:image\/webp/i.test(imageDataUrl)) return "WEBP";
  return "JPEG";
}

function extractQuestionImageSources(question: string, imageData?: string | null) {
  const sources = new Set<string>();
  if (imageData) sources.add(imageData);
  if (typeof DOMParser !== "undefined" && /<img[\s>]/i.test(question)) {
    const parsed = new DOMParser().parseFromString(question, "text/html");
    parsed.querySelectorAll("img").forEach((image) => {
      const src = image.getAttribute("src")?.trim();
      if (src) {
        sources.add(src);
      }
    });
  }
  return Array.from(sources);
}

async function exportQuestionsPdf({
  title,
  filename,
  questions,
}: {
  title: string;
  filename: string;
  questions: PdfExportQuestionItem[];
}) {
  if (questions.length === 0) {
    throw new Error("No questions are available for PDF export.");
  }

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const topMargin = 56;
  const bottomMargin = 42;
  const contentWidth = pageWidth - marginX * 2;
  const imageIndent = 22;
  const bodyWidth = contentWidth - imageIndent;
  const maxRenderableImageHeight = pageHeight - topMargin - bottomMargin - 24;
  const maxDisplayImageWidth = Math.min(bodyWidth, 340);
  const maxDisplayImageHeight = Math.min(maxRenderableImageHeight, 220);
  let y = topMargin;
  let skippedImageCount = 0;

  const addPage = () => {
    doc.addPage();
    y = topMargin;
  };

  const ensureSpace = (heightNeeded: number) => {
    if (y + heightNeeded > pageHeight - bottomMargin) {
      addPage();
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text(title, marginX, y);
  y += 28;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text("Questions only export", marginX, y);
  y += 20;

  for (const [index, item] of questions.entries()) {
    const questionLabel = `${index + 1}.`;
    const questionText = stripRichHtmlToText(item.question) || "Untitled question";
    const questionLines = doc.splitTextToSize(questionText, bodyWidth);
    ensureSpace(Math.max(30, questionLines.length * 16 + 14));

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(questionLabel, marginX, y);

    doc.setFont("helvetica", "normal");
    doc.text(questionLines, marginX + imageIndent, y);
    y += questionLines.length * 16 + 10;

    for (const imageSource of extractQuestionImageSources(item.question, item.imageData)) {
      try {
        const imageDataUrl = await resolveImageDataUrl(imageSource);
        if (!imageDataUrl) continue;
        const imageProperties = doc.getImageProperties(imageDataUrl);
        const naturalImageWidth = Math.max(imageProperties.width || 0, 1);
        const naturalImageHeight = Math.max(imageProperties.height || 0, 1);
        const imageScale = Math.min(
          maxDisplayImageWidth / naturalImageWidth,
          maxDisplayImageHeight / naturalImageHeight,
          1,
        );
        const imageWidth = naturalImageWidth * imageScale;
        const imageHeight = naturalImageHeight * imageScale;

        ensureSpace(imageHeight + 12);
        doc.addImage(
          imageDataUrl,
          getImageFormat(imageDataUrl),
          marginX + imageIndent,
          y,
          imageWidth,
          imageHeight,
        );
        y += imageHeight + 12;
      } catch {
        skippedImageCount += 1;
      }
    }

    y += 10;
  }

  const totalPages = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth / 2, pageHeight - 18, { align: "center" });
  }

  doc.save(filename);
  return { skippedImageCount };
}

function normalizeImportedText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractReadableText(element: Element | null, options?: { stripOptionPrefix?: boolean }) {
  if (!element || typeof document === "undefined") return "";
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, summary, script, style").forEach((node) => node.remove());
  clone.querySelectorAll("img").forEach((img) => {
    img.replaceWith(document.createTextNode(" "));
  });
  const rawText = normalizeImportedText(clone.textContent || "");
  return options?.stripOptionPrefix ? rawText.replace(/^[A-D]\.\s*/i, "").trim() : rawText;
}

function extractRichImportHtml(element: Element | null) {
  if (!element || typeof document === "undefined") return "";
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, summary, script, style").forEach((node) => node.remove());
  if (!clone.querySelector("img, sup, sub")) return "";
  const sanitized = sanitizeRichHtml(clone.innerHTML);
  return looksLikeRichHtmlContent(sanitized) ? sanitized : "";
}

function extractFirstImageSource(element: Element | null) {
  if (!element) return null;
  const images = Array.from(element.querySelectorAll("img"));
  for (const image of images) {
    const src = image.getAttribute("src")?.trim() || "";
    if (src) return src;
  }
  return null;
}

function normalizeImportedSectionTitle(value: string, options?: { gateImport?: boolean }) {
  const cleaned = normalizeImportedText(value) || "Imported Section";
  const normalized = cleaned.toLowerCase();
  if (normalized.includes("general aptitude")) return "General Aptitude";
  if (options?.gateImport) return "Technical";
  return cleaned;
}

function inferImportedDifficulty(tags: string[]): "easy" | "moderate" | "tough" {
  const combined = tags.join(" ").toLowerCase();
  if (combined.includes("expert") || combined.includes("advanced") || combined.includes("hard")) return "tough";
  if (combined.includes("easy")) return "easy";
  return "moderate";
}

function defaultIdealTimeSeconds(difficulty: "easy" | "moderate" | "tough") {
  if (difficulty === "easy") return 60;
  if (difficulty === "tough") return 180;
  return 90;
}

function toImportedQuestionType(value: string | null): QuestionType {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return "mcq";
  if (normalized === "msq" || normalized.includes("multi") || normalized.includes("multiple")) return "multi";
  if (normalized === "nat" || normalized.includes("integer") || normalized.includes("numeric") || normalized.includes("numerical")) return "integer";
  return "mcq";
}

function answerLettersToIndices(value: string | null) {
  if (!value) return [];
  const trimmed = value.trim();
  const entries = /^[A-Za-z]+$/.test(trimmed)
    ? trimmed.split("")
    : trimmed.split(/[\s,;|/]+/);
  return entries
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean)
    .map((entry) => entry.charCodeAt(0) - 65)
    .filter((entry) => entry >= 0);
}

function parseImportedNumericValue(value: string | null | undefined) {
  if (!value || !value.trim()) return null;
  const parsed = Number(value.trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractImportedIntegerRange(low: string | null, high: string | null, answerText: string | null) {
  const parsedLow = parseImportedNumericValue(low);
  const parsedHigh = parseImportedNumericValue(high);
  if (parsedLow !== null && parsedHigh !== null) {
    return {
      min: Math.min(parsedLow, parsedHigh),
      max: Math.max(parsedLow, parsedHigh),
    };
  }
  if (answerText) {
    const trimmed = answerText.trim();
    const directMatch = trimmed.match(/(-?\d+(?:\.\d+)?)\s*(?:-|—|–|to)\s*(-?\d+(?:\.\d+)?)/i);
    if (directMatch) {
      return {
        min: Math.min(Number(directMatch[1]), Number(directMatch[2])),
        max: Math.max(Number(directMatch[1]), Number(directMatch[2])),
      };
    }
    const betweenMatch = trimmed.match(/between\s+(-?\d+(?:\.\d+)?)\s+and\s+(-?\d+(?:\.\d+)?)/i);
    if (betweenMatch) {
      return {
        min: Math.min(Number(betweenMatch[1]), Number(betweenMatch[2])),
        max: Math.max(Number(betweenMatch[1]), Number(betweenMatch[2])),
      };
    }
  }
  return null;
}

async function parseSavedHtmlTestImport(file: File): Promise<ExportedTestBundle> {
  const html = await file.text();
  const documentParser = new DOMParser().parseFromString(html, "text/html");
  const cards = Array.from(documentParser.querySelectorAll("section.card.qcard"));
  if (!cards.length) throw new Error("No importable questions found in the HTML file.");

  const rawTitle =
    normalizeImportedText(documentParser.querySelector("title")?.textContent || "") ||
    file.name.replace(/\.(html?|json)$/i, "").trim() ||
    "Imported Test";
  const gateImport = /gate/i.test(rawTitle) || /gate/i.test(file.name);
  const durationSeconds = Number(documentParser.querySelector("#timerWrap")?.getAttribute("data-duration") || 0);
  const durationMinutes = durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : 180;

  const sections = new Map<
    string,
    {
      exportRef: string;
      title: string;
      questionCount: number;
      marks: Set<number>;
      negatives: Set<number>;
      typeCounts: Record<QuestionType, number>;
      order: number;
    }
  >();

  const questions: ExportedTestBundle["test"]["questions"] = [];

  for (const [index, card] of cards.entries()) {
    const questionNumber = Number(card.getAttribute("data-qnum") || index + 1);
    const requestedQuestionType = toImportedQuestionType(card.getAttribute("data-qtype"));
    const tags = normalizeImportedText(card.querySelector(".tags")?.textContent || "")
      .split("•")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const sectionTitle = normalizeImportedSectionTitle(tags[0] || "Imported Section", { gateImport });
    const sectionKey = sectionTitle.toLowerCase();
    if (!sections.has(sectionKey)) {
      sections.set(sectionKey, {
        exportRef: `section-${sections.size + 1}`,
        title: sectionTitle,
        questionCount: 0,
        marks: new Set<number>(),
        negatives: new Set<number>(),
        typeCounts: { mcq: 0, multi: 0, integer: 0 },
        order: sections.size,
      });
    }
    const section = sections.get(sectionKey)!;

    const qtext = card.querySelector(".qtext");
    const questionRichHtml = extractRichImportHtml(qtext);
    const questionText = questionRichHtml || extractReadableText(qtext) || `Imported question ${questionNumber}`;
    const questionImageData = !questionRichHtml ? extractFirstImageSource(qtext) : null;

    const optionNodes = Array.from(card.querySelectorAll(".opts label.opt"));
    const options = optionNodes.map((node) => extractReadableText(node.querySelector("div") ?? node, { stripOptionPrefix: true }));
    const optionImages = optionNodes.map((node) => extractFirstImageSource(node.querySelector("div") ?? node));

    const difficulty = inferImportedDifficulty(tags);
    const negativeMarks = Number(card.getAttribute("data-wrong") || 0) || 0;
    const points = Number(card.getAttribute("data-right") || 1) || 1;

    const solutionRoot = card.querySelector("details.solution");
    const solutionClone = solutionRoot?.cloneNode(true) as HTMLElement | null;
    solutionClone?.querySelector("summary")?.remove();
    const solutionRichHtml = extractRichImportHtml(solutionClone);
    const solutionText = solutionRichHtml || extractReadableText(solutionClone);
    const solutionImageData = !solutionRichHtml ? extractFirstImageSource(solutionClone) : null;

    const correctLetters = answerLettersToIndices(card.getAttribute("data-correct"));
    const answerLineText = normalizeImportedText(card.querySelector(".answerline b")?.textContent || "");
    const canInferIntegerRangeFromText = requestedQuestionType === "integer" || options.length === 0;
    const importedIntegerRange =
      extractImportedIntegerRange(
        card.getAttribute("data-nat-low"),
        card.getAttribute("data-nat-high"),
        answerLineText,
      ) ??
      (canInferIntegerRangeFromText
        ? extractImportedIntegerRange(
            null,
            null,
            solutionText,
          )
        : null);
    const questionType =
      requestedQuestionType === "multi" || correctLetters.length > 1
        ? "multi"
        : requestedQuestionType === "integer" || (options.length === 0 && Boolean(importedIntegerRange))
          ? "integer"
          : "mcq";
    const questionRecord: Record<string, unknown> = {
      question: questionText,
      questionType,
      sectionRef: section.exportRef,
      questionCode: `Q${String(questionNumber).padStart(2, "0")}`,
      sourceType: "html-import",
      subjectLabel: section.title,
      options: questionType === "integer" ? [] : options,
      optionImages: questionType === "integer" || optionImages.every((entry) => !entry) ? [] : optionImages,
      points,
      negativeMarks,
      meta: {
        difficulty,
        estimatedTimeSeconds: defaultIdealTimeSeconds(difficulty),
        importedTags: tags,
        importedQuestionNumber: questionNumber,
        importedSourceFile: file.name,
      },
      solutionText: solutionText || null,
      solutionImageData,
      order: index,
      imageData: questionImageData,
    };

    if (questionType === "mcq") {
      questionRecord.correctAnswer = correctLetters[0] ?? 0;
    } else if (questionType === "multi") {
      questionRecord.correctAnswerMulti = correctLetters;
    } else {
      if (importedIntegerRange) {
        questionRecord.correctAnswerMin = importedIntegerRange.min;
        questionRecord.correctAnswerMax = importedIntegerRange.max;
      } else {
        questionRecord.correctAnswer =
          parseImportedNumericValue(card.getAttribute("data-nat-low")) ??
          parseImportedNumericValue(answerLineText) ??
          0;
      }
    }

    questions.push(questionRecord);
    section.questionCount += 1;
    section.marks.add(points);
    section.negatives.add(negativeMarks);
    section.typeCounts[questionType] += 1;
  }

  const exportedSections = Array.from(sections.values())
    .sort((left, right) => left.order - right.order)
    .map((section) => {
      const preferredQuestionType = (Object.entries(section.typeCounts)
        .sort((left, right) => right[1] - left[1])[0]?.[0] ?? "mcq") as QuestionType;
      return {
        exportRef: section.exportRef,
        title: section.title,
        description: null,
        subjectLabel: section.title,
        questionCount: section.questionCount,
        marksPerQuestion: section.marks.size === 1 ? Array.from(section.marks)[0] : null,
        negativeMarks: section.negatives.size === 1 ? Array.from(section.negatives)[0] : null,
        meta: {
          preferredQuestionType,
          importedFromHtml: true,
        },
        order: section.order,
      };
    });

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: {
      testId: 0,
      title: rawTitle,
      examType: "custom",
    },
    test: {
      title: rawTitle,
      description: `Imported from saved HTML: ${file.name}`,
      examType: "custom",
      examHeader: rawTitle,
      examSubheader: "Imported",
      instructions: null,
      examConfig: {
        importedFromHtml: true,
        sourceFile: file.name,
      },
      durationMinutes,
      passingScore: null,
      defaultPositiveMarks: null,
      defaultNegativeMarks: null,
      scheduledAt: null,
      sections: exportedSections,
      questions,
    },
  };
}

const EXAM_PRESETS: Record<Exclude<ExamType, "custom">, { label: string; duration: string; passing: string; positive: string; negative: string; sections: Omit<SectionDraft, "id">[] }> = {
  jee: {
    label: "JEE Pattern",
    duration: "180",
    passing: "60",
    positive: "4",
    negative: "1",
    sections: [
      { title: "Physics", description: "Physics section", subjectLabel: "Physics", questionCount: "25", marksPerQuestion: "4", negativeMarks: "1", preferredQuestionType: "mcq" },
      { title: "Chemistry", description: "Chemistry section", subjectLabel: "Chemistry", questionCount: "25", marksPerQuestion: "4", negativeMarks: "1", preferredQuestionType: "mcq" },
      { title: "Mathematics", description: "Mathematics section", subjectLabel: "Mathematics", questionCount: "25", marksPerQuestion: "4", negativeMarks: "1", preferredQuestionType: "mcq" },
    ],
  },
  gate: {
    label: "GATE Pattern",
    duration: "180",
    passing: "60",
    positive: "2",
    negative: "0.66",
    sections: [
      { title: "General Aptitude", description: "10 questions. Mixed +1 and +2. MCQ can carry -1/3 or -2/3. NAT/MSQ no negative.", subjectLabel: "General Aptitude", questionCount: "10", marksPerQuestion: "1", negativeMarks: "0.33", preferredQuestionType: "mcq" },
      { title: "Engineering Mathematics", description: "Around 10-12 questions. Mixed MCQ, MSQ, NAT allowed.", subjectLabel: "Engineering Maths", questionCount: "10", marksPerQuestion: "1", negativeMarks: "0.33", preferredQuestionType: "mcq" },
      { title: "Core Subject", description: "Around 40-45 questions. Core paper with MCQ, MSQ, NAT.", subjectLabel: "Core Subject", questionCount: "45", marksPerQuestion: "2", negativeMarks: "0.66", preferredQuestionType: "mcq" },
    ],
  },
  "iit-jam": {
    label: "IIT JAM Pattern",
    duration: "180",
    passing: "60",
    positive: "2",
    negative: "0.33",
    sections: [
      { title: "Section A", description: "30 MCQs with negative marking.", subjectLabel: "Section A", questionCount: "30", marksPerQuestion: "1", negativeMarks: "0.33", preferredQuestionType: "mcq" },
      { title: "Section B", description: "10 MSQs with no negative marking.", subjectLabel: "Section B", questionCount: "10", marksPerQuestion: "2", negativeMarks: "0", preferredQuestionType: "multi" },
      { title: "Section C", description: "20 NAT questions with no negative marking.", subjectLabel: "Section C", questionCount: "20", marksPerQuestion: "2", negativeMarks: "0", preferredQuestionType: "integer" },
    ],
  },
  cuet: {
    label: "CUET Pattern",
    duration: "60",
    passing: "60",
    positive: "5",
    negative: "1",
    sections: [
      { title: "Language", description: "50 questions, attempt around 40. MCQ only.", subjectLabel: "Language", questionCount: "50", marksPerQuestion: "5", negativeMarks: "1", preferredQuestionType: "mcq" },
      { title: "Domain Subjects", description: "Subject-specific MCQ section. Multiple subjects can be cloned later by super admin.", subjectLabel: "Domain Subjects", questionCount: "50", marksPerQuestion: "5", negativeMarks: "1", preferredQuestionType: "mcq" },
      { title: "General Test", description: "General aptitude and reasoning. MCQ only.", subjectLabel: "General Test", questionCount: "50", marksPerQuestion: "5", negativeMarks: "1", preferredQuestionType: "mcq" },
    ],
  },
  neet: {
    label: "NEET Pattern",
    duration: "200",
    passing: "60",
    positive: "4",
    negative: "1",
    sections: [
      { title: "Physics", description: "45 MCQs. NEET-style section with optional choice rules configurable later.", subjectLabel: "Physics", questionCount: "45", marksPerQuestion: "4", negativeMarks: "1", preferredQuestionType: "mcq" },
      { title: "Chemistry", description: "45 MCQs. NEET-style section with optional choice rules configurable later.", subjectLabel: "Chemistry", questionCount: "45", marksPerQuestion: "4", negativeMarks: "1", preferredQuestionType: "mcq" },
      { title: "Biology", description: "90 MCQs. Includes Botany/Zoology coverage as needed.", subjectLabel: "Biology", questionCount: "90", marksPerQuestion: "4", negativeMarks: "1", preferredQuestionType: "mcq" },
    ],
  },
  cat: {
    label: "CAT Pattern",
    duration: "120",
    passing: "60",
    positive: "3",
    negative: "1",
    sections: [
      { title: "VARC", description: "Verbal Ability and Reading Comprehension", subjectLabel: "VARC", questionCount: "24", marksPerQuestion: "3", negativeMarks: "1", preferredQuestionType: "mcq" },
      { title: "DILR", description: "Data Interpretation and Logical Reasoning", subjectLabel: "DILR", questionCount: "20", marksPerQuestion: "3", negativeMarks: "1", preferredQuestionType: "mcq" },
      { title: "QA", description: "Quantitative Aptitude", subjectLabel: "QA", questionCount: "22", marksPerQuestion: "3", negativeMarks: "1", preferredQuestionType: "mcq" },
    ],
  },
};

const FALLBACK_TEMPLATES: ExamTemplate[] = Object.entries(EXAM_PRESETS).map(([key, preset], index) => ({
  id: index + 1,
  key,
  name: preset.label,
  description: null,
  examHeader: preset.label.toUpperCase(),
  examSubheader: `${preset.label} Mock Assessment`,
  instructions: getDefaultTemplateInstructions(preset.label, Number(preset.duration)),
  durationMinutes: Number(preset.duration),
  passingScore: Number(preset.passing),
  defaultPositiveMarks: Number(preset.positive),
  defaultNegativeMarks: Number(preset.negative),
  sections: preset.sections.map((section) => ({
    ...section,
    questionCount: Number(section.questionCount),
    marksPerQuestion: Number(section.marksPerQuestion),
    negativeMarks: Number(section.negativeMarks),
  })),
}));

function makeSectionDraft(input?: Partial<SectionDraft>): SectionDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input?.title ?? "",
    description: input?.description ?? "",
    subjectLabel: input?.subjectLabel ?? "",
    questionCount: input?.questionCount ?? "",
    marksPerQuestion: input?.marksPerQuestion ?? "",
    negativeMarks: input?.negativeMarks ?? "",
    preferredQuestionType: input?.preferredQuestionType ?? "mcq",
  };
}

export default function AdminTests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const [selectedExamKey, setSelectedExamKey] = useState(() => readAdminExamSelection(location));
  const [createOpen, setCreateOpen] = useState(false);
  const [newExamType, setNewExamType] = useState<ExamType>("");
  const [newTitle, setNewTitle] = useState("");
  const [newExamHeader, setNewExamHeader] = useState("");
  const [newExamSubheader, setNewExamSubheader] = useState("");
  const [newCustomInstructions, setNewCustomInstructions] = useState("");
  const [newDuration, setNewDuration] = useState("30");
  const [newPassing, setNewPassing] = useState("60");
  const [newDefaultPositiveMarks, setNewDefaultPositiveMarks] = useState("1");
  const [newDefaultNegativeMarks, setNewDefaultNegativeMarks] = useState("0");
  const [newScheduled, setNewScheduled] = useState("");
  const [newTestCategory, setNewTestCategory] = useState<TestCategory>("mock");
  const [newCalculatorEnabled, setNewCalculatorEnabled] = useState(false);
  const [sectionDrafts, setSectionDrafts] = useState<SectionDraft[]>([makeSectionDraft()]);

  // ── Inline test settings dialog ───────────────────────────────────────────
  const [settingsTestId, setSettingsTestId] = useState<number | null>(null);
  const [settingsCategory, setSettingsCategory] = useState<TestCategory>("mock");
  const [settingsExamType, setSettingsExamType] = useState("");
  const [settingsDuration, setSettingsDuration] = useState("");
  const [settingsPassing, setSettingsPassing] = useState("");
  const [settingsScheduled, setSettingsScheduled] = useState("");
  const [settingsCalculator, setSettingsCalculator] = useState(false);

  // ── Bulk selection & bulk edit ────────────────────────────────────────────
  const [selectedTestIds, setSelectedTestIds] = useState<Set<number>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState<TestCategory | "">("");
  const [bulkExamType, setBulkExamType] = useState("");
  const [bulkPublish, setBulkPublish] = useState<"" | "publish" | "unpublish">("");

  const toggleSelectTest = (id: number) =>
    setSelectedTestIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const selectAllVisible = () => setSelectedTestIds(new Set(filteredTests?.map((t) => t.id) ?? []));
  const clearSelection = () => setSelectedTestIds(new Set());

  // ── Admin All-Tests Student View ──────────────────────────────────────────
  const [adminStudentViewOpen, setAdminStudentViewOpen] = useState(false);
  const [adminStudentViewTab, setAdminStudentViewTab] = useState<"view" | "reorder">("view");
  const [svSearchQuery, setSvSearchQuery] = useState("");
  const [svCategoryFilter, setSvCategoryFilter] = useState<"all" | TestCategory>("all");

  // ── Student Preview dialog ────────────────────────────────────────────────
  const [studentPreviewTestId, setStudentPreviewTestId] = useState<number | null>(null);
  const [studentPreviewTab, setStudentPreviewTab] = useState<"listing" | "view">("listing");
  const [studentPreviewLoading, setStudentPreviewLoading] = useState(false);
  const [studentPreviewDetail, setStudentPreviewDetail] = useState<{
    title: string; examHeader: string | null; examSubheader: string | null;
    instructions: string | null; examConfig: Record<string, unknown> | null;
    durationMinutes: number; questions: Question[]; sections: TestSection[];
  } | null>(null);
  const [studentPreviewCurrentQ, setStudentPreviewCurrentQ] = useState(0);
  const [studentPreviewShowInstructions, setStudentPreviewShowInstructions] = useState(true);
  const [reorderDraggedId, setReorderDraggedId] = useState<number | null>(null);
  const [reorderDragOverId, setReorderDragOverId] = useState<number | null>(null);
  const [reorderQuestions, setReorderQuestions] = useState<Question[]>([]);
  const [reorderSaving, setReorderSaving] = useState(false);

  const openStudentPreview = async (testId?: number) => {
    const resolvedId = testId ?? tests[0]?.id;
    if (!resolvedId) { toast({ title: "No tests available to preview" }); return; }
    setStudentPreviewTestId(resolvedId);
    setStudentPreviewTab("listing");
    setStudentPreviewShowInstructions(true);
    setStudentPreviewCurrentQ(0);
    setStudentPreviewDetail(null);
    setStudentPreviewLoading(true);
    try {
      const r = await fetch(buildApiUrl(`/api/tests/${resolvedId}`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load test");
      const data = await r.json();
      const qs: Question[] = Array.isArray(data.questions) ? [...data.questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
      const secs: TestSection[] = Array.isArray(data.sections) ? [...data.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
      setStudentPreviewDetail({
        title: data.title ?? "",
        examHeader: data.examHeader ?? null,
        examSubheader: data.examSubheader ?? null,
        instructions: data.instructions ?? null,
        examConfig: data.examConfig ?? null,
        durationMinutes: data.durationMinutes ?? 180,
        questions: qs,
        sections: secs,
      });
      setReorderQuestions(qs);
    } catch {
      toast({ title: "Preview load failed", variant: "destructive" });
      setStudentPreviewTestId(null);
    } finally {
      setStudentPreviewLoading(false);
    }
  };

  const saveQuestionReorder = async () => {
    if (!studentPreviewTestId || reorderQuestions.length === 0) return;
    setReorderSaving(true);
    try {
      await Promise.all(
        reorderQuestions.map((q, idx) =>
          fetch(buildApiUrl(`/api/tests/${studentPreviewTestId}/questions/${q.id}`), {
            method: "PATCH", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order: idx }),
          }),
        ),
      );
      setStudentPreviewDetail((prev) => prev ? { ...prev, questions: reorderQuestions.map((q, idx) => ({ ...q, order: idx })) } : prev);
      setQuestionsMap((prev) => ({ ...prev, [studentPreviewTestId]: reorderQuestions.map((q, idx) => ({ ...q, order: idx })) }));
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      toast({ title: "Questions reordered successfully" });
    } catch {
      toast({ title: "Reorder failed", variant: "destructive" });
    } finally {
      setReorderSaving(false);
    }
  };

  const handleReorderDragStart = (e: React.DragEvent, qId: number) => {
    setReorderDraggedId(qId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleReorderDragOver = (e: React.DragEvent, qId: number) => {
    e.preventDefault();
    if (qId !== reorderDraggedId) setReorderDragOverId(qId);
  };

  const handleReorderDrop = (e: React.DragEvent, dropId: number) => {
    e.preventDefault();
    if (reorderDraggedId === null || reorderDraggedId === dropId) { setReorderDraggedId(null); setReorderDragOverId(null); return; }
    setReorderQuestions((prev) => {
      const arr = [...prev];
      const fromIdx = arr.findIndex((q) => q.id === reorderDraggedId);
      const toIdx = arr.findIndex((q) => q.id === dropId);
      if (fromIdx === -1 || toIdx === -1) return arr;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
    setReorderDraggedId(null);
    setReorderDragOverId(null);
  };

  const bulkSetCalculator = async (enabled: boolean) => {
    const ids = Array.from(selectedTestIds);
    try {
      await fetch(buildApiUrl(`/api/tests/bulk-exam-config`), {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, examConfigPatch: { calculatorEnabled: enabled } }),
      });
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      toast({ title: `Calculator ${enabled ? "enabled" : "disabled"} for ${ids.length} test${ids.length === 1 ? "" : "s"}` });
    } catch {
      toast({ title: "Bulk update failed", variant: "destructive" });
    }
  };

  const bulkSetSync = async (enabled: boolean) => {
    const ids = Array.from(selectedTestIds);
    try {
      await fetch(buildApiUrl(`/api/tests/bulk-exam-config`), {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, examConfigPatch: { syncWithQuestionBank: enabled } }),
      });
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      toast({ title: `Question Bank sync ${enabled ? "enabled" : "disabled"} for ${ids.length} test${ids.length === 1 ? "" : "s"}` });
    } catch {
      toast({ title: "Bulk update failed", variant: "destructive" });
    }
  };

  // ── Background import queue ───────────────────────────────────────────────
  type ImportJobStatus = "pending" | "success" | "error";
  type ImportJob = {
    id: string;
    filename: string;
    title: string;
    status: ImportJobStatus;
    /** Simulated progress 0-100 */
    progress: number;
    /** ms timestamp when import started */
    startedAt: number;
    /** How long the import actually took in ms (set on success) */
    durationMs?: number;
    message?: string;
  };
  const [importQueue, setImportQueue] = useState<ImportJob[]>([]);

  // Persist import durations keyed by testId so they show on test cards after reload
  const LS_KEY = "rp_test_import_durations";
  const [importDurations, setImportDurations] = useState<Record<number, number>>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}"); } catch { return {}; }
  });
  const saveImportDuration = (testId: number, ms: number) => {
    setImportDurations((prev) => {
      const next = { ...prev, [testId]: ms };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  };

  // Tick simulated progress every 250 ms for pending jobs
  useEffect(() => {
    const hasPending = importQueue.some((j) => j.status === "pending");
    if (!hasPending) return;
    const id = setInterval(() => {
      const now = Date.now();
      setImportQueue((prev) =>
        prev.map((j) => {
          if (j.status !== "pending") return j;
          const elapsedSec = (now - j.startedAt) / 1000;
          // Asymptotic curve: caps at ~85% while in-flight, k controls speed
          const k = 0.35;
          const cap = 85;
          const simulated = cap * (1 - Math.exp(-k * elapsedSec));
          return { ...j, progress: Math.min(simulated, cap) };
        }),
      );
    }, 250);
    return () => clearInterval(id);
  }, [importQueue]);

  const dismissImportJob = (id: string) =>
    setImportQueue((prev) => prev.filter((j) => j.id !== id));

  const dismissAllCompletedImports = () =>
    setImportQueue((prev) => prev.filter((j) => j.status === "pending"));

  /** Format seconds into "Xs" / "Xm Xs" */
  const formatTimeLeft = (sec: number) => {
    if (sec <= 0) return "almost done";
    if (sec < 60) return `${Math.ceil(sec)}s left`;
    const m = Math.floor(sec / 60);
    const s = Math.ceil(sec % 60);
    return s > 0 ? `${m}m ${s}s left` : `${m}m left`;
  };

  // ─────────────────────────────────────────────────────────────────────────

  const [importOpen, setImportOpen] = useState(false);
  const [importBundle, setImportBundle] = useState<ExportedTestBundle | null>(null);
  const [importFilename, setImportFilename] = useState("");
  const [importExamType, setImportExamType] = useState("");
  const [importScheduled, setImportScheduled] = useState("");

  // ── Multi-HTML import ─────────────────────────────────────────────────────
  type MultiImportFileStatus = "parsing" | "ready" | "error";
  type MultiImportFile = {
    id: string;
    file: File;
    bundle: ExportedTestBundle | null;
    status: MultiImportFileStatus;
    error: string | null;
    questionCount: number;
  };
  const [multiImportOpen, setMultiImportOpen] = useState(false);
  const [multiImportExamType, setMultiImportExamType] = useState("");
  const [multiImportFiles, setMultiImportFiles] = useState<MultiImportFile[]>([]);
  const multiImportInputRef = useRef<HTMLInputElement>(null);

  const [metadataImportOpen, setMetadataImportOpen] = useState(false);
  const [metadataImportMode, setMetadataImportMode] = useState<QuestionBulkImportMode>("metadata");
  const [metadataImportTestId, setMetadataImportTestId] = useState<number | null>(null);
  const [metadataImportFilename, setMetadataImportFilename] = useState("");
  const [metadataImportText, setMetadataImportText] = useState("");
  const [publishResultDialog, setPublishResultDialog] = useState<PublishResultDialogState | null>(null);

  // ── AI Metadata Generator state ──────────────────────────────────────────
  const [aiMetaOpen, setAiMetaOpen] = useState(false);
  const [aiMetaTestId, setAiMetaTestId] = useState<number | null>(null);
  type AiMetaStep = "upload" | "analyzing" | "table" | "done" | "error";
  const [aiMetaStep, setAiMetaStep] = useState<AiMetaStep>("upload");
  const [aiMetaRows, setAiMetaRows] = useState<Array<{ questionCode: string; subject: string; chapter: string; topic: string; difficulty: string; idealTimeSeconds: number }>>([]);
  const [aiMetaProgress, setAiMetaProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [aiMetaError, setAiMetaError] = useState<string | null>(null);
  const [aiMetaIsDragging, setAiMetaIsDragging] = useState(false);
  const aiMetaFileRef = useRef<HTMLInputElement>(null);

  // ── Bulk AI Metadata state ─────────────────────────────────────────────────
  const [bulkAiMetaOpen, setBulkAiMetaOpen] = useState(false);
  const [bulkAiMetaRunning, setBulkAiMetaRunning] = useState(false);
  const [bulkAiMetaAutoImport, setBulkAiMetaAutoImport] = useState(true);
  type BulkAiMetaStatus = "pending" | "fetching" | "analyzing" | "importing" | "done" | "error" | "skipped";
  type MetaRow = { questionCode: string; subject: string; chapter: string; topic: string; difficulty: string; idealTimeSeconds: number };
  interface BulkAiMetaJob {
    testId: number;
    title: string;
    status: BulkAiMetaStatus;
    progress: { done: number; total: number };
    error: string | null;
    partialMeta: MetaRow[]; // accumulated so far — used to resume on retry
  }
  const [bulkAiMetaJobs, setBulkAiMetaJobs] = useState<BulkAiMetaJob[]>([]);
  const bulkAiMetaCancelRef = useRef(false);

  const resetAiMetaDialog = () => {
    setAiMetaStep("upload");
    setAiMetaRows([]);
    setAiMetaError(null);
    setAiMetaProgress({ done: 0, total: 0 });
    setAiMetaIsDragging(false);
    if (aiMetaFileRef.current) aiMetaFileRef.current.value = "";
  };

  // Core analysis — accepts already-parsed questions, no file upload needed
  const runAiAnalysisParsed = async (allQuestions: ParsedQuestion[]) => {
    if (!allQuestions.length) { setAiMetaError("Is test mein koi question nahi mila."); setAiMetaStep("upload"); return; }
    setAiMetaError(null);
    setAiMetaStep("analyzing");
    setAiMetaProgress({ done: 0, total: allQuestions.length });

    const BATCH = 10;
    const allMeta: typeof aiMetaRows = [];
    try {
      for (let i = 0; i < allQuestions.length; i += BATCH) {
        const batch = allQuestions.slice(i, i + BATCH);
        const res = await fetch(buildApiUrl(`/api/metadata/analyze`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ questions: batch }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        allMeta.push(...data);
        setAiMetaProgress({ done: Math.min(i + BATCH, allQuestions.length), total: allQuestions.length });
      }
      setAiMetaRows(allMeta);
      setAiMetaStep("table");
    } catch (err) {
      setAiMetaError(err instanceof Error ? err.message : String(err));
      setAiMetaStep("error");
    }
  };

  // Convert existing test Question[] → ParsedQuestion[] and run analysis
  const runAiAnalysisFromTestQuestions = (questions: Question[]) => {
    const qtypeMap: Record<QuestionType, string> = { mcq: "MCQ", multi: "MULTI", integer: "INTEGER" };
    const parsed: ParsedQuestion[] = questions.map((q, idx) => ({
      questionCode: q.questionCode ?? `Q${String(idx + 1).padStart(2, "0")}`,
      qnum: idx + 1,
      qtype: qtypeMap[q.questionType] ?? "MCQ",
      questionText: stripRichHtmlToText(q.question) || q.question || "",
      optionsText: q.options ?? [],
      hasImages: !!(q.imageData || q.optionImages?.some((x) => x != null)),
      marksRight: q.points,
      marksWrong: q.negativeMarks ?? 0,
      tagsRaw: q.subjectLabel ?? "",
      subjectRaw: q.subjectLabel ?? "",
    }));
    void runAiAnalysisParsed(parsed);
  };

  const openAiMetaDialog = (testId: number) => {
    setAiMetaTestId(testId);
    setAiMetaRows([]);
    setAiMetaError(null);
    setAiMetaProgress({ done: 0, total: 0 });
    setAiMetaIsDragging(false);
    if (aiMetaFileRef.current) aiMetaFileRef.current.value = "";
    setAiMetaOpen(true);

    // Existing questions already loaded → start analysis immediately, no HTML upload needed
    const existing = questionsMap[testId];
    if (existing && existing.length > 0) {
      runAiAnalysisFromTestQuestions(existing);
    } else {
      // Questions not cached yet — fetch from API then run analysis directly
      setAiMetaStep("analyzing");
      setAiMetaProgress({ done: 0, total: 0 });
      (async () => {
        try {
          const r = await fetch(buildApiUrl(`/api/tests/${testId}`), { credentials: "include" });
          if (!r.ok) throw new Error(`Failed to load test questions (HTTP ${r.status})`);
          const data = await r.json();
          const questions: Question[] = data.questions ?? [];
          setQuestionsMap((prev) => ({ ...prev, [testId]: questions }));
          setSectionsMap((prev) => ({ ...prev, [testId]: data.sections ?? [] }));
          if (questions.length === 0) {
            setAiMetaError("Is test mein koi question nahi mila. Pehle questions add karo.");
            setAiMetaStep("upload");
            return;
          }
          runAiAnalysisFromTestQuestions(questions);
        } catch (err) {
          setAiMetaError(err instanceof Error ? err.message : String(err));
          setAiMetaStep("error");
        }
      })();
    }
  };

  const runAiAnalysis = async (files: File[]) => {
    const htmlFiles = files.filter((f) => f.name.endsWith(".html") || f.name.endsWith(".htm"));
    if (!htmlFiles.length) { setAiMetaError("Sirf HTML files supported hain."); return; }
    setAiMetaError(null);
    const allQuestions: ParsedQuestion[] = [];
    for (const file of htmlFiles) {
      const text = await file.text();
      const { questions } = parseQuestionsFromHTML(text);
      allQuestions.push(...questions);
    }
    void runAiAnalysisParsed(allQuestions);
  };

  // ── Bulk AI Metadata functions ─────────────────────────────────────────────
  const openBulkAiMeta = () => {
    const jobs: BulkAiMetaJob[] = Array.from(selectedTestIds).map((id) => ({
      testId: id,
      title: tests.find((t) => t.id === id)?.title ?? `Test #${id}`,
      status: "pending" as BulkAiMetaStatus,
      progress: { done: 0, total: 0 },
      error: null,
      partialMeta: [],
    }));
    setBulkAiMetaJobs(jobs);
    setBulkAiMetaRunning(false);
    bulkAiMetaCancelRef.current = false;
    setBulkAiMetaOpen(true);
  };

  const updateBulkJob = (testId: number, update: Partial<BulkAiMetaJob>) =>
    setBulkAiMetaJobs((prev) => prev.map((j) => (j.testId === testId ? { ...j, ...update } : j)));

  // ── Core per-job processing (shared by bulk run + individual retry) ─────────
  const processBulkJob = async (job: BulkAiMetaJob, cancelRef: React.MutableRefObject<boolean>) => {
    const BATCH = 10;
    const qtypeMap: Record<QuestionType, string> = { mcq: "MCQ", multi: "MULTI", integer: "INTEGER" };

    if (cancelRef.current) { updateBulkJob(job.testId, { status: "skipped" }); return; }
    try {
      // Step 1: fetch questions (use cache if available)
      updateBulkJob(job.testId, { status: "fetching", progress: { done: job.partialMeta.length, total: 0 } });
      let questions: Question[];
      if (questionsMap[job.testId]?.length) {
        questions = questionsMap[job.testId];
      } else {
        const r = await fetch(buildApiUrl(`/api/tests/${job.testId}`), { credentials: "include" });
        if (!r.ok) throw new Error(`Questions load failed (HTTP ${r.status})`);
        const data = await r.json();
        questions = Array.isArray(data.questions) ? (data.questions as Question[]) : [];
        setQuestionsMap((prev) => ({ ...prev, [job.testId]: questions }));
      }
      if (!questions.length) {
        updateBulkJob(job.testId, { status: "skipped", error: "No questions found" });
        return;
      }

      // Step 2: analyze — resume from where we left off (partialMeta.length = already done)
      const parsed: ParsedQuestion[] = questions.map((q, idx) => ({
        questionCode: q.questionCode ?? `Q${String(idx + 1).padStart(2, "0")}`,
        qnum: idx + 1,
        qtype: qtypeMap[q.questionType] ?? "MCQ",
        questionText: stripRichHtmlToText(q.question) || q.question || "",
        optionsText: q.options ?? [],
        hasImages: !!(q.imageData || q.optionImages?.some((x) => x != null)),
        marksRight: q.points,
        marksWrong: q.negativeMarks ?? 0,
        tagsRaw: q.subjectLabel ?? "",
        subjectRaw: q.subjectLabel ?? "",
      }));

      const resumeFrom = job.partialMeta.length; // 0 on first run, >0 on retry
      const allMeta: MetaRow[] = [...job.partialMeta];
      updateBulkJob(job.testId, { status: "analyzing", progress: { done: resumeFrom, total: parsed.length } });

      for (let i = resumeFrom; i < parsed.length; i += BATCH) {
        if (cancelRef.current) break;
        const batch = parsed.slice(i, i + BATCH);
        const res = await fetch(buildApiUrl(`/api/metadata/analyze`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ questions: batch }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
        }
        allMeta.push(...(await res.json() as MetaRow[]));
        // Save partial progress so retry can resume here
        updateBulkJob(job.testId, { partialMeta: allMeta, progress: { done: Math.min(i + BATCH, parsed.length), total: parsed.length } });
      }

      if (cancelRef.current) { updateBulkJob(job.testId, { status: "skipped" }); return; }

      // Step 3: auto-import
      if (bulkAiMetaAutoImport) {
        updateBulkJob(job.testId, { status: "importing" });
        const imp = await fetch(buildApiUrl(`/api/tests/${job.testId}/import-question-metadata`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(allMeta),
        });
        if (!imp.ok) throw new Error(`Import failed (HTTP ${imp.status})`);
      }
      updateBulkJob(job.testId, { status: "done", partialMeta: allMeta, progress: { done: parsed.length, total: parsed.length } });
    } catch (err) {
      // Save whatever was collected so far — retry will resume from this point
      updateBulkJob(job.testId, { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  };

  const runBulkAiMeta = async () => {
    setBulkAiMetaRunning(true);
    bulkAiMetaCancelRef.current = false;
    // Snapshot jobs — skip already-done ones
    const snapshot = bulkAiMetaJobs.filter((j) => j.status !== "done");
    for (const job of snapshot) {
      await processBulkJob(job, bulkAiMetaCancelRef);
    }
    setBulkAiMetaRunning(false);
    void queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
  };

  const retryOneBulkJob = async (testId: number) => {
    if (bulkAiMetaRunning) return;
    // Find current job (with its partialMeta for resume)
    const job = bulkAiMetaJobs.find((j) => j.testId === testId);
    if (!job) return;
    setBulkAiMetaRunning(true);
    bulkAiMetaCancelRef.current = false;
    await processBulkJob(job, bulkAiMetaCancelRef);
    setBulkAiMetaRunning(false);
    void queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
  };

  const [questionsMap, setQuestionsMap] = useState<Record<number, Question[]>>({});
  const [sectionsMap, setSectionsMap] = useState<Record<number, TestSection[]>>({});
  const loadingTestSummaryIdsRef = useRef(new Set<number>());
  const [exportingTestId, setExportingTestId] = useState<number | null>(null);
  const [exportingTestPdfId, setExportingTestPdfId] = useState<number | null>(null);
  const [renamingTestId, setRenamingTestId] = useState<number | null>(null);
  const [renamingTitleValue, setRenamingTitleValue] = useState("");
  const [renamingLoading, setRenamingLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<TestCategory | "all">("all");
  const importTestInputRef = useRef<HTMLInputElement>(null);
  const metadataImportInputRef = useRef<HTMLInputElement>(null);

  const { data: tests = [], isLoading } = useQuery<Test[]>({
    queryKey: ["admin-tests"],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/tests`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    const syncExam = () => setSelectedExamKey(readAdminExamSelection(location));
    window.addEventListener("admin-exam-changed", syncExam);
    window.addEventListener("storage", syncExam);
    syncExam();
    return () => {
      window.removeEventListener("admin-exam-changed", syncExam);
      window.removeEventListener("storage", syncExam);
    };
  }, [location]);

  const { data: examTemplates = FALLBACK_TEMPLATES } = useQuery<ExamTemplate[]>({
    queryKey: ["exam-templates"],
    queryFn: fetchExamTemplatesList,
    staleTime: 60_000,
  });

  const prefetchBuilderResources = (testId: number) => {
    void Promise.all([
      queryClient.prefetchQuery({
        queryKey: ["admin-test-builder", testId],
        queryFn: () => fetchBuilderTestDetail(testId),
        staleTime: 60_000,
      }),
      queryClient.prefetchQuery({
        queryKey: ["exam-templates"],
        queryFn: fetchExamTemplatesList,
        staleTime: 60_000,
      }),
    ]);
  };

  const openBuilder = (testId: number, questionId?: number | null) => {
    prefetchBuilderResources(testId);
    setLocation(questionId ? `/admin/tests/${testId}/builder?questionId=${questionId}` : `/admin/tests/${testId}/builder`);
  };

  const startRename = (testId: number, currentTitle: string) => {
    setRenamingTestId(testId);
    setRenamingTitleValue(currentTitle);
  };

  const cancelRename = () => {
    setRenamingTestId(null);
    setRenamingTitleValue("");
  };

  const commitRename = async (testId: number) => {
    const trimmed = renamingTitleValue.trim();
    if (!trimmed) { cancelRename(); return; }
    setRenamingLoading(true);
    try {
      const r = await fetch(buildApiUrl(`/api/tests/${testId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: trimmed }),
      });
      if (!r.ok) throw new Error("Failed to rename");
      await queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      toast({ title: "Test renamed", description: `Renamed to "${trimmed}".` });
    } catch {
      toast({ title: "Rename failed", variant: "destructive" });
    } finally {
      setRenamingLoading(false);
      cancelRename();
    }
  };

  const applyPreset = (preset: string) => {
    setNewExamType(preset);
    const template = examTemplates.find((item) => item.key === preset) ?? FALLBACK_TEMPLATES.find((item) => item.key === preset);
    if (!template) return;
    setNewExamHeader(template.examHeader ?? template.name);
    setNewExamSubheader(template.examSubheader ?? `${template.name} Mock Assessment`);
    setNewCustomInstructions(template.customInstructions?.trim() || "");
    setNewDuration(String(template.durationMinutes));
    setNewPassing(template.passingScore == null ? "" : String(template.passingScore));
    setNewDefaultPositiveMarks(String(template.defaultPositiveMarks));
    setNewDefaultNegativeMarks(String(template.defaultNegativeMarks));
    setSectionDrafts(template.sections.map((section) => makeSectionDraft({
      title: section.title,
      description: section.description ?? "",
      subjectLabel: section.subjectLabel ?? "",
      questionCount: section.questionCount != null ? String(section.questionCount) : "",
      marksPerQuestion: section.marksPerQuestion != null ? String(section.marksPerQuestion) : "",
      negativeMarks: section.negativeMarks != null ? String(section.negativeMarks) : "",
      preferredQuestionType: section.preferredQuestionType ?? "mcq",
    })));
  };

  useEffect(() => {
    if (!createOpen) return;
    const templateExists = examTemplates.some((template) => template.key === newExamType);
    if (!newExamType || !templateExists) {
      const firstTemplate = examTemplates[0] ?? FALLBACK_TEMPLATES[0];
      if (firstTemplate) applyPreset(firstTemplate.key);
    }
  }, [createOpen, examTemplates, newExamType]);

  const examTests = selectedExamKey
    ? tests.filter((test) => testBelongsToAdminExam(test, selectedExamKey))
    : tests;
  const totalTests = examTests.length;
  const publishedTests = examTests.filter((test) => test.isPublished).length;
  const draftTests = totalTests - publishedTests;
  const totalQuestions = examTests.reduce((sum, test) => sum + Math.max(0, Number(test.questionCount) || 0), 0);

  const categoryCounts: Record<TestCategory | "all", number> = { all: tests.length, mock: 0, "subject-wise": 0, "multi-subject": 0, pyq: 0 };
  examTests.forEach((test) => {
    const sections = sectionsMap[test.id] ?? [];
    categoryCounts[getResolvedTestCategory(test, sections)]++;
  });

  const filteredTests = activeCategory === "all"
    ? examTests
    : examTests.filter((test) => {
        const sections = sectionsMap[test.id] ?? [];
        return getResolvedTestCategory(test, sections) === activeCategory;
      });
  const metadataImportTest = metadataImportTestId != null
    ? tests.find((test) => test.id === metadataImportTestId) ?? null
    : null;
  const metadataImportConfig = metadataImportMode === "answers"
    ? {
        title: "Import Correct Answers",
        intro: "This import only updates the correct answers for this test.",
        helper: "Questions are matched using `questionCode`/`Q01` or `questionNumber`.",
        loadedFileText: "Paste correct-answer JSON below for this test.",
        quickCards: [
          { label: "Match", value: "`questionCode`, `code`, `questionNumber`, `questionNo`" },
          { label: "MCQ", value: "`correctAnswer`" },
          { label: "Multi-select", value: "`correctAnswerMulti` ya `answers`" },
          { label: "Integer", value: "`correctAnswer`, `correctAnswerMin`, `correctAnswerMax`" },
        ],
        example: `[
  {
    "questionCode": "Q20",
    "correctAnswer": "B"
  },
  {
    "questionCode": "Q21",
    "correctAnswerMulti": ["A", "C"]
  },
  {
    "questionCode": "Q22",
    "correctAnswerMin": 35.05,
    "correctAnswerMax": 42.05
  }
]`,
        pasteTitle: "Paste Correct Answer JSON",
        pasteHelper: "Paste answers directly here. Matching questions in the existing test will be updated.",
        submitLabel: "Import Correct Answer",
        invalidFileTitle: "Invalid correct-answer file",
        invalidJsonTitle: "Invalid correct-answer JSON",
      }
    : {
        title: "Import Question Metadata",
        intro: "This import only updates existing questions in this test.",
        helper: "No new test will be created. Matching is based on `questionCode`/`Q01` or `questionNumber`.",
        loadedFileText: "Paste metadata JSON below for this test.",
        quickCards: [
          { label: "Match", value: "`questionCode`, `code`, `questionNumber`, `questionNo`" },
          { label: "Metadata", value: "`subject`, `chapter`, `topic`, `difficulty`, `idealTimeSeconds`" },
          { label: "Answers", value: "`correctAnswer`, `correctAnswerMulti`, `correctAnswerMin`, `correctAnswerMax`" },
          { label: "Shapes", value: "root array, `questions`, `items`, `test.questions`" },
        ],
        example: `[
  {
    "questionCode": "Q20",
    "subject": "Communication Systems",
    "chapter": "Digital Modulation",
    "topic": "PSK & QAM",
    "difficulty": "moderate",
    "idealTimeSeconds": 120
  }
]`,
        pasteTitle: "Paste Metadata JSON",
        pasteHelper: "Paste directly here. Each line or question will be applied to the selected test.",
        submitLabel: "Import Metadata",
        invalidFileTitle: "Invalid metadata file",
        invalidJsonTitle: "Invalid metadata JSON",
      };

  const resetImportDialog = () => {
    setImportOpen(false);
    setImportBundle(null);
    setImportFilename("");
    setImportExamType("");
    setImportScheduled("");
  };

  const resetMultiImportDialog = () => {
    setMultiImportOpen(false);
    setMultiImportFiles([]);
    setMultiImportExamType("");
  };

  const handleMultiImportFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const htmlFiles = Array.from(files).filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase();
      return ext === "html" || ext === "htm" || f.type.includes("html");
    });
    if (htmlFiles.length === 0) {
      toast({ title: "No HTML files", description: "Please select .html or .htm files.", variant: "destructive" });
      return;
    }
    const entries: MultiImportFile[] = htmlFiles.map((f) => ({
      id: `mf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: f,
      bundle: null,
      status: "parsing" as MultiImportFileStatus,
      error: null,
      questionCount: 0,
    }));
    setMultiImportFiles(entries);
    setMultiImportOpen(true);

    const updated = await Promise.all(
      entries.map(async (entry) => {
        try {
          const bundle = await parseSavedHtmlTestImport(entry.file);
          return { ...entry, bundle, status: "ready" as MultiImportFileStatus, questionCount: bundle.test.questions.length };
        } catch (err) {
          return { ...entry, status: "error" as MultiImportFileStatus, error: err instanceof Error ? err.message : "Parse error" };
        }
      }),
    );
    setMultiImportFiles(updated);
  };

  const handleStartMultiImport = () => {
    const readyFiles = multiImportFiles.filter((f) => f.status === "ready" && f.bundle);
    if (!readyFiles.length || !multiImportExamType) return;
    // Sort by the numeric prefix in the filename (002_, 003_, …) so tests are
    // imported — and therefore displayed — in the same order as the file names.
    const sortedFiles = [...readyFiles].sort((a, b) => {
      const orderA = extractFilenameOrder(a.file.name) ?? Infinity;
      const orderB = extractFilenameOrder(b.file.name) ?? Infinity;
      return orderA - orderB;
    });
    for (const entry of sortedFiles) {
      if (!entry.bundle) continue;
      startBackgroundImport({
        bundle: entry.bundle,
        examType: multiImportExamType,
        scheduledAt: "",
        filename: entry.file.name,
      });
    }
    resetMultiImportDialog();
  };

  const resetMetadataImportDialog = () => {
    setMetadataImportOpen(false);
    setMetadataImportMode("metadata");
    setMetadataImportTestId(null);
    setMetadataImportFilename("");
    setMetadataImportText("");
  };

  const openMetadataImportDialog = (testId: number, mode: QuestionBulkImportMode) => {
    setMetadataImportMode(mode);
    setMetadataImportTestId(testId);
    setMetadataImportFilename("");
    setMetadataImportText("");
    setMetadataImportOpen(true);
  };

  const handleMetadataImportFile = async (testId: number, file?: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if ((!Array.isArray(parsed) && (typeof parsed !== "object" || parsed === null))) {
        throw new Error("Please upload a JSON object or question metadata array.");
      }
      setMetadataImportTestId(testId);
      setMetadataImportFilename(file.name);
      setMetadataImportText(text);
      setMetadataImportOpen(true);
    } catch (error) {
      toast({
        title: metadataImportConfig.invalidFileTitle,
        description: error instanceof Error ? error.message : "Please upload a valid JSON file.",
        variant: "destructive",
      });
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(buildApiUrl(`/api/tests`), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: null,
          examType: newExamType,
          examHeader: newExamHeader.trim() || null,
          examSubheader: newExamSubheader.trim() || null,
          instructions: newCustomInstructions.trim() || null,
          durationMinutes: parseInt(newDuration) || 30,
          passingScore: newPassing.trim() ? parseInt(newPassing) : null,
          defaultPositiveMarks: parseFloat(newDefaultPositiveMarks) || 1,
          defaultNegativeMarks: parseFloat(newDefaultNegativeMarks) || 0,
          examConfig: {
            bulkSupported: true,
            sectionCount: sectionDrafts.filter((section) => (section.subjectLabel.trim() || section.title.trim())).length,
            sourceModes: ["manual", "bulk", "ai"],
            testCategory: newTestCategory,
            calculatorEnabled: newCalculatorEnabled,
          },
          scheduledAt: newScheduled || null,
              sections: sectionDrafts
            .filter((section) => (section.subjectLabel.trim() || section.title.trim()))
            .map((section) => ({
              title: (section.subjectLabel.trim() || section.title.trim()),
              description: section.description.trim() || null,
              subjectLabel: section.subjectLabel.trim() || null,
              questionCount: section.questionCount.trim() ? parseInt(section.questionCount) : null,
              marksPerQuestion: section.marksPerQuestion.trim() ? parseFloat(section.marksPerQuestion) : null,
              negativeMarks: section.negativeMarks.trim() ? parseFloat(section.negativeMarks) : null,
              meta: { structureSource: newExamType, preferredQuestionType: section.preferredQuestionType },
            })),
        }),
      });
      if (!r.ok) {
        const message = await r.text();
        throw new Error(message || "Failed");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      setCreateOpen(false); setNewExamType(""); setNewTitle(""); setNewExamHeader(""); setNewExamSubheader(""); setNewCustomInstructions(""); setNewDuration("30"); setNewPassing(""); setNewDefaultPositiveMarks("1"); setNewDefaultNegativeMarks("0"); setNewScheduled(""); setNewTestCategory("mock"); setNewCalculatorEnabled(false); setSectionDrafts([makeSectionDraft()]);
      toast({ title: "Test created" });
    },
    onError: (error: Error) => toast({ title: "Failed to create test", description: error.message, variant: "destructive" }),
  });

  const startBackgroundImport = useCallback(({
    bundle,
    examType,
    scheduledAt,
    filename,
  }: {
    bundle: ExportedTestBundle;
    examType: string;
    scheduledAt: string;
    filename: string;
  }) => {
    const jobId = `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const title = bundle.test.title ?? filename;

    // Close modal immediately and add job to queue
    const startedAt = Date.now();
    resetImportDialog();
    setImportQueue((prev) => [
      ...prev,
      { id: jobId, filename, title, status: "pending", progress: 0, startedAt },
    ]);

    const filenameOrder = extractFilenameOrder(filename);
    const normalizedBundle: ExportedTestBundle = {
      ...bundle,
      test: {
        ...bundle.test,
        examType,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        // Pass the numeric prefix (e.g. 2 from "002_…") so the backend can
        // store it as displayOrder and preserve the intended file-name sequence.
        ...(filenameOrder !== null ? { displayOrder: filenameOrder } : {}),
      },
    };

    fetch(buildApiUrl(`/api/tests/import`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedBundle),
    })
      .then(async (r) => {
        if (!r.ok) {
          const message = await r.text();
          throw new Error(message || "Failed to import test");
        }
        return r.json() as Promise<{ id?: number; title?: string; sectionCount?: number; questionCount?: number; pendingReviewCount?: number }>;
      })
      .then((data) => {
        const durationMs = Date.now() - startedAt;
        // Persist duration so the test card shows it even after page reload
        if (typeof data.id === "number") saveImportDuration(data.id, durationMs);
        queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
        const desc = (data.pendingReviewCount ?? 0) > 0
          ? `${data.pendingReviewCount} question${data.pendingReviewCount === 1 ? "" : "s"} still need manual setup.`
          : `Ready as draft · ${data.sectionCount ?? 0} sections · ${data.questionCount ?? 0} questions`;
        setImportQueue((prev) =>
          prev.map((j) => j.id === jobId ? { ...j, status: "success", progress: 100, durationMs, message: desc } : j),
        );
        // Auto-dismiss success after 8 s
        setTimeout(() => dismissImportJob(jobId), 8000);
      })
      .catch((error: Error) => {
        setImportQueue((prev) =>
          prev.map((j) => j.id === jobId ? { ...j, status: "error", progress: 100, message: error.message } : j),
        );
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  const importMetadataMutation = useMutation({
    mutationFn: async ({ testId, payload, mode }: { testId: number; payload: unknown; mode: QuestionBulkImportMode }) => {
      const r = await fetch(buildApiUrl(`/api/tests/${testId}/import-question-metadata`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const message = formatApiErrorMessage(
          await r.text(),
          `Failed to import ${mode === "answers" ? "correct answers" : "question metadata"}`,
        );
        throw new Error(message);
      }
      return r.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      resetMetadataImportDialog();
      const skippedPreview = Array.isArray(data.skippedRows)
        ? data.skippedRows.filter((value: unknown) => typeof value === "string" && value.trim()).slice(0, 5)
        : [];
      const skippedSuffix = data.skippedCount > 0
        ? skippedPreview.length > 0
          ? ` (${skippedPreview.join(", ")}${data.skippedCount > skippedPreview.length ? ` + ${data.skippedCount - skippedPreview.length} more` : ""})`
          : ""
        : "";
      toast({
        title: variables.mode === "answers" ? "Correct answers imported" : "Metadata imported",
        description: `${data.updatedCount} questions updated${data.skippedCount > 0 ? `, ${data.skippedCount} rows skipped${skippedSuffix}` : ""}${data.unresolvedCount > 0 ? `, ${data.unresolvedCount} still need review` : ""}.`,
      });
    },
    onError: (error: Error, variables) => {
      toast({
        title: variables.mode === "answers" ? "Correct-answer import failed" : "Metadata import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, isPublished }: { id: number; isPublished: boolean }) => {
      const r = await fetch(buildApiUrl(`/api/tests/${id}`), { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPublished }) });
      if (!r.ok) {
        const message = formatApiErrorMessage(
          await r.text(),
          isPublished ? "Failed to publish test" : "Failed to unpublish test",
        );
        throw new Error(message);
      }
      return r.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["admin-tests"] });
      const previousTests = queryClient.getQueryData<Test[]>(["admin-tests"]);
      queryClient.setQueryData<Test[]>(["admin-tests"], (current = []) =>
        current.map((test) => (
          test.id === variables.id
            ? { ...test, isPublished: variables.isPublished }
            : test
        )),
      );
      return { previousTests };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank"] });
      // Student-facing queries must also refresh so the test appears/disappears for students
      queryClient.invalidateQueries({ queryKey: ["student-tests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-tests"] });
      queryClient.invalidateQueries({ queryKey: ["student-question-bank-exams"] });
      if (variables.isPublished) {
        const sync = data?.questionBankSync as PublishSyncSummary | null | undefined;
        if (sync) {
          setPublishResultDialog({
            testId: data?.id ?? variables.id,
            testTitle: data?.title ?? "Test",
            summary: sync,
          });
          return;
        }
      }
      if (!variables.isPublished) {
        const cleanup = data?.questionBankCleanup as UnpublishCleanupSummary | null | undefined;
        if (cleanup) {
          const cleanupParts = [
            cleanup.removedQuestionCount > 0
              ? `${cleanup.removedQuestionCount} question${cleanup.removedQuestionCount === 1 ? "" : "s"} removed from Question Bank`
              : null,
            cleanup.removedChapterCount && cleanup.removedChapterCount > 0
              ? `${cleanup.removedChapterCount} chapter${cleanup.removedChapterCount === 1 ? "" : "s"} removed`
              : null,
            cleanup.removedSubjectCount && cleanup.removedSubjectCount > 0
              ? `${cleanup.removedSubjectCount} subject${cleanup.removedSubjectCount === 1 ? "" : "s"} removed`
              : null,
          ].filter(Boolean);
          toast({
            title: "Test unpublished",
            description: cleanupParts.length > 0
              ? `${cleanupParts.join(", ")}. Review Bucket hidden for this test.`
              : "Question Bank sync removed and Review Bucket hidden for this test.",
          });
          return;
        }
      }
      toast({ title: variables.isPublished ? "Test published" : "Test unpublished" });
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousTests) {
        queryClient.setQueryData(["admin-tests"], context.previousTests);
      }
      toast({
        title: "Publish update failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank"] });
      queryClient.invalidateQueries({ queryKey: ["student-tests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-tests"] });
    },
  });

  const updateTestConfigMutation = useMutation({
    mutationFn: async ({ id, examConfig }: { id: number; examConfig: Record<string, unknown> }) => {
      const r = await fetch(buildApiUrl(`/api/tests/${id}`), {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examConfig }),
      });
      if (!r.ok) throw new Error("Failed to update test settings");
      return r.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["admin-tests"] });
      const previousTests = queryClient.getQueryData<Test[]>(["admin-tests"]);
      queryClient.setQueryData<Test[]>(["admin-tests"], (current = []) =>
        current.map((test) => (
          test.id === variables.id
            ? { ...test, examConfig: { ...normalizeExamConfigObject(test.examConfig), ...variables.examConfig } }
            : test
        )),
      );
      return { previousTests };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      queryClient.invalidateQueries({ queryKey: ["student-tests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-tests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });

      if (variables.examConfig?.syncWithQuestionBank === true) {
        const sync = data?.questionBankSync as PublishSyncSummary | null | undefined;
        if (sync) {
          setPublishResultDialog({
            testId: data?.id ?? variables.id,
            testTitle: data?.title ?? "Test",
            summary: sync,
          });
          return;
        }
        toast({ title: "Question Bank sync enabled", description: "Questions will sync to the question bank on next publish." });
        return;
      }
      if (variables.examConfig?.syncWithQuestionBank === false) {
        const cleanup = data?.questionBankCleanup as UnpublishCleanupSummary | null | undefined;
        if (cleanup) {
          const cleanupParts = [
            cleanup.removedQuestionCount > 0
              ? `${cleanup.removedQuestionCount} question${cleanup.removedQuestionCount === 1 ? "" : "s"} removed from Question Bank`
              : null,
            cleanup.removedChapterCount && cleanup.removedChapterCount > 0
              ? `${cleanup.removedChapterCount} chapter${cleanup.removedChapterCount === 1 ? "" : "s"} removed`
              : null,
            cleanup.removedSubjectCount && cleanup.removedSubjectCount > 0
              ? `${cleanup.removedSubjectCount} subject${cleanup.removedSubjectCount === 1 ? "" : "s"} removed`
              : null,
          ].filter(Boolean);
          toast({
            title: "Question Bank sync disabled",
            description: cleanupParts.length > 0
              ? cleanupParts.join(", ") + "."
              : "Questions removed from Question Bank.",
          });
        } else {
          toast({ title: "Question Bank sync disabled" });
        }
        return;
      }
      if (variables.examConfig?.showOnStudentDashboard === true) {
        toast({ title: "Visible on Student Dashboard", description: "Students can now see this test in their Tests tab." });
        return;
      }
      if (variables.examConfig?.showOnStudentDashboard === false) {
        toast({ title: "Hidden from Student Dashboard", description: "This test is now hidden from students' Tests tab." });
        return;
      }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousTests) queryClient.setQueryData(["admin-tests"], context.previousTests);
      toast({ title: "Update failed", variant: "destructive" });
    },
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (id: number) => { await fetch(buildApiUrl(`/api/tests/${id}`), { method: "DELETE", credentials: "include" }); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-tests"] }); toast({ title: "Test deleted" }); },
  });

  const reorderTestsMutation = useMutation({
    mutationFn: async ({ orderedIds }: { orderedIds: number[]; newPosition: number; testName: string }) => {
      const r = await fetch(buildApiUrl(`/api/tests/reorder`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!r.ok) throw new Error("Failed to reorder");
    },
    onMutate: async ({ orderedIds }) => {
      // Cancel any in-flight refetches so they don't overwrite the optimistic update
      await queryClient.cancelQueries({ queryKey: ["admin-tests"] });
      const previousTests = queryClient.getQueryData<Test[]>(["admin-tests"]);
      // Immediately reorder the cache so the UI reflects the new order without waiting for the API
      if (previousTests) {
        const idToTest = new Map(previousTests.map((t) => [t.id, t]));
        const reordered = orderedIds.map((id) => idToTest.get(id)).filter((t): t is Test => t !== undefined);
        queryClient.setQueryData<Test[]>(["admin-tests"], reordered);
      }
      return { previousTests };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      queryClient.invalidateQueries({ queryKey: ["student-tests"] });
      toast({
        title: "Order saved",
        description: `"${variables.testName}" moved to position ${variables.newPosition}.`,
      });
    },
    onError: (_err, _vars, context) => {
      // Roll back to the previous order if the API call fails
      if (context?.previousTests) {
        queryClient.setQueryData<Test[]>(["admin-tests"], context.previousTests);
      }
      toast({ title: "Reorder failed", variant: "destructive" });
    },
  });

  const [draggedTestId, setDraggedTestId] = useState<number | null>(null);
  const [dragOverTestId, setDragOverTestId] = useState<number | null>(null);
  const [editingPositionTestId, setEditingPositionTestId] = useState<number | null>(null);
  const [editingPositionValue, setEditingPositionValue] = useState<string>("");

  const dragPreviewTests = useMemo(() => {
    if (draggedTestId === null || dragOverTestId === null || draggedTestId === dragOverTestId) {
      return filteredTests;
    }
    const arr = [...filteredTests];
    const fromIdx = arr.findIndex((t) => t.id === draggedTestId);
    const toIdx = arr.findIndex((t) => t.id === dragOverTestId);
    if (fromIdx === -1 || toIdx === -1) return arr;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    return arr;
  }, [filteredTests, draggedTestId, dragOverTestId]);

  // Preview of all tests while dragging in the student view overlay
  const svDragPreviewTests = useMemo(() => {
    if (draggedTestId === null || dragOverTestId === null || draggedTestId === dragOverTestId) {
      return tests;
    }
    const arr = [...tests];
    const fromIdx = arr.findIndex((t) => t.id === draggedTestId);
    const toIdx = arr.findIndex((t) => t.id === dragOverTestId);
    if (fromIdx === -1 || toIdx === -1) return arr;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    return arr;
  }, [tests, draggedTestId, dragOverTestId]);

  // Filtered tests for the student view overlay
  const svFilteredTests = useMemo(() => {
    let result = tests;
    if (svSearchQuery.trim()) {
      const q = svSearchQuery.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(q));
    }
    if (svCategoryFilter !== "all") {
      result = result.filter((t) => getAdminTestCategory(t) === svCategoryFilter);
    }
    return result;
  }, [tests, svSearchQuery, svCategoryFilter]);

  const handleDragStart = (e: React.DragEvent, testId: number) => {
    setDraggedTestId(testId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(testId));
  };

  const handleDragOver = (e: React.DragEvent, testId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (testId !== draggedTestId) setDragOverTestId(testId);
  };

  const handleDrop = (e: React.DragEvent, dropTargetId: number) => {
    e.preventDefault();
    if (draggedTestId === null || draggedTestId === dropTargetId) {
      setDraggedTestId(null);
      setDragOverTestId(null);
      return;
    }
    const allIds = tests.map((t) => t.id);
    const fromIdx = allIds.indexOf(draggedTestId);
    const toIdx = allIds.indexOf(dropTargetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...allIds];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, draggedTestId);
    const newPosition = reordered.indexOf(draggedTestId) + 1;
    const testName = tests.find((t) => t.id === draggedTestId)?.title ?? "Test";
    setDraggedTestId(null);
    setDragOverTestId(null);
    reorderTestsMutation.mutate({ orderedIds: reordered, newPosition, testName });
  };

  const handleDragEnd = () => {
    setDraggedTestId(null);
    setDragOverTestId(null);
  };

  const commitPositionJump = (testId: number) => {
    const target = parseInt(editingPositionValue, 10);
    setEditingPositionTestId(null);
    setEditingPositionValue("");
    if (isNaN(target)) return;

    // Position jump works within the currently visible (filtered) list so the
    // number the user types matches what they see on screen.
    const visibleIds = filteredTests.map((t) => t.id);
    const fromIdxInFiltered = visibleIds.indexOf(testId);
    if (fromIdxInFiltered === -1) return;
    const clamped = Math.max(1, Math.min(target, visibleIds.length));
    const toIdxInFiltered = clamped - 1;
    if (fromIdxInFiltered === toIdxInFiltered) return;

    // Find the reference test occupying the target slot in the filtered view,
    // then move the dragged test to that slot in the FULL list so all other
    // tests keep their relative order.
    const refId = visibleIds[toIdxInFiltered];
    const allIds = tests.map((t) => t.id);
    const fromIdx = allIds.indexOf(testId);
    const toIdx = allIds.indexOf(refId);
    if (fromIdx === -1 || toIdx === -1) return;
    if (fromIdx === toIdx) return;
    const reordered = [...allIds];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, testId);
    const newPosition = toIdxInFiltered + 1;
    const testName = tests.find((t) => t.id === testId)?.title ?? "Test";
    reorderTestsMutation.mutate({ orderedIds: reordered, newPosition, testName });
  };

  const updateTestSettingsMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) => {
      const r = await fetch(buildApiUrl(`/api/tests/${id}`), {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("Failed to save test settings");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      queryClient.invalidateQueries({ queryKey: ["student-tests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-tests"] });
      setSettingsTestId(null);
      toast({ title: "Test settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const openSettings = (test: Test) => {
    const cfg = normalizeExamConfigObject(test.examConfig);
    setSettingsCategory((normalizeTestCategory(cfg.testCategory) ?? "mock") as TestCategory);
    setSettingsExamType(test.examType ?? "");
    setSettingsDuration(String(test.durationMinutes ?? ""));
    setSettingsPassing(test.passingScore != null ? String(test.passingScore) : "");
    setSettingsScheduled(test.scheduledAt ? test.scheduledAt.slice(0, 16) : "");
    setSettingsCalculator(Boolean(cfg.calculatorEnabled));
    setSettingsTestId(test.id);
  };

  const commitSettings = () => {
    if (settingsTestId == null) return;
    const test = tests?.find((t) => t.id === settingsTestId);
    if (!test) return;
    const currentCfg = normalizeExamConfigObject(test.examConfig);
    const payload: Record<string, unknown> = {
      examType: settingsExamType || undefined,
      examConfig: { ...currentCfg, testCategory: settingsCategory, calculatorEnabled: settingsCalculator },
      durationMinutes: settingsDuration ? Number(settingsDuration) : undefined,
      passingScore: settingsPassing !== "" ? settingsPassing : null,
      scheduledAt: settingsScheduled ? new Date(settingsScheduled).toISOString() : null,
    };
    updateTestSettingsMutation.mutate({ id: settingsTestId, payload });
  };

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, patch }: { ids: number[]; patch: Record<string, unknown> }) => {
      await Promise.all(ids.map((id) =>
        fetch(buildApiUrl(`/api/tests/${id}`), {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
      ));
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      queryClient.invalidateQueries({ queryKey: ["student-tests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-tests"] });
      clearSelection();
      setBulkDialogOpen(false);
      setBulkCategory("");
      setBulkExamType("");
      setBulkPublish("");
      toast({ title: `${variables.ids.length} tests updated` });
    },
    onError: () => {
      toast({ title: "Bulk update failed", variant: "destructive" });
    },
  });

  const commitBulkEdit = () => {
    if (selectedTestIds.size === 0) return;
    const ids = Array.from(selectedTestIds);
    const patch: Record<string, unknown> = {};
    if (bulkExamType) patch.examType = bulkExamType;
    if (bulkPublish) patch.isPublished = bulkPublish === "publish";
    if (bulkCategory) {
      const baseTest = tests?.find((t) => ids.includes(t.id));
      const baseCfg = baseTest ? normalizeExamConfigObject(baseTest.examConfig) : {};
      patch.examConfig = { ...baseCfg, testCategory: bulkCategory };
    }
    if (Object.keys(patch).length === 0) return;
    if (bulkCategory && ids.length > 1) {
      ids.forEach((id) => {
        const t = tests?.find((x) => x.id === id);
        const cfg = normalizeExamConfigObject(t?.examConfig);
        fetch(buildApiUrl(`/api/tests/${id}`), {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...patch, examConfig: { ...cfg, testCategory: bulkCategory } }),
        });
      });
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      queryClient.invalidateQueries({ queryKey: ["student-tests"] });
      clearSelection();
      setBulkDialogOpen(false);
      setBulkCategory("");
      setBulkExamType("");
      setBulkPublish("");
      toast({ title: `${ids.length} tests updated` });
      return;
    }
    bulkUpdateMutation.mutate({ ids, patch });
  };

  const slugifyFilename = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "test";

  const getResponseErrorMessage = async (response: Response, fallback: string) => {
    const raw = await response.text();
    if (!raw) return fallback;

    try {
      const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
      if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error.trim();
      if (typeof parsed?.message === "string" && parsed.message.trim()) return parsed.message.trim();
    } catch {
      // Ignore JSON parse failure and fall back to the raw text.
    }

    return raw.trim() || fallback;
  };

  const loadTestDetailForExport = async (testId: number) => {
    const exportResponse = await fetch(buildApiUrl(`/api/tests/${testId}/export`), { credentials: "include" });
    if (exportResponse.ok) {
      const bundle = await exportResponse.json() as ExportedTestBundle;
      return {
        questions: Array.isArray(bundle.test?.questions) ? (bundle.test.questions as unknown as PdfExportQuestionPayload[]) : [],
        sections: Array.isArray(bundle.test?.sections) ? (bundle.test.sections as unknown as PdfExportSectionPayload[]) : [],
      };
    }

    const detailResponse = await fetch(buildApiUrl(`/api/tests/${testId}`), { credentials: "include" });
    if (!detailResponse.ok) {
      throw new Error(await getResponseErrorMessage(detailResponse, "Failed to load test questions"));
    }

    const detail = await detailResponse.json() as { questions?: Question[]; sections?: TestSection[] };
    return {
      questions: Array.isArray(detail.questions) ? detail.questions : [],
      sections: Array.isArray(detail.sections) ? detail.sections : [],
    };
  };

  const handleExportTest = async (test: Test) => {
    setExportingTestId(test.id);
    try {
      const response = await fetch(buildApiUrl(`/api/tests/${test.id}/export`), { credentials: "include" });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to export test");
      }
      const bundle = await response.json();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slugifyFilename(test.title)}-test-export.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast({ title: "Test exported", description: `${test.title} JSON bundle downloaded.` });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "The test bundle could not be downloaded.",
        variant: "destructive",
      });
    } finally {
      setExportingTestId(null);
    }
  };

  const handleExportTestPdf = async (test: Test) => {
    setExportingTestPdfId(test.id);
    try {
      const detail = await loadTestDetailForExport(test.id);
      const questions = Array.isArray(detail.questions) ? detail.questions : [];
      const sections = Array.isArray(detail.sections) ? detail.sections : [];

      if (questions.length === 0) {
        throw new Error("No questions are available for PDF export.");
      }

      const sectionOrder = new Map(
        sections.map((section, index) => {
          return [getPdfSectionKey(section, index), section.order ?? index] as const;
        }),
      );
      const orderedQuestions = [...questions].sort((left, right) => {
        const leftSectionKey = getPdfQuestionSectionKey(left);
        const rightSectionKey = getPdfQuestionSectionKey(right);
        const leftSectionOrder = sectionOrder.get(leftSectionKey) ?? Number.MAX_SAFE_INTEGER;
        const rightSectionOrder = sectionOrder.get(rightSectionKey) ?? Number.MAX_SAFE_INTEGER;
        if (leftSectionOrder !== rightSectionOrder) return leftSectionOrder - rightSectionOrder;
        const leftOrder = typeof left.order === "number" ? left.order : Number.MAX_SAFE_INTEGER;
        const rightOrder = typeof right.order === "number" ? right.order : Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder;
      });

      const { skippedImageCount } = await exportQuestionsPdf({
        title: test.title,
        filename: `${slugifyFilename(test.title)}-questions.pdf`,
        questions: orderedQuestions.map((question) => ({
          question: question.question,
          imageData: question.imageData ?? null,
        })),
      });

      toast({
        title: "PDF exported",
        description: skippedImageCount > 0
          ? `${test.title} PDF downloaded. ${skippedImageCount} image${skippedImageCount === 1 ? "" : "s"} could not be included.`
          : `${test.title} questions PDF downloaded.`,
      });
    } catch (error) {
      toast({
        title: "PDF export failed",
        description: error instanceof Error ? error.message : "The questions PDF could not be generated.",
        variant: "destructive",
      });
    } finally {
      setExportingTestPdfId(null);
    }
  };

  const handleImportTestFile = async (file?: File | null) => {
    if (!file) return;
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const parsed =
        extension === "html" || extension === "htm" || file.type.includes("html")
          ? await parseSavedHtmlTestImport(file)
          : (JSON.parse(await file.text()) as ExportedTestBundle);
      if (!parsed?.test || !parsed?.test?.title || !Array.isArray(parsed?.test?.sections) || !Array.isArray(parsed?.test?.questions)) {
        throw new Error("Invalid test export file");
      }
      setImportBundle(parsed);
      setImportFilename(file.name);
      setImportExamType(
        normalizeExamTypeSelection(
          parsed.test.examType ?? parsed.source?.examType ?? "",
          examTemplates,
        ),
      );
      setImportScheduled(formatDateTimeLocalValue(parsed.test.scheduledAt ?? null));
      setImportOpen(true);
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "The selected file could not be parsed.",
        variant: "destructive",
      });
    }
  };

  const loadTestSummary = async (testId: number) => {
    if (questionsMap[testId] && sectionsMap[testId]) return;
    if (loadingTestSummaryIdsRef.current.has(testId)) return;

    loadingTestSummaryIdsRef.current.add(testId);
    try {
      const r = await fetch(buildApiUrl(`/api/tests/${testId}`), { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setQuestionsMap((prev) => ({ ...prev, [testId]: data.questions ?? [] }));
      setSectionsMap((prev) => ({ ...prev, [testId]: data.sections ?? [] }));
    } catch {
      // The dashboard already has lightweight question counts on each test.
      // A transient detail-request failure must not crash the whole page.
    } finally {
      loadingTestSummaryIdsRef.current.delete(testId);
    }
  };

  useEffect(() => {
    tests.forEach((test) => {
      if (!questionsMap[test.id] || !sectionsMap[test.id]) {
        void loadTestSummary(test.id);
      }
    });
  }, [tests, questionsMap, sectionsMap]);

  useEffect(() => {
    if (!publishResultDialog) return;
    const timeout = window.setTimeout(() => {
      setPublishResultDialog(null);
    }, 5200);
    return () => window.clearTimeout(timeout);
  }, [publishResultDialog]);

  return (
    <div className="space-y-6 bg-[#fffaf2]" style={{ fontFamily: "\"Plus Jakarta Sans\", sans-serif" }}>
      <div className="rounded-[28px] border border-[#eadfcd] bg-white p-6 shadow-[0_20px_40px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Tests Dashboard</h1>
              <p className="mt-1 text-sm text-slate-500">Build, manage, and publish your exam papers.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-2 border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-100"
                onClick={() => openStudentPreview()}
              >
                <Eye className="h-4 w-4" />
                Student View
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-2 border-[#eadfcd] bg-white text-sm text-slate-700 hover:border-[#f4c98b] hover:bg-[#fff7ea]"
                onClick={() => importTestInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Import Test
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-2 border-[#eadfcd] bg-white text-sm text-slate-700 hover:border-[#f4c98b] hover:bg-[#fff7ea]"
                onClick={() => multiImportInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Bulk Import HTML
              </Button>
              <Button
                onClick={() => setCreateOpen(true)}
                className="h-9 gap-2 bg-[#f97316] text-sm font-semibold text-white hover:bg-[#ea580c]"
                data-testid="button-create-test"
              >
                <Plus className="h-4 w-4" />
                Create New Test
              </Button>
              <input
                ref={importTestInputRef}
                type="file"
                accept="application/json,.json,text/html,.html,.htm"
                className="hidden"
                onChange={(event) => {
                  handleImportTestFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={multiImportInputRef}
                type="file"
                multiple
                accept="text/html,.html,.htm"
                className="hidden"
                onChange={(event) => {
                  void handleMultiImportFilesSelected(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={metadataImportInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const targetTestId = metadataImportTestId;
                  if (targetTestId != null) {
                    handleMetadataImportFile(targetTestId, event.currentTarget.files?.[0]);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex items-center gap-3 rounded-xl border border-[#eadfcd] bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <ClipboardList size={18} />
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500">Total Tests</p>
                <p className="text-2xl font-extrabold leading-tight text-slate-800">{totalTests}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-[#eadfcd] bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500">Published</p>
                <p className="text-2xl font-extrabold leading-tight text-emerald-600">{publishedTests}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-[#eadfcd] bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <FileText size={18} />
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500">Drafts</p>
                <p className="text-2xl font-extrabold leading-tight text-amber-600">{draftTests}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-[#eadfcd] bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                <Hash size={18} />
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500">Loaded Questions</p>
                <p className="text-2xl font-extrabold leading-tight text-orange-600">{totalQuestions}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all" as const, label: "All" },
            { key: "mock" as const, label: "Mock" },
            { key: "subject-wise" as const, label: "Subject Wise" },
            { key: "multi-subject" as const, label: "Chapter Wise" },
            { key: "pyq" as const, label: "PYQ" },
          ] as { key: TestCategory | "all"; label: string }[]
        ).map(({ key, label }) => {
          const isActive = activeCategory === key;
          const toneClass = key === "all"
            ? isActive ? "bg-slate-800 text-white border-slate-800" : "border-[#eadfcd] bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800"
            : key === "mock"
            ? isActive ? "bg-[#BE123C] text-white border-[#BE123C]" : "border-[#FCA5A5] bg-[#FFF1F2] text-[#BE123C] hover:bg-[#ffe4e8]"
            : key === "subject-wise"
            ? isActive ? "bg-[#0E7490] text-white border-[#0E7490]" : "border-[#A5F3FC] bg-[#ECFEFF] text-[#0E7490] hover:bg-[#cffafe]"
            : key === "multi-subject"
            ? isActive ? "bg-[#7C3AED] text-white border-[#7C3AED]" : "border-[#C4B5FD] bg-[#F5F3FF] text-[#7C3AED] hover:bg-[#ede9fe]"
            : isActive ? "bg-[#047857] text-white border-[#047857]" : "border-[#6EE7B7] bg-[#ECFDF5] text-[#047857] hover:bg-[#d1fae5]";
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveCategory(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${toneClass}`}
            >
              {label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isActive ? "bg-white/20" : "bg-white/70"}`}>
                {categoryCounts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Bulk action bar ──────────────────────────────────────────────── */}
      {selectedTestIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 shadow-sm">
          <SquareCheck size={15} className="shrink-0 text-amber-600" />
          <span className="text-sm font-semibold text-amber-800">
            {selectedTestIds.size} test{selectedTestIds.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-slate-600 hover:text-slate-800"
              onClick={selectAllVisible}
            >
              Select all ({filteredTests.length})
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1.5 px-3 text-xs chip-orange-solid"
              onClick={() => {
                setBulkCategory("");
                setBulkExamType("");
                setBulkPublish("");
                setBulkDialogOpen(true);
              }}
            >
              <Layers size={12} />
              Bulk Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2.5 text-xs border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              onClick={() => bulkSetCalculator(true)}
              title="Enable calculator for all selected tests"
            >
              <Calculator size={11} />
              Calc ON
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2.5 text-xs border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              onClick={() => bulkSetCalculator(false)}
              title="Disable calculator for all selected tests"
            >
              <Calculator size={11} />
              Calc OFF
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2.5 text-xs border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
              onClick={() => bulkSetSync(true)}
              title="Enable question bank sync for all selected tests"
            >
              <DatabaseZap size={11} />
              Sync ON
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2.5 text-xs border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              onClick={() => bulkSetSync(false)}
              title="Disable question bank sync for all selected tests"
            >
              <DatabaseZap size={11} />
              Sync OFF
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2.5 text-xs border-violet-400 bg-violet-50 font-semibold text-violet-700 hover:bg-violet-100"
              onClick={openBulkAiMeta}
              title="Generate AI metadata for all selected tests"
            >
              <Sparkles size={11} />
              AI Metadata
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-slate-500 hover:text-rose-600"
              onClick={clearSelection}
            >
              <X size={12} />
              Clear
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filteredTests.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><ClipboardList size={40} className="mx-auto text-muted-foreground mb-3" /><p className="text-muted-foreground">{activeCategory === "all" ? "No tests yet. Create your first test." : `No ${activeCategory === "subject-wise" ? "Subject Wise" : activeCategory === "multi-subject" ? "Chapter Wise" : activeCategory === "pyq" ? "PYQ" : "Mock"} tests yet.`}</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {dragPreviewTests.map((test, idx) => {
            const qs = questionsMap[test.id] ?? [];
            const sections = sectionsMap[test.id] ?? [];
            const loadedQuestionCount = qs.length > 0 ? qs.length : Math.max(0, Number(test.questionCount) || 0);
            const isJsonExporting = exportingTestId === test.id;
            const isPdfExporting = exportingTestPdfId === test.id;
            const calculatorEnabled = getCalculatorEnabledFromExamConfig(test.examConfig);
            const testCategory = getResolvedTestCategory(test, sections);
            const reportedQuestions = qs.filter((question) => getOpenReportCount(question) > 0);
            const openReportedQuestionCount = reportedQuestions.length;
            const totalOpenReports = reportedQuestions.reduce((sum, question) => sum + getOpenReportCount(question), 0);
            const firstReportedQuestionId = reportedQuestions[0]?.id ?? null;
            const totalPlannedQuestions = sections.reduce((sum, section) => sum + Number(section.questionCount ?? 0), 0);
            const progress = totalPlannedQuestions > 0 ? Math.min(100, (loadedQuestionCount / totalPlannedQuestions) * 100) : 0;
            const isDragging = draggedTestId === test.id;
            return (
              <Card
                key={test.id}
                draggable
                onDragStart={(e) => handleDragStart(e, test.id)}
                onDragOver={(e) => handleDragOver(e, test.id)}
                onDrop={(e) => handleDrop(e, test.id)}
                onDragEnd={handleDragEnd}
                className={`overflow-hidden rounded-xl border bg-white shadow-[0_12px_30px_rgba(15,23,42,0.04)] transition-all select-none
                  ${isDragging ? "opacity-40 scale-[0.99]" : ""}
                  ${selectedTestIds.has(test.id) ? "border-amber-400 ring-2 ring-amber-200" : "border-[#eadfcd]"}
                `}
                data-testid={`test-card-${test.id}`}
              >
                <CardContent className="p-0">
                  <div className="h-0.5 bg-[#f4ecdf]">
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${progress}%`,
                        background: test.isPublished ? "hsl(142 72% 45%)" : "hsl(24 95% 53%)",
                      }}
                    />
                  </div>
                  <div className="flex flex-col items-stretch gap-4 p-4 sm:flex-row sm:items-center">
                    <div className="hidden shrink-0 sm:flex items-center gap-2">
                      <div
                        className="flex h-7 w-5 cursor-grab active:cursor-grabbing items-center justify-center rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors"
                        title="Drag to reorder"
                      >
                        <GripVertical size={16} />
                      </div>
                      {editingPositionTestId === test.id ? (
                        <form
                          onSubmit={(e) => { e.preventDefault(); commitPositionJump(test.id); }}
                          className="flex items-center"
                        >
                          <input
                            autoFocus
                            type="number"
                            min={1}
                            max={filteredTests.length}
                            placeholder={String(idx + 1)}
                            value={editingPositionValue}
                            onChange={(e) => setEditingPositionValue(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => commitPositionJump(test.id)}
                            onKeyDown={(e) => { if (e.key === "Escape") { setEditingPositionTestId(null); setEditingPositionValue(""); } }}
                            className="w-12 rounded border border-amber-400 bg-white px-1.5 py-0.5 text-center text-xs font-semibold text-slate-700 outline-none ring-2 ring-amber-300 focus:ring-amber-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        </form>
                      ) : (
                        <button
                          type="button"
                          title="Click to jump to position"
                          onClick={(e) => { e.stopPropagation(); setEditingPositionTestId(test.id); setEditingPositionValue(String(idx + 1)); }}
                          className="flex h-6 min-w-[1.5rem] items-center justify-center rounded bg-slate-100 px-1 text-xs font-semibold text-slate-400 hover:bg-amber-100 hover:text-amber-600 transition-colors cursor-pointer"
                        >
                          {idx + 1}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleSelectTest(test.id)}
                        className={`flex items-center justify-center h-5 w-5 rounded transition-colors ${selectedTestIds.has(test.id) ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}`}
                        title={selectedTestIds.has(test.id) ? "Deselect" : "Select for bulk edit"}
                      >
                        {selectedTestIds.has(test.id) ? <SquareCheck size={18} /> : <Square size={18} />}
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {renamingTestId === test.id ? (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(e) => { e.preventDefault(); void commitRename(test.id); }}
                          >
                            <input
                              autoFocus
                              className="min-w-0 rounded border border-amber-400 bg-white px-2 py-0.5 text-base font-bold text-slate-900 outline-none ring-2 ring-amber-300 focus:ring-amber-400"
                              value={renamingTitleValue}
                              onChange={(e) => setRenamingTitleValue(e.target.value)}
                              disabled={renamingLoading}
                              onKeyDown={(e) => { if (e.key === "Escape") cancelRename(); }}
                              style={{ width: Math.max(140, renamingTitleValue.length * 9) }}
                            />
                            <button type="submit" disabled={renamingLoading} className="rounded px-1.5 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Save</button>
                            <button type="button" onClick={cancelRename} disabled={renamingLoading} className="rounded px-1.5 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
                          </form>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="min-w-0 max-w-full break-words text-base font-bold leading-snug text-slate-900 sm:truncate">{test.title}</span>
                            <button
                              type="button"
                              title="Rename test"
                              onClick={() => startRename(test.id, test.title)}
                              className="rounded p-0.5 text-slate-400 opacity-60 hover:bg-slate-100 hover:text-amber-600 hover:opacity-100"
                            >
                              <PencilLine size={13} />
                            </button>
                          </div>
                        )}
                        <span
                          aria-label={test.isPublished ? "Published" : "Draft"}
                          title={test.isPublished ? "Published" : "Draft"}
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${
                            test.isPublished
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                        >
                          {test.isPublished ? <CheckCircle2 size={12} /> : <FileText size={12} />}
                        </span>
                        {test.subjectName ? (
                          <span className="rounded-full border border-[#eadfcd] bg-[#fff9ef] px-2 py-0.5 text-[10px] font-medium text-slate-600">
                            {test.subjectName}
                          </span>
                        ) : null}
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getTestCategoryTone(testCategory)}`}>
                          {getTestCategoryLabel(testCategory)}
                        </span>
                        {calculatorEnabled ? (
                          <span
                            aria-label="Calculator enabled"
                            title="Calculator enabled"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
                          >
                            <Calculator size={11} />
                          </span>
                        ) : null}
                        {openReportedQuestionCount > 0 ? (
                          <button
                            type="button"
                            onMouseEnter={() => prefetchBuilderResources(test.id)}
                            onFocus={() => prefetchBuilderResources(test.id)}
                            onClick={() => openBuilder(test.id, firstReportedQuestionId)}
                            className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
                            title={`${totalOpenReports} open student report${totalOpenReports === 1 ? "" : "s"}`}
                          >
                            <Flag size={11} />
                            {openReportedQuestionCount} reported
                          </button>
                        ) : null}
                        {importDurations[test.id] != null ? (
                          <span
                            title={`Imported in ${(importDurations[test.id] / 1000).toFixed(1)}s`}
                            className="inline-flex items-center gap-1 rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-600"
                          >
                            <Download size={9} />
                            {importDurations[test.id] < 60_000
                              ? `${(importDurations[test.id] / 1000).toFixed(1)}s`
                              : `${Math.round(importDurations[test.id] / 60_000)}m`}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><Clock size={11} />{test.durationMinutes} min</span>
                        {test.scheduledAt ? <span>{format(new Date(test.scheduledAt), "MMM d, yyyy")}</span> : null}
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <Switch
                            checked={getShowOnStudentDashboard(test.examConfig)}
                            onCheckedChange={(checked) => {
                              const current = normalizeExamConfigObject(test.examConfig);
                              updateTestConfigMutation.mutate({ id: test.id, examConfig: { ...current, showOnStudentDashboard: checked } });
                            }}
                            className="scale-75 data-[state=checked]:bg-blue-600"
                          />
                          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                            <Monitor size={11} />
                            Student Dashboard
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <Switch
                            checked={getSyncWithQuestionBank(test.examConfig)}
                            onCheckedChange={(checked) => {
                              const current = normalizeExamConfigObject(test.examConfig);
                              updateTestConfigMutation.mutate({ id: test.id, examConfig: { ...current, syncWithQuestionBank: checked } });
                            }}
                            className="scale-75 data-[state=checked]:bg-violet-600"
                          />
                          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                            <DatabaseZap size={11} />
                            Sync Question Bank
                          </span>
                        </label>
                      </div>
                    </div>
                    <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                      <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                        {openReportedQuestionCount > 0 ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 w-full justify-center gap-1.5 border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800 sm:h-8 sm:w-auto"
                            onMouseEnter={() => prefetchBuilderResources(test.id)}
                            onFocus={() => prefetchBuilderResources(test.id)}
                            onClick={() => openBuilder(test.id, firstReportedQuestionId)}
                          >
                            <Flag size={13} />
                            Review reports
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          className="chip-orange-solid h-9 w-full justify-center gap-1.5 px-4 text-xs font-semibold sm:h-8 sm:w-auto"
                          onMouseEnter={() => prefetchBuilderResources(test.id)}
                          onFocus={() => prefetchBuilderResources(test.id)}
                          onClick={() => openBuilder(test.id)}
                        >
                          <PencilLine size={13} />
                          Edit test
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 w-full justify-center gap-1.5 border-[#eadfcd] px-3 text-xs font-semibold text-slate-600 hover:bg-[#fff9ef] hover:text-[#b45309] sm:h-8 sm:w-auto"
                          onClick={() => openSettings(test)}
                          title="Test settings"
                        >
                          <Settings2 size={13} />
                          Settings
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-10 w-full justify-center rounded-xl px-0 text-[#D97706] hover:bg-[#FFF7E8] hover:text-[#B45309] sm:h-9 sm:w-9"
                              disabled={isJsonExporting || isPdfExporting}
                              aria-label="Export test"
                              title="Export"
                            >
                              <Download size={16} className={isJsonExporting || isPdfExporting ? "animate-pulse" : ""} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44 border-[#E5E7EB]">
                            <DropdownMenuItem onClick={() => handleExportTest(test)}>
                              <Download size={13} />
                              Export JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExportTestPdf(test)}>
                              <FileText size={13} />
                              Export PDF
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-10 w-full justify-center rounded-xl px-0 text-[#D97706] hover:bg-[#FFF7E8] hover:text-[#B45309] sm:h-9 sm:w-9"
                              disabled={importMetadataMutation.isPending && metadataImportTestId === test.id}
                              aria-label="Import test metadata"
                              title="Import"
                            >
                              <Upload size={16} className={importMetadataMutation.isPending && metadataImportTestId === test.id ? "animate-pulse" : ""} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56 border-[#E5E7EB]">
                            <DropdownMenuItem onClick={() => openAiMetaDialog(test.id)} className="text-violet-700 focus:text-violet-700 focus:bg-violet-50">
                              <Sparkles size={13} className="text-violet-500" />
                              Generate AI Metadata
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openMetadataImportDialog(test.id, "metadata")}>
                              <Upload size={13} />
                              Import Metadata (JSON)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openMetadataImportDialog(test.id, "answers")}>
                              <Upload size={13} />
                              Import Correct Answer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 w-full justify-center gap-1.5 px-2 text-xs text-[#D97706] hover:bg-[#FFF7E8] hover:text-[#B45309] sm:h-8 sm:w-auto"
                          onClick={() => setLocation(`/admin/tests/${test.id}/analytics`)}
                          data-testid={`button-advanced-analytics-${test.id}`}
                        >
                          <TrendingUp size={13} />
                          Advanced
                        </Button>
                        <Button size="sm" variant="ghost" className={`h-9 w-full justify-center gap-1.5 px-2 text-xs sm:h-8 sm:w-auto ${test.isPublished ? "text-[#F97316] hover:bg-[#FFF7E8]" : "text-[#16A34A] hover:bg-emerald-50"}`}
                          onClick={() => togglePublish.mutate({ id: test.id, isPublished: !test.isPublished })} data-testid={`button-toggle-publish-${test.id}`}>
                          {test.isPublished ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                          {test.isPublished ? "Unpublish" : "Publish"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-9 w-full p-0 text-destructive hover:bg-rose-50 hover:text-destructive sm:h-8 sm:w-8"
                          onClick={() => { if (confirm("Delete this test?")) deleteTestMutation.mutate(test.id); }} data-testid={`button-delete-test-${test.id}`}>
                          <Trash2 size={13} />
                          <span className="ml-1 text-xs sm:hidden">Delete</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {publishResultDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[3px]">
          <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-[#f2d6a6] bg-[#fffaf2] shadow-[0_32px_90px_rgba(120,53,15,0.24)]">
            <button
              type="button"
              onClick={() => setPublishResultDialog(null)}
              className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/50 bg-white/60 text-[#9a3412] shadow-sm transition hover:bg-white"
              aria-label="Close publish summary"
            >
              <X size={16} />
            </button>

            <div className="relative overflow-hidden bg-[radial-gradient(circle_at_15%_10%,rgba(255,255,255,0.38),transparent_28%),linear-gradient(135deg,#F59E0B_0%,#EA7A00_52%,#D97706_100%)] px-5 py-5 text-white">
              <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/18" />
              <div className="absolute -bottom-12 left-8 h-24 w-24 rounded-full bg-white/12" />
              <div className="flex items-center gap-3 pr-10">
                <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-[0_12px_30px_rgba(120,53,15,0.22)]">
                  <CheckCircle2 size={22} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/75">Publish Complete</p>
                  <h2 className="mt-1 truncate text-2xl font-black tracking-tight">Test published</h2>
                  <p className="mt-1 text-sm leading-5 text-white/90">
                    <span className="font-semibold text-white">{publishResultDialog.testTitle}</span> is live. Question bank sync summary is below.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Synced</p>
                    <CheckCircle2 size={16} className="text-emerald-600" />
                  </div>
                  <p className="mt-2 text-3xl font-black text-emerald-800">{publishResultDialog.summary.linkedCount}</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-[#fff7e8] to-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#b45309]">Duplicates</p>
                    <Hash size={16} className="text-[#D97706]" />
                  </div>
                  <p className="mt-2 text-3xl font-black text-[#b45309]">{publishResultDialog.summary.skippedDuplicateCount}</p>
                </div>
                <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-rose-700">Review</p>
                    <Flag size={16} className="text-rose-600" />
                  </div>
                  <p className="mt-2 text-3xl font-black text-rose-700">{publishResultDialog.summary.skippedNoSubjectCount}</p>
                </div>
              </div>

              {publishResultDialog.summary.duplicateQuestions && publishResultDialog.summary.duplicateQuestions.length > 0 ? (
                <div className="rounded-2xl border border-[#f0d7ad] bg-white px-4 py-3 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#b45309]">Duplicate Questions</p>
                  <p className="mt-2 text-sm text-slate-700">
                    {publishResultDialog.summary.duplicateQuestions.slice(0, 10).map((item) => item.questionNo).join(", ")}
                    {publishResultDialog.summary.duplicateQuestions.length > 10
                      ? ` + ${publishResultDialog.summary.duplicateQuestions.length - 10} more`
                      : ""}
                  </p>
                </div>
              ) : null}

              {publishResultDialog.summary.createdQuestionBankClassCount > 0 ? (
                <div className="rounded-2xl border border-[#f0d7ad] bg-[#fff7e8] px-4 py-3 text-sm text-[#7c2d12] shadow-sm">
                  The question bank card for the same exam was missing, so the system created it automatically.
                </div>
              ) : null}

              {publishResultDialog.summary.skippedNoSubjectCount > 0 ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm leading-6 text-rose-900 shadow-sm">
                  Test published successfully. {publishResultDialog.summary.skippedNoSubjectCount} question{publishResultDialog.summary.skippedNoSubjectCount === 1 ? "" : "s"} still need exact subject/chapter review in Edit test, so they were not synced to the question bank yet.
                </div>
              ) : null}

              {publishResultDialog.summary.reviewQuestions && publishResultDialog.summary.reviewQuestions.length > 0 ? (
                <div className="rounded-2xl border border-rose-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-rose-700">Questions to Review</p>
                      <p className="mt-1 text-sm text-slate-600">
                        These questions are live in the test, but not synced to Question Bank.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full bg-gradient-to-r from-[#F59E0B] to-[#D97706] px-4 text-white shadow-[0_12px_26px_rgba(217,119,6,0.24)] hover:from-[#D97706] hover:to-[#b45309]"
                      onClick={() => {
                        setPublishResultDialog(null);
                        const firstReviewQuestion = publishResultDialog.summary.reviewQuestions?.[0];
                        setLocation(firstReviewQuestion
                          ? `/admin/tests/${publishResultDialog.testId}/builder?questionId=${firstReviewQuestion.questionId}`
                          : `/admin/tests/${publishResultDialog.testId}/builder`);
                      }}
                    >
                      Open builder
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {publishResultDialog.summary.reviewQuestions.slice(0, 18).map((item) => (
                      <button
                        key={item.questionId}
                        type="button"
                        title={`${item.reason}${item.subjectName ? ` Subject: ${item.subjectName}` : ""}${item.chapterName ? ` Chapter: ${item.chapterName}` : ""}`}
                        onClick={() => {
                          setPublishResultDialog(null);
                          setLocation(`/admin/tests/${publishResultDialog.testId}/builder?questionId=${item.questionId}`);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
                      >
                        <Flag className="h-3 w-3" />
                        {item.questionNo}
                      </button>
                    ))}
                    {publishResultDialog.summary.reviewQuestions.length > 18 ? (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
                        + {publishResultDialog.summary.reviewQuestions.length - 18} more
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 max-h-28 space-y-1.5 overflow-y-auto pr-1">
                    {publishResultDialog.summary.reviewQuestions.slice(0, 5).map((item) => (
                      <p key={`reason-${item.questionId}`} className="text-xs leading-5 text-slate-600">
                        <span className="font-bold text-slate-900">{item.questionNo}</span>: {item.reason}
                        {item.subjectName ? ` Subject: ${item.subjectName}.` : ""}
                        {item.chapterName ? ` Chapter: ${item.chapterName}.` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              {publishResultDialog.summary.warnings && publishResultDialog.summary.warnings.length > 0 ? (
                <div className="rounded-2xl border border-[#f0d7ad] bg-white px-4 py-3 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#b45309]">Review Notes</p>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {publishResultDialog.summary.warnings.slice(0, 5).map((warning, index) => (
                      <p key={`${index}-${warning}`}>{warning}</p>
                    ))}
                    {publishResultDialog.summary.warnings.length > 5 ? (
                      <p className="text-xs text-slate-500">+ {publishResultDialog.summary.warnings.length - 5} more</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Create Test Dialog ─── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create New Test</DialogTitle></DialogHeader>
          <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_320px]">
                <div className="space-y-4">
                  <div><Label className="text-xs">Test Title *</Label><Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. GATE Physics Full Test 1" className="mt-1" data-testid="input-test-title" /></div>
                </div>
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Exam Structure</p>
                  <div className="mt-3 grid gap-2">
                    <Select value={newExamType} onValueChange={(value) => applyPreset(value)}>
                      <SelectTrigger><SelectValue placeholder="Select structure" /></SelectTrigger>
                      <SelectContent>
                        {examTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.key}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">Student Visibility</p>
                  <InfoTip content={`Visible to students who selected ${String(newExamType || "exam").toUpperCase()} during registration or in profile settings.`} />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <Label className="text-sm font-medium text-slate-900">Test category</Label>
                <p className="mt-1 text-xs text-slate-500">Students will see a badge with this label.</p>
                <div className="mt-3">
                  <Select value={newTestCategory} onValueChange={(value) => setNewTestCategory(value as TestCategory)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="subject-wise">Subject Wise Test</SelectItem>
                      <SelectItem value="mock">Mock Test</SelectItem>
                      <SelectItem value="pyq">PYQ</SelectItem>
                      <SelectItem value="multi-subject">Chapter Wise Test</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Student calculator</p>
                  <p className="text-xs text-slate-500">Turn on the exam calculator only for tests that need it.</p>
                </div>
                <Switch checked={newCalculatorEnabled} onCheckedChange={setNewCalculatorEnabled} />
              </div>
              <div><Label className="text-xs">Scheduled Date (optional)</Label><Input type="datetime-local" value={newScheduled} onChange={(e) => setNewScheduled(e.target.value)} className="mt-1" /></div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button disabled={!newTitle.trim() || !sectionDrafts.some((section) => section.subjectLabel.trim() || section.title.trim()) || createMutation.isPending} onClick={() => createMutation.mutate()} data-testid="button-confirm-create-test">
                {createMutation.isPending ? "Creating..." : "Create Test"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) resetImportDialog();
          else setImportOpen(true);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Import Test</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#eadfcd] bg-[#fff9ef] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Selected File</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{importBundle?.test.title ?? "Untitled test"}</p>
              <p className="mt-1 text-xs text-slate-500">{importFilename}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Part Of Exam</Label>
                <Select value={importExamType} onValueChange={setImportExamType}>
                  <SelectTrigger className="h-11 rounded-xl border-[#eadfcd] bg-white">
                    <SelectValue placeholder="Select exam" />
                  </SelectTrigger>
                  <SelectContent>
                    {examTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.key}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">This determines which exam stream the imported test belongs to.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schedule Date</Label>
                <Input
                  type="datetime-local"
                  value={importScheduled}
                  onChange={(event) => setImportScheduled(event.target.value)}
                  className="h-11 rounded-xl border-[#eadfcd] bg-white"
                />
                <p className="text-xs text-slate-500">Leave this blank to import the test as a draft without a schedule.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => resetImportDialog()}>
                Cancel
              </Button>
              <Button
                disabled={!importBundle || !importExamType}
                className="bg-[#f97316] text-white hover:bg-[#ea580c]"
                onClick={() => {
                  if (!importBundle) return;
                  startBackgroundImport({
                    bundle: importBundle,
                    examType: importExamType,
                    scheduledAt: importScheduled,
                    filename: importFilename,
                  });
                }}
              >
                Import Test
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Bulk HTML Import Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={multiImportOpen}
        onOpenChange={(open) => {
          if (!open) resetMultiImportDialog();
          else setMultiImportOpen(true);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk Import HTML Tests</DialogTitle>
            <DialogDescription>
              Import multiple HTML test files at once. All tests will share the same exam type.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Part of Exam selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Part of Exam</Label>
              <Select value={multiImportExamType} onValueChange={setMultiImportExamType}>
                <SelectTrigger className="h-11 rounded-xl border-[#eadfcd] bg-white">
                  <SelectValue placeholder="Select exam type for all files" />
                </SelectTrigger>
                <SelectContent>
                  {examTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.key}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">This exam type applies to all files being imported.</p>
            </div>

            {/* File list */}
            <div className="rounded-2xl border border-[#eadfcd] bg-[#fffaf1] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {multiImportFiles.length} file{multiImportFiles.length === 1 ? "" : "s"} selected
                </p>
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-slate-600"
                  onClick={() => multiImportInputRef.current?.click()}
                >
                  Change files
                </button>
              </div>
              <div className="max-h-60 space-y-1.5 overflow-y-auto">
                {multiImportFiles.map((entry) => (
                  <div
                    key={entry.id}
                    className={[
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2",
                      entry.status === "ready"
                        ? "border-emerald-200 bg-white"
                        : entry.status === "error"
                        ? "border-red-200 bg-red-50"
                        : "border-[#eadfcd] bg-white",
                    ].join(" ")}
                  >
                    {entry.status === "parsing" && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />
                    )}
                    {entry.status === "ready" && (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    )}
                    {entry.status === "error" && (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800">
                        {entry.bundle?.test.title ?? entry.file.name}
                      </p>
                      {entry.status === "ready" && (
                        <p className="text-[11px] text-slate-500">
                          {entry.questionCount} question{entry.questionCount === 1 ? "" : "s"} · {entry.file.name}
                        </p>
                      )}
                      {entry.status === "parsing" && (
                        <p className="text-[11px] text-slate-400">Parsing…</p>
                      )}
                      {entry.status === "error" && (
                        <p className="text-[11px] text-red-600">{entry.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Import progress note */}
            {multiImportFiles.some((f) => f.status === "ready") && (
              <p className="text-xs text-slate-500">
                Import progress for each test will appear in the bottom-right corner after you start.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={resetMultiImportDialog}>
                Cancel
              </Button>
              <Button
                disabled={
                  !multiImportExamType ||
                  multiImportFiles.every((f) => f.status !== "ready") ||
                  multiImportFiles.some((f) => f.status === "parsing")
                }
                className="bg-[#f97316] text-white hover:bg-[#ea580c]"
                onClick={handleStartMultiImport}
              >
                Import {multiImportFiles.filter((f) => f.status === "ready").length} Test
                {multiImportFiles.filter((f) => f.status === "ready").length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={metadataImportOpen}
        onOpenChange={(open) => {
          if (!importMetadataMutation.isPending) {
            if (!open) {
              resetMetadataImportDialog();
            } else {
              setMetadataImportOpen(true);
            }
          }
        }}
      >
        <DialogContent className="max-w-5xl overflow-hidden p-0">
          <div className="grid max-h-[88vh] lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="overflow-y-auto border-b border-[#eadfcd] bg-[#fffaf1] p-5 lg:border-b-0 lg:border-r">
              <div className="rounded-2xl border border-[#eadfcd] bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Selected Test</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{metadataImportTest?.title ?? "Untitled test"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {metadataImportFilename ? `Loaded file: ${metadataImportFilename}` : metadataImportConfig.loadedFileText}
                </p>
              </div>
              <div className="mt-4 rounded-2xl bg-slate-950 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">Example</p>
                <pre className="mt-3 overflow-x-auto text-[11px] leading-5 text-slate-100">
{metadataImportConfig.example}
                </pre>
              </div>
            </div>
            <div className="flex min-h-0 flex-col overflow-hidden bg-white">
              <DialogHeader className="border-b border-[#eadfcd] px-6 py-5 pr-14 text-left">
                <DialogTitle>{metadataImportConfig.title}</DialogTitle>
                <p className="mt-1 text-sm text-slate-500">Paste or load data to update questions in the selected test in bulk.</p>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="rounded-2xl border border-[#cfd4ff] bg-white px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{metadataImportConfig.pasteTitle}</p>
                      <p className="mt-1 text-xs text-slate-500">{metadataImportConfig.pasteHelper}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 border-[#d8dafe] text-xs text-slate-700 hover:bg-[#f8f8ff]"
                      onClick={() => metadataImportInputRef.current?.click()}
                      disabled={!metadataImportTestId || importMetadataMutation.isPending}
                    >
                      <Upload size={13} />
                      Load File
                    </Button>
                  </div>
                  <Textarea
                    value={metadataImportText}
                    onChange={(event) => setMetadataImportText(event.target.value)}
                    placeholder={metadataImportConfig.example}
                    className="mt-4 min-h-[340px] rounded-2xl border-[#7c7cff] bg-white font-mono text-[13px] leading-6 lg:min-h-[420px]"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-[#eadfcd] px-6 py-4">
                <Button
                  variant="ghost"
                  disabled={importMetadataMutation.isPending}
                  onClick={() => resetMetadataImportDialog()}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!metadataImportTestId || !metadataImportText.trim() || importMetadataMutation.isPending}
                  onClick={() => {
                    if (!metadataImportTestId || !metadataImportText.trim()) return;
                    try {
                      const parsed = JSON.parse(metadataImportText) as unknown;
                      if ((!Array.isArray(parsed) && (typeof parsed !== "object" || parsed === null))) {
                        throw new Error("Please paste a JSON object or question metadata array.");
                      }
                      importMetadataMutation.mutate({
                        testId: metadataImportTestId,
                        payload: parsed,
                        mode: metadataImportMode,
                      });
                    } catch (error) {
                      toast({
                        title: metadataImportConfig.invalidJsonTitle,
                        description: error instanceof Error ? error.message : "Please paste valid JSON.",
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  {importMetadataMutation.isPending ? "Importing..." : metadataImportConfig.submitLabel}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── AI Metadata Generator Dialog ────────────────────────────────────── */}
      <Dialog open={aiMetaOpen} onOpenChange={(open) => { if (!open) { resetAiMetaDialog(); setAiMetaOpen(false); } }}>
        <DialogContent className="max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b border-[#eadfcd] px-6 py-4 pr-14 text-left">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-violet-500" /> AI Metadata Generator
            </DialogTitle>
            <p className="mt-0.5 text-sm text-slate-500">
              {aiMetaTestId != null ? `Test: ${tests.find((t) => t.id === aiMetaTestId)?.title ?? "—"}` : ""}
            </p>
          </DialogHeader>

          {/* UPLOAD step */}
          {aiMetaStep === "upload" && (
            <div className="flex flex-col gap-5 p-6">
              <div
                onDragOver={(e) => { e.preventDefault(); setAiMetaIsDragging(true); }}
                onDragLeave={() => setAiMetaIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setAiMetaIsDragging(false); if (e.dataTransfer.files) runAiAnalysis(Array.from(e.dataTransfer.files)); }}
                onClick={() => aiMetaFileRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-12 transition-colors ${aiMetaIsDragging ? "border-violet-400 bg-violet-50" : "border-[#E5E7EB] bg-[#F8FAFC] hover:border-violet-400 hover:bg-violet-50/40"}`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
                  <Sparkles size={22} className="text-violet-500" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-[#0F172A]">HTML question paper yahan drop karo</p>
                  <p className="mt-1 text-xs text-[#64748B]">ya click karke select karo — AI har question ko auto-tag karega</p>
                </div>
                <input ref={aiMetaFileRef} type="file" accept=".html,.htm" multiple className="hidden" onChange={(e) => { if (e.target.files) runAiAnalysis(Array.from(e.target.files)); }} />
              </div>
              {aiMetaError && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={14} /> {aiMetaError}
                </div>
              )}
              <p className="text-center text-xs text-[#94A3B8]">AI API key super admin settings mein configure karo</p>
            </div>
          )}

          {/* ERROR step */}
          {aiMetaStep === "error" && (
            <div className="flex flex-col items-center gap-5 py-16 px-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                <AlertCircle size={24} className="text-red-500" />
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-[#0F172A]">AI analysis fail ho gayi</p>
                <p className="mt-2 max-w-sm text-sm text-red-600">{aiMetaError}</p>
              </div>
              <Button
                size="sm"
                className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() => {
                  const existing = aiMetaTestId != null ? questionsMap[aiMetaTestId] : null;
                  if (existing && existing.length > 0) {
                    setAiMetaError(null);
                    runAiAnalysisFromTestQuestions(existing);
                  }
                }}
              >
                <Sparkles size={13} /> Retry
              </Button>
            </div>
          )}

          {/* ANALYZING step */}
          {aiMetaStep === "analyzing" && (
            <div className="flex flex-col items-center gap-5 py-16 px-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
                <Loader2 size={24} className="animate-spin text-violet-500" />
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-[#0F172A]">AI analysis chal rahi hai…</p>
                <p className="mt-1 text-sm text-[#64748B]">{aiMetaProgress.done} / {aiMetaProgress.total} questions classify ho gaye</p>
              </div>
              <div className="w-full max-w-sm">
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
                  <div className="h-full rounded-full bg-violet-500 transition-all duration-500"
                    style={{ width: `${aiMetaProgress.total > 0 ? Math.round((aiMetaProgress.done / aiMetaProgress.total) * 100) : 0}%` }} />
                </div>
                <p className="mt-1.5 text-center text-xs text-[#94A3B8]">
                  {aiMetaProgress.total > 0 ? Math.round((aiMetaProgress.done / aiMetaProgress.total) * 100) : 0}% complete
                </p>
              </div>
            </div>
          )}

          {/* TABLE step */}
          {aiMetaStep === "table" && (
            <div className="flex flex-col" style={{ maxHeight: "70vh" }}>
              <div className="flex-1 overflow-auto">
                <table className="w-full min-w-[700px] border-collapse text-sm">
                  <thead>
                    <tr className="sticky top-0 border-b border-[#E5E7EB] bg-[#F8FAFC]">
                      {["#", "Q Code", "Subject", "Chapter", "Topic", "Difficulty", "Time (s)"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {aiMetaRows.map((row, idx) => (
                      <tr key={row.questionCode + idx} className="border-b border-[#F1F5F9] hover:bg-[#FAFBFF]">
                        <td className="px-3 py-2 text-xs text-[#94A3B8]">{idx + 1}</td>
                        <td className="px-3 py-2 font-mono text-xs font-bold text-violet-600 whitespace-nowrap">{row.questionCode}</td>
                        <td className="px-3 py-2"><input className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:bg-white hover:border-[#E5E7EB] focus:outline-none focus:border-violet-400 focus:bg-white" value={row.subject} onChange={(e) => setAiMetaRows((r) => r.map((x, i) => i === idx ? { ...x, subject: e.target.value } : x))} /></td>
                        <td className="px-3 py-2"><input className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:bg-white hover:border-[#E5E7EB] focus:outline-none focus:border-violet-400 focus:bg-white" value={row.chapter} onChange={(e) => setAiMetaRows((r) => r.map((x, i) => i === idx ? { ...x, chapter: e.target.value } : x))} /></td>
                        <td className="px-3 py-2"><input className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:bg-white hover:border-[#E5E7EB] focus:outline-none focus:border-violet-400 focus:bg-white" value={row.topic} onChange={(e) => setAiMetaRows((r) => r.map((x, i) => i === idx ? { ...x, topic: e.target.value } : x))} /></td>
                        <td className="px-3 py-2">
                          <select className={`rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold focus:outline-none focus:border-violet-400 ${row.difficulty === "easy" ? "text-green-600" : row.difficulty === "hard" ? "text-red-600" : "text-yellow-600"}`}
                            value={row.difficulty} onChange={(e) => setAiMetaRows((r) => r.map((x, i) => i === idx ? { ...x, difficulty: e.target.value } : x))}>
                            <option value="easy">Easy</option>
                            <option value="moderate">Moderate</option>
                            <option value="hard">Hard</option>
                          </select>
                        </td>
                        <td className="px-3 py-2"><input type="number" min={10} step={10} className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:bg-white hover:border-[#E5E7EB] focus:outline-none focus:border-violet-400 focus:bg-white" value={row.idealTimeSeconds} onChange={(e) => setAiMetaRows((r) => r.map((x, i) => i === idx ? { ...x, idealTimeSeconds: parseInt(e.target.value) || 60 } : x))} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-[#E5E7EB] px-6 py-3">
                <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
                  <CheckCircle2 size={13} className="text-green-500" />
                  {aiMetaRows.length} questions ready — cells click karke edit kar sakte ho
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setAiMetaStep("upload")}>Back</Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                    disabled={importMetadataMutation.isPending && metadataImportTestId === aiMetaTestId}
                    onClick={() => {
                      if (!aiMetaTestId) return;
                      importMetadataMutation.mutate(
                        { testId: aiMetaTestId, payload: aiMetaRows, mode: "metadata" },
                        {
                          onSuccess: () => { setAiMetaOpen(false); resetAiMetaDialog(); },
                        }
                      );
                    }}
                  >
                    {importMetadataMutation.isPending ? <><Loader2 size={13} className="animate-spin" /> Applying…</> : <><CheckCircle2 size={13} /> Approve & Apply</>}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Background import progress panel ───────────────────────────────── */}
      {importQueue.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex w-[22rem] flex-col gap-2">
          {/* Header bar when multiple jobs */}
          {importQueue.length > 1 && (
            <div className="flex items-center justify-between rounded-xl border border-[#eadfcd] bg-white px-3 py-2 shadow-md">
              <span className="text-xs font-semibold text-slate-600">
                {importQueue.filter((j) => j.status === "pending").length > 0
                  ? `Importing ${importQueue.filter((j) => j.status === "pending").length} test${importQueue.filter((j) => j.status === "pending").length === 1 ? "" : "s"}…`
                  : `${importQueue.length} imports complete`}
              </span>
              <button
                type="button"
                onClick={dismissAllCompletedImports}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Clear done
              </button>
            </div>
          )}

          {/* Individual job cards */}
          {importQueue.map((job) => {
            const pct = Math.round(job.progress);
            // Estimate time remaining: if progress > 2% we can extrapolate
            let timeLeft = "";
            if (job.status === "pending") {
              const elapsedSec = (Date.now() - job.startedAt) / 1000;
              if (job.progress >= 2 && elapsedSec > 1.5) {
                // rate = progress per second; estimate seconds to reach 100
                const rate = job.progress / elapsedSec; // %/s
                const remaining = (100 - job.progress) / rate;
                timeLeft = formatTimeLeft(remaining);
              } else {
                timeLeft = "Calculating…";
              }
            }

            return (
              <div
                key={job.id}
                className={[
                  "rounded-xl border shadow-lg transition-all",
                  job.status === "pending"
                    ? "border-[#f4c98b] bg-[#fffaf2]"
                    : job.status === "success"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-red-200 bg-red-50",
                ].join(" ")}
              >
                {/* Top row: icon + title + dismiss */}
                <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2">
                  <div className="mt-0.5 shrink-0">
                    {job.status === "pending" && (
                      <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
                    )}
                    {job.status === "success" && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}
                    {job.status === "error" && (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800">{job.title}</p>
                    {job.status === "pending" && (
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#f97316]">{pct}%</span>
                        <span className="text-xs text-slate-400">{timeLeft}</span>
                      </div>
                    )}
                    {job.status === "success" && (
                      <p className="mt-0.5 text-xs text-emerald-700">{job.message}</p>
                    )}
                    {job.status === "error" && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-red-700">{job.message ?? "Import failed"}</p>
                    )}
                  </div>

                  {job.status !== "pending" && (
                    <button
                      type="button"
                      onClick={() => dismissImportJob(job.id)}
                      className="ml-1 mt-0.5 shrink-0 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Progress bar (always visible — 100% when done) */}
                <div className="px-3.5 pb-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={[
                        "h-full rounded-full transition-all",
                        job.status === "error"
                          ? "bg-red-400"
                          : job.status === "success"
                          ? "bg-emerald-400"
                          : "bg-[#f97316]",
                      ].join(" ")}
                      style={{
                        width: `${pct}%`,
                        transitionDuration: job.status === "pending" ? "250ms" : "400ms",
                        transitionTimingFunction: job.status === "pending" ? "linear" : "ease-out",
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Bulk AI Metadata Dialog ──────────────────────────────────────────── */}
      {bulkAiMetaOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[#eadfcd] bg-[#faf7ff] px-4 py-2.5 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white">
                <Sparkles size={13} />
              </div>
              <span className="text-sm font-bold text-slate-800">Bulk AI Metadata</span>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                {bulkAiMetaJobs.length} test{bulkAiMetaJobs.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Auto-import toggle */}
            <label className="ml-2 flex cursor-pointer items-center gap-2 rounded-lg border border-[#eadfcd] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={bulkAiMetaAutoImport}
                onChange={(e) => setBulkAiMetaAutoImport(e.target.checked)}
                disabled={bulkAiMetaRunning}
                className="accent-violet-600"
              />
              Auto-import after generation
            </label>

            <div className="ml-auto flex items-center gap-2">
              {/* Overall progress */}
              {bulkAiMetaRunning && (() => {
                const done = bulkAiMetaJobs.filter((j) => j.status === "done" || j.status === "error" || j.status === "skipped").length;
                const pct = bulkAiMetaJobs.length > 0 ? Math.round((done / bulkAiMetaJobs.length) * 100) : 0;
                return (
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-32 overflow-hidden rounded-full bg-[#E5E7EB]">
                      <div className="h-full rounded-full bg-violet-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-violet-700">{pct}%</span>
                  </div>
                );
              })()}

              {!bulkAiMetaRunning ? (
                <Button
                  size="sm"
                  className="h-7 gap-1.5 bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700"
                  onClick={() => void runBulkAiMeta()}
                  disabled={bulkAiMetaJobs.every((j) => j.status === "done")}
                >
                  <Sparkles size={11} />
                  {bulkAiMetaJobs.some((j) => j.status === "done" || j.status === "error") ? "Run Again" : "Start Generation"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 border-rose-300 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                  onClick={() => { bulkAiMetaCancelRef.current = true; }}
                >
                  <X size={11} />
                  Cancel
                </Button>
              )}
              <button
                type="button"
                onClick={() => { if (!bulkAiMetaRunning) setBulkAiMetaOpen(false); }}
                disabled={bulkAiMetaRunning}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#eadfcd] bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 transition-colors"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Job list */}
          <div className="flex-1 overflow-y-auto bg-[#f8fafc] px-6 py-5">
            {/* Summary row */}
            {bulkAiMetaJobs.some((j) => j.status !== "pending") && (
              <div className="mb-4 flex flex-wrap gap-3">
                {[
                  { label: "Done", count: bulkAiMetaJobs.filter((j) => j.status === "done").length, color: "text-green-700 bg-green-50 border-green-200" },
                  { label: "Error", count: bulkAiMetaJobs.filter((j) => j.status === "error").length, color: "text-rose-700 bg-rose-50 border-rose-200" },
                  { label: "Skipped", count: bulkAiMetaJobs.filter((j) => j.status === "skipped").length, color: "text-slate-600 bg-slate-50 border-slate-200" },
                  { label: "Pending", count: bulkAiMetaJobs.filter((j) => j.status === "pending").length, color: "text-slate-500 bg-white border-slate-200" },
                ].filter((s) => s.count > 0).map((s) => (
                  <span key={s.label} className={`rounded-full border px-3 py-1 text-xs font-semibold ${s.color}`}>
                    {s.count} {s.label}
                  </span>
                ))}
              </div>
            )}

            <div className="space-y-3">
              {bulkAiMetaJobs.map((job) => {
                const pct = job.progress.total > 0 ? Math.round((job.progress.done / job.progress.total) * 100) : 0;
                const statusConfig: Record<BulkAiMetaStatus, { icon: React.ReactNode; label: string; color: string }> = {
                  pending:   { icon: <div className="h-4 w-4 rounded-full border-2 border-slate-300" />, label: "Pending", color: "text-slate-400" },
                  fetching:  { icon: <Loader2 size={14} className="animate-spin text-blue-500" />, label: "Fetching questions…", color: "text-blue-600" },
                  analyzing: { icon: <Loader2 size={14} className="animate-spin text-violet-500" />, label: `Analyzing… ${job.progress.done}/${job.progress.total}`, color: "text-violet-600" },
                  importing: { icon: <Loader2 size={14} className="animate-spin text-amber-500" />, label: "Importing metadata…", color: "text-amber-600" },
                  done:      { icon: <CheckCircle2 size={14} className="text-green-500" />, label: "Done", color: "text-green-600" },
                  error:     { icon: <AlertCircle size={14} className="text-rose-500" />, label: job.error ?? "Error", color: "text-rose-600" },
                  skipped:   { icon: <div className="h-4 w-4 rounded-full border-2 border-slate-200 bg-slate-100" />, label: job.error ? `Skipped — ${job.error}` : "Skipped", color: "text-slate-400" },
                };
                const cfg = statusConfig[job.status];
                return (
                  <div
                    key={job.testId}
                    className={`flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-sm transition-all ${
                      job.status === "analyzing" || job.status === "fetching" || job.status === "importing"
                        ? "border-violet-300 ring-1 ring-violet-100"
                        : job.status === "done"
                        ? "border-green-200"
                        : job.status === "error"
                        ? "border-rose-200"
                        : "border-[#eadfcd]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50">
                        {cfg.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{job.title}</p>
                        <p className={`mt-0.5 text-xs font-medium ${cfg.color}`}>{cfg.label}</p>
                      </div>
                      {job.status === "analyzing" && (
                        <span className="shrink-0 text-xs font-bold text-violet-600">{pct}%</span>
                      )}
                    </div>
                    {job.status === "analyzing" && job.progress.total > 0 && (
                      <div className="ml-12">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
                          <div
                            className="h-full rounded-full bg-violet-500 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400">{job.progress.done} of {job.progress.total} questions classified</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Instructions when idle */}
            {!bulkAiMetaRunning && bulkAiMetaJobs.every((j) => j.status === "pending") && (
              <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50 px-5 py-4">
                <p className="text-sm font-semibold text-violet-800">How bulk generation works</p>
                <ol className="mt-2 space-y-1.5 text-xs text-violet-700">
                  <li>1. Each test's questions are fetched from the database</li>
                  <li>2. AI classifies each question's subject, chapter, topic, difficulty & ideal time</li>
                  {bulkAiMetaAutoImport
                    ? <li>3. Metadata is <span className="font-semibold">automatically imported</span> into each test</li>
                    : <li>3. <span className="font-semibold">Auto-import is OFF</span> — use per-test "Generate AI Metadata" to review before importing</li>
                  }
                  <li className="pt-1 font-semibold text-violet-800">Tests are processed one at a time to stay within AI rate limits.</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Bulk Edit Dialog ─────────────────────────────────────────────── */}
      <Dialog open={bulkDialogOpen} onOpenChange={(open) => { if (!open) setBulkDialogOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers size={16} className="text-amber-600" />
              Bulk Edit — {selectedTestIds.size} Test{selectedTestIds.size === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Only fields you fill in will be updated. Leave blank to keep existing values.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Set Category</Label>
              <Select value={bulkCategory} onValueChange={(v) => setBulkCategory(v as TestCategory | "")}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Keep existing" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mock">Mock Test</SelectItem>
                  <SelectItem value="subject-wise">Subject Wise Test</SelectItem>
                  <SelectItem value="multi-subject">Chapter Wise Test</SelectItem>
                  <SelectItem value="pyq">PYQ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Set Exam Type</Label>
              <Select value={bulkExamType} onValueChange={setBulkExamType}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Keep existing" />
                </SelectTrigger>
                <SelectContent>
                  {examTemplates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Publish Status</Label>
              <Select value={bulkPublish} onValueChange={(v) => setBulkPublish(v as "" | "publish" | "unpublish")}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Keep existing" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="publish">Publish all</SelectItem>
                  <SelectItem value="unpublish">Unpublish all</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={(!bulkCategory && !bulkExamType && !bulkPublish) || bulkUpdateMutation.isPending}
              onClick={commitBulkEdit}
              className="chip-orange-solid"
            >
              {bulkUpdateMutation.isPending ? "Applying…" : `Apply to ${selectedTestIds.size} Test${selectedTestIds.size === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Inline Test Settings Dialog ─────────────────────────────────── */}
      <Dialog open={settingsTestId !== null} onOpenChange={(open) => { if (!open) setSettingsTestId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 size={16} className="text-amber-600" />
              Test Settings
            </DialogTitle>
            <DialogDescription>
              Edit test configuration without opening the test builder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Test Category</Label>
              <Select value={settingsCategory} onValueChange={(v) => setSettingsCategory(v as TestCategory)}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mock">Mock Test</SelectItem>
                  <SelectItem value="subject-wise">Subject Wise Test</SelectItem>
                  <SelectItem value="multi-subject">Chapter Wise Test</SelectItem>
                  <SelectItem value="pyq">PYQ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Exam Type</Label>
              <Select value={settingsExamType} onValueChange={setSettingsExamType}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select exam type" />
                </SelectTrigger>
                <SelectContent>
                  {examTemplates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Duration (min)</Label>
                <Input
                  type="number"
                  min={1}
                  className="mt-1.5"
                  value={settingsDuration}
                  onChange={(e) => setSettingsDuration(e.target.value)}
                  placeholder="e.g. 180"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Passing Score</Label>
                <Input
                  type="number"
                  min={0}
                  className="mt-1.5"
                  value={settingsPassing}
                  onChange={(e) => setSettingsPassing(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled Date</Label>
              <Input
                type="datetime-local"
                className="mt-1.5"
                value={settingsScheduled}
                onChange={(e) => setSettingsScheduled(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Student Calculator</p>
                <p className="text-xs text-slate-500">Enable calculator during the test.</p>
              </div>
              <Switch checked={settingsCalculator} onCheckedChange={setSettingsCalculator} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettingsTestId(null)}>Cancel</Button>
            <Button
              disabled={updateTestSettingsMutation.isPending}
              onClick={commitSettings}
              className="chip-orange-solid"
            >
              {updateTestSettingsMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Admin All-Tests Student View ─────────────────────────────────────── */}
      {adminStudentViewOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {/* Toolbar */}
          <div className="flex items-center gap-3 border-b border-[#eadfcd] bg-[#fffaf2] px-4 py-2.5 shadow-sm flex-wrap">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
                <Eye size={13} />
              </div>
              <span className="text-sm font-bold text-slate-800">Student View</span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                {tests.length} tests
              </span>
            </div>
            {/* Tab switcher */}
            <div className="ml-2 flex items-center gap-1 rounded-lg border border-[#eadfcd] bg-white p-0.5">
              <button
                type="button"
                onClick={() => setAdminStudentViewTab("view")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  adminStudentViewTab === "view" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
              >
                <Eye size={11} />
                Student View
              </button>
              <button
                type="button"
                onClick={() => setAdminStudentViewTab("reorder")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  adminStudentViewTab === "reorder" ? "bg-amber-500 text-white shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
              >
                <GripVertical size={11} />
                Test Reorder
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAdminStudentViewOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#eadfcd] bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* ── Student View Tab ── */}
          {adminStudentViewTab === "view" ? (
            <div className="flex flex-1 flex-col overflow-hidden bg-[#F8FAFC]">
              {/* Search + Category Filter */}
              <div className="border-b border-[#E5E7EB] bg-white px-5 py-3 flex flex-wrap items-center gap-3">
                {/* Category pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(["all", "mock", "subject-wise", "multi-subject"] as const).map((cat) => {
                    const labels: Record<string, string> = { all: "All Tests", mock: "Mock Tests", "subject-wise": "Subject Wise", "multi-subject": "Chapter Wise" };
                    const active = svCategoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSvCategoryFilter(cat)}
                        className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors border ${
                          active
                            ? "bg-[#0F172A] text-white border-[#0F172A]"
                            : "bg-white text-[#475569] border-[#E5E7EB] hover:bg-[#F1F5F9] hover:border-[#CBD5E1]"
                        }`}
                      >
                        {labels[cat]}
                        {cat !== "all" && (
                          <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/20" : "bg-[#F1F5F9]"}`}>
                            {tests.filter((t) => getAdminTestCategory(t) === cat).length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* Search */}
                <div className="relative ml-auto w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
                  <input
                    type="text"
                    placeholder="Search tests…"
                    value={svSearchQuery}
                    onChange={(e) => setSvSearchQuery(e.target.value)}
                    className="w-full rounded-full border border-[#E5E7EB] bg-[#F8FAFC] py-2 pl-9 pr-4 text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20"
                  />
                </div>
              </div>

              {/* Test Cards Grid */}
              <div className="flex-1 overflow-y-auto px-5 py-5">
                {svFilteredTests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-slate-400">
                    <BookOpen size={40} className="mb-3 opacity-30" />
                    <p className="text-sm font-medium">No tests found</p>
                    <p className="mt-1 text-xs">Try changing the filter or search query</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {svFilteredTests.map((test) => {
                      const subject = getAdminTestSubject(test);
                      const accent = getAdminTestAccent(subject);
                      const cat = getAdminTestCategory(test);
                      const catTone = getAdminTestCategoryTone(cat);
                      const catLabel = getAdminTestCategoryLabel(cat);
                      const visibleDesc = getAdminVisibleDescription(test.description);
                      const qCount = questionsMap[test.id]?.length ?? test.questionCount ?? null;
                      return (
                        <div
                          key={test.id}
                          className="group flex h-full flex-col overflow-hidden rounded-[24px] border border-[#E5E7EB] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_16px_36px_rgba(15,23,42,0.10)]"
                        >
                          <div className={`h-1.5 w-full ${accent.line}`} />
                          <div className="flex h-full flex-col p-4 sm:p-5">
                            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${accent.dot}`} />
                                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6B7280] truncate">{subject || "General"}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 self-start">
                                <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${catTone.pill}`}>
                                  {catLabel}
                                </span>
                                {test.isPublished ? (
                                  <span className="h-2.5 w-2.5 rounded-full bg-[#10B981] shadow-[0_0_0_2px_rgba(16,185,129,0.18)]" title="Published" />
                                ) : (
                                  <span className="h-2.5 w-2.5 rounded-full bg-[#94A3B8] shadow-[0_0_0_2px_rgba(148,163,184,0.18)]" title="Draft" />
                                )}
                              </div>
                            </div>

                            <h3 className="line-clamp-2 text-[16px] font-bold leading-tight text-[#0F172A] sm:text-[18px]">{test.title}</h3>
                            <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-[#6B7280] sm:min-h-[40px] sm:text-[13px] sm:leading-6">
                              {visibleDesc || `${subject || "General"} practice test with exam-style timing.`}
                            </p>

                            <div className="mt-4 flex flex-wrap gap-2">
                              <div className="inline-flex items-center gap-1.5 rounded-full bg-[#F8FAFC] px-3 py-1.5 text-xs font-semibold text-[#475569]">
                                <HelpCircle className="h-3.5 w-3.5" />
                                <span>{qCount == null ? "--" : `${qCount} Qs`}</span>
                              </div>
                              <div className="inline-flex items-center gap-1.5 rounded-full bg-[#F8FAFC] px-3 py-1.5 text-xs font-semibold text-[#475569]">
                                <Clock className="h-3.5 w-3.5" />
                                <span>{test.durationMinutes} min</span>
                              </div>
                            </div>

                            <div className="mt-2 text-xs font-medium text-[#94A3B8]">
                              {test.scheduledAt ? `Scheduled: ${format(new Date(test.scheduledAt), "MMM d, yyyy")}` : "Available now"}
                            </div>

                            <div className="mt-auto pt-4">
                              <div className={`w-full rounded-full px-4 py-2.5 text-center text-sm font-semibold text-white ${accent.line} opacity-80 cursor-default`}>
                                {test.isPublished ? "Start Test" : "Draft — Not Published"}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Test Reorder Tab ── */
            <div className="flex flex-1 flex-col overflow-hidden bg-[#f8fafc]">
              <div className="border-b border-[#eadfcd] bg-white px-6 py-4">
                <p className="text-sm font-semibold text-slate-700">
                  Drag tests to reorder them. Changes are saved instantly.
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {tests.length} test{tests.length !== 1 ? "s" : ""} · students see them in this order
                </p>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="space-y-2">
                  {svDragPreviewTests.map((test, idx) => {
                    const isDragging = draggedTestId === test.id;
                    const isDragOver = dragOverTestId === test.id;
                    const subject = getAdminTestSubject(test);
                    const cat = getAdminTestCategory(test);
                    const catLabel = getAdminTestCategoryLabel(cat);
                    const catTone = getAdminTestCategoryTone(cat);
                    return (
                      <div
                        key={test.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, test.id)}
                        onDragOver={(e) => handleDragOver(e, test.id)}
                        onDrop={(e) => handleDrop(e, test.id)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm transition-all select-none cursor-grab active:cursor-grabbing ${
                          isDragging ? "opacity-40 scale-[0.99]" : ""
                        } ${isDragOver ? "border-amber-400 ring-2 ring-amber-200" : "border-[#eadfcd]"}`}
                      >
                        <GripVertical size={18} className="text-slate-300 shrink-0" />
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-500">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${catTone.pill}`}>
                              {catLabel}
                            </span>
                            {test.isPublished ? (
                              <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">Published</span>
                            ) : (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Draft</span>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-slate-800 truncate">{test.title}</p>
                          {subject && <p className="text-xs text-slate-500 mt-0.5">{subject}</p>}
                        </div>
                        <div className="shrink-0 text-right text-xs text-slate-400 space-y-0.5">
                          <div className="flex items-center gap-1 justify-end">
                            <Clock size={11} />
                            <span>{test.durationMinutes} min</span>
                          </div>
                          {(questionsMap[test.id]?.length ?? test.questionCount) != null && (
                            <div className="flex items-center gap-1 justify-end">
                              <HelpCircle size={11} />
                              <span>{questionsMap[test.id]?.length ?? test.questionCount} Qs</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Student Preview Dialog ──────────────────────────────────────────── */}
      {studentPreviewTestId !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {/* Admin toolbar */}
          <div className="flex items-center gap-3 border-b border-[#eadfcd] bg-[#fffaf2] px-4 py-2.5 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
                <Eye size={13} />
              </div>
              <span className="text-sm font-bold text-slate-800">Admin Preview</span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                {studentPreviewDetail?.title ?? "Loading…"}
              </span>
            </div>
            {/* Tab switcher */}
            <div className="ml-4 flex items-center gap-1 rounded-lg border border-[#eadfcd] bg-white p-0.5">
              <button
                type="button"
                onClick={() => setStudentPreviewTab("listing")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  studentPreviewTab === "listing" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
              >
                <Eye size={11} />
                My Tests View
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setStudentPreviewTestId(null); setStudentPreviewDetail(null); }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#eadfcd] bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                aria-label="Close preview"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Content */}
          {studentPreviewLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <Loader2 size={32} className="animate-spin text-blue-500" />
                <p className="text-sm font-medium">Loading student view…</p>
              </div>
            </div>
          ) : studentPreviewDetail === null ? null : studentPreviewTab === "listing" ? (
            /* ── My Tests Listing Tab (with inline test reordering) ───────── */
            (() => {
              const publishedCount = svDragPreviewTests.filter((t) => t.isPublished).length;
              const listingDisplayTests = svCategoryFilter === "all"
                ? svDragPreviewTests
                : svDragPreviewTests.filter((t) => getAdminTestCategory(t) === svCategoryFilter);
              const catCounts: Record<string, number> = {
                all: svDragPreviewTests.length,
                mock: svDragPreviewTests.filter((t) => getAdminTestCategory(t) === "mock").length,
                "subject-wise": svDragPreviewTests.filter((t) => getAdminTestCategory(t) === "subject-wise").length,
                "multi-subject": svDragPreviewTests.filter((t) => getAdminTestCategory(t) === "multi-subject").length,
              };
              return (
                <div className="flex flex-1 flex-col overflow-auto bg-[#f0f2f5]" style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif" }}>
                  <div className="mx-auto w-full max-w-5xl px-4 py-6">
                    {/* Admin reorder notice */}
                    <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
                      <GripVertical size={13} className="shrink-0 text-amber-600" />
                      <p className="text-xs text-amber-700">
                        <span className="font-semibold">Admin view</span> — drag the grip handle on any row to reorder tests. Order saves instantly.{" "}
                        <span className="text-amber-600">Highlighted row = currently selected test.</span>
                      </p>
                    </div>

                    {/* Header */}
                    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h1 className="text-2xl font-bold text-[#1a1a2e]">My Tests</h1>
                        <p className="mt-0.5 text-sm text-[#64748B]">Choose your test type and start practising to achieve your best.</p>
                      </div>
                      <div className="flex gap-3">
                        {[
                          { label: "Total Tests", value: String(svDragPreviewTests.length), icon: "📋", color: "text-blue-600" },
                          { label: "Published", value: String(publishedCount), icon: "✅", color: "text-green-600" },
                          { label: "Drafts", value: String(svDragPreviewTests.length - publishedCount), icon: "📝", color: "text-orange-500" },
                        ].map((stat) => (
                          <div key={stat.label} className="flex min-w-[80px] flex-col items-center justify-center rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
                            <span className="text-lg">{stat.icon}</span>
                            <span className={`text-lg font-bold ${stat.color}`}>{stat.value}</span>
                            <span className="text-center text-[10px] text-[#94A3B8]">{stat.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Test table */}
                    <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
                      {/* Filters bar — functional, student-styled */}
                      <div className="flex flex-wrap items-center gap-3 border-b border-[#F1F5F9] px-4 py-3">
                        <div className="flex gap-2">
                          {([
                            { key: "all" as const, label: "All Tests" },
                            { key: "mock" as const, label: "Mock Tests" },
                            { key: "subject-wise" as const, label: "Subject Wise" },
                            { key: "multi-subject" as const, label: "Chapter Wise" },
                          ]).map(({ key, label }) => {
                            const isActive = svCategoryFilter === key;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setSvCategoryFilter(key)}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                                  isActive
                                    ? "border-[#2563EB] bg-[#2563EB] text-white"
                                    : "border-[#E5E7EB] bg-white text-[#64748B] hover:border-[#94A3B8]"
                                }`}
                              >
                                {label}
                                {catCounts[key] > 0 && (
                                  <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isActive ? "bg-white/20 text-white" : "bg-[#F1F5F9] text-[#94A3B8]"}`}>
                                    {catCounts[key]}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <div className="ml-auto flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-1.5">
                          <Search size={12} className="text-[#94A3B8]" />
                          <span className="text-xs text-[#94A3B8]">Search tests...</span>
                        </div>
                      </div>
                      {/* Table header */}
                      <div
                        className="grid items-center gap-2 border-b border-[#F1F5F9] bg-[#F8FAFC] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]"
                        style={{ gridTemplateColumns: "20px 2fr 1fr 80px 80px 110px 80px 110px" }}
                      >
                        <span></span>
                        <span>Test Name</span>
                        <span>Type</span>
                        <span className="text-center">Questions</span>
                        <span className="text-center">Marks</span>
                        <span className="text-center">Duration</span>
                        <span className="text-center">Status</span>
                        <span className="text-right">Action</span>
                      </div>
                      {/* All test rows — draggable */}
                      {listingDisplayTests.map((test) => {
                        const isDragging = draggedTestId === test.id;
                        const isDragOver = dragOverTestId === test.id;
                        const cat = getAdminTestCategory(test);
                        const catLabel = getAdminTestCategoryLabel(cat);
                        const catTone = getAdminTestCategoryTone(cat);
                        const qCount = questionsMap[test.id]?.length ?? test.questionCount ?? 0;
                        return (
                          <div
                            key={test.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, test.id)}
                            onDragOver={(e) => handleDragOver(e, test.id)}
                            onDrop={(e) => handleDrop(e, test.id)}
                            onDragEnd={handleDragEnd}
                            className={`grid items-center gap-2 border-b border-[#F1F5F9] px-4 py-3.5 transition-all select-none last:border-b-0 ${
                              isDragging ? "opacity-40 scale-[0.99]" : ""
                            } ${isDragOver ? "ring-2 ring-inset ring-amber-400 bg-amber-50" : "hover:bg-[#F8FAFC]"}`}
                            style={{ gridTemplateColumns: "20px 2fr 1fr 80px 80px 110px 80px 110px" }}
                          >
                            {/* Drag handle */}
                            <div className="flex cursor-grab active:cursor-grabbing items-center justify-center">
                              <GripVertical size={14} className="text-slate-300 hover:text-slate-500 transition-colors" />
                            </div>
                            {/* Test name */}
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                                <FileText size={14} className="text-blue-600" />
                              </div>
                              <span className="block text-sm font-semibold text-[#0F172A] leading-snug line-clamp-2">{test.title}</span>
                            </div>
                            {/* Type */}
                            <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${catTone.pill}`}>
                              {catLabel}
                            </span>
                            {/* Questions */}
                            <span className="text-center text-sm font-semibold text-[#374151]">{qCount}</span>
                            {/* Marks */}
                            <span className="text-center text-sm font-semibold text-[#374151]">
                              {questionsMap[test.id]
                                ? questionsMap[test.id].reduce((s, q) => s + (q.points ?? 0), 0)
                                : "—"}
                            </span>
                            {/* Duration */}
                            <div className="flex items-center justify-center gap-1">
                              <Clock size={13} className="text-[#94A3B8]" />
                              <span className="text-sm font-semibold text-[#374151]">{test.durationMinutes ?? "—"} min</span>
                            </div>
                            {/* Status */}
                            <div className="flex justify-center">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                test.isPublished ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                              }`}>
                                {test.isPublished ? "Published" : "Draft"}
                              </span>
                            </div>
                            {/* Action */}
                            <div className="flex justify-end">
                              <span className="inline-flex cursor-default items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-bold text-white">
                                Start →
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {listingDisplayTests.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                          <FileText size={32} className="mb-2 opacity-30" />
                          <p className="text-sm">No tests found</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            /* ── Student View Tab ─────────────────────────────────────────── */
            <div className="relative flex flex-1 flex-col overflow-hidden bg-white text-black [color-scheme:light]">
              {/* Exact student exam header */}
              <div className="overflow-hidden border-b border-[#7f7f7f] bg-white text-black">
                <div className="flex items-center justify-between gap-2 border-b border-[#a76d1c] px-2 py-2 sm:px-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#7f7f7f] bg-[#f3f3f3] text-[9px] font-bold text-[#57438f] sm:h-10 sm:w-10 sm:text-[10px]">EC</div>
                  <div className="min-w-0 flex-1 px-2 text-center leading-tight">
                    <p className="truncate text-sm font-bold uppercase tracking-tight text-[#6e4ca5] sm:text-xl">
                      {(studentPreviewDetail.examHeader?.trim() || studentPreviewDetail.title || "Exam").toUpperCase()}
                    </p>
                    <p className="truncate text-[10px] font-semibold uppercase text-[#3a8b2e] sm:text-xs">
                      {studentPreviewDetail.examSubheader?.trim() || "Online Test"}
                    </p>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#7f7f7f] bg-[#f3f3f3] text-[9px] font-bold text-[#d58a00] sm:h-10 sm:w-10 sm:text-[10px]">QB</div>
                </div>
                <div className="flex items-center justify-between bg-[#d7edf6] px-3 py-2 sm:px-4">
                  <p className="text-sm font-bold text-[#4d4d4d]">
                    {studentPreviewShowInstructions ? "Instructions" : studentPreviewDetail.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 rounded border border-[#7f7f7f] bg-white px-2 py-0.5 text-xs font-semibold text-[#2b2b2b]">
                      <Clock size={12} />
                      {studentPreviewDetail.durationMinutes}:00
                    </span>
                    {getCalculatorEnabledFromExamConfig(studentPreviewDetail.examConfig) && (
                      <span className="flex items-center gap-1 rounded border border-[#7f7f7f] bg-white px-2 py-0.5 text-xs font-semibold text-[#2b2b2b]">
                        <Calculator size={12} />
                        Calculator
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {studentPreviewShowInstructions ? (
                /* Instructions screen */
                <div className="flex flex-1 overflow-hidden">
                  <div className="flex-1 overflow-y-auto px-6 py-6">
                    <div className="mx-auto max-w-2xl">
                      <div className="mb-5 flex items-center gap-2">
                        <Info size={18} className="text-blue-600" />
                        <h2 className="text-lg font-bold text-[#111827]">General Instructions</h2>
                      </div>
                      <ol className="space-y-3">
                        {[
                          `The duration of the examination is ${studentPreviewDetail.durationMinutes} minutes. The countdown timer at the top right-hand corner of your screen displays the remaining time.`,
                          "When the timer reaches zero, the examination will end automatically and your responses will be submitted.",
                          "The screen is divided into two panels. The panel on the left shows the questions one at a time and the panel on the right has the Question Palette.",
                          "Click on Save & Next to save your answer and move to the next question.",
                          "Click on Mark for Review & Next to mark the current question for review and continue.",
                          "Click on a question number in the Question Palette to navigate directly without auto-saving the current question.",
                          "Use Clear Response to remove the selected answer from the current question.",
                          "MCQ uses circular selection, MSQ uses square selection, and integer questions use the numeric input area.",
                          ...(studentPreviewDetail.instructions
                            ? studentPreviewDetail.instructions.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
                            : []),
                        ].map((item, i) => (
                          <li key={i} className="flex gap-3 text-sm text-[#374151]">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[11px] font-bold text-[#4F46E5]">{i + 1}</span>
                            <span className="leading-6">{item}</span>
                          </li>
                        ))}
                      </ol>
                      <div className="mt-8 flex items-center justify-between gap-4 rounded-xl border border-[#D8DEEF] bg-[#F8F9FF] px-5 py-4">
                        <div className="flex flex-wrap gap-4 text-xs text-[#374151]">
                          <span><span className="font-bold">{studentPreviewDetail.questions.length}</span> Total Questions</span>
                          <span><span className="font-bold">{studentPreviewDetail.durationMinutes}</span> Minutes</span>
                          <span><span className="font-bold">{studentPreviewDetail.sections.length || 1}</span> Section{(studentPreviewDetail.sections.length || 1) !== 1 ? "s" : ""}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setStudentPreviewShowInstructions(false); setStudentPreviewCurrentQ(0); }}
                          className="flex items-center gap-2 rounded-[14px] bg-[#6366F1] px-5 py-2 text-sm font-semibold text-white hover:bg-[#5558E8]"
                        >
                          Start Test <ChevronRight size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Test runner view */
                <div className="flex flex-1 overflow-hidden">
                  {/* Left: question panel */}
                  <div className="flex flex-1 flex-col overflow-hidden border-r border-[#e5e7eb]">
                    {/* Section tabs */}
                    {studentPreviewDetail.sections.length > 1 && (
                      <div className="flex gap-0 overflow-x-auto border-b border-[#e5e7eb] bg-[#f1f5f9]">
                        {studentPreviewDetail.sections.map((sec) => {
                          const sectionQs = studentPreviewDetail.questions.filter((q) => q.sectionId === sec.id);
                          const isActive = sectionQs.some((q) => q === studentPreviewDetail.questions[studentPreviewCurrentQ]);
                          return (
                            <button
                              key={sec.id}
                              type="button"
                              onClick={() => {
                                const idx = studentPreviewDetail.questions.findIndex((q) => q.sectionId === sec.id);
                                if (idx !== -1) setStudentPreviewCurrentQ(idx);
                              }}
                              className={`shrink-0 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
                                isActive ? "border-[#6366F1] bg-white text-[#4F46E5]" : "border-transparent text-[#64748B] hover:bg-white hover:text-[#374151]"
                              }`}
                            >
                              {sec.title || sec.subjectLabel || `Section ${sec.order + 1}`}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Question content */}
                    {(() => {
                      const q = studentPreviewDetail.questions[studentPreviewCurrentQ];
                      if (!q) return <div className="flex flex-1 items-center justify-center text-sm text-slate-400">No questions found.</div>;
                      return (
                        <div className="flex flex-1 flex-col overflow-y-auto">
                          <div className="border-b border-[#e5e7eb] bg-[#f8f9ff] px-5 py-3">
                            <span className="text-xs font-semibold text-[#6366F1]">
                              Question {studentPreviewCurrentQ + 1} of {studentPreviewDetail.questions.length}
                            </span>
                            <span className={`ml-3 rounded px-2 py-0.5 text-[10px] font-semibold ${
                              q.questionType === "mcq" ? "bg-blue-50 text-blue-700" :
                              q.questionType === "multi" ? "bg-violet-50 text-violet-700" :
                              "bg-amber-50 text-amber-700"
                            }`}>
                              {q.questionType === "mcq" ? "Single Correct (MCQ)" : q.questionType === "multi" ? "Multiple Correct (MSQ)" : "Integer Type"}
                            </span>
                            <span className="ml-3 text-[10px] text-slate-400">+{q.points} {q.negativeMarks ? `/ −${q.negativeMarks}` : ""}</span>
                          </div>
                          <div className="flex-1 overflow-y-auto px-5 py-5">
                            <div className="mb-5 text-sm leading-relaxed text-[#111827]">
                              {looksLikeRichHtmlContent(q.question)
                                ? <RichQuestionContent content={sanitizeRichHtml(q.question)} />
                                : <p>{q.question}</p>}
                            </div>
                            {q.imageData && (
                              <div className="mb-5">
                                <img src={q.imageData} alt="Question" className="max-h-48 rounded-lg border border-[#e5e7eb] object-contain" />
                              </div>
                            )}
                            {q.questionType !== "integer" ? (
                              <div className="space-y-2.5">
                                {q.options.map((opt, oi) => (
                                  <div
                                    key={oi}
                                    className="flex cursor-not-allowed items-start gap-3 rounded-xl border border-[#e5e7eb] bg-white px-4 py-3 text-sm text-[#374151] select-none opacity-90"
                                  >
                                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                                      q.questionType === "multi" ? "rounded border-2 border-[#9ca3af]" : "rounded-full border-2 border-[#9ca3af]"
                                    }`}>
                                      {String.fromCharCode(65 + oi)}
                                    </span>
                                    <span className="leading-5">
                                      {q.optionImages?.[oi]
                                        ? <img src={q.optionImages[oi]!} alt={`Option ${String.fromCharCode(65 + oi)}`} className="max-h-20 object-contain" />
                                        : looksLikeRichHtmlContent(opt)
                                          ? <RichQuestionContent content={sanitizeRichHtml(opt)} />
                                          : opt}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-48 items-center rounded-lg border-2 border-[#9ca3af] bg-[#f9fafb] px-3 text-sm text-[#9ca3af]">
                                  Enter integer answer…
                                </div>
                              </div>
                            )}
                          </div>
                          {/* Nav bar */}
                          <div className="flex items-center justify-between border-t border-[#e5e7eb] bg-[#f8f9ff] px-5 py-3">
                            <button
                              type="button"
                              disabled={studentPreviewCurrentQ === 0}
                              onClick={() => setStudentPreviewCurrentQ((p) => p - 1)}
                              className="flex items-center gap-1.5 rounded-lg border border-[#d1d5db] bg-white px-3 py-1.5 text-xs font-semibold text-[#374151] hover:bg-[#f1f5f9] disabled:opacity-40"
                            >
                              <ChevronLeft size={13} /> Previous
                            </button>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="rounded-lg border border-[#9ca3af] bg-white px-3 py-1.5 text-xs font-semibold text-[#374151] hover:bg-[#f1f5f9] cursor-not-allowed opacity-70"
                              >
                                Mark for Review
                              </button>
                              <button
                                type="button"
                                className="rounded-lg bg-[#6366F1] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5558E8] cursor-not-allowed"
                              >
                                Save & Next
                              </button>
                            </div>
                            <button
                              type="button"
                              disabled={studentPreviewCurrentQ === studentPreviewDetail.questions.length - 1}
                              onClick={() => setStudentPreviewCurrentQ((p) => p + 1)}
                              className="flex items-center gap-1.5 rounded-lg border border-[#d1d5db] bg-white px-3 py-1.5 text-xs font-semibold text-[#374151] hover:bg-[#f1f5f9] disabled:opacity-40"
                            >
                              Next <ChevronRight size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Right: question palette */}
                  <div className="hidden w-56 flex-col border-l border-[#e5e7eb] bg-[#f8f9ff] sm:flex">
                    <div className="border-b border-[#e5e7eb] px-3 py-2.5">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748b]">Question Palette</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3">
                      {studentPreviewDetail.sections.length > 1 ? (
                        studentPreviewDetail.sections.map((sec) => {
                          const secQs = studentPreviewDetail.questions.filter((q) => q.sectionId === sec.id);
                          return (
                            <div key={sec.id} className="mb-3">
                              <p className="mb-1.5 text-[10px] font-semibold text-[#64748b] uppercase tracking-wide">
                                {sec.title || sec.subjectLabel}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {secQs.map((q) => {
                                  const globalIdx = studentPreviewDetail.questions.indexOf(q);
                                  return (
                                    <button
                                      key={q.id}
                                      type="button"
                                      onClick={() => setStudentPreviewCurrentQ(globalIdx)}
                                      className={`flex h-7 w-7 items-center justify-center rounded text-[11px] font-bold transition-colors ${
                                        globalIdx === studentPreviewCurrentQ
                                          ? "bg-[#6366F1] text-white"
                                          : "border border-[#d1d5db] bg-white text-[#374151] hover:bg-[#EEF2FF]"
                                      }`}
                                    >
                                      {globalIdx + 1}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {studentPreviewDetail.questions.map((q, qi) => (
                            <button
                              key={q.id}
                              type="button"
                              onClick={() => setStudentPreviewCurrentQ(qi)}
                              className={`flex h-7 w-7 items-center justify-center rounded text-[11px] font-bold transition-colors ${
                                qi === studentPreviewCurrentQ
                                  ? "bg-[#6366F1] text-white"
                                  : "border border-[#d1d5db] bg-white text-[#374151] hover:bg-[#EEF2FF]"
                              }`}
                            >
                              {qi + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Palette legend */}
                    <div className="border-t border-[#e5e7eb] px-3 py-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded border border-[#d1d5db] bg-white" />
                        <span className="text-[10px] text-[#64748b]">Not Visited</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded bg-[#6366F1]" />
                        <span className="text-[10px] text-[#64748b]">Current</span>
                      </div>
                    </div>
                    <div className="border-t border-[#e5e7eb] px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setStudentPreviewShowInstructions(true)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#d1d5db] bg-white px-3 py-2 text-xs font-semibold text-[#374151] hover:bg-[#f1f5f9]"
                      >
                        <Info size={12} />
                        View Instructions
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
