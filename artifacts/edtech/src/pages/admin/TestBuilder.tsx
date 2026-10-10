import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calculator,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  FileText,
  Flag,
  Hash,
  ImagePlus,
  List,
  PenLine,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PremiumWhiteLoader } from "@/components/ui/PremiumWhiteLoader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { useToast } from "@/hooks/use-toast";
import { optimizeImageToDataUrl } from "@/lib/imageUpload";
import { buildApiUrl } from "@/lib/api-origin";

function BuilderLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fffaf2] px-4 py-8">
      <div className="w-full max-w-xl">
        <PremiumWhiteLoader progress={72} />
      </div>
    </div>
  );
}

type QuestionType = "mcq" | "multi" | "integer";
type QuestionDifficulty = "easy" | "moderate" | "tough";
type ViewMode = "single" | "all";
type DraftIntegerMode = "exact" | "range";
type SidebarMarksFilter = "all" | string;
type SidebarDifficultyFilter = "all" | QuestionDifficulty;
type SidebarQuestionTypeFilter = "all" | QuestionType;
type TestCategory = "mock" | "subject-wise" | "multi-subject" | "pyq";

interface MarkingScheme {
  positive: number;
  negative: number;
  key: string;
}

interface TestSection {
  id: number;
  title: string;
  description: string | null;
  subjectLabel: string | null;
  questionCount?: number | null;
  marksPerQuestion?: number | null;
  negativeMarks?: number | null;
  meta?: Record<string, unknown> | null;
  order: number;
}

interface Question {
  id: number;
  sectionId: number | null;
  questionCode?: string | null;
  sourceType?: string | null;
  subjectLabel?: string | null;
  question: string;
  questionType: QuestionType;
  options: string[];
  optionImages?: (string | null)[] | null;
  correctAnswer?: number;
  correctAnswerMulti?: number[] | null;
  correctAnswerMin?: number | null;
  correctAnswerMax?: number | null;
  points: number;
  negativeMarks?: number | null;
  order: number;
  imageData?: string | null;
  solutionText?: string | null;
  solutionImageData?: string | null;
  difficulty?: string | null;
  idealTimeSeconds?: number | null;
  meta?: Record<string, unknown> | null;
  reports?: QuestionReport[] | null;
  openReportCount?: number | null;
  totalReportCount?: number | null;
}

interface QuestionReport {
  id: number;
  testId: number;
  questionId: number;
  reportedBy: number;
  teacherId: number;
  reporterName?: string;
  reason: string;
  status: "open" | "resolved" | "rejected";
  teacherNote?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface TestDetail {
  id: number;
  title: string;
  description: string | null;
  examType?: string | null;
  examHeader?: string | null;
  examSubheader?: string | null;
  instructions?: string | null;
  examConfig?: Record<string, unknown> | null;
  durationMinutes: number;
  defaultPositiveMarks?: number | null;
  defaultNegativeMarks?: number | null;
  passingScore?: number | null;
  isPublished?: boolean;
  scheduledAt?: string | null;
  className?: string | null;
  chapterName?: string | null;
  subjectName?: string | null;
  sections: TestSection[];
  questions: Question[];
}

type AdminTestsCacheItem = Partial<TestDetail> & { id: number };

interface BuilderExportSection {
  exportRef?: string | null;
  title?: string | null;
  description?: string | null;
  subjectLabel?: string | null;
  questionCount?: number | null;
  marksPerQuestion?: number | null;
  negativeMarks?: number | null;
  meta?: Record<string, unknown> | null;
  order?: number | null;
}

interface BuilderExportQuestion {
  question?: string | null;
  questionType?: QuestionType | null;
  sectionRef?: string | null;
  questionCode?: string | null;
  sourceType?: string | null;
  subjectLabel?: string | null;
  options?: string[] | null;
  optionImages?: (string | null)[] | null;
  correctAnswer?: number | null;
  correctAnswerMulti?: number[] | null;
  correctAnswerMin?: number | null;
  correctAnswerMax?: number | null;
  points?: number | null;
  negativeMarks?: number | null;
  order?: number | null;
  imageData?: string | null;
  meta?: Record<string, unknown> | null;
  solutionText?: string | null;
  solutionImageData?: string | null;
}

interface BuilderExportBundle {
  test?: {
    title?: string | null;
    description?: string | null;
    examType?: string | null;
    examHeader?: string | null;
    examSubheader?: string | null;
    instructions?: string | null;
    examConfig?: Record<string, unknown> | null;
    durationMinutes?: number | null;
    passingScore?: number | null;
    defaultPositiveMarks?: number | null;
    defaultNegativeMarks?: number | null;
    scheduledAt?: string | null;
    sections?: BuilderExportSection[] | null;
    questions?: BuilderExportQuestion[] | null;
  } | null;
}

interface ExamTemplate {
  id: number;
  key: string;
  name: string;
  examHeader?: string | null;
  examSubheader?: string | null;
}

interface QuestionBankChapterOption {
  id: number;
  title: string;
}

interface QuestionBankSubjectOption {
  id: number;
  title: string;
  chapters?: QuestionBankChapterOption[];
}

interface QuestionBankExamCatalog {
  subjects?: QuestionBankSubjectOption[];
}

interface QuestionDraft {
  questionType: QuestionType;
  question: string;
  imageData: string | null;
  solutionText: string;
  solutionImageData: string | null;
  options: string[];
  optionImages: (string | null)[];
  correctAnswer: number;
  correctAnswerMulti: number[];
  integerMode: DraftIntegerMode;
  correctInteger: string;
  correctIntegerMin: string;
  correctIntegerMax: string;
  difficulty: QuestionDifficulty;
  subjectName: string;
  chapterName: string;
  topicTag: string;
  idealTimeSeconds: string;
  questionCode: string;
}

interface ReportedQuestionDraft {
  question: string;
  solutionText: string;
  correctAnswer: number;
  correctAnswerMulti: number[];
  integerAnswer: string;
  correctAnswerMin: string;
  correctAnswerMax: string;
}

const QUESTION_TYPE_OPTIONS: Array<{
  value: QuestionType;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    value: "mcq",
    label: "MCQ Single",
    description: "One correct answer",
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  {
    value: "multi",
    label: "Multi-select",
    description: "Multiple correct answers",
    icon: <CheckSquare className="h-4 w-4" />,
  },
  {
    value: "integer",
    label: "Integer",
    description: "Exact value or answer range",
    icon: <Hash className="h-4 w-4" />,
  },
];

const DIFFICULTY_OPTIONS: Array<{
  value: QuestionDifficulty;
  label: string;
  tone: string;
}> = [
  {
    value: "easy",
    label: "Easy",
    tone: "border-emerald-300 bg-emerald-50 text-emerald-700 data-[active=true]:border-emerald-500 data-[active=true]:bg-emerald-500 data-[active=true]:text-white",
  },
  {
    value: "moderate",
    label: "Medium",
    tone: "border-amber-300 bg-amber-50 text-amber-700 data-[active=true]:border-amber-500 data-[active=true]:bg-amber-500 data-[active=true]:text-white",
  },
  {
    value: "tough",
    label: "Hard",
    tone: "border-rose-300 bg-rose-50 text-rose-700 data-[active=true]:border-rose-500 data-[active=true]:bg-rose-500 data-[active=true]:text-white",
  },
];

const OPTION_BADGE_STYLES = [
  "bg-orange-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-slate-700",
];

const CPET_EXPECTED_QUESTION_COUNT = 100;

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

function normalizeTestCategory(value: unknown): TestCategory {
  if (typeof value !== "string") return "mock";
  const normalized = value.trim().toLowerCase();
  if (normalized === "subject-wise" || normalized === "subject wise" || normalized === "subject" || normalized === "chapter-wise" || normalized === "chapter wise" || normalized === "chapter") return "subject-wise";
  if (normalized === "multi-subject" || normalized === "multi subject" || normalized === "multi-subject-wise" || normalized === "topic-wise" || normalized === "topic wise" || normalized === "topic") return "multi-subject";
  if (normalized === "pyq" || normalized === "previous year" || normalized === "previous-year") return "pyq";
  return "mock";
}

function formatDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function normalizeExamTypeSelection(value: unknown, templates: ExamTemplate[]) {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  const matched = templates.find((template) => {
    const candidates = [
      template.key,
      template.name,
      template.examHeader ?? "",
      template.examSubheader ?? "",
    ];
    return candidates.some((candidate) => candidate.trim().toLowerCase() === normalized);
  });
  return matched?.key ?? trimmed;
}

function normalizeTestDifficultyValue(value: unknown): QuestionDifficulty | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "easy") return "easy";
  if (normalized === "moderate" || normalized === "medium") return "moderate";
  if (normalized === "tough" || normalized === "hard" || normalized === "advanced" || normalized === "expert") {
    return "tough";
  }
  return null;
}

const IGNORED_IMPORTED_TAXONOMY_KEYS = new Set([
  "aerospace engineering",
  "agricultural engineering",
  "biotechnology engineering",
  "bt",
  "chemical engineering",
  "ch",
  "civil engineering",
  "ce",
  "computer science and engineering",
  "computer science engineering",
  "cse",
  "cs",
  "electrical engineering",
  "ee",
  "ec",
  "ece",
  "electronics and communication engineering",
  "electronics engineering",
  "engineering sciences",
  "es",
  "it",
  "instrumentation engineering",
  "ie",
  "mechanical engineering",
  "me",
  "metallurgical engineering",
  "mt",
  "production engineering",
  "pe",
]);

function normalizeImportedTaxonomyKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeMarkingValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMarkingValue(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatMarkingSchemeLabel(scheme: Pick<MarkingScheme, "positive" | "negative">) {
  return `+${formatMarkingValue(scheme.positive)} / -${formatMarkingValue(scheme.negative)}`;
}

function parseBuilderExportSectionId(sectionRef: string | null | undefined, fallbackIndex: number) {
  if (typeof sectionRef === "string") {
    const matched = sectionRef.match(/section-(\d+)/i);
    if (matched) return Number(matched[1]);
  }
  return -(fallbackIndex + 1);
}

function mapBuilderExportBundleToTestDetail(testId: number, bundle: BuilderExportBundle): TestDetail {
  const exportedTest = bundle.test ?? {};
  const rawSections = Array.isArray(exportedTest.sections) ? exportedTest.sections : [];
  const sections = rawSections.map((section, index) => ({
    id: parseBuilderExportSectionId(section.exportRef, index),
    title: section.title?.trim() || `Section ${index + 1}`,
    description: section.description ?? null,
    subjectLabel: section.subjectLabel ?? null,
    questionCount: section.questionCount ?? null,
    marksPerQuestion: section.marksPerQuestion ?? null,
    negativeMarks: section.negativeMarks ?? null,
    meta: section.meta ?? null,
    order: typeof section.order === "number" ? section.order : index,
  }));

  const sectionIdByRef = new Map<string, number>();
  rawSections.forEach((section, index) => {
    if (section.exportRef) {
      sectionIdByRef.set(section.exportRef, parseBuilderExportSectionId(section.exportRef, index));
    }
  });

  const questions = (Array.isArray(exportedTest.questions) ? exportedTest.questions : []).map((question, index) => {
    const questionType: QuestionType =
      question.questionType === "multi" || question.questionType === "integer"
        ? question.questionType
        : "mcq";

    return {
      id: -(index + 1),
      sectionId: question.sectionRef ? (sectionIdByRef.get(question.sectionRef) ?? null) : null,
      questionCode: question.questionCode ?? null,
      sourceType: question.sourceType ?? "manual",
      subjectLabel: question.subjectLabel ?? null,
      question: question.question ?? "",
      questionType,
      options: Array.isArray(question.options) ? question.options : [],
      optionImages: Array.isArray(question.optionImages) ? question.optionImages : null,
      correctAnswer: typeof question.correctAnswer === "number" ? question.correctAnswer : undefined,
      correctAnswerMulti: Array.isArray(question.correctAnswerMulti) ? question.correctAnswerMulti : null,
      correctAnswerMin: typeof question.correctAnswerMin === "number" ? question.correctAnswerMin : null,
      correctAnswerMax: typeof question.correctAnswerMax === "number" ? question.correctAnswerMax : null,
      points: typeof question.points === "number" ? question.points : 1,
      negativeMarks: typeof question.negativeMarks === "number" ? question.negativeMarks : 0,
      order: typeof question.order === "number" ? question.order : index,
      imageData: question.imageData ?? null,
      solutionText: question.solutionText ?? null,
      solutionImageData: question.solutionImageData ?? null,
      difficulty: typeof question.meta?.difficulty === "string" ? question.meta.difficulty : null,
      idealTimeSeconds: typeof question.meta?.estimatedTimeSeconds === "number"
        ? question.meta.estimatedTimeSeconds
        : typeof question.meta?.idealTimeSeconds === "number"
          ? question.meta.idealTimeSeconds
          : null,
      meta: question.meta ?? null,
      reports: null,
      openReportCount: 0,
      totalReportCount: 0,
    };
  });

  return {
    id: testId,
    title: exportedTest.title ?? "Test Builder",
    description: exportedTest.description ?? null,
    examType: exportedTest.examType ?? null,
    examHeader: exportedTest.examHeader ?? null,
    examSubheader: exportedTest.examSubheader ?? null,
    instructions: exportedTest.instructions ?? null,
    examConfig: exportedTest.examConfig ?? null,
    durationMinutes: typeof exportedTest.durationMinutes === "number" ? exportedTest.durationMinutes : 0,
    defaultPositiveMarks: typeof exportedTest.defaultPositiveMarks === "number" ? exportedTest.defaultPositiveMarks : null,
    defaultNegativeMarks: typeof exportedTest.defaultNegativeMarks === "number" ? exportedTest.defaultNegativeMarks : null,
    passingScore: typeof exportedTest.passingScore === "number" ? exportedTest.passingScore : null,
    isPublished: false,
    scheduledAt: exportedTest.scheduledAt ?? null,
    className: null,
    chapterName: null,
    subjectName: null,
    sections,
    questions,
  };
}

function buildMarkingScheme(positive: number, negative: number): MarkingScheme {
  const normalizedNegative = Math.max(0, negative);
  return {
    positive,
    negative: normalizedNegative,
    key: `${positive}|${normalizedNegative}`,
  };
}

function getExplicitSectionMarking(section: TestSection | null | undefined, test: TestDetail | null | undefined) {
  const sectionPositive = normalizeMarkingValue(section?.marksPerQuestion);
  const sectionNegative = normalizeMarkingValue(section?.negativeMarks);

  if (sectionPositive != null && sectionPositive > 0) {
    return buildMarkingScheme(sectionPositive, sectionNegative ?? 0);
  }

  const defaultPositive = normalizeMarkingValue(test?.defaultPositiveMarks);
  const defaultNegative = normalizeMarkingValue(test?.defaultNegativeMarks);
  if (defaultPositive != null && defaultPositive > 0) {
    return buildMarkingScheme(defaultPositive, defaultNegative ?? 0);
  }

  return null;
}

function getQuestionMarking(
  question: Pick<Question, "points" | "negativeMarks"> | null | undefined,
  section: TestSection | null | undefined,
  test: TestDetail | null | undefined,
) {
  const positive = normalizeMarkingValue(question?.points);
  const negative = normalizeMarkingValue(question?.negativeMarks);

  if (positive != null && positive > 0) {
    return buildMarkingScheme(positive, negative ?? 0);
  }

  return getExplicitSectionMarking(section, test);
}

function getSectionMarkingSchemes(
  questions: Array<Pick<Question, "points" | "negativeMarks">>,
  section: TestSection | null | undefined,
  test: TestDetail | null | undefined,
) {
  const schemes = new Map<string, MarkingScheme>();

  questions.forEach((question) => {
    const scheme = getQuestionMarking(question, null, null);
    if (!scheme) return;
    schemes.set(scheme.key, scheme);
  });

  if (schemes.size === 0) {
    const explicitScheme = getExplicitSectionMarking(section, test);
    if (explicitScheme) schemes.set(explicitScheme.key, explicitScheme);
  }

  return Array.from(schemes.values()).sort((left, right) => {
    if (left.positive !== right.positive) return left.positive - right.positive;
    return left.negative - right.negative;
  });
}

function getPreferredNewQuestionMarking(
  questions: Array<Pick<Question, "points" | "negativeMarks">>,
  section: TestSection | null | undefined,
  test: TestDetail | null | undefined,
) {
  const explicitScheme = getExplicitSectionMarking(section, test);
  if (explicitScheme) return explicitScheme;

  const schemeCounts = new Map<string, { scheme: MarkingScheme; count: number }>();
  questions.forEach((question) => {
    const scheme = getQuestionMarking(question, null, null);
    if (!scheme) return;
    const existing = schemeCounts.get(scheme.key);
    if (existing) {
      existing.count += 1;
    } else {
      schemeCounts.set(scheme.key, { scheme, count: 1 });
    }
  });

  const sortedSchemes = Array.from(schemeCounts.values()).sort((left, right) => {
    if (left.count !== right.count) return right.count - left.count;
    if (left.scheme.positive !== right.scheme.positive) return right.scheme.positive - left.scheme.positive;
    return right.scheme.negative - left.scheme.negative;
  });

  if (sortedSchemes[0]) return sortedSchemes[0].scheme;
  return buildMarkingScheme(1, 0);
}

function buildSectionBreadcrumb(subjectLabel?: string | null, sectionTitle?: string | null) {
  const labels = [subjectLabel?.trim() ?? "", sectionTitle?.trim() ?? ""].filter(Boolean);
  const seen = new Set<string>();
  const uniqueLabels: string[] = [];

  labels.forEach((label) => {
    const key = normalizeImportedTaxonomyKey(label);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    uniqueLabels.push(label);
  });

  return uniqueLabels.join(" · ");
}

function isQuestionCodeLikeLabel(value?: string | null) {
  const normalized = value?.trim() ?? "";
  return /^q\s*[-:]?\s*\d+$/i.test(normalized) || /^[a-z]\s*[-:]?\s*\d+$/i.test(normalized);
}

function isImportedMarksTag(value: string) {
  return /^[-+0-9.\s/]+$/.test(value.trim());
}

function isImportedDifficultyTag(value: string) {
  return Boolean(normalizeTestDifficultyValue(value));
}

function sanitizeExplicitTaxonomyValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  const normalized = normalizeImportedTaxonomyKey(trimmed);
  if (!normalized) return "";
  if (isImportedMarksTag(trimmed)) return "";
  if (isImportedDifficultyTag(trimmed)) return "";
  return trimmed;
}

function sanitizeImportedTaxonomyValue(value: unknown, sectionLabel?: string | null) {
  const sanitized = sanitizeExplicitTaxonomyValue(value);
  const normalized = normalizeImportedTaxonomyKey(sanitized);
  const normalizedSection = sectionLabel ? normalizeImportedTaxonomyKey(sectionLabel) : "";
  if (!normalized) return "";
  if (IGNORED_IMPORTED_TAXONOMY_KEYS.has(normalized)) return "";
  if (normalizedSection && normalized === normalizedSection) return "";
  return sanitized;
}

function inferImportedTaxonomy(meta: Record<string, unknown> | null, sectionLabel?: string | null) {
  const importedTags = Array.isArray(meta?.importedTags)
    ? meta.importedTags
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  const candidates = importedTags
    .map((tag) => sanitizeImportedTaxonomyValue(tag, sectionLabel))
    .filter(Boolean);

  return {
    subjectName: candidates[0] ?? "",
    chapterName: candidates[1] ?? "",
  };
}

function normalizeResolvedTaxonomy({
  subjectName,
  chapterName,
  topicTag,
}: {
  subjectName: string;
  chapterName: string;
  topicTag: string;
}) {
  return {
    subjectName,
    chapterName: chapterName || topicTag,
    topicTag,
  };
}

function resolveQuestionTaxonomy(meta: Record<string, unknown> | null, sectionLabel?: string | null) {
  const inferredTaxonomy = inferImportedTaxonomy(meta, sectionLabel);
  const readValue = (value: unknown) => sanitizeExplicitTaxonomyValue(value);
  return normalizeResolvedTaxonomy({
    subjectName: readValue(meta?.subjectName) || readValue(meta?.subject) || inferredTaxonomy.subjectName,
    chapterName: readValue(meta?.chapterName) || readValue(meta?.chapter) || inferredTaxonomy.chapterName,
    topicTag: readValue(meta?.topicTag) || readValue(meta?.topicName) || readValue(meta?.topic),
  });
}

function getQuestionDifficulty(question: Question): QuestionDifficulty {
  const meta = (question.meta as Record<string, unknown> | null) ?? null;
  return normalizeTestDifficultyValue(meta?.difficulty ?? question.difficulty) ?? "moderate";
}

function getDifficultyDotClass(difficulty: QuestionDifficulty) {
  if (difficulty === "easy") return "bg-emerald-400";
  if (difficulty === "moderate") return "bg-amber-400";
  return "bg-rose-500";
}

function getReportTone(status: QuestionReport["status"]) {
  if (status === "resolved") {
    return {
      badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
      card: "border-emerald-200 bg-emerald-50/80 text-emerald-900",
      label: "Resolved",
    };
  }
  if (status === "rejected") {
    return {
      badge: "border-amber-200 bg-amber-50 text-amber-700",
      card: "border-amber-200 bg-amber-50/80 text-amber-900",
      label: "Rejected",
    };
  }
  return {
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    card: "border-rose-200 bg-rose-50/80 text-rose-900",
    label: "Open",
  };
}

function getQuestionOpenReportCount(question: Pick<Question, "openReportCount" | "reports"> | null | undefined) {
  if (!question) return 0;
  if (typeof question.openReportCount === "number" && Number.isFinite(question.openReportCount)) {
    return Math.max(0, question.openReportCount);
  }
  return (question.reports ?? []).filter((report) => report.status === "open").length;
}

function getQuestionIdealTimeSeconds(question: Question) {
  const meta = (question.meta as Record<string, unknown> | null) ?? null;
  return Math.round(Number(meta?.estimatedTimeSeconds ?? question.idealTimeSeconds ?? 0) || 0);
}

function readQuestionSetupFlag(question: Question | null | undefined, key: string) {
  const meta = (question?.meta as Record<string, unknown> | null) ?? null;
  return meta?.[key] === true || meta?.[key] === "true";
}

function getQuestionSetupWarnings(question: Question | null | undefined) {
  if (!question) return [];
  const warnings: string[] = [];
  if (readQuestionSetupFlag(question, "needsSubjectName")) warnings.push("Subject name");
  if (readQuestionSetupFlag(question, "needsChapterName")) warnings.push("Chapter name");
  if (readQuestionSetupFlag(question, "needsTaxonomyReview")) warnings.push("Taxonomy review");
  if (readQuestionSetupFlag(question, "needsDifficulty")) warnings.push("Difficulty");
  if (readQuestionSetupFlag(question, "needsIdealTimeSeconds")) warnings.push("Ideal time");
  if (readQuestionSetupFlag(question, "needsCorrectAnswer")) warnings.push("Correct answer");
  return warnings;
}

function hasQuestionSetupPending(question: Question | null | undefined) {
  return getQuestionSetupWarnings(question).length > 0;
}

function defaultIdealTimeSeconds(difficulty: QuestionDifficulty) {
  if (difficulty === "easy") return 60;
  if (difficulty === "tough") return 180;
  return 90;
}

function sortQuestionsForSection(questions: Question[], sectionId: number) {
  return questions
    .filter((question) => question.sectionId === sectionId)
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.id - right.id;
    });
}

function makeQuestionDraft(section: TestSection, _test: TestDetail, slotNumber: number, question?: Question | null): QuestionDraft {
  if (question) {
    const meta = (question.meta as Record<string, unknown> | null) ?? null;
    const taxonomy = resolveQuestionTaxonomy(meta, question.subjectLabel ?? section.subjectLabel ?? section.title);
    const difficulty = getQuestionDifficulty(question);
    const needsCorrectAnswer = readQuestionSetupFlag(question, "needsCorrectAnswer");
    const integerMode: DraftIntegerMode =
      question.questionType === "integer" && question.correctAnswerMin != null && question.correctAnswerMax != null
        ? "range"
        : "exact";
    const normalizedOptionCount = question.questionType === "integer"
      ? 0
      : Math.max(4, question.options.length, question.optionImages?.length ?? 0);
    return {
      questionType: question.questionType,
      question: question.question ?? "",
      imageData: question.imageData ?? null,
      solutionText: question.solutionText ?? "",
      solutionImageData: question.solutionImageData ?? null,
      options: Array.from({ length: normalizedOptionCount }, (_, index) => question.options[index] ?? ""),
      optionImages: Array.from({ length: normalizedOptionCount }, (_, index) => question.optionImages?.[index] ?? null),
      correctAnswer: question.questionType === "mcq" && needsCorrectAnswer ? -1 : question.correctAnswer ?? -1,
      correctAnswerMulti: question.correctAnswerMulti ?? [],
      integerMode,
      correctInteger: integerMode === "exact" ? (needsCorrectAnswer ? "" : String(question.correctAnswer ?? "")) : "",
      correctIntegerMin: integerMode === "range" ? (needsCorrectAnswer ? "" : String(question.correctAnswerMin ?? "")) : "",
      correctIntegerMax: integerMode === "range" ? (needsCorrectAnswer ? "" : String(question.correctAnswerMax ?? "")) : "",
      difficulty,
      subjectName: taxonomy.subjectName,
      chapterName: taxonomy.chapterName,
      topicTag: taxonomy.topicTag,
      idealTimeSeconds: String(getQuestionIdealTimeSeconds(question) || defaultIdealTimeSeconds(difficulty)),
      questionCode: question.questionCode?.trim() || `Q${String(slotNumber).padStart(2, "0")}`,
    };
  }

  const preferredQuestionType = (section.meta as Record<string, unknown> | null)?.preferredQuestionType;
  const questionType: QuestionType =
    preferredQuestionType === "multi" || preferredQuestionType === "integer" || preferredQuestionType === "mcq"
      ? preferredQuestionType
      : "mcq";

  return {
    questionType,
    question: "",
    imageData: null,
    solutionText: "",
    solutionImageData: null,
    options: ["", "", "", ""],
    optionImages: [null, null, null, null],
    correctAnswer: -1,
    correctAnswerMulti: [],
    integerMode: "exact",
    correctInteger: "",
    correctIntegerMin: "",
    correctIntegerMax: "",
    difficulty: "moderate",
    subjectName: "",
    chapterName: "",
    topicTag: "",
    idealTimeSeconds: String(defaultIdealTimeSeconds("moderate")),
    questionCode: `Q${String(slotNumber).padStart(2, "0")}`,
  };
}

function canSaveDraft(draft: QuestionDraft) {
  if (!draft.question.trim() && !draft.imageData) return false;
  if (draft.questionType === "mcq") {
    return draft.options.every((option, index) => option.trim() || draft.optionImages[index]);
  }
  if (draft.questionType === "multi") {
    return draft.options.every((option, index) => option.trim() || draft.optionImages[index]);
  }
  if (draft.integerMode === "range" && draft.correctIntegerMin.trim() && draft.correctIntegerMax.trim()) {
    const min = Number(draft.correctIntegerMin);
    const max = Number(draft.correctIntegerMax);
    return Number.isFinite(min) && Number.isFinite(max) && min <= max;
  }
  return true;
}

function buildQuestionPayload({
  draft,
  activeSection,
  marking,
  examType,
}: {
  draft: QuestionDraft;
  activeSection: TestSection;
  marking: MarkingScheme;
  examType?: string | null;
}) {
  const subjectName = draft.subjectName.trim();
  const chapterName = draft.chapterName.trim();
  const topicTag = draft.topicTag.trim();
  const estimatedTimeSeconds = Math.max(0, Math.round(Number(draft.idealTimeSeconds) || 0));
  const needsSubjectName = !subjectName;
  const needsChapterName = !chapterName;
  const needsDifficulty = !draft.difficulty;
  const needsIdealTimeSeconds = estimatedTimeSeconds <= 0;
  const needsCorrectAnswer =
    draft.questionType === "mcq"
      ? draft.correctAnswer < 0
      : draft.questionType === "multi"
        ? draft.correctAnswerMulti.length === 0
        : draft.integerMode === "range"
          ? !draft.correctIntegerMin.trim() || !draft.correctIntegerMax.trim()
          : !draft.correctInteger.trim();
  const needsQuestionSetup =
    needsSubjectName || needsChapterName || needsDifficulty || needsIdealTimeSeconds || needsCorrectAnswer;
  const body: Record<string, unknown> = {
    question: draft.question.trim(),
    questionType: draft.questionType,
    sectionId: activeSection.id,
    questionCode: draft.questionCode.trim() || null,
    sourceType: "manual",
    subjectLabel: activeSection.subjectLabel ?? activeSection.title,
    points: marking.positive,
    negativeMarks: marking.negative,
    imageData: draft.imageData || null,
    solutionText: draft.solutionText.trim() || null,
    solutionImageData: draft.solutionImageData || null,
    meta: {
      examType: examType ?? "custom",
      difficulty: draft.difficulty,
      subjectName: subjectName || null,
      chapterName: chapterName || null,
      topicTag: topicTag || null,
      estimatedTimeSeconds,
      needsSubjectName,
      needsChapterName,
      needsDifficulty,
      needsIdealTimeSeconds,
      needsCorrectAnswer,
      needsQuestionSetup,
    },
  };

  if (draft.questionType === "mcq") {
    body.options = draft.options;
    if (draft.optionImages.some(Boolean)) body.optionImages = draft.optionImages;
    if (draft.correctAnswer >= 0) body.correctAnswer = draft.correctAnswer;
  } else if (draft.questionType === "multi") {
    body.options = draft.options;
    if (draft.optionImages.some(Boolean)) body.optionImages = draft.optionImages;
    body.correctAnswerMulti = draft.correctAnswerMulti;
  } else {
    body.options = [];
    if (draft.integerMode === "range" && draft.correctIntegerMin.trim() && draft.correctIntegerMax.trim()) {
      body.correctAnswerMin = Number(draft.correctIntegerMin);
      body.correctAnswerMax = Number(draft.correctIntegerMax);
    } else if (draft.correctInteger.trim()) {
      body.correctAnswer = Number(draft.correctInteger);
    }
  }

  return body;
}

function FilterChip({
  active,
  label,
  onClick,
  tone,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone: "orange" | "violet" | QuestionDifficulty;
}) {
  const tones = {
    orange: active
      ? "border-orange-500 bg-orange-500 text-white"
      : "border-[#e7dbca] bg-white text-slate-500 hover:border-orange-300 hover:text-orange-600",
    violet: active
      ? "border-violet-500 bg-violet-500 text-white"
      : "border-[#e7dbca] bg-white text-slate-500 hover:border-violet-300 hover:text-violet-600",
    easy: active
      ? "border-emerald-500 bg-emerald-500 text-white"
      : "border-[#e7dbca] bg-white text-slate-500 hover:border-emerald-300 hover:text-emerald-600",
    moderate: active
      ? "border-amber-500 bg-amber-500 text-white"
      : "border-[#e7dbca] bg-white text-slate-500 hover:border-amber-300 hover:text-amber-600",
    tough: active
      ? "border-rose-500 bg-rose-500 text-white"
      : "border-[#e7dbca] bg-white text-slate-500 hover:border-rose-300 hover:text-rose-600",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${tones[tone]}`}
    >
      {label}
    </button>
  );
}

export default function AdminTestBuilder() {
  const { id } = useParams<{ id: string }>();
  const testId = Number.parseInt(id ?? "", 10);
  const [, psuBuilderParams] = useRoute<{ psuId: string; id: string }>("/admin/psu/:psuId/tests/:id/builder");
  const psuId = Number.parseInt(psuBuilderParams?.psuId ?? "", 10);
  const isPsuBuilder = Number.isInteger(psuId) && psuId > 0;
  const builderApiPath = (path: string) => {
    if (!isPsuBuilder) return path;
    const suffix = path.replace(new RegExp(`^/api/tests/${testId}`), "");
    if (suffix === "/export" || suffix === "") return `/api/psus/${psuId}/tests/${testId}/builder`;
    return `/api/psus/${psuId}/tests/${testId}/builder${suffix}`;
  };
  const deepLinkedQuestionId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("questionId");
    const parsed = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);
  const [activeSlotNumber, setActiveSlotNumber] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [marksFilter, setMarksFilter] = useState<SidebarMarksFilter>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<SidebarDifficultyFilter>("all");
  const [questionTypeFilter, setQuestionTypeFilter] = useState<SidebarQuestionTypeFilter>("all");
  const [builderExamType, setBuilderExamType] = useState("");
  const [builderScheduledAt, setBuilderScheduledAt] = useState("");
  const [builderTestCategory, setBuilderTestCategory] = useState<TestCategory>("mock");
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [reportReviewQuestionId, setReportReviewQuestionId] = useState<number | null>(null);
  const [reportedQuestionDraft, setReportedQuestionDraft] = useState<ReportedQuestionDraft | null>(null);
  const [editReportedQuestionText, setEditReportedQuestionText] = useState(false);
  const [editReportedSolutionText, setEditReportedSolutionText] = useState(false);
  const [hasAppliedDeepLink, setHasAppliedDeepLink] = useState(false);

  const questionImageInputRef = useRef<HTMLInputElement>(null);
  const solutionImageInputRef = useRef<HTMLInputElement>(null);
  const optionImageInputRef = useRef<HTMLInputElement>(null);
  const activeOptionImageIndexRef = useRef<number>(-1);
  const testDetailsAutoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    data: test,
    isLoading,
    isError,
    error,
  } = useQuery<TestDetail>({
    queryKey: ["admin-test-builder", testId],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(builderApiPath(`/api/tests/${testId}`)), { credentials: "include" });
      if (response.ok) {
        if (!isPsuBuilder) return response.json();
        const payload = await response.json() as { bundle: BuilderExportBundle; isPublished?: boolean };
        return { ...mapBuilderExportBundleToTestDetail(testId, payload.bundle), isPublished: payload.isPublished };
      }

      const fallbackResponse = await fetch(buildApiUrl(builderApiPath(`/api/tests/${testId}/export`)), { credentials: "include" });
      if (fallbackResponse.ok) {
        const bundle = await fallbackResponse.json() as BuilderExportBundle;
        return mapBuilderExportBundleToTestDetail(testId, bundle);
      }

      const message = await response.text();
      throw new Error(message || "Failed to load test");
    },
    enabled: Number.isFinite(testId),
    staleTime: 60_000,
  });

  const { data: examTemplates = [] } = useQuery<ExamTemplate[]>({
    queryKey: ["exam-templates"],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/planner/exam-templates`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load exam templates");
      return response.json();
    },
    staleTime: 60_000,
  });

  const currentExamTypeSelection = useMemo(
    () => normalizeExamTypeSelection(test?.examType ?? "", examTemplates),
    [test?.examType, examTemplates],
  );
  const { data: questionBankCatalog = null } = useQuery<QuestionBankExamCatalog | null>({
    queryKey: ["admin-test-builder-question-bank-taxonomy", currentExamTypeSelection],
    queryFn: async () => {
      const examKey = currentExamTypeSelection.trim();
      if (!examKey) return null;
      const response = await fetch(buildApiUrl(`/api/question-bank/exams/${encodeURIComponent(examKey)}`), { credentials: "include" });
      if (response.status === 403 || response.status === 404) return null;
      if (!response.ok) throw new Error("Failed to load question bank taxonomy");
      return response.json();
    },
    enabled: Boolean(currentExamTypeSelection),
    staleTime: 5 * 60_000,
  });
  const currentScheduledSelection = useMemo(
    () => formatDateTimeLocalValue(test?.scheduledAt ?? null),
    [test?.scheduledAt],
  );
  const currentExamConfig = useMemo(
    () => normalizeExamConfigObject(test?.examConfig),
    [test?.examConfig],
  );
  const currentTestCategorySelection = useMemo(
    () => normalizeTestCategory(currentExamConfig.testCategory),
    [currentExamConfig],
  );

  useEffect(() => {
    setBuilderExamType(currentExamTypeSelection);
  }, [currentExamTypeSelection]);

  useEffect(() => {
    setBuilderScheduledAt(currentScheduledSelection);
  }, [currentScheduledSelection]);

  useEffect(() => {
    setBuilderTestCategory(currentTestCategorySelection);
  }, [currentTestCategorySelection]);

  useEffect(() => {
    return () => {
      if (testDetailsAutoSaveTimeoutRef.current) {
        clearTimeout(testDetailsAutoSaveTimeoutRef.current);
      }
    };
  }, []);

  const sections = useMemo(
    () => [...(test?.sections ?? [])].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
    [test?.sections],
  );
  const savedQuestionCount = test?.questions.length ?? 0;
  const isCpetTest = /\bcpet\b/i.test([
    test?.examType,
    test?.title,
    test?.examHeader,
    test?.examSubheader,
  ].filter(Boolean).join(" "));
  const isImportedLayoutTest = Boolean(
    currentExamConfig.importedFromHtml ||
    currentExamConfig.preserveImportedSections ||
    (test?.questions ?? []).some((question) => {
      const sourceType = (question.sourceType ?? "manual").trim().toLowerCase();
      return Boolean(sourceType && sourceType !== "manual");
    }) ||
    sections.some((section) => /^[a-z]+\s*[-:]?\s*\d+/i.test(section.title.trim())),
  );

  useEffect(() => {
    if (!sections.length) return;
    if (activeSectionId == null || !sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(sections[0].id);
      setActiveSlotNumber(1);
    }
  }, [sections, activeSectionId]);

  const activeSection = useMemo(
    () => sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null,
    [sections, activeSectionId],
  );

  const activeSectionQuestions = useMemo(
    () => (activeSection ? sortQuestionsForSection(test?.questions ?? [], activeSection.id) : []),
    [activeSection, test?.questions],
  );
  const activeSectionMarkingSchemes = useMemo(
    () => getSectionMarkingSchemes(activeSectionQuestions, activeSection, test),
    [activeSectionQuestions, activeSection, test],
  );
  const questionsWithOpenReports = useMemo(
    () => (test?.questions ?? []).filter((question) => getQuestionOpenReportCount(question) > 0),
    [test?.questions],
  );
  const openReportedQuestionCount = questionsWithOpenReports.length;
  const totalOpenReports = useMemo(
    () => questionsWithOpenReports.reduce((sum, question) => sum + getQuestionOpenReportCount(question), 0),
    [questionsWithOpenReports],
  );

  const totalSlots = activeSection ? Math.max(activeSection.questionCount ?? 0, activeSectionQuestions.length || 1) : 1;
  const nextEditableSlot = Math.min(totalSlots, activeSectionQuestions.length + 1);

  useEffect(() => {
    if (!activeSection) return;
    setActiveSlotNumber((previous) => Math.min(Math.max(previous, 1), nextEditableSlot));
  }, [activeSection, nextEditableSlot]);

  const updateDraft = (patch: Partial<QuestionDraft>) => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
  };

  const focusQuestionInBuilder = (question: Question | null | undefined) => {
    if (!question || !test) return;
    if (question.sectionId) {
      setActiveSectionId(question.sectionId);
      const sectionQuestions = sortQuestionsForSection(test.questions ?? [], question.sectionId);
      const slotNumber = sectionQuestions.findIndex((item) => item.id === question.id) + 1;
      if (slotNumber > 0) setActiveSlotNumber(slotNumber);
    }
    setViewMode("single");
  };

  const visibleSectionQuestions = useMemo(() => {
    return activeSectionQuestions.filter((question) => {
      const questionMarking = getQuestionMarking(question, activeSection, test);
      const matchesMarks = marksFilter === "all" || questionMarking?.key === marksFilter;
      const matchesDifficulty = difficultyFilter === "all" || getQuestionDifficulty(question) === difficultyFilter;
      const matchesQuestionType = questionTypeFilter === "all" || question.questionType === questionTypeFilter;
      return matchesMarks && matchesDifficulty && matchesQuestionType;
    });
  }, [activeSectionQuestions, marksFilter, difficultyFilter, questionTypeFilter, activeSection, test]);

  const availableMarkingSchemes = useMemo(() => activeSectionMarkingSchemes, [activeSectionMarkingSchemes]);

  const availableDifficulties = useMemo(
    () => ["easy", "moderate", "tough"].filter((difficulty) => activeSectionQuestions.some((question) => getQuestionDifficulty(question) === difficulty)) as QuestionDifficulty[],
    [activeSectionQuestions],
  );

  const availableQuestionTypes = useMemo(
    () => (["mcq", "multi", "integer"] as QuestionType[]).filter((questionType) => activeSectionQuestions.some((question) => question.questionType === questionType)),
    [activeSectionQuestions],
  );

  const activeFiltersCount = [marksFilter !== "all", difficultyFilter !== "all", questionTypeFilter !== "all"].filter(Boolean).length;
  const hasActiveQuestionFilters = activeFiltersCount > 0;
  const visibleSlotNumbers = useMemo(
    () =>
      visibleSectionQuestions
        .map((question) => activeSectionQuestions.findIndex((item) => item.id === question.id) + 1)
        .filter((slotNumber) => slotNumber > 0),
    [visibleSectionQuestions, activeSectionQuestions],
  );
  const visibleSlotNumberSet = useMemo(() => new Set(visibleSlotNumbers), [visibleSlotNumbers]);
  const selectedSlotNumber =
    hasActiveQuestionFilters && visibleSlotNumbers.length > 0 && !visibleSlotNumberSet.has(activeSlotNumber)
      ? visibleSlotNumbers[0]
      : activeSlotNumber;
  const currentQuestion = activeSectionQuestions[selectedSlotNumber - 1] ?? null;
  const currentQuestionMarking = useMemo(
    () => getQuestionMarking(currentQuestion, activeSection, test),
    [currentQuestion, activeSection, test],
  );
  const currentQuestionMeta = useMemo(
    () => ((currentQuestion?.meta as Record<string, unknown> | null) ?? null),
    [currentQuestion],
  );
  const currentQuestionTaxonomyReview = useMemo(() => {
    const importedSubjectName = sanitizeExplicitTaxonomyValue(currentQuestionMeta?.importedSubjectName);
    const importedChapterName = sanitizeExplicitTaxonomyValue(currentQuestionMeta?.importedChapterName);
    const suggestedSubjectName = sanitizeExplicitTaxonomyValue(currentQuestionMeta?.suggestedSubjectName);
    const suggestedChapterName = sanitizeExplicitTaxonomyValue(currentQuestionMeta?.suggestedChapterName);
    const reviewReason =
      typeof currentQuestionMeta?.taxonomyReviewReason === "string" && currentQuestionMeta.taxonomyReviewReason.trim()
        ? currentQuestionMeta.taxonomyReviewReason.trim()
        : "This subject or chapter does not exactly match the super-admin question bank.";
    const needsReview =
      readQuestionSetupFlag(currentQuestion, "needsTaxonomyReview") ||
      Boolean(importedSubjectName || importedChapterName);

    if (!needsReview) return null;

    return {
      importedSubjectName,
      importedChapterName,
      suggestedSubjectName,
      suggestedChapterName,
      reviewReason,
    };
  }, [currentQuestion, currentQuestionMeta]);
  const preferredNewQuestionMarking = useMemo(
    () => getPreferredNewQuestionMarking(activeSectionQuestions, activeSection, test),
    [activeSectionQuestions, activeSection, test],
  );
  const currentQuestionReports = (currentQuestion?.reports ?? []) as QuestionReport[];
  const currentOpenReports = currentQuestionReports.filter((report) => report.status === "open");
  const latestQuestionReport = currentQuestionReports[0] ?? null;
  const reportReviewQuestion = test?.questions.find((question) => question.id === reportReviewQuestionId) ?? null;
  const currentVisibleSlotIndex = hasActiveQuestionFilters ? visibleSlotNumbers.indexOf(selectedSlotNumber) : -1;
  const previousSlotNumber = hasActiveQuestionFilters
    ? (currentVisibleSlotIndex > 0 ? visibleSlotNumbers[currentVisibleSlotIndex - 1] : null)
    : (selectedSlotNumber > 1 ? selectedSlotNumber - 1 : null);
  const nextSlotNumber = hasActiveQuestionFilters
    ? (currentVisibleSlotIndex >= 0 ? (visibleSlotNumbers[currentVisibleSlotIndex + 1] ?? null) : (visibleSlotNumbers[0] ?? null))
    : (selectedSlotNumber < nextEditableSlot ? selectedSlotNumber + 1 : null);
  const showFilteredEmptyState = hasActiveQuestionFilters && visibleSectionQuestions.length === 0;
  const selectedGlobalQuestionNumber = useMemo(() => {
    if (!activeSection) return selectedSlotNumber;
    let offset = 0;
    const allQuestions = test?.questions ?? [];

    for (const section of sections) {
      const sectionQuestions = sortQuestionsForSection(allQuestions, section.id);
      const sectionTotalSlots = Math.max(section.questionCount ?? 0, sectionQuestions.length || 1);
      if (section.id === activeSection.id) {
        return offset + selectedSlotNumber;
      }
      offset += sectionTotalSlots;
    }

    return selectedSlotNumber;
  }, [activeSection, sections, selectedSlotNumber, test?.questions]);
  const singleQuestionHeaderLabel = useMemo(() => {
    if (showFilteredEmptyState) return "No match";
    return String(selectedGlobalQuestionNumber);
  }, [selectedGlobalQuestionNumber, showFilteredEmptyState]);
  const singleQuestionContextLabel = useMemo(() => {
    if (showFilteredEmptyState) return "";
    const headerKey = normalizeImportedTaxonomyKey(singleQuestionHeaderLabel);
    const labels = [
      activeSection?.subjectLabel?.trim() ?? "",
      isImportedLayoutTest ? "" : activeSection?.title?.trim() ?? "",
    ];
    const uniqueLabels: string[] = [];
    const uniqueKeys = new Set<string>();

    for (const label of labels) {
      if (!label) continue;
      const labelKey = normalizeImportedTaxonomyKey(label);
      if (isImportedLayoutTest && isQuestionCodeLikeLabel(label)) continue;
      if (!labelKey || labelKey === headerKey || uniqueKeys.has(labelKey)) continue;
      uniqueKeys.add(labelKey);
      uniqueLabels.push(label);
    }

    return uniqueLabels.join(" / ");
  }, [
    activeSection?.subjectLabel,
    activeSection?.title,
    isImportedLayoutTest,
    showFilteredEmptyState,
    singleQuestionHeaderLabel,
  ]);
  const sidebarQuestionItems = useMemo(() => {
    const allQuestions = test?.questions ?? [];
    const items = sections.flatMap((section, sectionIndex) => {
      const sectionQuestions = sortQuestionsForSection(allQuestions, section.id);
      const sectionTotalSlots = Math.max(section.questionCount ?? 0, sectionQuestions.length || 1);
      const sectionNextEditableSlot = Math.min(sectionTotalSlots, sectionQuestions.length + 1);

      return Array.from({ length: sectionTotalSlots }, (_, index) => {
        const slot = index + 1;
        return {
          key: `${section.id}:${slot}`,
          section,
          sectionIndex,
          slot,
          question: sectionQuestions[index] ?? null,
          totalSlots: sectionTotalSlots,
          nextEditableSlot: sectionNextEditableSlot,
        };
      });
    });

    return items.map((item, index) => ({
      ...item,
      displayNumber: index + 1,
    }));
  }, [sections, test?.questions]);
  const firstBlankSidebarQuestionItem = useMemo(
    () => sidebarQuestionItems.find((item) => !item.question && item.slot <= item.nextEditableSlot) ?? null,
    [sidebarQuestionItems],
  );
  const cpetExistingQuestionSlotCount = Math.max(savedQuestionCount, sidebarQuestionItems.length);
  const cpetMissingQuestionCount = Math.max(0, CPET_EXPECTED_QUESTION_COUNT - cpetExistingQuestionSlotCount);
  const canAddImportedCpetQuestion = Boolean(
    isCpetTest &&
    cpetMissingQuestionCount > 0 &&
    (isImportedLayoutTest || sidebarQuestionItems.length > 1),
  );
  const showImportedCpetAddQuestionButton = Boolean(
    canAddImportedCpetQuestion && (firstBlankSidebarQuestionItem || activeSection || sections.length > 0),
  );
  const visibleSidebarQuestionItems = useMemo(() => {
    if (!hasActiveQuestionFilters) return sidebarQuestionItems;

    return sidebarQuestionItems.filter((item) => {
      if (!item.question) return false;
      const questionMarking = getQuestionMarking(item.question, item.section, test);
      const matchesMarks = marksFilter === "all" || questionMarking?.key === marksFilter;
      const matchesDifficulty = difficultyFilter === "all" || getQuestionDifficulty(item.question) === difficultyFilter;
      const matchesQuestionType = questionTypeFilter === "all" || item.question.questionType === questionTypeFilter;
      return matchesMarks && matchesDifficulty && matchesQuestionType;
    });
  }, [sidebarQuestionItems, hasActiveQuestionFilters, marksFilter, difficultyFilter, questionTypeFilter, test]);
  const currentQuestionOpenReportCount = getQuestionOpenReportCount(currentQuestion);
  const questionBankSubjects = useMemo(
    () => (questionBankCatalog?.subjects ?? []).filter((subject) => subject.title?.trim()),
    [questionBankCatalog],
  );
  const selectedQuestionBankSubject = useMemo(() => {
    const subjectKey = normalizeImportedTaxonomyKey(draft?.subjectName ?? "");
    return questionBankSubjects.find((subject) => normalizeImportedTaxonomyKey(subject.title) === subjectKey) ?? null;
  }, [draft?.subjectName, questionBankSubjects]);
  const questionBankChapterOptions = useMemo(
    () => (selectedQuestionBankSubject?.chapters ?? []).filter((chapter) => chapter.title?.trim()),
    [selectedQuestionBankSubject],
  );
  const draftSubjectName = draft?.subjectName.trim() ?? "";
  const draftChapterName = draft?.chapterName.trim() ?? "";
  const draftSubjectOutsideCatalog = Boolean(
    draftSubjectName &&
    questionBankSubjects.length > 0 &&
    !questionBankSubjects.some((subject) => normalizeImportedTaxonomyKey(subject.title) === normalizeImportedTaxonomyKey(draftSubjectName)),
  );
  const draftChapterOutsideCatalog = Boolean(
    draftChapterName &&
    questionBankChapterOptions.length > 0 &&
    !questionBankChapterOptions.some((chapter) => normalizeImportedTaxonomyKey(chapter.title) === normalizeImportedTaxonomyKey(draftChapterName)),
  );

  const jumpToNextReportedQuestion = () => {
    if (!questionsWithOpenReports.length) return;
    const currentIndex = currentQuestion
      ? questionsWithOpenReports.findIndex((question) => question.id === currentQuestion.id)
      : -1;
    const nextQuestion = currentIndex >= 0
      ? questionsWithOpenReports[(currentIndex + 1) % questionsWithOpenReports.length]
      : questionsWithOpenReports[0];
    focusQuestionInBuilder(nextQuestion);
  };

  useEffect(() => {
    if (!hasActiveQuestionFilters || visibleSlotNumbers.length === 0) return;
    if (!visibleSlotNumberSet.has(activeSlotNumber)) {
      setActiveSlotNumber(visibleSlotNumbers[0]);
    }
  }, [hasActiveQuestionFilters, visibleSlotNumbers, visibleSlotNumberSet, activeSlotNumber]);

  useEffect(() => {
    if (!activeSection || !test) return;
    setDraft(makeQuestionDraft(activeSection, test, selectedSlotNumber, currentQuestion));
  }, [activeSection, test, selectedSlotNumber, currentQuestion]);

  useEffect(() => {
    if (hasAppliedDeepLink || !deepLinkedQuestionId || !test?.questions?.length) return;
    const questionIndex = test.questions.findIndex((question) => question.id === deepLinkedQuestionId);
    if (questionIndex < 0) {
      setHasAppliedDeepLink(true);
      return;
    }
    const question = test.questions[questionIndex];
    if (question.sectionId) {
      setActiveSectionId(question.sectionId);
      const sectionQuestions = sortQuestionsForSection(test.questions, question.sectionId);
      const slotNumber = sectionQuestions.findIndex((item) => item.id === question.id) + 1;
      if (slotNumber > 0) setActiveSlotNumber(slotNumber);
    }
    setViewMode("single");
    setHasAppliedDeepLink(true);
  }, [deepLinkedQuestionId, hasAppliedDeepLink, test?.questions]);

  const createQuestionMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const response = await fetch(buildApiUrl(builderApiPath(`/api/tests/${testId}/questions`)), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to save question");
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-test-builder", testId] });
      // Student detail cache for this test must refresh so question count is correct
      queryClient.invalidateQueries({ queryKey: ["student-test-card-detail", testId] });
      toast({ title: "Question saved" });
      setActiveSlotNumber((previous) => Math.min(previous + 1, totalSlots));
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save question", description: error.message, variant: "destructive" });
    },
  });

  const updateQuestionMutation = useMutation({
    mutationFn: async ({ questionId, body }: { questionId: number; body: Record<string, unknown> }) => {
      const response = await fetch(buildApiUrl(builderApiPath(`/api/tests/${testId}/questions/${questionId}`)), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to update question");
      }
      return response.json();
    },
    onSuccess: async (payload: { resolvedReportsCount?: number }) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-test-builder", testId] });
      queryClient.invalidateQueries({ queryKey: ["student-test-card-detail", testId] });
      setReportReviewQuestionId(null);
      setReportedQuestionDraft(null);
      setEditReportedQuestionText(false);
      setEditReportedSolutionText(false);
      const resolvedReportsCount = Number(payload?.resolvedReportsCount ?? 0) || 0;
      toast({
        title: resolvedReportsCount > 0 ? "Question updated and reports resolved" : "Question updated",
        description: resolvedReportsCount > 0
          ? `${resolvedReportsCount} student report${resolvedReportsCount === 1 ? "" : "s"} were notified automatically.`
          : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update question", description: error.message, variant: "destructive" });
    },
  });

  const rejectReportMutation = useMutation({
    mutationFn: async (reportId: number) => {
      const response = await fetch(buildApiUrl(`/api/tests/question-reports/${reportId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to reject report");
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-test-builder", testId] });
      toast({ title: "Report rejected", description: "The student has been notified." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reject report", description: error.message, variant: "destructive" });
    },
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: async (questionId: number) => {
      const response = await fetch(buildApiUrl(builderApiPath(`/api/tests/${testId}/questions/${questionId}`)), {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete question");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-test-builder", testId] });
      toast({ title: "Question removed" });
      setActiveSlotNumber((previous) => Math.max(1, Math.min(previous, activeSectionQuestions.length)));
    },
    onError: () => {
      toast({ title: "Failed to delete question", variant: "destructive" });
    },
  });

  const toggleCalculatorMutation = useMutation({
    mutationFn: async (calculatorEnabled: boolean) => {
      const response = await fetch(buildApiUrl(builderApiPath(`/api/tests/${testId}`)), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examConfig: {
            ...normalizeExamConfigObject(test?.examConfig),
            calculatorEnabled,
          },
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to update calculator setting");
      }
      return response.json();
    },
    onSuccess: async (_data, calculatorEnabled) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-test-builder", testId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-tests"] }),
      ]);
      toast({ title: calculatorEnabled ? "Calculator enabled" : "Calculator disabled" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update calculator", description: error.message, variant: "destructive" });
    },
  });

  const updateTestDetailsMutation = useMutation({
    mutationFn: async ({ examType, scheduledAt, testCategory }: { examType: string; scheduledAt: string; testCategory: TestCategory }) => {
      const response = await fetch(buildApiUrl(builderApiPath(`/api/tests/${testId}`)), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examType,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          examConfig: {
            ...normalizeExamConfigObject(test?.examConfig),
            testCategory,
          },
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to update test details");
      }
      return response.json() as Promise<Partial<TestDetail> & { id: number }>;
    },
    onSuccess: async (updatedTest) => {
      queryClient.setQueryData<AdminTestsCacheItem[]>(["admin-tests"], (current) =>
        current?.map((cachedTest) =>
          cachedTest.id === testId ? { ...cachedTest, ...updatedTest } : cachedTest,
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-test-builder", testId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-tests"] }),
      ]);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to auto-save test details", description: error.message, variant: "destructive" });
    },
  });

  const queueTestDetailsAutoSave = ({
    examType,
    scheduledAt,
    testCategory,
    delayMs,
  }: {
    examType: string;
    scheduledAt: string;
    testCategory: TestCategory;
    delayMs: number;
  }) => {
    if (testDetailsAutoSaveTimeoutRef.current) {
      clearTimeout(testDetailsAutoSaveTimeoutRef.current);
    }
    if (!examType || (examType === currentExamTypeSelection && scheduledAt === currentScheduledSelection && testCategory === currentTestCategorySelection)) {
      return;
    }
    testDetailsAutoSaveTimeoutRef.current = setTimeout(() => {
      updateTestDetailsMutation.mutate({ examType, scheduledAt, testCategory });
      testDetailsAutoSaveTimeoutRef.current = null;
    }, delayMs);
  };

  const handleSaveQuestion = () => {
    if (!draft || !activeSection || !test) return;
    const body = buildQuestionPayload({
      draft,
      activeSection,
      marking: currentQuestionMarking ?? preferredNewQuestionMarking,
      examType: test.examType,
    });
    if (currentQuestion) {
      updateQuestionMutation.mutate({ questionId: currentQuestion.id, body });
    } else {
      createQuestionMutation.mutate(body);
    }
  };

  const createMissingCpetQuestionSectionMutation = useMutation({
    mutationFn: async ({
      title,
      subjectLabel,
      questionCount,
      marksPerQuestion,
      negativeMarks,
      meta,
    }: {
      title: string;
      subjectLabel: string | null;
      questionCount: number;
      marksPerQuestion: number | null;
      negativeMarks: number | null;
      meta: Record<string, unknown> | null;
    }) => {
      const response = await fetch(buildApiUrl(builderApiPath(`/api/tests/${testId}/sections`)), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: null,
          subjectLabel,
          questionCount,
          marksPerQuestion,
          negativeMarks,
          meta,
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to add question slot");
      }
      return response.json() as Promise<TestSection>;
    },
    onSuccess: async (section) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-test-builder", testId] });
      setActiveSectionId(section.id);
      setActiveSlotNumber(1);
      setViewMode("single");
      toast({ title: "Question slot added", description: "Fill the blank question and save it." });
    },
    onError: (error: Error) => {
      toast({ title: "Could not add question", description: error.message, variant: "destructive" });
    },
  });

  const handleAddQuestionSlot = () => {
    if (!canAddImportedCpetQuestion) return;
    if (firstBlankSidebarQuestionItem) {
      setActiveSectionId(firstBlankSidebarQuestionItem.section.id);
      setActiveSlotNumber(firstBlankSidebarQuestionItem.slot);
      setViewMode("single");
      return;
    }

    const templateSection = activeSection ?? sections[sections.length - 1];
    if (!templateSection) return;
    const nextQuestionNumber = Math.min(savedQuestionCount + 1, CPET_EXPECTED_QUESTION_COUNT);

    createMissingCpetQuestionSectionMutation.mutate({
      title: `Q${nextQuestionNumber}`,
      subjectLabel: templateSection.subjectLabel ?? null,
      questionCount: 1,
      marksPerQuestion: templateSection.marksPerQuestion ?? null,
      negativeMarks: templateSection.negativeMarks ?? null,
      meta: templateSection.meta ?? null,
    });
  };

  const handleQuestionImageUpload = async (file?: File | null) => {
    if (!file) return;
    const dataUrl = await optimizeImageToDataUrl(file, { maxWidth: 1800, maxHeight: 1800, quality: 0.82 });
    updateDraft({ imageData: dataUrl });
  };

  const handleSolutionImageUpload = async (file?: File | null) => {
    if (!file) return;
    const dataUrl = await optimizeImageToDataUrl(file, { maxWidth: 1800, maxHeight: 1800, quality: 0.82 });
    updateDraft({ solutionImageData: dataUrl });
  };

  const handleOptionImageUpload = async (file?: File | null) => {
    if (!file || !draft) return;
    const optionIndex = activeOptionImageIndexRef.current;
    if (optionIndex < 0) return;
    const dataUrl = await optimizeImageToDataUrl(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 });
    const nextImages = [...draft.optionImages];
    nextImages[optionIndex] = dataUrl;
    updateDraft({ optionImages: nextImages });
  };

  if (isLoading) {
    return <BuilderLoadingScreen />;
  }

  if (isError || !test) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#fffaf2] px-6 text-center">
        <div>
          <p className="text-lg font-bold text-slate-900">Could not load builder</p>
          <p className="mt-1 text-sm text-slate-500">
            {error instanceof Error ? error.message : "The test could not be loaded right now."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="border-[#e7dbca] bg-white text-slate-700 hover:border-orange-300 hover:bg-[#fff7ea]"
          onClick={() => setLocation("/admin/tests")}
        >
          Back to Tests
        </Button>
      </div>
    );
  }

  if (!activeSection) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#fffaf2] px-6 text-center">
        <div>
          <p className="text-lg font-bold text-slate-900">Builder setup is incomplete</p>
          <p className="mt-1 text-sm text-slate-500">
            This test does not have any usable sections yet. Please reopen the builder once the test structure is restored.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="border-[#e7dbca] bg-white text-slate-700 hover:border-orange-300 hover:bg-[#fff7ea]"
          onClick={() => setLocation("/admin/tests")}
        >
          Back to Tests
        </Button>
      </div>
    );
  }

  if (!draft) {
    return <BuilderLoadingScreen />;
  }

  const sectionProgress = totalSlots > 0 ? Math.min(100, (activeSectionQuestions.length / totalSlots) * 100) : 0;
  const calculatorEnabled = getCalculatorEnabledFromExamConfig(test.examConfig);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#fffaf2] text-slate-900" style={{ fontFamily: "\"Plus Jakarta Sans\", sans-serif" }}>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-[#eadfcd] bg-white px-3 py-2 xl:flex-nowrap">
        <button
          type="button"
          onClick={() => setLocation("/admin/tests")}
          className="group flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4 transition group-hover:-translate-x-0.5" />
          Back
        </button>
        <span className="h-4 w-px bg-[#e7dbca]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-sm font-extrabold text-slate-900">{test.title}</h1>
            <span
              aria-label={test.isPublished ? "Published" : "Draft"}
              title={test.isPublished ? "Published" : "Draft"}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${
                test.isPublished
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {test.isPublished ? <CheckCircle2 className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {test.durationMinutes} min · {test.subjectName ?? "General"} · {test.chapterName ?? "Paper Builder"}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 xl:flex-nowrap">
          <div className="flex items-center gap-1.5 rounded-full border border-[#e7dbca] bg-[#fffaf1] px-1.5 py-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Exam</span>
            <Select
              value={builderExamType}
              onValueChange={(value) => {
                setBuilderExamType(value);
                queueTestDetailsAutoSave({ examType: value, scheduledAt: builderScheduledAt, testCategory: builderTestCategory, delayMs: 0 });
              }}
            >
              <SelectTrigger className="h-7 min-w-[112px] border-none bg-transparent px-1 text-[11px] font-semibold text-slate-700 shadow-none focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="Part of exam" />
              </SelectTrigger>
              <SelectContent>
                {examTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.key}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-[#e7dbca] bg-[#fffaf1] px-1.5 py-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Type</span>
            <Select
              value={builderTestCategory}
              onValueChange={(value) => {
                const nextValue = normalizeTestCategory(value);
                setBuilderTestCategory(nextValue);
                queueTestDetailsAutoSave({ examType: builderExamType, scheduledAt: builderScheduledAt, testCategory: nextValue, delayMs: 0 });
              }}
            >
              <SelectTrigger className="h-7 min-w-[132px] border-none bg-transparent px-1 text-[11px] font-semibold text-slate-700 shadow-none focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mock">Mock Test</SelectItem>
                <SelectItem value="subject-wise">Subject Wise Test</SelectItem>
                <SelectItem value="multi-subject">Chapter Wise Test</SelectItem>
                <SelectItem value="pyq">PYQ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-[#e7dbca] bg-[#fffaf1] px-1.5 py-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Schedule</span>
            <Input
              type="datetime-local"
              value={builderScheduledAt}
              onChange={(event) => {
                const nextValue = event.target.value;
                setBuilderScheduledAt(nextValue);
                queueTestDetailsAutoSave({ examType: builderExamType, scheduledAt: nextValue, testCategory: builderTestCategory, delayMs: 500 });
              }}
              className="h-7 w-[178px] border-none bg-transparent px-1 text-[11px] text-slate-700 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          {openReportedQuestionCount > 0 ? (
            <button
              type="button"
              onClick={jumpToNextReportedQuestion}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${
                currentQuestionOpenReportCount > 0
                  ? "border-rose-300 bg-rose-100 text-rose-800 hover:bg-rose-200"
                  : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
              }`}
              title={`${totalOpenReports} open report${totalOpenReports === 1 ? "" : "s"} across ${openReportedQuestionCount} question${openReportedQuestionCount === 1 ? "" : "s"}`}
            >
              <Flag className="h-3.5 w-3.5" />
              {totalOpenReports} report{totalOpenReports === 1 ? "" : "s"}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => toggleCalculatorMutation.mutate(!calculatorEnabled)}
            disabled={toggleCalculatorMutation.isPending}
            aria-label={calculatorEnabled ? "Calculator enabled" : "Calculator disabled"}
            title={calculatorEnabled ? "Calculator enabled" : "Calculator disabled"}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
              calculatorEnabled
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-[#f1e0be] bg-[#fff7ea] text-[#9a5b15] hover:bg-[#ffefcf]"
            } ${toggleCalculatorMutation.isPending ? "cursor-wait opacity-70" : ""}`}
          >
            <Calculator className="h-3.5 w-3.5" />
          </button>

          <div className="flex items-center rounded-full border border-[#e7dbca] bg-[#fff6e8] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("single")}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${viewMode === "single" ? "border border-[#e7dbca] bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
            >
              <PenLine className="h-3 w-3" />
              Single
            </button>
            <button
              type="button"
              onClick={() => setViewMode("all")}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${viewMode === "all" ? "border border-[#e7dbca] bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
            >
              <List className="h-3 w-3" />
              All Questions
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {viewMode === "single" ? (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#eadfcd] bg-white px-6">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-slate-500">Question</span>
                  <span className="rounded-md bg-[#f97316] px-2 py-0.5 text-sm font-bold text-white">
                    {singleQuestionHeaderLabel}
                  </span>
                  {singleQuestionContextLabel ? (
                    <>
                      <span className="text-xs text-slate-400">/</span>
                      <span className="text-xs font-medium text-slate-600">
                        {singleQuestionContextLabel}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>
                    <strong className="text-slate-900">{activeSectionQuestions.length}</strong>/{totalSlots} saved
                  </span>
                  <span className="h-4 w-px bg-[#e7dbca]" />
                  <span>
                    <strong className="text-slate-900">{Math.max(totalSlots - activeSectionQuestions.length, 0)}</strong> remaining
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {showFilteredEmptyState ? (
                  <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center px-6 py-6">
                    <div className="w-full rounded-2xl border-2 border-dashed border-[#eadfcd] bg-white px-6 py-12 text-center">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
                        <SlidersHorizontal className="h-7 w-7" />
                      </div>
                      <p className="mt-4 text-lg font-semibold text-slate-900">No questions match these filters</p>
                      <p className="mt-1 text-sm text-slate-500">Clear or change the filters to see other questions in this section.</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-5 rounded-lg border-[#eadfcd] bg-white"
                        onClick={() => {
                          setMarksFilter("all");
                          setDifficultyFilter("all");
                          setQuestionTypeFilter("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    </div>
                  </div>
                ) : (
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6 pb-24">
                  {currentOpenReports.length > 0 ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-600">Student Reports</p>
                          <p className="mt-1 text-sm text-rose-900">
                            {currentOpenReports.length} open report{currentOpenReports.length === 1 ? "" : "s"} on this question.
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700">
                          <Flag className="h-3.5 w-3.5" />
                          Needs review
                        </span>
                      </div>
                      <div className="mt-4 space-y-3">
                      {currentOpenReports.map((report) => (
                          <div key={report.id} className="rounded-2xl border border-rose-200 bg-white px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{report.reporterName || "Student"}</p>
                                <p className="mt-1 text-sm leading-6 text-slate-600">{report.reason}</p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-8 rounded-full border-amber-200 bg-white px-3 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                                onClick={() => rejectReportMutation.mutate(report.id)}
                                disabled={rejectReportMutation.isPending}
                              >
                                Reject
                              </Button>
                            </div>
                        </div>
                      ))}
                      <div className="flex justify-end pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                          onClick={() => {
                            if (!currentQuestion) return;
                            setReportReviewQuestionId(currentQuestion.id);
                            setReportedQuestionDraft({
                              question: currentQuestion.question,
                              solutionText: currentQuestion.solutionText ?? "",
                              correctAnswer: currentQuestion.correctAnswer ?? -1,
                              correctAnswerMulti: [...(currentQuestion.correctAnswerMulti ?? [])],
                              integerAnswer: currentQuestion.correctAnswer == null ? "" : String(currentQuestion.correctAnswer),
                              correctAnswerMin: currentQuestion.correctAnswerMin == null ? "" : String(currentQuestion.correctAnswerMin),
                              correctAnswerMax: currentQuestion.correctAnswerMax == null ? "" : String(currentQuestion.correctAnswerMax),
                            });
                            setEditReportedQuestionText(false);
                            setEditReportedSolutionText(false);
                          }}
                        >
                          <PenLine className="mr-2 h-4 w-4" />
                          Review question
                        </Button>
                      </div>
                    </div>
                    </div>
                  ) : latestQuestionReport ? (
                    <div className={`rounded-2xl border p-4 ${getReportTone(latestQuestionReport.status).card}`}>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]">Latest Report</p>
                      <p className="mt-1 text-sm font-medium">{getReportTone(latestQuestionReport.status).label}</p>
                      <p className="mt-2 text-sm leading-6 opacity-90">{latestQuestionReport.reason}</p>
                      {latestQuestionReport.teacherNote ? (
                        <p className="mt-2 text-xs font-semibold opacity-90">Teacher note: {latestQuestionReport.teacherNote}</p>
                      ) : null}
                    </div>
                  ) : null}

                  <div>
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Question Type</p>
                    <div className="grid gap-2 md:grid-cols-3">
                      {QUESTION_TYPE_OPTIONS.map((option) => {
                        const isActive = draft.questionType === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => updateDraft({
                              questionType: option.value,
                              correctAnswer: option.value === "mcq" ? -1 : draft.correctAnswer,
                              correctAnswerMulti: [],
                              integerMode: option.value === "integer" ? draft.integerMode : "exact",
                              correctInteger: option.value === "integer" ? draft.correctInteger : "",
                              correctIntegerMin: option.value === "integer" ? draft.correctIntegerMin : "",
                              correctIntegerMax: option.value === "integer" ? draft.correctIntegerMax : "",
                            })}
                            className={`rounded-xl border-2 p-3 text-left transition ${isActive ? "border-orange-500 bg-orange-50 text-orange-700" : "border-[#eadfcd] bg-white text-slate-500 hover:border-orange-300 hover:text-slate-900"}`}
                          >
                            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                              {option.icon}
                              {option.label}
                            </div>
                            <p className="text-[11px] opacity-80">{option.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {currentQuestionTaxonomyReview ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700">Taxonomy Review Pending</p>
                      <p className="mt-2 text-sm leading-6 text-amber-900">
                        {currentQuestionTaxonomyReview.reviewReason} This test can still be published, but this question will stay in the builder until you choose the exact subject and chapter.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {currentQuestionTaxonomyReview.importedSubjectName ? (
                          <span className="rounded-full border border-amber-200 bg-white px-3 py-1 text-amber-800">
                            Imported subject: {currentQuestionTaxonomyReview.importedSubjectName}
                          </span>
                        ) : null}
                        {currentQuestionTaxonomyReview.importedChapterName ? (
                          <span className="rounded-full border border-amber-200 bg-white px-3 py-1 text-amber-800">
                            Imported chapter: {currentQuestionTaxonomyReview.importedChapterName}
                          </span>
                        ) : null}
                        {currentQuestionTaxonomyReview.suggestedSubjectName ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800">
                            Suggested subject: {currentQuestionTaxonomyReview.suggestedSubjectName}
                          </span>
                        ) : null}
                        {currentQuestionTaxonomyReview.suggestedChapterName ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800">
                            Suggested chapter: {currentQuestionTaxonomyReview.suggestedChapterName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subject Name</Label>
                      {questionBankSubjects.length > 0 ? (
                        <Select
                          value={draft.subjectName || undefined}
                          onValueChange={(value) => {
                            const nextSubject = questionBankSubjects.find((subject) => subject.title === value) ?? null;
                            const nextChapters = nextSubject?.chapters ?? [];
                            const currentChapterKey = normalizeImportedTaxonomyKey(draft.chapterName);
                            const preservedChapter = nextChapters.find((chapter) => normalizeImportedTaxonomyKey(chapter.title) === currentChapterKey);
                            updateDraft({
                              subjectName: value,
                              chapterName: preservedChapter?.title ?? nextChapters[0]?.title ?? "",
                            });
                          }}
                        >
                          <SelectTrigger className="h-10 rounded-xl border-[#eadfcd] bg-white">
                            <SelectValue placeholder="Select subject" />
                          </SelectTrigger>
                          <SelectContent>
                            {draftSubjectOutsideCatalog ? (
                              <SelectItem value={draftSubjectName}>{draftSubjectName} (review)</SelectItem>
                            ) : null}
                            {questionBankSubjects.map((subject) => (
                              <SelectItem key={subject.id} value={subject.title}>
                                {subject.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={draft.subjectName}
                          onChange={(event) => updateDraft({ subjectName: event.target.value })}
                          placeholder="e.g. Communication Systems"
                          className="h-10 rounded-xl border-[#eadfcd] bg-white"
                        />
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chapter Name</Label>
                      {questionBankChapterOptions.length > 0 ? (
                        <Select
                          value={draft.chapterName || undefined}
                          onValueChange={(value) => updateDraft({ chapterName: value })}
                        >
                          <SelectTrigger className="h-10 rounded-xl border-[#eadfcd] bg-white">
                            <SelectValue placeholder="Select chapter" />
                          </SelectTrigger>
                          <SelectContent>
                            {draftChapterOutsideCatalog ? (
                              <SelectItem value={draftChapterName}>{draftChapterName} (review)</SelectItem>
                            ) : null}
                            {questionBankChapterOptions.map((chapter) => (
                              <SelectItem key={chapter.id} value={chapter.title}>
                                {chapter.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={draft.chapterName}
                          onChange={(event) => updateDraft({ chapterName: event.target.value })}
                          placeholder="e.g. Digital Modulation"
                          className="h-10 rounded-xl border-[#eadfcd] bg-white"
                        />
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Topic Name</Label>
                      <Input
                        value={draft.topicTag}
                        onChange={(event) => updateDraft({ topicTag: event.target.value })}
                        placeholder="e.g. PSK & QAM"
                        className="h-10 rounded-xl border-[#eadfcd] bg-white"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ideal Time (s)</Label>
                      <Input
                        type="number"
                        value={draft.idealTimeSeconds}
                        onChange={(event) => updateDraft({ idealTimeSeconds: event.target.value })}
                        className="h-10 rounded-xl border-[#eadfcd] bg-white font-medium"
                      />
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Difficulty</p>
                    <div className="flex flex-wrap gap-2">
                      {DIFFICULTY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          data-active={draft.difficulty === option.value}
                          onClick={() => updateDraft({
                            difficulty: option.value,
                            idealTimeSeconds: String(defaultIdealTimeSeconds(option.value)),
                          })}
                          className={`rounded-lg border-2 px-5 py-2 text-sm font-semibold transition ${option.tone}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Question</p>
                    <div className="overflow-hidden rounded-2xl border-2 border-[#eadfcd] bg-white transition focus-within:border-orange-400">
                      <Textarea
                        value={draft.question}
                        onChange={(event) => updateDraft({ question: event.target.value })}
                        placeholder="Type your question here..."
                        className="min-h-[170px] resize-none border-0 bg-white p-4 text-base focus-visible:ring-0"
                      />
                      <div className="flex items-center gap-2 border-t border-[#eadfcd] bg-[#fff9ef] px-3 py-2">
                        {draft.imageData ? (
                          <div className="relative inline-flex overflow-hidden rounded-xl border border-[#eadfcd] bg-white p-2">
                            <img src={draft.imageData} alt="Question visual" className="max-h-20 rounded-lg object-contain" />
                            <button
                              type="button"
                              onClick={() => updateDraft({ imageData: null })}
                              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => questionImageInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-orange-50 hover:text-orange-600"
                        >
                          <ImagePlus className="h-3.5 w-3.5" />
                          {draft.imageData ? "Replace image" : "Add image"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {(draft.questionType === "mcq" || draft.questionType === "multi") && (
                    <div>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Options</p>
                        <span className="text-[10px] text-slate-500">
                          {draft.questionType === "mcq" ? "Click letter to mark correct" : "Select all correct answers"}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {draft.options.map((option, index) => {
                          const isCorrect = draft.questionType === "multi"
                            ? draft.correctAnswerMulti.includes(index)
                            : draft.correctAnswer === index;
                          const optionImage = draft.optionImages[index];

                          return (
                            <div key={index} className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  if (draft.questionType === "mcq") {
                                    updateDraft({ correctAnswer: index });
                                    return;
                                  }
                                  updateDraft({
                                    correctAnswerMulti: draft.correctAnswerMulti.includes(index)
                                      ? draft.correctAnswerMulti.filter((value) => value !== index)
                                      : [...draft.correctAnswerMulti, index],
                                  });
                                }}
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold transition ${isCorrect ? `${OPTION_BADGE_STYLES[index % OPTION_BADGE_STYLES.length]} border-transparent text-white shadow-md` : "border-[#eadfcd] bg-white text-slate-500 hover:border-orange-300 hover:text-slate-900"}`}
                              >
                                {isCorrect ? <Check className="h-4 w-4" /> : String.fromCharCode(65 + index)}
                              </button>
                              <div className="relative flex-1">
                                <Input
                                  value={option}
                                  onChange={(event) => {
                                    const nextOptions = [...draft.options];
                                    nextOptions[index] = event.target.value;
                                    updateDraft({ options: nextOptions });
                                  }}
                                  placeholder={`Option ${String.fromCharCode(65 + index)}`}
                                  className={`h-11 rounded-xl border-[#eadfcd] bg-white pr-24 ${isCorrect ? "border-emerald-400 bg-emerald-50/40" : ""}`}
                                />
                                {isCorrect ? (
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                    Correct
                                  </span>
                                ) : null}
                              </div>
                              {optionImage ? (
                                <div className="relative overflow-hidden rounded-lg border border-[#eadfcd] bg-white p-1.5">
                                  <img src={optionImage} alt="" className="h-10 w-10 rounded object-cover" />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextImages = [...draft.optionImages];
                                      nextImages[index] = null;
                                      updateDraft({ optionImages: nextImages });
                                    }}
                                    className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white"
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    activeOptionImageIndexRef.current = index;
                                    optionImageInputRef.current?.click();
                                  }}
                                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-[#d7c7b0] text-slate-400 transition hover:border-orange-300 hover:text-orange-600"
                                >
                                  <ImagePlus className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {draft.questionType === "integer" ? (
                    <div>
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Correct Answer</p>
                      <div className="rounded-2xl border-2 border-[#eadfcd] bg-white p-6">
                        <div className="mb-4 flex gap-2">
                          <button
                            type="button"
                            onClick={() => updateDraft({ integerMode: "exact" })}
                            className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold transition ${draft.integerMode === "exact" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-[#eadfcd] bg-white text-slate-500"}`}
                          >
                            Exact Answer
                          </button>
                          <button
                            type="button"
                            onClick={() => updateDraft({ integerMode: "range" })}
                            className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold transition ${draft.integerMode === "range" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-[#eadfcd] bg-white text-slate-500"}`}
                          >
                            Answer Range
                          </button>
                        </div>
                        {draft.integerMode === "exact" ? (
                          <Input
                            type="number"
                            step="any"
                            value={draft.correctInteger}
                            onChange={(event) => updateDraft({ correctInteger: event.target.value })}
                            placeholder="e.g. 42"
                            className="h-12 max-w-[220px] rounded-xl border-[#eadfcd] bg-white text-center font-semibold"
                          />
                        ) : (
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Minimum</Label>
                              <Input
                                type="number"
                                step="any"
                                value={draft.correctIntegerMin}
                                onChange={(event) => updateDraft({ correctIntegerMin: event.target.value })}
                                className="h-11 rounded-xl border-[#eadfcd] bg-white"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Maximum</Label>
                              <Input
                                type="number"
                                step="any"
                                value={draft.correctIntegerMax}
                                onChange={(event) => updateDraft({ correctIntegerMax: event.target.value })}
                                className="h-11 rounded-xl border-[#eadfcd] bg-white"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Teacher Solution</p>
                    <div className="rounded-2xl border-2 border-[#eadfcd] bg-white p-4">
                      <Textarea
                        value={draft.solutionText}
                        onChange={(event) => updateDraft({ solutionText: event.target.value })}
                        placeholder="Add solution steps or explanation..."
                        className="min-h-[110px] resize-none border-0 bg-white p-0 text-sm focus-visible:ring-0"
                      />
                      <div className="mt-3 flex items-center gap-2">
                        {draft.solutionImageData ? (
                          <div className="relative overflow-hidden rounded-xl border border-[#eadfcd] bg-white p-2">
                            <img src={draft.solutionImageData} alt="Solution visual" className="max-h-20 rounded-lg object-contain" />
                            <button
                              type="button"
                              onClick={() => updateDraft({ solutionImageData: null })}
                              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => solutionImageInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-orange-50 hover:text-orange-600"
                        >
                          <ImagePlus className="h-3.5 w-3.5" />
                          {draft.solutionImageData ? "Replace image" : "Add image"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                )}
              </div>

              {!showFilteredEmptyState ? (
              <div className="flex shrink-0 items-center justify-between border-t border-[#eadfcd] bg-white px-6 py-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-[#eadfcd] bg-[#fff9ef] px-3 py-1">
                    {draft.questionCode}
                  </span>
                  {currentQuestionMarking ? (
                    <span className="rounded-full border border-[#eadfcd] bg-[#fff9ef] px-3 py-1">
                      +{formatMarkingValue(currentQuestionMarking.positive)} / -{formatMarkingValue(currentQuestionMarking.negative)}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {currentQuestion ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg border-rose-200 bg-white px-3 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => deleteQuestionMutation.mutate(currentQuestion.id)}
                      disabled={deleteQuestionMutation.isPending}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg border-[#eadfcd] bg-white px-3"
                    onClick={() => {
                      if (previousSlotNumber == null) return;
                      setActiveSlotNumber(previousSlotNumber);
                    }}
                    disabled={previousSlotNumber == null}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg border-[#eadfcd] bg-white px-3"
                    onClick={() => {
                      if (nextSlotNumber == null) return;
                      setActiveSlotNumber(nextSlotNumber);
                    }}
                    disabled={nextSlotNumber == null}
                  >
                    Next
                  </Button>
                  <Button
                    type="button"
                    className="h-9 rounded-lg bg-[#17253d] px-4 text-white hover:bg-[#101b2e]"
                    onClick={handleSaveQuestion}
                    disabled={!canSaveDraft(draft) || createQuestionMutation.isPending || updateQuestionMutation.isPending}
                  >
                    <Save className="mr-1.5 h-4 w-4" />
                    {currentQuestion ? (updateQuestionMutation.isPending ? "Saving..." : "Save Changes") : (createQuestionMutation.isPending ? "Saving..." : "Save Question")}
                  </Button>
                </div>
              </div>
              ) : null}
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-6 py-6">
              <div className="mx-auto w-full max-w-4xl space-y-5">
                <div className="rounded-2xl border border-[#eadfcd] bg-white p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Section Review</p>
                      <h2 className="mt-1 text-xl font-extrabold text-slate-900">{activeSection.title}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {activeSectionQuestions.length} saved of {totalSlots} slots
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg border-[#eadfcd] bg-white"
                      onClick={() => {
                        setViewMode("single");
                        setActiveSlotNumber(nextEditableSlot);
                      }}
                    >
                      <PenLine className="mr-1.5 h-4 w-4" />
                      Continue Editing
                    </Button>
                  </div>
                </div>

                {visibleSectionQuestions.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed border-[#eadfcd] bg-white px-6 py-12 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
                      <FileText className="h-7 w-7" />
                    </div>
                    <p className="mt-4 text-lg font-semibold text-slate-900">No questions in this section yet</p>
                    <p className="mt-1 text-sm text-slate-500">Save the next slot to start building this section.</p>
                  </div>
                ) : (
                  visibleSectionQuestions.map((question) => {
                    const meta = (question.meta as Record<string, unknown> | null) ?? null;
                    const taxonomy = resolveQuestionTaxonomy(meta, question.subjectLabel ?? activeSection.subjectLabel ?? activeSection.title);
                    const questionSlot = activeSectionQuestions.findIndex((item) => item.id === question.id) + 1;
                    const questionReports = (question.reports ?? []) as QuestionReport[];
                    const openReports = questionReports.filter((report) => report.status === "open");
                    const questionSetupWarnings = getQuestionSetupWarnings(question);
                    const needsCorrectAnswer = readQuestionSetupFlag(question, "needsCorrectAnswer");
                    const rangeAnswer =
                      question.correctAnswerMin != null && question.correctAnswerMax != null
                        ? `${question.correctAnswerMin} - ${question.correctAnswerMax}`
                        : null;

                    return (
                      <div key={question.id} className="rounded-2xl border border-[#eadfcd] bg-white p-5 shadow-[0_16px_32px_rgba(15,23,42,0.04)]">
                        <div className="flex items-start gap-3">
                          <span className="chip-orange-soft rounded-full px-3 py-1 text-xs font-bold">
                            Q{questionSlot}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-[#eadfcd] bg-[#fff9ef] px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                {activeSection.subjectLabel ?? activeSection.title}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${question.questionType === "multi" ? "bg-violet-100 text-violet-700" : question.questionType === "integer" ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700"}`}>
                                {question.questionType === "mcq" ? "MCQ Single" : question.questionType === "multi" ? "Multi-select" : "Integer"}
                              </span>
                              {openReports.length > 0 ? (
                                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                  {openReports.length} report{openReports.length === 1 ? "" : "s"}
                                </span>
                              ) : null}
                              {questionSetupWarnings.length > 0 ? (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                  {questionSetupWarnings.length} setup pending
                                </span>
                              ) : null}
                            </div>
                            <RichQuestionContent content={question.question} className="text-sm font-medium leading-6 text-slate-900" />
                            {question.imageData ? (
                              <div className="mt-3">
                                <img src={question.imageData} alt="Question visual" className="max-h-52 rounded-xl border border-[#eadfcd] object-contain" />
                              </div>
                            ) : null}

                            {question.questionType === "integer" ? (
                              <div className="mt-4 flex flex-wrap items-center gap-2">
                                <span className="text-xs text-slate-500">Correct answer:</span>
                                {needsCorrectAnswer ? (
                                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                                    Needs confirmation
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">
                                    {rangeAnswer ?? question.correctAnswer}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="mt-4 grid gap-2 md:grid-cols-2">
                                {question.options.map((option, optionIndex) => {
                                  const isCorrect = question.questionType === "multi"
                                    ? (!needsCorrectAnswer && (question.correctAnswerMulti ?? []).includes(optionIndex))
                                    : (!needsCorrectAnswer && question.correctAnswer === optionIndex);
                                  return (
                                    <div key={optionIndex} className={`rounded-xl border px-3 py-2 text-sm ${isCorrect ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-[#eadfcd] bg-white text-slate-700"}`}>
                                      <div className="flex items-start gap-2">
                                        <span className="font-semibold">{String.fromCharCode(65 + optionIndex)}.</span>
                                        <RichQuestionContent content={option} className="flex-1" />
                                      </div>
                                      {question.optionImages?.[optionIndex] ? (
                                        <img src={question.optionImages[optionIndex] ?? ""} alt="" className="mt-2 max-h-20 rounded border border-[#eadfcd] object-contain" />
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {questionSetupWarnings.length > 0 ? (
                              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">Pending Setup</p>
                                <p className="mt-2 text-sm leading-6 text-amber-900">
                                  {questionSetupWarnings.join(" · ")}
                                </p>
                              </div>
                            ) : null}

                            {(question.solutionText || question.solutionImageData) ? (
                              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">Teacher Solution</p>
                                {question.solutionText ? (
                                  <RichQuestionContent content={question.solutionText} className="mt-2 text-sm leading-6 text-emerald-900" />
                                ) : null}
                                {question.solutionImageData ? (
                                  <img src={question.solutionImageData} alt="Solution visual" className="mt-3 max-h-32 rounded-xl border border-emerald-200 object-contain" />
                                ) : null}
                              </div>
                            ) : null}

                            {openReports.length > 0 ? (
                              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-700">Open Reports</p>
                                <div className="mt-2 space-y-2">
                                  {openReports.slice(0, 2).map((report) => (
                                    <div key={report.id} className="rounded-xl border border-rose-200 bg-white px-3 py-2">
                                      <p className="text-xs font-semibold text-slate-900">{report.reporterName || "Student"}</p>
                                      <p className="mt-1 text-xs leading-5 text-slate-600">{report.reason}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            <p className="mt-4 text-xs text-slate-500">
                              {[taxonomy.subjectName, taxonomy.chapterName, taxonomy.topicTag, getQuestionDifficulty(question), `${getQuestionIdealTimeSeconds(question) || defaultIdealTimeSeconds(getQuestionDifficulty(question))} sec`, `${question.points} marks`]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>

                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-[#4f46e5] hover:bg-[#eef2ff] hover:text-[#4338ca]"
                              onClick={() => {
                                setViewMode("single");
                                setActiveSlotNumber(questionSlot);
                              }}
                            >
                              <PenLine className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              onClick={() => deleteQuestionMutation.mutate(question.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="flex h-full w-80 shrink-0 flex-col overflow-hidden border-l border-[#eadfcd] bg-[#fff7ea]">
          <div className="border-b border-[#eadfcd] px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold text-slate-900">{activeSection.title}</span>
              <span>{activeSectionQuestions.length}/{totalSlots} saved</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#efe4d2]">
              <div className="h-full rounded-full bg-[#f97316] transition-all" style={{ width: `${sectionProgress}%` }} />
            </div>
          </div>

          <div className="border-b border-[#eadfcd]">
            <button
              type="button"
              onClick={() => setFiltersOpen((previous) => !previous)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold text-slate-500 transition hover:text-slate-900"
            >
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Question Filters</span>
                {activeFiltersCount > 0 ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#f97316] text-[10px] font-bold text-white">
                    {activeFiltersCount}
                  </span>
                ) : null}
              </div>
              {filtersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {filtersOpen ? (
              <div className="space-y-3 px-4 pb-3">
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Marks</p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip active={marksFilter === "all"} label="All" onClick={() => setMarksFilter("all")} tone="orange" />
                    {availableMarkingSchemes.map((scheme) => (
                      <FilterChip
                        key={scheme.key}
                        active={marksFilter === scheme.key}
                        label={formatMarkingSchemeLabel(scheme)}
                        onClick={() => setMarksFilter(scheme.key)}
                        tone="orange"
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Difficulty</p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip active={difficultyFilter === "all"} label="All" onClick={() => setDifficultyFilter("all")} tone="orange" />
                    {availableDifficulties.map((value) => (
                      <FilterChip
                        key={value}
                        active={difficultyFilter === value}
                        label={value === "moderate" ? "Medium" : value[0].toUpperCase() + value.slice(1)}
                        onClick={() => setDifficultyFilter(value)}
                        tone={value}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Question Type</p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip active={questionTypeFilter === "all"} label="All" onClick={() => setQuestionTypeFilter("all")} tone="violet" />
                    {availableQuestionTypes.map((value) => (
                      <FilterChip
                        key={value}
                        active={questionTypeFilter === value}
                        label={value === "mcq" ? "MCQ Single" : value === "multi" ? "Multi-select" : "Integer"}
                        onClick={() => setQuestionTypeFilter(value)}
                        tone="violet"
                      />
                    ))}
                  </div>
                </div>

                {activeFiltersCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMarksFilter("all");
                      setDifficultyFilter("all");
                      setQuestionTypeFilter("all");
                    }}
                    className="text-[10px] text-slate-400 underline underline-offset-2 transition hover:text-rose-500"
                  >
                    Clear all filters
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Questions</span>
              <div className="flex items-center gap-2">
                {activeFiltersCount > 0 ? (
                  <span className="text-[10px] text-orange-600">{visibleSidebarQuestionItems.length} matched</span>
                ) : null}
              </div>
            </div>
            {visibleSidebarQuestionItems.length > 0 ? (
              <div className="grid grid-cols-4 gap-1.5">
                {visibleSidebarQuestionItems.map((item) => {
                  const slotQuestion = item.question;
                  const slot = item.slot;
                  const isActive = activeSection?.id === item.section.id && selectedSlotNumber === slot;
                  const isSaved = Boolean(slotQuestion);
                  const isDisabledFutureSlot = !slotQuestion && slot > item.nextEditableSlot;
                  const openReportCount = Number(slotQuestion?.openReportCount ?? 0) || 0;
                  const hasPendingSetup = hasQuestionSetupPending(slotQuestion);
                  const needsReviewAttention = hasPendingSetup || openReportCount > 0;
                  const importedCode = slotQuestion?.questionCode?.trim() ?? "";
                  const displayNumber = item.displayNumber;
                  const titleLabel = importedCode
                    ? `${displayNumber}${importedCode !== String(displayNumber) ? ` (${importedCode})` : ""}`
                    : String(displayNumber);

                  return (
                    <button
                      key={item.key}
                      type="button"
                      title={titleLabel}
                      onClick={() => {
                        if (isDisabledFutureSlot) return;
                        setActiveSectionId(item.section.id);
                        setActiveSlotNumber(slot);
                        setViewMode("single");
                      }}
                      disabled={isDisabledFutureSlot}
                      className={`relative flex h-9 items-center justify-center rounded-md border px-1 text-[11px] font-semibold transition ${isActive ? "border-[#f97316] bg-[#f97316] text-white shadow-sm" : isDisabledFutureSlot ? "cursor-not-allowed border-[#eadfcd] bg-[#fffaf3] text-slate-400" : isSaved ? needsReviewAttention ? "border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50" : "border-[#d9ccb7] bg-white text-slate-700 hover:border-orange-300 hover:bg-orange-50" : "border-[#eadfcd] bg-white text-slate-400 hover:border-[#d6c5ae] hover:text-slate-700"}`}
                    >
                      <span className="max-w-full truncate">{displayNumber}</span>
                      {slotQuestion ? (
                        <span
                          className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-white ${
                            needsReviewAttention ? "bg-rose-500" : getDifficultyDotClass(getQuestionDifficulty(slotQuestion))
                          }`}
                        />
                      ) : null}
                      {openReportCount > 0 ? (
                        <span className="absolute bottom-0.5 right-0.5 flex min-h-[14px] min-w-[14px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                          {openReportCount}
                        </span>
                      ) : null}
                            </button>
                          );
                        })}
                {!hasActiveQuestionFilters && showImportedCpetAddQuestionButton ? (
                  <button
                    type="button"
                    onClick={handleAddQuestionSlot}
                    disabled={createMissingCpetQuestionSectionMutation.isPending}
                    title={`Add missing CPET question (${cpetMissingQuestionCount} remaining)`}
                    aria-label="Add missing CPET question"
                    className="relative flex h-9 items-center justify-center rounded-md border border-dashed border-[#f0c88f] bg-[#FFF7E8] px-1 text-[#D97706] shadow-sm transition hover:bg-[#ffedd0] hover:text-[#b45309] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[#eadfcd] bg-white/70 px-3 py-6 text-center text-xs text-slate-500">
                No questions match the current filters.
              </div>
            )}
            {hasActiveQuestionFilters ? (
              <p className="mt-3 text-xs text-slate-500">
                {`Showing only ${visibleSidebarQuestionItems.length} question${visibleSidebarQuestionItems.length === 1 ? "" : "s"} that match the current filters.`}
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      <Dialog
        open={reportReviewQuestionId !== null}
        onOpenChange={(open) => {
          if (!open && !updateQuestionMutation.isPending) {
            setReportReviewQuestionId(null);
            setReportedQuestionDraft(null);
            setEditReportedQuestionText(false);
            setEditReportedSolutionText(false);
          }
        }}
      >
        <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto rounded-2xl p-0">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <DialogTitle>Review reported question</DialogTitle>
            <DialogDescription>
              Question content is shown in the same rendered format students see. You can update only the question, solution, and correct answer.
            </DialogDescription>
          </DialogHeader>

          {reportReviewQuestion && reportedQuestionDraft ? (
            <div className="space-y-6 px-6 py-5">
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Question</h3>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditReportedQuestionText((value) => !value)}>
                    <PenLine className="mr-1.5 h-3.5 w-3.5" />
                    {editReportedQuestionText ? "Stop editing" : "Edit question"}
                  </Button>
                </div>
                {editReportedQuestionText ? (
                  <Textarea
                    autoFocus
                    value={reportedQuestionDraft.question}
                    onChange={(event) => setReportedQuestionDraft((draftState) => draftState ? { ...draftState, question: event.target.value } : draftState)}
                    placeholder="Edit question content"
                    className="min-h-28"
                  />
                ) : null}
                <div className="rounded-xl border bg-background p-4">
                  <RichQuestionContent content={reportedQuestionDraft.question} className="text-base leading-7" />
                  {reportReviewQuestion.imageData ? <img src={reportReviewQuestion.imageData} alt="Question visual" className="mt-4 max-h-72 rounded-lg object-contain" /> : null}
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Correct answer</h3>
                {reportReviewQuestion.questionType === "integer" ? (
                  reportReviewQuestion.correctAnswerMin != null && reportReviewQuestion.correctAnswerMax != null ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5 text-sm font-medium">Minimum
                        <Input type="number" step="any" value={reportedQuestionDraft.correctAnswerMin} onChange={(event) => setReportedQuestionDraft((draftState) => draftState ? { ...draftState, correctAnswerMin: event.target.value } : draftState)} />
                      </label>
                      <label className="space-y-1.5 text-sm font-medium">Maximum
                        <Input type="number" step="any" value={reportedQuestionDraft.correctAnswerMax} onChange={(event) => setReportedQuestionDraft((draftState) => draftState ? { ...draftState, correctAnswerMax: event.target.value } : draftState)} />
                      </label>
                    </div>
                  ) : (
                    <label className="block max-w-sm space-y-1.5 text-sm font-medium">Numeric answer
                      <Input type="number" step="any" value={reportedQuestionDraft.integerAnswer} onChange={(event) => setReportedQuestionDraft((draftState) => draftState ? { ...draftState, integerAnswer: event.target.value } : draftState)} />
                    </label>
                  )
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {reportReviewQuestion.options.map((option, optionIndex) => {
                      const selected = reportReviewQuestion.questionType === "multi"
                        ? reportedQuestionDraft.correctAnswerMulti.includes(optionIndex)
                        : reportedQuestionDraft.correctAnswer === optionIndex;
                      return (
                        <button
                          key={optionIndex}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setReportedQuestionDraft((draftState) => {
                            if (!draftState) return draftState;
                            if (reportReviewQuestion.questionType === "multi") {
                              const selectedAnswers = draftState.correctAnswerMulti;
                              return {
                                ...draftState,
                                correctAnswerMulti: selectedAnswers.includes(optionIndex)
                                  ? selectedAnswers.filter((answer) => answer !== optionIndex)
                                  : [...selectedAnswers, optionIndex],
                              };
                            }
                            return { ...draftState, correctAnswer: optionIndex };
                          })}
                          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${selected ? "border-emerald-400 bg-emerald-50 text-emerald-950" : "bg-background hover:border-primary/50"}`}
                        >
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/40"}`}>
                            {selected ? <Check className="h-4 w-4" /> : String.fromCharCode(65 + optionIndex)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <RichQuestionContent content={option} />
                            {reportReviewQuestion.optionImages?.[optionIndex] ? <img src={reportReviewQuestion.optionImages[optionIndex] ?? ""} alt="Option visual" className="mt-2 max-h-32 rounded object-contain" /> : null}
                            {selected ? <span className="mt-2 block text-xs font-semibold text-emerald-700">Correct answer</span> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Solution</h3>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditReportedSolutionText((value) => !value)}>
                    <PenLine className="mr-1.5 h-3.5 w-3.5" />
                    {editReportedSolutionText ? "Stop editing" : "Edit solution"}
                  </Button>
                </div>
                {editReportedSolutionText ? (
                  <Textarea
                    value={reportedQuestionDraft.solutionText}
                    onChange={(event) => setReportedQuestionDraft((draftState) => draftState ? { ...draftState, solutionText: event.target.value } : draftState)}
                    placeholder="Edit solution or explanation"
                    className="min-h-28"
                  />
                ) : null}
                <div className="rounded-xl border bg-background p-4">
                  {reportedQuestionDraft.solutionText.trim()
                    ? <RichQuestionContent content={reportedQuestionDraft.solutionText} />
                    : <p className="text-sm text-muted-foreground">No written solution has been added.</p>}
                  {reportReviewQuestion.solutionImageData ? <img src={reportReviewQuestion.solutionImageData} alt="Solution visual" className="mt-4 max-h-72 rounded-lg object-contain" /> : null}
                </div>
              </section>
            </div>
          ) : (
            <p className="px-6 py-8 text-sm text-muted-foreground">This reported question is no longer available.</p>
          )}

          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setReportReviewQuestionId(null)} disabled={updateQuestionMutation.isPending}>Cancel</Button>
            <Button
              type="button"
              disabled={!reportReviewQuestion || !reportedQuestionDraft || updateQuestionMutation.isPending || !reportedQuestionDraft.question.trim() || (
                reportReviewQuestion?.questionType === "mcq" && (reportedQuestionDraft.correctAnswer < 0 || reportedQuestionDraft.correctAnswer >= (reportReviewQuestion.options?.length ?? 0))
              ) || (
                reportReviewQuestion?.questionType === "multi" && reportedQuestionDraft.correctAnswerMulti.length === 0
              ) || (
                reportReviewQuestion?.questionType === "integer" && reportReviewQuestion.correctAnswerMin != null && reportReviewQuestion.correctAnswerMax != null && (
                  !reportedQuestionDraft.correctAnswerMin.trim() || !reportedQuestionDraft.correctAnswerMax.trim() || !Number.isFinite(Number(reportedQuestionDraft.correctAnswerMin)) || !Number.isFinite(Number(reportedQuestionDraft.correctAnswerMax)) || Number(reportedQuestionDraft.correctAnswerMin) > Number(reportedQuestionDraft.correctAnswerMax)
                )
              ) || (
                reportReviewQuestion?.questionType === "integer" && !(reportReviewQuestion.correctAnswerMin != null && reportReviewQuestion.correctAnswerMax != null) && (!reportedQuestionDraft.integerAnswer.trim() || !Number.isFinite(Number(reportedQuestionDraft.integerAnswer)))
              )}
              onClick={() => {
                if (!reportReviewQuestion || !reportedQuestionDraft) return;
                const body: Record<string, unknown> = {
                  question: reportedQuestionDraft.question.trim(),
                  solutionText: reportedQuestionDraft.solutionText.trim() || null,
                };
                if (reportReviewQuestion.questionType === "mcq") body.correctAnswer = reportedQuestionDraft.correctAnswer;
                if (reportReviewQuestion.questionType === "multi") body.correctAnswerMulti = reportedQuestionDraft.correctAnswerMulti;
                if (reportReviewQuestion.questionType === "integer") {
                  if (reportReviewQuestion.correctAnswerMin != null && reportReviewQuestion.correctAnswerMax != null) {
                    body.correctAnswerMin = Number(reportedQuestionDraft.correctAnswerMin);
                    body.correctAnswerMax = Number(reportedQuestionDraft.correctAnswerMax);
                  } else {
                    body.correctAnswer = Number(reportedQuestionDraft.integerAnswer);
                  }
                }
                updateQuestionMutation.mutate({ questionId: reportReviewQuestion.id, body });
              }}
            >
              <Save className="mr-2 h-4 w-4" />
              {updateQuestionMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input
        ref={questionImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          handleQuestionImageUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={solutionImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          handleSolutionImageUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={optionImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          handleOptionImageUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
