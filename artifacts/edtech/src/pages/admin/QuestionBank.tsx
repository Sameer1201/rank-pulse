import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Check,
  CheckSquare,
  ClipboardList,
  Download,
  FileQuestion,
  FileText,
  Flag,
  Gauge,
  Hash,
  ImagePlus,
  List,
  Pencil,
  PenLine,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { PremiumWhiteLoader } from "@/components/ui/PremiumWhiteLoader";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { ReportedQuestionQueue } from "@/components/admin/ReportedQuestionQueue";
import { RichQuestionEditor } from "@/components/admin/RichQuestionEditor";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { optimizeImageToDataUrl } from "@/lib/imageUpload";
import { stripRichHtmlToText } from "@/lib/richContent";
import { parsePyqHtml, type ParsedPyqImport } from "@/lib/pyqImport";
import { SubjectThemeIcon, getSubjectAccent, getSubjectTheme } from "@/lib/subject-theme";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildApiUrl } from "@/lib/api-origin";
import {
  persistAdminExam,
  readAdminExamQuery,
  readAdminExamSelection,
} from "@/lib/admin-exam-selection";

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

interface QuestionReport {
  id: number;
  reporterName: string;
  reason: string | null;
  status: string;
  createdAt: string;
}

interface QuestionItem {
  id: number;
  createdAt: string;
  question: string;
  questionType: QuestionType;
  options: string[];
  optionImages?: (string | null)[];
  correctAnswer: number | null;
  correctAnswerMulti: number[];
  correctAnswerMin?: number | null;
  correctAnswerMax?: number | null;
  explanation?: string | null;
  topicTag?: string | null;
  difficulty: string;
  points: number;
  imageData?: string | null;
  reportCount: number;
  openReportCount: number;
  reports: QuestionReport[];
  isSaved?: boolean;
  hasImage?: boolean;
  hasOptionImages?: boolean;
}

interface ChapterItem {
  id: number;
  title: string;
  description?: string | null;
  targetQuestions?: number | null;
  questionCount?: number;
  attemptedCount?: number;
  questions: QuestionItem[];
}

interface SubjectItem {
  id: number;
  title: string;
  teacherId?: number | null;
  teacherName?: string | null;
  chapters: ChapterItem[];
}

interface QuestionBankExamSummary {
  key: string;
  label: string;
  subjectCount: number;
  chapterCount: number;
  questionCount: number;
  weeklyTargetQuestions?: number | null;
  weeklyTargetDeadline?: string | null;
  remainingQuestions?: number;
}

interface QuestionBankExamResponse {
  exam: { key: string; label: string };
  subjects: SubjectItem[];
  savedBucket: QuestionItem[];
}

interface QuestionChapterResponse {
  questions: QuestionItem[];
}

interface ReportQueueItem {
  id: number;
  questionId: number;
  questionText: string;
  examKey?: string | null;
  classId?: number | null;
  subjectId?: number | null;
  chapterId?: number | null;
  subjectTitle?: string;
  chapterTitle?: string;
  reporterName: string;
  reason: string | null;
  status: string;
  createdAt: string | null;
}

interface ReportQueuePage {
  reports: ReportQueueItem[];
  nextCursor: string | null;
}

function formatQuestionBankDeadlineLabel(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(date);
}

function formatQuestionBankDateKey(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

interface EditorState {
  question: string;
  questionType: QuestionType;
  options: string[];
  optionImages: (string | null)[];
  imageData: string | null;
  correctAnswer: number;
  correctAnswerMulti: number[];
  correctAnswerInt: string;
  correctAnswerMin: string;
  correctAnswerMax: string;
  integerMode: "exact" | "range";
  explanation: string;
  topicTag: string;
  difficulty: string;
  points: string;
}

interface QuestionBankExamTransferBundle {
  version?: number;
  exportedAt?: string;
  exam?: {
    key?: string;
    label?: string;
  };
  subjects?: Array<{
    title?: string;
    chapters?: Array<{
      title?: string;
      description?: string | null;
      questions?: Array<Record<string, unknown>>;
    }>;
  }>;
}

interface QuestionBankSubjectTransferBundle {
  version?: number;
  exportedAt?: string;
  subject?: {
    id?: number;
    title?: string;
    description?: string | null;
  };
  chapters?: Array<{
    id?: number;
    title?: string;
    description?: string | null;
    targetQuestions?: number | null;
    questions?: Array<Record<string, unknown>>;
  }>;
}

interface QuestionBankHtmlImportState {
  fileName: string;
  parsed: ParsedPyqImport;
}

const QUESTION_BANK_JSON_IMPORT_ACCEPT = ".json,application/json";
const QUESTION_BANK_HTML_IMPORT_ACCEPT = ".html,.htm,text/html";

const emptyEditor = (): EditorState => ({
  question: "",
  questionType: "mcq",
  options: ["", "", "", ""],
  optionImages: [null, null, null, null],
  imageData: null,
  correctAnswer: 0,
  correctAnswerMulti: [],
  correctAnswerInt: "",
  correctAnswerMin: "",
  correctAnswerMax: "",
  integerMode: "exact",
  explanation: "",
  topicTag: "",
  difficulty: "medium",
  points: "1",
});

function questionTypeIcon(type: QuestionType) {
  if (type === "multi") return <CheckSquare size={13} />;
  if (type === "integer") return <Hash size={13} />;
  return <FileQuestion size={13} />;
}

function questionTypeLabel(type: QuestionType) {
  if (type === "multi") return "Multi";
  if (type === "integer") return "Integer";
  return "MCQ";
}

function builderFilterChipTone(tone: "orange" | "easy" | "medium" | "hard" | "violet", active: boolean) {
  if (tone === "easy") {
    return active
      ? "border-emerald-500 bg-emerald-500 text-white shadow-sm"
      : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
  }
  if (tone === "medium") {
    return active
      ? "border-amber-500 bg-amber-500 text-white shadow-sm"
      : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100";
  }
  if (tone === "hard") {
    return active
      ? "border-rose-500 bg-rose-500 text-white shadow-sm"
      : "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100";
  }
  if (tone === "violet") {
    return active
      ? "border-violet-500 bg-violet-500 text-white shadow-sm"
      : "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100";
  }
  return active
    ? "border-[#f97316] bg-[#f97316] text-white shadow-sm"
    : "border-[#eadfcd] bg-white text-slate-600 hover:border-orange-300 hover:bg-orange-50";
}

function BuilderFilterChip({
  active,
  label,
  onClick,
  tone,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone: "orange" | "easy" | "medium" | "hard" | "violet";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${builderFilterChipTone(tone, active)}`}
    >
      {label}
    </button>
  );
}

function getFocusedQuestionDotClass(question: QuestionItem | null | undefined) {
  if (!question) return "bg-slate-300";
  if (question.difficulty === "easy") return "bg-emerald-400";
  if (question.difficulty === "hard") return "bg-rose-400";
  return "bg-amber-400";
}

function isStarterQuestion(question: Pick<QuestionItem, "difficulty"> | null | undefined) {
  return String(question?.difficulty ?? "").trim().toLowerCase() === "starter";
}

function formatQuestionBankDifficulty(value?: string | null) {
  const normalized = String(value ?? "medium").trim().toLowerCase();
  if (normalized === "starter") return "Starter Questions";
  if (normalized === "easy") return "Easy";
  if (normalized === "hard") return "Hard";
  return "Medium";
}

const QUESTION_BANK_TYPE_OPTIONS: Array<{
  value: QuestionType;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    value: "mcq",
    label: "MCQ",
    description: "Single correct option",
    icon: <FileQuestion className="h-4 w-4" />,
  },
  {
    value: "multi",
    label: "Multi-select",
    description: "More than one correct option",
    icon: <CheckSquare className="h-4 w-4" />,
  },
  {
    value: "integer",
    label: "Integer",
    description: "Exact answer or answer range",
    icon: <Hash className="h-4 w-4" />,
  },
];

const QUESTION_BANK_DIFFICULTY_OPTIONS: Array<{
  value: "easy" | "medium" | "hard" | "starter";
  label: string;
  tone: string;
}> = [
  {
    value: "easy",
    label: "Easy",
    tone: "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  },
  {
    value: "medium",
    label: "Medium",
    tone: "border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100",
  },
  {
    value: "hard",
    label: "Hard",
    tone: "border-rose-500 bg-rose-50 text-rose-700 hover:bg-rose-100",
  },
  {
    value: "starter",
    label: "Starter Questions",
    tone: "border-sky-500 bg-sky-50 text-sky-700 hover:bg-sky-100",
  },
];

const QUESTION_BANK_OPTION_BADGE_STYLES = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
];

function editorFromQuestion(question: QuestionItem): EditorState {
  return {
    question: question.question,
    questionType: question.questionType,
    options: question.options.length > 0 ? [...question.options] : ["", "", "", ""],
    optionImages: question.options.length > 0
      ? Array.from({ length: question.options.length }, (_, index) => question.optionImages?.[index] ?? null)
      : [null, null, null, null],
    imageData: question.imageData ?? null,
    correctAnswer: question.correctAnswer ?? 0,
    correctAnswerMulti: [...(question.correctAnswerMulti ?? [])],
    correctAnswerInt: question.correctAnswer !== null && question.correctAnswer !== undefined ? String(question.correctAnswer) : "",
    correctAnswerMin: question.correctAnswerMin !== null && question.correctAnswerMin !== undefined ? String(question.correctAnswerMin) : "",
    correctAnswerMax: question.correctAnswerMax !== null && question.correctAnswerMax !== undefined ? String(question.correctAnswerMax) : "",
    integerMode: question.correctAnswerMin !== null && question.correctAnswerMin !== undefined ? "range" : "exact",
    explanation: question.explanation ?? "",
    topicTag: question.topicTag ?? "",
    difficulty: question.difficulty ?? "medium",
    points: String(question.points ?? 1),
  };
}

function appendEditorImages(content: string, imageDataUrls: string[]) {
  const imageMarkup = imageDataUrls
    .filter(Boolean)
    .map((src) => `<p><img src="${src}" alt="Uploaded question image" /></p>`)
    .join("\n");
  return [content.trim(), imageMarkup].filter(Boolean).join("\n");
}

async function optimizeEditorImages(files: File[], options: { maxWidth: number; maxHeight: number }) {
  return Promise.all(files.map((file) => optimizeImageToDataUrl(file, { ...options, quality: 0.82 })));
}

interface PdfExportQuestionItem {
  question: string;
  imageData?: string | null;
  subjectTitle?: string;
  chapterTitle?: string;
}

function buildPayload(editor: EditorState) {
  const payload: Record<string, unknown> = {
    question: editor.question,
    questionType: editor.questionType,
    explanation: editor.explanation || undefined,
    topicTag: editor.topicTag.trim() || undefined,
    difficulty: editor.difficulty,
    points: parseInt(editor.points, 10) || 1,
    imageData: editor.imageData ?? undefined,
  };

  if (editor.questionType === "integer") {
    payload.options = [];
    if (editor.integerMode === "range") {
      payload.correctAnswerMin = parseFloat(editor.correctAnswerMin);
      payload.correctAnswerMax = parseFloat(editor.correctAnswerMax);
    } else {
      payload.correctAnswer = parseFloat(editor.correctAnswerInt);
    }
    return payload;
  }

  const cleanOptions = editor.options.map((option) => option.trim()).filter(Boolean);
  payload.options = cleanOptions;
  payload.optionImages = cleanOptions.map((_option, index) => editor.optionImages[index] ?? null);

  if (editor.questionType === "multi") {
    payload.correctAnswerMulti = editor.correctAnswerMulti;
  } else {
    payload.correctAnswer = editor.correctAnswer;
  }

  return payload;
}

function canSaveEditor(editor: EditorState) {
  if (!editor.question.trim() && !editor.imageData) return false;

  if (editor.questionType === "mcq") {
    const hasAllOptions = editor.options.every((option, index) => option.trim() || editor.optionImages[index]);
    return hasAllOptions && editor.correctAnswer >= 0 && editor.correctAnswer < editor.options.length;
  }

  if (editor.questionType === "multi") {
    const hasAllOptions = editor.options.every((option, index) => option.trim() || editor.optionImages[index]);
    return hasAllOptions && editor.correctAnswerMulti.length > 0;
  }

  if (editor.integerMode === "range") {
    const min = Number(editor.correctAnswerMin);
    const max = Number(editor.correctAnswerMax);
    return (
      editor.correctAnswerMin.trim().length > 0
      && editor.correctAnswerMax.trim().length > 0
      && Number.isFinite(min)
      && Number.isFinite(max)
      && min <= max
    );
  }

  return editor.correctAnswerInt.trim().length > 0 && Number.isFinite(Number(editor.correctAnswerInt));
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugifyFilename(value: string, fallback: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || fallback;
}

async function parseExamImportBundle(file: File): Promise<{
  bundle: QuestionBankExamTransferBundle;
  sourceLabel: "JSON";
  warnings: string[];
}> {
  const text = await file.text();
  return {
    bundle: JSON.parse(text) as QuestionBankExamTransferBundle,
    sourceLabel: "JSON",
    warnings: [],
  };
}

async function parseSubjectImportBundle(
  file: File,
): Promise<{
  bundle: QuestionBankSubjectTransferBundle;
  sourceLabel: "JSON";
  warnings: string[];
}> {
  const text = await file.text();
  return {
    bundle: JSON.parse(text) as QuestionBankSubjectTransferBundle,
    sourceLabel: "JSON",
    warnings: [],
  };
}

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "TS"
  );
}

function getPercent(uploaded: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(Math.round((uploaded / target) * 100), 100);
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(source, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to load image (${response.status}).`);
    }
    return readBlobAsDataUrl(await response.blob());
  } finally {
    clearTimeout(timer);
  }
}

function getImageFormat(imageDataUrl: string) {
  if (/^data:image\/png/i.test(imageDataUrl)) return "PNG";
  if (/^data:image\/webp/i.test(imageDataUrl)) return "WEBP";
  return "JPEG";
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
  let lastSectionLabel = "";
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
    // Yield to browser every 10 questions so the tab stays responsive
    if (index > 0 && index % 10 === 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    const sectionLabel = [item.subjectTitle, item.chapterTitle].filter(Boolean).join(" - ");
    if (sectionLabel && sectionLabel !== lastSectionLabel) {
      ensureSpace(26);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(37, 99, 235);
      doc.text(sectionLabel, marginX, y);
      y += 18;
      lastSectionLabel = sectionLabel;
    }

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

    if (item.imageData) {
      try {
        const imageDataUrl = await resolveImageDataUrl(item.imageData);
        if (imageDataUrl) {
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
        }
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

export default function AdminQuestionBank() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const routeParams = useParams<{ examKey?: string; subjectId?: string; chapterId?: string }>();
  const queryExamKey = useMemo(() => {
    return readAdminExamQuery(location);
  }, [location]);
  const [selectedExamKey, setSelectedExamKey] = useState<string>(() => {
    const routeExam = routeParams.examKey?.trim();
    return routeExam || queryExamKey || readAdminExamSelection(location);
  });
  const [activeSubjectId, setActiveSubjectId] = useState<number | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [editorByChapter, setEditorByChapter] = useState<Record<number, EditorState>>({});
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [editingState, setEditingState] = useState<EditorState>(emptyEditor());
  const [exportingExamKey, setExportingExamKey] = useState<string | null>(null);
  const [exportingExamPdfKey, setExportingExamPdfKey] = useState<string | null>(null);
  const [importingExamKey, setImportingExamKey] = useState<string | null>(null);
  const [exportingSubjectId, setExportingSubjectId] = useState<number | null>(null);
  const [importingSubjectId, setImportingSubjectId] = useState<number | null>(null);
  const [moveTargetByQuestion, setMoveTargetByQuestion] = useState<Record<number, string>>({});
  const [focusedFiltersOpen, setFocusedFiltersOpen] = useState(false);
  const [focusedMarksFilter, setFocusedMarksFilter] = useState<"all" | string>("all");
  const [focusedDifficultyFilter, setFocusedDifficultyFilter] = useState<"all" | "easy" | "medium" | "hard" | "starter">("all");
  const [focusedQuestionTypeFilter, setFocusedQuestionTypeFilter] = useState<"all" | QuestionType>("all");
  const [activeFocusedQuestionId, setActiveFocusedQuestionId] = useState<number | null>(null);
  const [isAddingFocusedQuestion, setIsAddingFocusedQuestion] = useState(false);
  const [focusedViewMode, setFocusedViewMode] = useState<"single" | "all">("single");
  const [focusedAddSubjectName, setFocusedAddSubjectName] = useState("");
  const [focusedAddChapterName, setFocusedAddChapterName] = useState("");
  const [questionBankHtmlImport, setQuestionBankHtmlImport] = useState<QuestionBankHtmlImportState | null>(null);
  const [questionBankHtmlSubjectId, setQuestionBankHtmlSubjectId] = useState<number | null>(null);
  const [questionBankHtmlChapterId, setQuestionBankHtmlChapterId] = useState<number | null>(null);
  const [questionBankHtmlImporting, setQuestionBankHtmlImporting] = useState(false);
  const examImportInputRef = useRef<HTMLInputElement | null>(null);
  const subjectImportInputRef = useRef<HTMLInputElement | null>(null);
  const questionBankHtmlImportInputRef = useRef<HTMLInputElement | null>(null);
  const focusedQuestionCardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const focusedExamKey = routeParams.examKey?.trim() || "";
  const focusedSubjectId = routeParams.subjectId ? Number(routeParams.subjectId) : null;
  const focusedChapterId = routeParams.chapterId ? Number(routeParams.chapterId) : null;
  const focusedQuestionId = useMemo(() => {
    const value = new URLSearchParams(search).get("questionId");
    const questionId = value ? Number(value) : NaN;
    return Number.isFinite(questionId) && questionId > 0 ? questionId : null;
  }, [search]);
  const isFocusedWorkspace = Boolean(
    focusedExamKey
      && focusedSubjectId
      && !Number.isNaN(focusedSubjectId)
      && focusedChapterId
      && !Number.isNaN(focusedChapterId),
  );
  const isReportWorkspace = isFocusedWorkspace && focusedQuestionId != null;

  const { data: examCards = [], isLoading: examCardsLoading, isError: examCardsError } = useQuery<QuestionBankExamSummary[]>({
    queryKey: ["admin-question-bank-exams"],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/question-bank/exams`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load exam cards");
      return r.json();
    },
  });

  const visibleExamCards = examCardsError
    ? []
    : selectedExamKey
      ? examCards.filter((exam) => exam.key === selectedExamKey)
      : examCards;

  useEffect(() => {
    const requestedExamKey = focusedExamKey || queryExamKey || readAdminExamSelection(location);
    if (requestedExamKey && requestedExamKey !== selectedExamKey) {
      setSelectedExamKey(requestedExamKey);
    }
  }, [focusedExamKey, location, queryExamKey, selectedExamKey]);

  useEffect(() => {
    if (examCardsLoading) return;
    if (visibleExamCards.length === 0) {
      if (selectedExamKey) {
        setSelectedExamKey("");
      }
      return;
    }

    const hasSelectedExam = visibleExamCards.some((exam) => exam.key === selectedExamKey);
    if (!selectedExamKey || !hasSelectedExam) {
      setSelectedExamKey(visibleExamCards[0].key);
    }
  }, [examCardsLoading, visibleExamCards, selectedExamKey]);

  useEffect(() => {
    if (!selectedExamKey || !visibleExamCards.some((exam) => exam.key === selectedExamKey)) return;
    persistAdminExam(selectedExamKey);
  }, [selectedExamKey, visibleExamCards]);

  const selectExamWorkspace = (examKey: string) => {
    persistAdminExam(examKey);
    setSelectedExamKey(examKey);
    setLocation(`/admin/question-bank?exam=${encodeURIComponent(examKey)}`);
  };

  const { data, isLoading } = useQuery<QuestionBankExamResponse>({
    queryKey: ["admin-question-bank", selectedExamKey],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/question-bank/exams/${selectedExamKey}/structure`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load question bank");
      const payload = await r.json();
      return {
        ...payload,
        subjects: (payload.subjects ?? []).map((subject: SubjectItem) => ({
          ...subject,
          chapters: (subject.chapters ?? []).map((chapter: ChapterItem) => ({
            ...chapter,
            questions: [],
          })),
        })),
        savedBucket: [],
      } as QuestionBankExamResponse;
    },
    enabled: !!selectedExamKey,
    staleTime: 30_000,
  });

  const activeQuestionBankStructure = selectedExamKey ? data : undefined;
  const includeChapterImages = isFocusedWorkspace && !isReportWorkspace && focusedViewMode === "all";
  const focusedQuestionQueryId = isFocusedWorkspace ? focusedQuestionId : null;
  const { data: chapterQuestionsQueryData, isLoading: chapterQuestionsLoading } = useQuery<QuestionChapterResponse>({
    queryKey: ["admin-question-bank-chapter", activeChapterId, includeChapterImages, focusedQuestionQueryId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeChapterImages) params.set("includeImages", "1");
      if (focusedQuestionQueryId != null) params.set("questionId", String(focusedQuestionQueryId));
      const query = params.toString();
      const r = await fetch(buildApiUrl(`/api/question-bank/chapters/${activeChapterId}/questions${query ? `?${query}` : ""}`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load chapter questions");
      return r.json();
    },
    enabled: activeChapterId != null && !!selectedExamKey && (!isFocusedWorkspace || activeChapterId === focusedChapterId),
    staleTime: 30_000,
  });
  const { data: activeQuestionImage } = useQuery<{ imageData: string | null; optionImages: (string | null)[] }>({
    queryKey: ["admin-question-bank-question-image", activeFocusedQuestionId],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/question-bank/questions/${activeFocusedQuestionId}/image`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load question images");
      return r.json();
    },
    enabled: activeFocusedQuestionId != null,
  });
  useEffect(() => {
    if (activeFocusedQuestionId == null || !activeQuestionImage || editingQuestionId !== activeFocusedQuestionId) return;
    setEditingState((previous) => ({
      ...previous,
      imageData: activeQuestionImage.imageData,
      optionImages: activeQuestionImage.optionImages.length > 0
        ? activeQuestionImage.optionImages
        : previous.optionImages,
    }));
  }, [activeFocusedQuestionId, activeQuestionImage, editingQuestionId]);
  const activeQuestionBank = useMemo<QuestionBankExamResponse | undefined>(() => {
    if (!activeQuestionBankStructure) return undefined;
    const loadedQuestions = (chapterQuestionsQueryData?.questions ?? []).map((question) => (
      {
        ...question,
        reports: question.reports ?? [],
        ...(question.id === activeFocusedQuestionId && activeQuestionImage
          ? { imageData: activeQuestionImage.imageData, optionImages: activeQuestionImage.optionImages }
          : {}),
      }
    ));
    return {
      ...activeQuestionBankStructure,
      subjects: activeQuestionBankStructure.subjects.map((subject) => ({
        ...subject,
        chapters: subject.chapters.map((chapter) => ({
          ...chapter,
          questions: chapter.id === activeChapterId ? loadedQuestions : [],
        })),
      })),
    };
  }, [activeChapterId, activeFocusedQuestionId, activeQuestionBankStructure, activeQuestionImage, chapterQuestionsQueryData?.questions]);
  const activeExamCard = useMemo(
    () => visibleExamCards.find((exam) => exam.key === selectedExamKey) ?? null,
    [visibleExamCards, selectedExamKey],
  );
  const showChapterTargetMeta = Boolean(
    (activeExamCard?.weeklyTargetQuestions ?? 0) > 0 && activeExamCard?.weeklyTargetDeadline,
  );

  useEffect(() => {
    if (!activeQuestionBank || activeQuestionBank.subjects.length === 0) {
      setActiveSubjectId(null);
      setActiveChapterId(null);
      return;
    }
    setActiveSubjectId((prev) => (
      prev && activeQuestionBank.subjects.some((subject) => subject.id === prev)
        ? prev
        : activeQuestionBank.subjects[0].id
    ));
  }, [activeQuestionBank]);

  useEffect(() => {
    if (!isFocusedWorkspace || !activeQuestionBank || !focusedSubjectId || Number.isNaN(focusedSubjectId)) return;
    if (!activeQuestionBank.subjects.some((subject) => subject.id === focusedSubjectId)) return;
    if (activeSubjectId !== focusedSubjectId) {
      setActiveSubjectId(focusedSubjectId);
    }
  }, [activeQuestionBank, activeSubjectId, focusedSubjectId, isFocusedWorkspace]);

  useEffect(() => {
    if (!activeQuestionBank || activeSubjectId == null) {
      setActiveChapterId(null);
      return;
    }
    const subject = activeQuestionBank.subjects.find((entry) => entry.id === activeSubjectId);
    if (!subject || subject.chapters.length === 0) {
      setActiveChapterId(null);
      return;
    }
    setActiveChapterId((prev) => (
      prev && subject.chapters.some((chapter) => chapter.id === prev)
        ? prev
        : subject.chapters[0].id
    ));
  }, [activeQuestionBank, activeSubjectId]);

  useEffect(() => {
    if (!isFocusedWorkspace || !activeQuestionBank || !activeSubjectId || !focusedChapterId || Number.isNaN(focusedChapterId)) return;
    const focusedSubject = activeQuestionBank.subjects.find((subject) => subject.id === activeSubjectId);
    if (!focusedSubject) return;
    if (!focusedSubject.chapters.some((chapter) => chapter.id === focusedChapterId)) return;
    if (activeChapterId !== focusedChapterId) {
      setActiveChapterId(focusedChapterId);
    }
  }, [activeChapterId, activeQuestionBank, activeSubjectId, focusedChapterId, isFocusedWorkspace]);

  const activeSubject = useMemo(() => {
    if (!activeQuestionBank || activeQuestionBank.subjects.length === 0) return null;
    return activeQuestionBank.subjects.find((subject) => subject.id === activeSubjectId) ?? activeQuestionBank.subjects[0];
  }, [activeQuestionBank, activeSubjectId]);

  const activeSubjectTheme = useMemo(
    () => getSubjectTheme(activeSubject?.title ?? activeQuestionBank?.exam.label ?? "overall"),
    [activeQuestionBank?.exam.label, activeSubject?.title],
  );
  const activeSubjectAccent = useMemo(
    () => getSubjectAccent(activeSubject?.title ?? activeQuestionBank?.exam.label ?? "overall"),
    [activeQuestionBank?.exam.label, activeSubject?.title],
  );

  const activeChapter = useMemo(() => {
    if (!activeSubject || activeSubject.chapters.length === 0) return null;
    return activeSubject.chapters.find((chapter) => chapter.id === activeChapterId) ?? activeSubject.chapters[0];
  }, [activeSubject, activeChapterId]);

  const questionBankHtmlSubject = useMemo(
    () => activeQuestionBank?.subjects.find((subject) => subject.id === questionBankHtmlSubjectId) ?? null,
    [activeQuestionBank?.subjects, questionBankHtmlSubjectId],
  );
  const questionBankHtmlChapter = useMemo(
    () => questionBankHtmlSubject?.chapters.find((chapter) => chapter.id === questionBankHtmlChapterId) ?? null,
    [questionBankHtmlChapterId, questionBankHtmlSubject],
  );

  useEffect(() => {
    if (!activeQuestionBank?.subjects.length) {
      setQuestionBankHtmlSubjectId(null);
      setQuestionBankHtmlChapterId(null);
      return;
    }
    setQuestionBankHtmlSubjectId((previous) => (
      previous && activeQuestionBank.subjects.some((subject) => subject.id === previous)
        ? previous
        : activeSubject?.id ?? activeQuestionBank.subjects[0].id
    ));
  }, [activeQuestionBank, activeSubject?.id]);

  useEffect(() => {
    const chapters = questionBankHtmlSubject?.chapters ?? [];
    setQuestionBankHtmlChapterId((previous) => (
      previous && chapters.some((chapter) => chapter.id === previous)
        ? previous
        : activeChapter && chapters.some((chapter) => chapter.id === activeChapter.id)
          ? activeChapter.id
          : chapters[0]?.id ?? null
    ));
  }, [activeChapter, questionBankHtmlSubject]);

  useEffect(() => {
    setFocusedAddSubjectName(activeSubject?.title ?? "");
    setFocusedAddChapterName(activeChapter?.title ?? "");
  }, [activeChapter?.title, activeSubject?.title]);

  useEffect(() => {
    setMoveTargetByQuestion({});
    setFocusedMarksFilter("all");
    setFocusedDifficultyFilter("all");
    setFocusedQuestionTypeFilter("all");
    setActiveFocusedQuestionId(null);
    setFocusedViewMode("single");
  }, [activeChapterId]);

  const {
    data: reportPages,
    hasNextPage: hasMoreReports,
    fetchNextPage: fetchMoreReports,
    isFetchingNextPage: isFetchingMoreReports,
    isLoading: reportsLoading,
    isError: reportsError,
    refetch: refetchReports,
  } = useInfiniteQuery({
    queryKey: ["question-bank-reports", user?.id, user?.role, "open"],
    enabled: Boolean(user?.id) && (!isFocusedWorkspace || isReportWorkspace),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "100", status: "open" });
      if (pageParam) params.set("cursor", pageParam);
      const r = await fetch(buildApiUrl(`/api/question-bank/reports?${params.toString()}`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load reports");
      return r.json() as Promise<ReportQueuePage>;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const reports = (reportPages?.pages.flatMap((page) => page.reports) ?? [])
    .filter((report) => report.status.toLowerCase() === "open");
  useEffect(() => {
    if (isReportWorkspace && hasMoreReports && !isFetchingMoreReports && !reportsError) void fetchMoreReports();
  }, [isReportWorkspace, hasMoreReports, isFetchingMoreReports, reportsError, fetchMoreReports]);

  const dashboardStats = useMemo(() => {
    let subjects = 0;
    let chapters = 0;
    let questions = 0;
    let easy = 0;
    let medium = 0;
    let hard = 0;

    if (activeQuestionBank) {
      subjects = activeQuestionBank.subjects.length;
      activeQuestionBank.subjects.forEach((subject) => {
        chapters += subject.chapters.length;
        subject.chapters.forEach((chapter) => {
          questions += chapter.questionCount ?? chapter.questions.length;
          chapter.questions.forEach((question) => {
            if (question.difficulty === "easy") easy += 1;
            else if (question.difficulty === "hard") hard += 1;
            else medium += 1;
          });
        });
      });
    }

    return {
      subjects,
      chapters,
      questions,
      easy,
      medium,
      hard,
    };
  }, [activeQuestionBank]);

  const activeSubjectStats = useMemo(() => {
    if (!activeSubject) {
      return { uploaded: 0, target: 0, pending: 0, easy: 0, medium: 0, hard: 0 };
    }

    return activeSubject.chapters.reduce((acc, chapter) => {
      const uploaded = chapter.questionCount ?? chapter.questions.length;
      const target = Math.max(chapter.targetQuestions ?? 0, uploaded);
      acc.uploaded += uploaded;
      acc.target += target;
      acc.pending += Math.max(target - uploaded, 0);
      chapter.questions.forEach((question) => {
        if (question.difficulty === "easy") acc.easy += 1;
        else if (question.difficulty === "hard") acc.hard += 1;
        else acc.medium += 1;
      });
      return acc;
    }, { uploaded: 0, target: 0, pending: 0, easy: 0, medium: 0, hard: 0 });
  }, [activeSubject]);

  const activeChapterStats = useMemo(() => {
    if (!activeChapter) {
      return { uploaded: 0, target: 0, pending: 0, easy: 0, medium: 0, hard: 0, topics: [] as string[] };
    }

    let easy = 0;
    let medium = 0;
    let hard = 0;
    const topics = new Set<string>();
    activeChapter.questions.forEach((question) => {
      if (question.difficulty === "easy") easy += 1;
      else if (question.difficulty === "hard") hard += 1;
      else medium += 1;
      if (question.topicTag?.trim()) topics.add(question.topicTag.trim());
    });

    const uploaded = activeChapter.questionCount ?? activeChapter.questions.length;
    const target = Math.max(activeChapter.targetQuestions ?? 0, uploaded);
    return {
      uploaded,
      target,
      pending: Math.max(target - uploaded, 0),
      easy,
      medium,
      hard,
      topics: [...topics].sort((a, b) => a.localeCompare(b)),
    };
  }, [activeChapter]);

  const assignedSubjects = activeQuestionBank?.subjects ?? [];

  const teacherTotals = useMemo(() => {
    let target = 0;
    let uploaded = 0;

    assignedSubjects.forEach((subject) => {
      subject.chapters.forEach((chapter) => {
        const chapterUploaded = chapter.questionCount ?? chapter.questions.length;
        uploaded += chapterUploaded;
        target += Math.max(chapter.targetQuestions ?? 0, chapterUploaded);
      });
    });

    const pending = Math.max(target - uploaded, 0);
    return {
      target,
      uploaded,
      pending,
      progress: getPercent(uploaded, target),
    };
  }, [assignedSubjects]);

  const teacherName = user?.fullName?.trim() || activeSubject?.teacherName?.trim() || "Teacher";
  const teacherEmail = user?.email?.trim() || "Question bank workspace";
  const teacherInitials = getInitials(teacherName);

  const teacherChapters = useMemo(
    () => assignedSubjects.flatMap((subject) => subject.chapters),
    [assignedSubjects],
  );

  const pendingChapterCount = useMemo(
    () => teacherChapters.reduce(
      (count, chapter) => {
        const uploaded = chapter.questionCount ?? chapter.questions.length;
        return count + (Math.max(chapter.targetQuestions ?? 0, uploaded) > uploaded ? 1 : 0);
      },
      0,
    ),
    [teacherChapters],
  );

  const completedSets = useMemo(
    () => teacherChapters.filter((chapter) => (chapter.questionCount ?? chapter.questions.length) > 0).length,
    [teacherChapters],
  );

  const subjectSummaries = useMemo(
    () =>
      assignedSubjects.map((subject) => {
        const uploaded = subject.chapters.reduce((sum, chapter) => sum + (chapter.questionCount ?? chapter.questions.length), 0);
        const target = subject.chapters.reduce((sum, chapter) => {
          const chapterUploaded = chapter.questionCount ?? chapter.questions.length;
          return sum + Math.max(chapter.targetQuestions ?? 0, chapterUploaded);
        }, 0);
        const pending = Math.max(target - uploaded, 0);
        return {
          ...subject,
          uploaded,
          target,
          pending,
          progress: getPercent(uploaded, target),
        };
      }),
    [assignedSubjects],
  );

  const chapterRows = useMemo(() => {
    return (activeSubject?.chapters ?? []).map((chapter, index) => {
      const uploaded = chapter.questionCount ?? chapter.questions.length;
      const target = Math.max(chapter.targetQuestions ?? 0, uploaded);
      const remaining = showChapterTargetMeta ? Math.max(target - uploaded, 0) : null;
      return {
        ...chapter,
        chapterNumber: index + 1,
        progress: getPercent(uploaded, target),
        remaining,
        urgency: remaining == null ? null : remaining > 80 ? "High" : remaining > 30 ? "Medium" : "Low",
        due: showChapterTargetMeta ? formatQuestionBankDeadlineLabel(activeExamCard?.weeklyTargetDeadline) : null,
      };
    });
  }, [activeExamCard?.weeklyTargetDeadline, activeSubject, showChapterTargetMeta]);

  const dailyUploadData = useMemo(() => {
    const today = new Date();
    const dayBuckets = Array.from({ length: 6 }, (_value, index) => {
      const date = new Date(today);
      date.setHours(0, 0, 0, 0);
      date.setDate(today.getDate() - (5 - index));
      return {
        key: formatQuestionBankDateKey(date),
        day: new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date),
        questions: 0,
      };
    });

    const bucketIndexByKey = new Map(dayBuckets.map((bucket, index) => [bucket.key, index] as const));

    teacherChapters.forEach((chapter) => {
      chapter.questions.forEach((question) => {
        const questionDayKey = formatQuestionBankDateKey(question.createdAt);
        if (!questionDayKey) return;
        const bucketIndex = bucketIndexByKey.get(questionDayKey);
        if (bucketIndex == null) return;
        dayBuckets[bucketIndex] = {
          ...dayBuckets[bucketIndex],
          questions: dayBuckets[bucketIndex].questions + 1,
        };
      });
    });

    return dayBuckets.map(({ day, questions }) => ({ day, questions }));
  }, [teacherChapters]);

  const questionMixData = useMemo(
    () => [
      { label: "Easy", value: dashboardStats.easy, color: "#10b981" },
      { label: "Medium", value: dashboardStats.medium, color: "#f97316" },
      { label: "Hard", value: dashboardStats.hard, color: "#3b82f6" },
    ],
    [dashboardStats.easy, dashboardStats.medium, dashboardStats.hard],
  );

  const questionMixTotal = useMemo(
    () => questionMixData.reduce((sum, item) => sum + item.value, 0),
    [questionMixData],
  );

  const todayFocus = useMemo(() => [
    {
      icon: Gauge,
      text: activeChapter
        ? activeChapterStats.pending > 0
          ? `Finish ${activeChapterStats.pending} pending ${activeChapter.title} questions before review cut-off.`
          : `Review ${activeChapter.title} for accuracy and upload quality before adding fresh sets.`
        : "Pick a chapter and start clearing the highest-priority pending question targets.",
    },
    {
      icon: FileText,
      text: activeChapterStats.topics.length > 0
        ? `Keep solution explanations and topic tags updated for ${activeChapterStats.topics[0]} and related questions.`
        : "Attach clean explanations and topic tags for every new question you upload.",
    },
    {
      icon: Sparkles,
      text: `Current mix is ${dashboardStats.easy} easy, ${dashboardStats.medium} medium, and ${dashboardStats.hard} hard questions. Keep the balance steady.`,
    },
  ], [activeChapter, activeChapterStats.pending, activeChapterStats.topics, dashboardStats.easy, dashboardStats.hard, dashboardStats.medium]);

  const activeChapterOpenReports = useMemo(
    () => (activeChapter?.questions ?? []).flatMap((question) =>
      (question.reports ?? [])
        .filter((report) => report.status === "open")
        .map((report) => ({
          id: report.id,
          questionId: question.id,
          questionText: stripRichHtmlToText(question.question).slice(0, 120) || `Question ${question.id}`,
          reporterName: report.reporterName,
          reason: report.reason,
          status: report.status,
          createdAt: report.createdAt,
        })),
    ),
    [activeChapter],
  );
  const activeChapterUploaded = activeChapter?.questionCount ?? activeChapter?.questions.length ?? 0;
  const activeChapterTarget = activeChapter ? Math.max(activeChapter.targetQuestions ?? 0, activeChapterUploaded) : 0;
  const activeChapterPending = activeChapter ? Math.max(activeChapterTarget - activeChapterUploaded, 0) : 0;
  const activeChapterProgress = activeChapter ? getPercent(activeChapterUploaded, activeChapterTarget) : 0;
  const activeDeadlineLabel = formatQuestionBankDeadlineLabel(activeExamCard?.weeklyTargetDeadline);

  const focusedFilteredChapterQuestions = useMemo(() => {
    if (!activeChapter) return [];
    const filtered = activeChapter.questions.filter((question) => {
      const matchesMarks = focusedMarksFilter === "all" || String(Number(question.points ?? 0) || 0) === focusedMarksFilter;
      const matchesDifficulty = focusedDifficultyFilter === "all" || question.difficulty === focusedDifficultyFilter;
      const matchesQuestionType = focusedQuestionTypeFilter === "all" || question.questionType === focusedQuestionTypeFilter;
      return matchesMarks && matchesDifficulty && matchesQuestionType;
    });
    // A report opens with ?questionId=...; keep that route focused on the
    // reported question instead of rendering the complete chapter review.
    return focusedQuestionId == null
      ? filtered
      : filtered.filter((question) => question.id === focusedQuestionId);
  }, [activeChapter, focusedDifficultyFilter, focusedMarksFilter, focusedQuestionId, focusedQuestionTypeFilter]);

  const activeChapterQuestionNumberById = useMemo(() => {
    const numbers = new Map<number, number>();
    (activeChapter?.questions ?? []).forEach((question, index) => {
      numbers.set(question.id, index + 1);
    });
    return numbers;
  }, [activeChapter]);

  const focusedAvailableMarks = useMemo(
    () =>
      Array.from(
        new Set((activeChapter?.questions ?? []).map((question) => String(Number(question.points ?? 0) || 0))),
      ).sort((left, right) => Number(left) - Number(right)),
    [activeChapter],
  );

  const focusedAvailableDifficulties = useMemo(
    () =>
      (["easy", "medium", "hard", "starter"] as const).filter((difficulty) =>
        (activeChapter?.questions ?? []).some((question) => question.difficulty === difficulty),
      ),
    [activeChapter],
  );

  const focusedAvailableQuestionTypes = useMemo(
    () =>
      (["mcq", "multi", "integer"] as const).filter((questionType) =>
        (activeChapter?.questions ?? []).some((question) => question.questionType === questionType),
      ),
    [activeChapter],
  );

  const focusedActiveFiltersCount = [
    focusedMarksFilter !== "all",
    focusedDifficultyFilter !== "all",
    focusedQuestionTypeFilter !== "all",
  ].filter(Boolean).length;

  const focusedVisibleQuestions = useMemo(
    () =>
      focusedFilteredChapterQuestions
        .map((question) => ({
          question,
          slot: activeChapterQuestionNumberById.get(question.id) ?? 0,
        }))
        .filter((item) => item.slot > 0),
    [activeChapterQuestionNumberById, focusedFilteredChapterQuestions],
  );

  const openFocusedQuestion = (questionId: number) => {
    const question = activeChapter?.questions.find((item) => item.id === questionId);
    if (!question) return;
    setIsAddingFocusedQuestion(false);
    setActiveFocusedQuestionId(questionId);
    setEditingQuestionId(questionId);
    setEditingState(editorFromQuestion(question));
    requestAnimationFrame(() => {
      focusedQuestionCardRefs.current[questionId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const openReportedQuestion = (report: ReportQueueItem) => {
    if (!report.examKey || !report.subjectId || !report.chapterId) {
      toast({
        title: "Question location unavailable",
        description: "This report is missing its question-bank chapter mapping. Open the question from its exam workspace instead.",
        variant: "destructive",
      });
      return;
    }
    persistAdminExam(report.examKey);
    setFocusedViewMode("single");
    setLocation(`/admin/question-bank/exam/${encodeURIComponent(report.examKey)}/subject/${report.subjectId}/chapter/${report.chapterId}?questionId=${report.questionId}`);
  };

  useEffect(() => {
    if (!isFocusedWorkspace) return;
    if (isAddingFocusedQuestion) return;
    if (focusedFilteredChapterQuestions.length === 0) {
      setActiveFocusedQuestionId(null);
      setEditingQuestionId((previous) => {
        if (previous == null) return previous;
        return (activeChapter?.questions ?? []).some((question) => question.id === previous) ? previous : null;
      });
      return;
    }

    const hasActiveQuestion = focusedFilteredChapterQuestions.some((question) => question.id === activeFocusedQuestionId);
    const nextQuestion = hasActiveQuestion
      ? focusedFilteredChapterQuestions.find((question) => question.id === activeFocusedQuestionId) ?? focusedFilteredChapterQuestions[0]
      : focusedFilteredChapterQuestions[0];

    if (nextQuestion.id !== activeFocusedQuestionId) {
      setActiveFocusedQuestionId(nextQuestion.id);
    }
    if (editingQuestionId !== nextQuestion.id) {
      setEditingQuestionId(nextQuestion.id);
      setEditingState(editorFromQuestion(nextQuestion));
    }
  }, [activeChapter?.questions, activeFocusedQuestionId, editingQuestionId, focusedFilteredChapterQuestions, isAddingFocusedQuestion, isFocusedWorkspace]);

  useEffect(() => {
    if (!isFocusedWorkspace || focusedQuestionId == null || !activeChapter) return;
    if (focusedChapterId != null && activeChapter.id !== focusedChapterId) return;

    const question = activeChapter.questions.find((item) => item.id === focusedQuestionId);
    if (!question) return;

    setIsAddingFocusedQuestion(false);
    setFocusedViewMode("single");
    setActiveFocusedQuestionId(question.id);
    setEditingQuestionId(question.id);
    setEditingState(editorFromQuestion(question));
    // Image metadata changes the derived chapter object, but must not reload
    // its original text over an admin's in-progress visual edits.
  }, [activeChapter?.id, chapterQuestionsQueryData?.questions, focusedChapterId, focusedQuestionId, isFocusedWorkspace]);

  const addQuestionMutation = useMutation({
    mutationFn: async ({ chapterId, payload }: { chapterId: number; payload: Record<string, unknown> }) => {
      const r = await fetch(buildApiUrl(`/api/chapters/${chapterId}/question-bank-questions`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const payload = await r.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to add question");
      }
      return r.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank", selectedExamKey] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-chapter"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });
      setEditorByChapter((prev) => ({ ...prev, [variables.chapterId]: emptyEditor() }));
      setIsAddingFocusedQuestion(false);
      setFocusedAddSubjectName(activeSubject?.title ?? "");
      setFocusedAddChapterName(activeChapter?.title ?? "");
      if (data?.id && typeof data.id === "number") {
        setActiveFocusedQuestionId(data.id);
      }
      toast({ title: "Question added" });
    },
    onError: (err: Error) => toast({ title: "Could not add question", description: err.message, variant: "destructive" }),
  });

  const updateQuestionMutation = useMutation({
    mutationFn: async ({ questionId, payload }: { questionId: number; payload: Record<string, unknown> }) => {
      const r = await fetch(buildApiUrl(`/api/question-bank-questions/${questionId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const payload = await r.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to update question");
      }
      return r.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank", selectedExamKey] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-chapter"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });
      queryClient.invalidateQueries({ queryKey: ["question-bank-reports"] });
      queryClient.invalidateQueries({ queryKey: ["admin-test-builder"] });
      queryClient.invalidateQueries({ queryKey: ["admin-tests"] });
      queryClient.invalidateQueries({ queryKey: ["student-test-card-detail"] });
      queryClient.invalidateQueries({ queryKey: ["student-analysis"] });
      queryClient.invalidateQueries({ queryKey: ["student-analysis-solutions"] });
      setEditingQuestionId(null);
      setEditingState(emptyEditor());
      if (isReportWorkspace) {
        queryClient.setQueriesData<{ pages: ReportQueuePage[] }>({ queryKey: ["question-bank-reports"] }, previous => previous && ({
          ...previous, pages: previous.pages.map(page => ({ ...page, reports: page.reports.filter(report => report.questionId !== variables.questionId) })),
        }));
        const nextReport = reports.find(report => report.questionId !== variables.questionId);
        if (nextReport) openReportedQuestion(nextReport);
      }
      const linkedCount = Number(data?.linkedTestQuestionsSynced ?? 0);
      toast({ title: "Question updated", description: linkedCount > 0
        ? `Also updated ${linkedCount} linked test question${linkedCount === 1 ? "" : "s"}. No test questions deleted. Open reports are resolved.`
        : "Open reports on this question are resolved automatically." });
    },
    onError: (err: Error) => toast({ title: "Could not update question", description: err.message, variant: "destructive" }),
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(buildApiUrl(`/api/question-bank-questions/${id}`), { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank", selectedExamKey] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-chapter"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });
      queryClient.invalidateQueries({ queryKey: ["question-bank-reports"] });
      toast({ title: "Question removed" });
    },
  });

  const rejectReportMutation = useMutation({
    mutationFn: async (reportId: number) => {
      const r = await fetch(buildApiUrl(`/api/question-bank/reports/${reportId}/reject`), {
        method: "PATCH",
        credentials: "include",
      });
      if (!r.ok) {
        const payload = await r.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to reject report");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank", selectedExamKey] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-chapter"] });
      queryClient.invalidateQueries({ queryKey: ["question-bank-reports"] });
      toast({ title: "Report rejected", description: "The student has been notified." });
    },
    onError: (err: Error) => toast({ title: "Could not reject report", description: err.message, variant: "destructive" }),
  });

  const moveQuestionMutation = useMutation({
    mutationFn: async ({ questionId, chapterId }: { questionId: number; chapterId: number }) => {
      const r = await fetch(buildApiUrl(`/api/question-bank-questions/${questionId}/move`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId }),
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(payload.error ?? "Failed to move question");
      }
      return payload;
    },
    onSuccess: (_payload, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank", selectedExamKey] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });
      setMoveTargetByQuestion((prev) => {
        const next = { ...prev };
        delete next[variables.questionId];
        return next;
      });
      toast({ title: "Question moved", description: "The question was moved to the selected chapter." });
    },
    onError: (err: Error) => toast({ title: "Could not move question", description: err.message, variant: "destructive" }),
  });

  const setChapterEditor = (chapterId: number, updater: (prev: EditorState) => EditorState) => {
    setEditorByChapter((prev) => ({ ...prev, [chapterId]: updater(prev[chapterId] ?? emptyEditor()) }));
  };

  const handleQuestionBankHtmlFile = async (file?: File | null) => {
    if (!file) return;
    try {
      const parsed = parsePyqHtml(await file.text(), file.name);
      if (parsed.questions.length === 0) throw new Error("No questions were found in this HTML file.");
      setQuestionBankHtmlImport({ fileName: file.name, parsed });
      toast({
        title: "HTML ready for Question Bank",
        description: `${parsed.questions.length} questions detected. Choose a subject and chapter below; they will be saved as Starter Questions.`,
      });
    } catch (error) {
      toast({
        title: "HTML import failed",
        description: error instanceof Error ? error.message : "Could not read this HTML file",
        variant: "destructive",
      });
    }
  };

  const importQuestionBankHtml = async () => {
    if (!questionBankHtmlImport || !questionBankHtmlSubject || !questionBankHtmlChapter) return;
    setQuestionBankHtmlImporting(true);
    try {
      const questions = questionBankHtmlImport.parsed.questions.map((question) => ({
        question: question.question,
        questionType: question.questionType,
        options: question.options,
        correctAnswer: question.correctAnswer,
        correctAnswerMulti: question.correctAnswers,
        correctAnswerMin: question.answerMin,
        correctAnswerMax: question.answerMax,
        explanation: question.explanation,
        imageData: question.imageData,
        topicTag: null,
        difficulty: "starter",
        points: Number(question.marks?.match(/[0-9]+(?:\.[0-9]+)?/)?.[0] ?? 1) || 1,
      }));
      const response = await fetch(buildApiUrl(`/api/question-bank/subjects/${questionBankHtmlSubject.id}/import`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapters: [{ title: questionBankHtmlChapter.title, questions }] }),
      });
      const payload = await response.json().catch(() => ({})) as { importedCount?: number; skippedDuplicateCount?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not import HTML questions");
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank", selectedExamKey] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-chapter"] });
      queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });
      toast({
        title: "Starter Questions imported",
        description: `${payload.importedCount ?? 0} questions added to ${questionBankHtmlSubject.title} · ${questionBankHtmlChapter.title}${payload.skippedDuplicateCount ? `; ${payload.skippedDuplicateCount} duplicates skipped` : ""}.`,
      });
      setQuestionBankHtmlImport(null);
    } catch (error) {
      toast({ title: "HTML import failed", description: error instanceof Error ? error.message : "Could not import HTML questions", variant: "destructive" });
    } finally {
      setQuestionBankHtmlImporting(false);
    }
  };

  const handleExamExport = async () => {
    if (!selectedExamKey || !activeQuestionBank) return;
    setExportingExamKey(selectedExamKey);
    try {
      const response = await fetch(buildApiUrl(`/api/question-bank/exams/${selectedExamKey}/export`), {
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error ?? "Failed to export question bank");
      }
      const examLabel = activeQuestionBank.exam.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || selectedExamKey;
      downloadJson(`${examLabel}-question-bank.json`, payload);
      toast({
        title: "Question bank exported",
        description: `${activeQuestionBank.exam.label} is ready to download.`,
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Could not export question bank",
        variant: "destructive",
      });
    } finally {
      setExportingExamKey(null);
    }
  };

  const handleExamPdfExport = async () => {
    if (!selectedExamKey || !activeQuestionBank) return;

    setExportingExamPdfKey(selectedExamKey);
    try {
      // The page intentionally keeps only the selected chapter in memory. PDF
      // export is an explicit whole-exam operation, so fetch the complete tree
      // only when the user requests it.
      const response = await fetch(buildApiUrl(`/api/question-bank/exams/${selectedExamKey}?includeImages=1&includeExplanations=1`), {
        credentials: "include",
      });
      const fullExam = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((fullExam as { error?: string }).error ?? "Failed to load questions for PDF export");
      }

      const exportQuestions = (fullExam as QuestionBankExamResponse).subjects.flatMap((subject) =>
        subject.chapters.flatMap((chapter) =>
          chapter.questions.map((question) => ({
            question: question.question,
            imageData: question.imageData ?? null,
            subjectTitle: subject.title,
            chapterTitle: chapter.title,
          })),
        ),
      );

      if (exportQuestions.length === 0) {
        toast({
          title: "Nothing to export",
          description: `${activeQuestionBank.exam.label} does not have any questions yet.`,
          variant: "destructive",
        });
        return;
      }

      const { skippedImageCount } = await exportQuestionsPdf({
        title: activeQuestionBank.exam.label,
        filename: `${slugifyFilename(activeQuestionBank.exam.label, selectedExamKey)}-questions.pdf`,
        questions: exportQuestions,
      });

      toast({
        title: "Question bank PDF exported",
        description: skippedImageCount > 0
          ? `${activeQuestionBank.exam.label} downloaded. ${skippedImageCount} question image${skippedImageCount === 1 ? "" : "s"} could not be included.`
          : `${activeQuestionBank.exam.label} questions are ready in PDF format.`,
      });
    } catch (error) {
      toast({
        title: "PDF export failed",
        description: error instanceof Error ? error.message : "Could not export the question bank PDF",
        variant: "destructive",
      });
    } finally {
      setExportingExamPdfKey(null);
    }
  };

  const submitExamImportBundle = async (parsedImport: {
    bundle: QuestionBankExamTransferBundle;
    sourceLabel: "JSON" | "Document";
    warnings: string[];
  }) => {
    if (!selectedExamKey) return;

    const parsed = parsedImport.bundle;
    const rawSubjects = Array.isArray(parsed.subjects) ? parsed.subjects : [];
    if (rawSubjects.length === 0) {
      throw new Error(`No subjects were found in the ${parsedImport.sourceLabel.toLowerCase()} import.`);
    }

    const response = await fetch(buildApiUrl(`/api/question-bank/exams/${selectedExamKey}/import`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjects: rawSubjects }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((payload as { error?: string }).error ?? "Failed to import question bank bundle");
    }

    queryClient.invalidateQueries({ queryKey: ["admin-question-bank", selectedExamKey] });
    queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });

    const result = payload as {
      importedCount?: number;
      skippedSubjectCount?: number;
      skippedChapterCount?: number;
      skippedDuplicateCount?: number;
      invalidQuestionCount?: number;
    };
    toast({
      title: "Question bank imported",
      description: `Imported ${result.importedCount ?? 0} questions from ${parsedImport.sourceLabel}${result.skippedDuplicateCount ? `, ${result.skippedDuplicateCount} duplicates skipped` : ""}${result.invalidQuestionCount ? `, ${result.invalidQuestionCount} invalid rows skipped` : ""}${(result.skippedSubjectCount ?? 0) || (result.skippedChapterCount ?? 0) ? `, skipped ${result.skippedSubjectCount ?? 0} subject and ${result.skippedChapterCount ?? 0} chapter mappings` : ""}${parsedImport.warnings.length ? `, ${parsedImport.warnings.length} formatting note${parsedImport.warnings.length === 1 ? "" : "s"}` : ""}.`,
    });
  };

  const handleExamImport = async (file?: File | null) => {
    if (!file || !selectedExamKey) return;
    setImportingExamKey(selectedExamKey);
    try {
      const parsedImport = await parseExamImportBundle(file);
      await submitExamImportBundle(parsedImport);
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Could not import question bank bundle",
        variant: "destructive",
      });
    } finally {
      setImportingExamKey(null);
    }
  };

  const handleSubjectExport = async (subject: SubjectItem) => {
    setExportingSubjectId(subject.id);
    try {
      const response = await fetch(buildApiUrl(`/api/question-bank/subjects/${subject.id}/export`), {
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error ?? "Failed to export subject");
      }

      downloadJson(`${slugifyFilename(subject.title, `subject-${subject.id}`)}-question-bank.json`, payload);
      toast({
        title: "Subject exported",
        description: `${subject.title} is ready to download.`,
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Could not export the subject bundle",
        variant: "destructive",
      });
    } finally {
      setExportingSubjectId(null);
    }
  };

  const submitSubjectImportBundle = async (
    subject: SubjectItem,
    parsedImport: {
      bundle: QuestionBankSubjectTransferBundle;
      sourceLabel: "JSON" | "Document";
      warnings: string[];
    },
  ) => {
    const parsed = parsedImport.bundle;
    const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    if (rawChapters.length === 0) {
      throw new Error(`No chapters were found in the ${parsedImport.sourceLabel.toLowerCase()} import.`);
    }

    const response = await fetch(buildApiUrl(`/api/question-bank/subjects/${subject.id}/import`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapters: rawChapters }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((payload as { error?: string }).error ?? "Failed to import subject bundle");
    }

    queryClient.invalidateQueries({ queryKey: ["admin-question-bank", selectedExamKey] });
    queryClient.invalidateQueries({ queryKey: ["admin-question-bank-exams"] });

    const result = payload as {
      importedCount?: number;
      skippedChapterCount?: number;
      skippedDuplicateCount?: number;
      invalidQuestionCount?: number;
    };
    toast({
      title: "Subject imported",
      description: `Imported ${result.importedCount ?? 0} questions from ${parsedImport.sourceLabel}${result.skippedDuplicateCount ? `, ${result.skippedDuplicateCount} duplicates skipped` : ""}${result.invalidQuestionCount ? `, ${result.invalidQuestionCount} invalid rows skipped` : ""}${result.skippedChapterCount ? `, ${result.skippedChapterCount} chapter mappings skipped` : ""}${parsedImport.warnings.length ? `, ${parsedImport.warnings.length} formatting note${parsedImport.warnings.length === 1 ? "" : "s"}` : ""} in ${subject.title}.`,
    });
  };

  const handleSubjectImport = async (subject: SubjectItem, file?: File | null) => {
    if (!file) return;
    setImportingSubjectId(subject.id);
    try {
      const parsedImport = await parseSubjectImportBundle(file);
      await submitSubjectImportBundle(subject, parsedImport);
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Could not import the subject bundle",
        variant: "destructive",
      });
    } finally {
      setImportingSubjectId(null);
    }
  };

  const renderEditor = (editor: EditorState, onChange: (updater: (prev: EditorState) => EditorState) => void, footer?: React.ReactNode) => (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <Label className="text-xs">Question</Label>
          <RichQuestionEditor ariaLabel="Question" value={editor.question} onChange={(question) => onChange((prev) => ({ ...prev, question }))} placeholder="Enter question text" />
        </div>
        <div className="md:col-span-2 space-y-2">
          <Label className="text-xs">Question Image</Label>
          <div className="flex gap-2 flex-wrap">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void optimizeImageToDataUrl(file, { maxWidth: 1800, maxHeight: 1800, quality: 0.82 }).then((dataUrl) => {
                  onChange((prev) => ({ ...prev, imageData: dataUrl }));
                });
                e.currentTarget.value = "";
              }}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(e) => {
                const input = (e.currentTarget.parentElement?.previousElementSibling?.querySelector("input[type='file']") as HTMLInputElement | null);
                input?.click();
              }}
            >
              <ImagePlus size={13} className="mr-1" /> Add Question Image
            </Button>
            {editor.imageData && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange((prev) => ({ ...prev, imageData: null }))}>
                Remove Image
              </Button>
            )}
          </div>
          {editor.imageData && <img src={editor.imageData} alt="Question" className="max-h-40 rounded-lg border border-border object-contain bg-black/10 p-2" />}
        </div>
        <div>
          <Label className="text-xs">Type</Label>
          <select
            value={editor.questionType}
            onChange={(e) => onChange((prev) => ({ ...prev, questionType: e.target.value as QuestionType, correctAnswerMulti: [], correctAnswer: 0 }))}
            className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="mcq">MCQ</option>
            <option value="multi">Multi-select</option>
            <option value="integer">Integer</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Difficulty</Label>
          <select
            value={editor.difficulty}
            onChange={(e) => onChange((prev) => ({ ...prev, difficulty: e.target.value }))}
            className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Topic</Label>
          <Input
            value={editor.topicTag}
            onChange={(e) => onChange((prev) => ({ ...prev, topicTag: e.target.value }))}
            placeholder="e.g. Digital Modulation"
          />
        </div>
      </div>

      {editor.questionType !== "integer" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Options</Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange((prev) => ({ ...prev, options: [...prev.options, ""], optionImages: [...prev.optionImages, null] }))}
            >
              Add Option
            </Button>
          </div>
          {editor.options.map((option, index) => (
            <div key={index} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <RichQuestionEditor
                  compact
                  ariaLabel={`Option ${String.fromCharCode(65 + index)}`}
                  className="flex-1"
                  value={option}
                  onChange={(html) => onChange((prev) => {
                    const options = [...prev.options];
                    options[index] = html;
                    return { ...prev, options };
                  })}
                  placeholder={`Option ${String.fromCharCode(65 + index)}`}
                />
                {editor.questionType === "mcq" ? (
                  <Button type="button" size="sm" variant={editor.correctAnswer === index ? "default" : "outline"} onClick={() => onChange((prev) => ({ ...prev, correctAnswer: index }))}>
                    Correct
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant={editor.correctAnswerMulti.includes(index) ? "default" : "outline"}
                    onClick={() => onChange((prev) => ({
                      ...prev,
                      correctAnswerMulti: prev.correctAnswerMulti.includes(index)
                        ? prev.correctAnswerMulti.filter((item) => item !== index)
                        : [...prev.correctAnswerMulti, index],
                    }))}
                  >
                    Select
                  </Button>
                )}
                {editor.options.length > 2 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => onChange((prev) => {
                      const options = prev.options.filter((_, itemIndex) => itemIndex !== index);
                      const optionImages = prev.optionImages.filter((_, itemIndex) => itemIndex !== index);
                      const nextCorrectAnswer = prev.correctAnswer > index ? prev.correctAnswer - 1 : prev.correctAnswer;
                      const nextCorrectAnswerMulti = prev.correctAnswerMulti
                        .filter((itemIndex) => itemIndex !== index)
                        .map((itemIndex) => (itemIndex > index ? itemIndex - 1 : itemIndex));
                      return {
                        ...prev,
                        options,
                        optionImages,
                        correctAnswer: Math.min(nextCorrectAnswer, Math.max(options.length - 1, 0)),
                        correctAnswerMulti: nextCorrectAnswerMulti,
                      };
                    })}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void optimizeImageToDataUrl(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 }).then((dataUrl) => {
                      onChange((prev) => {
                        const optionImages = [...prev.optionImages];
                        optionImages[index] = dataUrl;
                        return { ...prev, optionImages };
                      });
                    });
                    e.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    const input = (e.currentTarget.parentElement?.querySelector("input[type='file']") as HTMLInputElement | null);
                    input?.click();
                  }}
                >
                  <ImagePlus size={13} className="mr-1" /> Option Image
                </Button>
                {editor.optionImages[index] && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onChange((prev) => {
                      const optionImages = [...prev.optionImages];
                      optionImages[index] = null;
                      return { ...prev, optionImages };
                    })}
                  >
                    Remove Image
                  </Button>
                )}
              </div>
              {editor.optionImages[index] && <img src={editor.optionImages[index] ?? ""} alt={`Option ${index + 1}`} className="max-h-32 rounded-lg border border-border object-contain bg-black/10 p-2" />}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">Mode</Label>
            <select
              value={editor.integerMode}
              onChange={(e) => onChange((prev) => ({ ...prev, integerMode: e.target.value as "exact" | "range" }))}
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="exact">Exact</option>
              <option value="range">Range</option>
            </select>
          </div>
          {editor.integerMode === "exact" ? (
            <div>
              <Label className="text-xs">Correct Answer</Label>
              <Input value={editor.correctAnswerInt} onChange={(e) => onChange((prev) => ({ ...prev, correctAnswerInt: e.target.value }))} placeholder="42" />
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">Min</Label>
                <Input value={editor.correctAnswerMin} onChange={(e) => onChange((prev) => ({ ...prev, correctAnswerMin: e.target.value }))} placeholder="10" />
              </div>
              <div>
                <Label className="text-xs">Max</Label>
                <Input value={editor.correctAnswerMax} onChange={(e) => onChange((prev) => ({ ...prev, correctAnswerMax: e.target.value }))} placeholder="20" />
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label className="text-xs">Points</Label>
          <Input value={editor.points} onChange={(e) => onChange((prev) => ({ ...prev, points: e.target.value }))} placeholder="1" />
        </div>
        <div>
          <Label className="text-xs">Explanation</Label>
          <RichQuestionEditor ariaLabel="Explanation" compact value={editor.explanation} onChange={(explanation) => onChange((prev) => ({ ...prev, explanation }))} placeholder="Optional explanation" />
        </div>
      </div>

      {footer ? <div className="flex gap-2 flex-wrap">{footer}</div> : null}
    </div>
  );

  const renderChapterWorkspace = (chapter: ChapterItem) => {
    const chapterEditor = editorByChapter[chapter.id] ?? emptyEditor();
    const chapterQuestions = activeChapter?.id === chapter.id
      ? (isFocusedWorkspace ? focusedFilteredChapterQuestions : chapter.questions)
      : chapter.questions;
    const availableMoveChapters = isFocusedWorkspace ? [] : (activeSubject?.chapters.filter((entry) => entry.id !== chapter.id) ?? []);
    const activeVisibleQuestion = chapterQuestions.find((question) => question.id === activeFocusedQuestionId) ?? chapterQuestions[0] ?? null;
    const activeVisibleQuestionNumber = activeVisibleQuestion
      ? activeChapterQuestionNumberById.get(activeVisibleQuestion.id) ?? -1
      : -1;
    const showFocusedAddComposer = isFocusedWorkspace && isAddingFocusedQuestion;

    if (activeChapter?.id === chapter.id && chapterQuestionsLoading && !showFocusedAddComposer) {
      return (
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-[#eadfcd] bg-white px-6 py-12">
          <div className="w-full max-w-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 animate-pulse rounded-xl bg-orange-100" />
              <div className="space-y-2">
                <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-64 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
            <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
            <p className="text-center text-sm text-slate-500">Loading questions for this chapter…</p>
          </div>
        </div>
      );
    }

    if (isFocusedWorkspace) {
      const currentFocusedQuestion = showFocusedAddComposer ? null : activeVisibleQuestion;
      const currentFocusedEditor = showFocusedAddComposer ? chapterEditor : editingState;
      const focusedOpenReports = currentFocusedQuestion?.reports?.filter((report) => report.status === "open") ?? [];
      const activeQuestionIndex = currentFocusedQuestion
        ? chapterQuestions.findIndex((question) => question.id === currentFocusedQuestion.id)
        : -1;
      const previousFocusedQuestion = activeQuestionIndex > 0 ? chapterQuestions[activeQuestionIndex - 1] : null;
      const nextFocusedQuestion = activeQuestionIndex >= 0 && activeQuestionIndex < chapterQuestions.length - 1
        ? chapterQuestions[activeQuestionIndex + 1]
        : null;
      const selectedFocusedSlotNumber = showFocusedAddComposer
        ? chapter.questions.length + 1
        : activeVisibleQuestionNumber > 0
          ? activeVisibleQuestionNumber
          : 1;
      const showFocusedEmptyState = !showFocusedAddComposer && chapterQuestions.length === 0;
      const isFocusedContextEditable = showFocusedAddComposer;
      const updateFocusedEditor = (updater: (prev: EditorState) => EditorState) => {
        if (showFocusedAddComposer) {
          setChapterEditor(chapter.id, updater);
          return;
        }
        setEditingState((prev) => updater(prev));
      };

      return (
        <div className="flex flex-col">
          <div>
            {focusedViewMode === "single" && showFocusedEmptyState ? (
              <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center px-6 py-6">
                <div className="w-full rounded-2xl border-2 border-dashed border-[#eadfcd] bg-white px-6 py-12 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
                    <SlidersHorizontal className="h-7 w-7" />
                  </div>
                  <p className="mt-4 text-lg font-semibold text-slate-900">No questions match these filters</p>
                  <p className="mt-1 text-sm text-slate-500">Clear or change the filters to see other questions in this chapter.</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-5 rounded-lg border-[#eadfcd] bg-white"
                    onClick={() => {
                      setFocusedMarksFilter("all");
                      setFocusedDifficultyFilter("all");
                      setFocusedQuestionTypeFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              </div>
            ) : focusedViewMode === "single" ? (
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6 pb-24">
                {focusedOpenReports.length > 0 ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-600">Student Reports</p>
                        <p className="mt-1 text-sm text-rose-900">
                          {focusedOpenReports.length} open report{focusedOpenReports.length === 1 ? "" : "s"} on this question.
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700">
                        <Flag className="h-3.5 w-3.5" />
                        Needs review
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {focusedOpenReports.map((report) => (
                        <div key={report.id} className="rounded-2xl border border-rose-200 bg-white px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">{report.reporterName || "Student"}</p>
                              <p className="mt-1 text-sm leading-6 text-slate-600">{report.reason || "Reported issue"}</p>
                            </div>
                            <button
                              type="button"
                              disabled={rejectReportMutation.isPending}
                              onClick={() => rejectReportMutation.mutate(report.id)}
                              className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Question Type</p>
                  <div className="grid gap-2 md:grid-cols-3">
                    {QUESTION_BANK_TYPE_OPTIONS.map((option) => {
                      const isActive = currentFocusedEditor.questionType === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updateFocusedEditor((prev) => ({
                            ...prev,
                            questionType: option.value,
                            options: option.value === "integer" ? prev.options : (prev.options.length ? prev.options : ["", "", "", ""]),
                            optionImages: option.value === "integer" ? prev.optionImages : (prev.optionImages.length ? prev.optionImages : [null, null, null, null]),
                            correctAnswer: option.value === "mcq" ? Math.max(prev.correctAnswer, 0) : prev.correctAnswer,
                            correctAnswerMulti: option.value === "multi" ? prev.correctAnswerMulti : [],
                            correctAnswerInt: option.value === "integer" ? prev.correctAnswerInt : "",
                            correctAnswerMin: option.value === "integer" ? prev.correctAnswerMin : "",
                            correctAnswerMax: option.value === "integer" ? prev.correctAnswerMax : "",
                            integerMode: option.value === "integer" ? prev.integerMode : "exact",
                          }))}
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

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subject Name</Label>
                    <Input
                      value={isFocusedContextEditable ? focusedAddSubjectName : (activeSubject?.title ?? "")}
                      readOnly={!isFocusedContextEditable}
                      onChange={isFocusedContextEditable ? (event) => setFocusedAddSubjectName(event.target.value) : undefined}
                      className={`h-10 rounded-xl border-[#eadfcd] ${isFocusedContextEditable ? "bg-white text-slate-900" : "bg-[#fff9ef] text-slate-500"}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chapter Name</Label>
                    <Input
                      value={isFocusedContextEditable ? focusedAddChapterName : chapter.title}
                      readOnly={!isFocusedContextEditable}
                      onChange={isFocusedContextEditable ? (event) => setFocusedAddChapterName(event.target.value) : undefined}
                      className={`h-10 rounded-xl border-[#eadfcd] ${isFocusedContextEditable ? "bg-white text-slate-900" : "bg-[#fff9ef] text-slate-500"}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Points</Label>
                    <Input
                      type="number"
                      value={currentFocusedEditor.points}
                      onChange={(event) => updateFocusedEditor((prev) => ({ ...prev, points: event.target.value }))}
                      className="h-10 rounded-xl border-[#eadfcd] bg-white font-medium"
                    />
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Difficulty</p>
                    <div className="flex flex-wrap gap-2">
                      {QUESTION_BANK_DIFFICULTY_OPTIONS.map((option) => {
                        const isActive = currentFocusedEditor.difficulty === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => updateFocusedEditor((prev) => ({ ...prev, difficulty: option.value }))}
                            className={`rounded-lg border-2 px-5 py-2 text-sm font-semibold transition ${isActive ? option.tone : "border-[#eadfcd] bg-white text-slate-500 hover:border-orange-300 hover:text-slate-900"}`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Topic Tag</Label>
                    <Input
                      value={currentFocusedEditor.topicTag}
                      onChange={(event) => updateFocusedEditor((prev) => ({ ...prev, topicTag: event.target.value }))}
                      placeholder="e.g. Digital Modulation"
                      className="h-10 rounded-xl border-[#eadfcd] bg-white"
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Question</p>
                  <div className="overflow-hidden rounded-2xl border-2 border-[#eadfcd] bg-white transition focus-within:border-orange-400">
                    <RichQuestionEditor
                      key={`question-${currentFocusedQuestion?.id ?? `new-${chapter.id}`}`}
                      ariaLabel="Question"
                      value={currentFocusedEditor.question}
                      onChange={(question) => updateFocusedEditor((prev) => ({ ...prev, question }))}
                      placeholder="Type your question here..."
                      className="rounded-none border-0 bg-white"
                    />
                    <div className="flex items-center gap-2 border-t border-[#eadfcd] bg-[#fff9ef] px-3 py-2">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          void optimizeImageToDataUrl(file, { maxWidth: 1800, maxHeight: 1800, quality: 0.82 }).then((dataUrl) => {
                            updateFocusedEditor((prev) => ({ ...prev, imageData: dataUrl }));
                          });
                          event.currentTarget.value = "";
                        }}
                      />
                      {currentFocusedEditor.imageData ? (
                        <div className="relative inline-flex overflow-hidden rounded-xl border border-[#eadfcd] bg-white p-2">
                          <img src={currentFocusedEditor.imageData} alt="Question visual" className="max-h-20 rounded-lg object-contain" />
                          <button
                            type="button"
                            onClick={() => updateFocusedEditor((prev) => ({ ...prev, imageData: null }))}
                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={(event) => {
                          const input = event.currentTarget.parentElement?.querySelector("input[type='file']") as HTMLInputElement | null;
                          input?.click();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-orange-50 hover:text-orange-600"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        {currentFocusedEditor.imageData ? "Replace image" : "Add image"}
                      </button>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          const files = Array.from(event.target.files ?? []);
                          if (!files.length) return;
                          void optimizeEditorImages(files, { maxWidth: 1800, maxHeight: 1800 }).then((images) => {
                            updateFocusedEditor((prev) => ({ ...prev, question: appendEditorImages(prev.question, images) }));
                          });
                          event.currentTarget.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          const inputs = event.currentTarget.parentElement?.querySelectorAll("input[type='file']");
                          (inputs?.[1] as HTMLInputElement | undefined)?.click();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-orange-600 transition hover:bg-orange-50"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        Add multiple images
                      </button>
                    </div>
                  </div>
                </div>

                {(currentFocusedEditor.questionType === "mcq" || currentFocusedEditor.questionType === "multi") ? (
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Options</p>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-500">
                          {currentFocusedEditor.questionType === "mcq" ? "Click letter to mark correct" : "Select all correct answers"}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateFocusedEditor((prev) => ({ ...prev, options: [...prev.options, ""], optionImages: [...prev.optionImages, null] }))}
                          className="rounded-md px-2 py-1 text-[11px] font-semibold text-orange-600 transition hover:bg-orange-50"
                        >
                          Add Option
                        </button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {currentFocusedEditor.options.map((option, index) => {
                        const isCorrect = currentFocusedEditor.questionType === "multi"
                          ? currentFocusedEditor.correctAnswerMulti.includes(index)
                          : currentFocusedEditor.correctAnswer === index;
                        const optionImage = currentFocusedEditor.optionImages[index];

                        return (
                          <div key={index} className="flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                if (currentFocusedEditor.questionType === "mcq") {
                                  updateFocusedEditor((prev) => ({ ...prev, correctAnswer: index }));
                                  return;
                                }
                                updateFocusedEditor((prev) => ({
                                  ...prev,
                                  correctAnswerMulti: prev.correctAnswerMulti.includes(index)
                                    ? prev.correctAnswerMulti.filter((value) => value !== index)
                                    : [...prev.correctAnswerMulti, index],
                                }));
                              }}
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold transition ${isCorrect ? `${QUESTION_BANK_OPTION_BADGE_STYLES[index % QUESTION_BANK_OPTION_BADGE_STYLES.length]} border-transparent text-white shadow-md` : "border-[#eadfcd] bg-white text-slate-500 hover:border-orange-300 hover:text-slate-900"}`}
                            >
                              {isCorrect ? <Check className="h-4 w-4" /> : String.fromCharCode(65 + index)}
                            </button>
                            <div className="relative min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-auto">
                              <RichQuestionEditor
                                key={`option-${currentFocusedQuestion?.id ?? `new-${chapter.id}`}-${index}`}
                                ariaLabel={`Option ${String.fromCharCode(65 + index)}`}
                                compact
                                value={option}
                                onChange={(html) => updateFocusedEditor((prev) => {
                                  const nextOptions = [...prev.options];
                                  nextOptions[index] = html;
                                  return { ...prev, options: nextOptions };
                                })}
                                placeholder={`Option ${String.fromCharCode(65 + index)}`}
                                className={`rounded-xl border-[#eadfcd] bg-white ${isCorrect ? "border-emerald-400 bg-emerald-50/40" : ""}`}
                              />
                              {isCorrect ? (
                                <span className="mt-1 block w-fit rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  Correct
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              {optionImage ? (
                                <div className="relative overflow-hidden rounded-lg border border-[#eadfcd] bg-white p-1.5">
                                  <img src={optionImage} alt="" className="h-10 w-10 rounded object-cover" />
                                  <button
                                    type="button"
                                    onClick={() => updateFocusedEditor((prev) => {
                                      const nextImages = [...prev.optionImages];
                                      nextImages[index] = null;
                                      return { ...prev, optionImages: nextImages };
                                    })}
                                    className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white"
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="relative">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(event) => {
                                      const file = event.target.files?.[0];
                                      if (!file) return;
                                      void optimizeImageToDataUrl(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 }).then((dataUrl) => {
                                        updateFocusedEditor((prev) => {
                                          const nextImages = [...prev.optionImages];
                                          nextImages[index] = dataUrl;
                                          return { ...prev, optionImages: nextImages };
                                        });
                                      });
                                      event.currentTarget.value = "";
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      const input = event.currentTarget.parentElement?.querySelector("input[type='file']") as HTMLInputElement | null;
                                      input?.click();
                                    }}
                                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-[#d7c7b0] text-slate-400 transition hover:border-orange-300 hover:text-orange-600"
                                  >
                                    <ImagePlus className="h-4 w-4" />
                                  </button>
                                </div>
                              )}
                              <div className="relative">
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  className="hidden"
                                  onChange={(event) => {
                                    const files = Array.from(event.target.files ?? []);
                                    if (!files.length) return;
                                    void optimizeEditorImages(files, { maxWidth: 1200, maxHeight: 1200 }).then((images) => {
                                      updateFocusedEditor((prev) => {
                                        const nextOptions = [...prev.options];
                                        nextOptions[index] = appendEditorImages(nextOptions[index] ?? "", images);
                                        return { ...prev, options: nextOptions };
                                      });
                                    });
                                    event.currentTarget.value = "";
                                  }}
                                />
                                <button
                                  type="button"
                                  title="Add multiple images to this option"
                                  onClick={(event) => {
                                    const input = event.currentTarget.parentElement?.querySelector("input[type='file']") as HTMLInputElement | null;
                                    input?.click();
                                  }}
                                  className="flex h-10 items-center gap-1 rounded-lg border border-dashed border-[#d7c7b0] px-2 text-[10px] font-semibold text-slate-400 transition hover:border-orange-300 hover:text-orange-600"
                                >
                                  <ImagePlus className="h-3.5 w-3.5" />
                                  Multiple
                                </button>
                              </div>
                              {currentFocusedEditor.options.length > 2 ? (
                                <button
                                  type="button"
                                  onClick={() => updateFocusedEditor((prev) => {
                                    const nextOptions = prev.options.filter((_, optionIndex) => optionIndex !== index);
                                    const nextImages = prev.optionImages.filter((_, optionIndex) => optionIndex !== index);
                                    const nextCorrectAnswer = prev.correctAnswer > index ? prev.correctAnswer - 1 : prev.correctAnswer;
                                    const nextCorrectAnswerMulti = prev.correctAnswerMulti
                                      .filter((value) => value !== index)
                                      .map((value) => (value > index ? value - 1 : value));
                                    return {
                                      ...prev,
                                      options: nextOptions,
                                      optionImages: nextImages,
                                      correctAnswer: Math.min(nextCorrectAnswer, Math.max(nextOptions.length - 1, 0)),
                                      correctAnswerMulti: nextCorrectAnswerMulti,
                                    };
                                  })}
                                  className="rounded-md px-2 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Correct Answer</p>
                    <div className="rounded-2xl border-2 border-[#eadfcd] bg-white p-6">
                      <div className="mb-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => updateFocusedEditor((prev) => ({ ...prev, integerMode: "exact" }))}
                          className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold transition ${currentFocusedEditor.integerMode === "exact" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-[#eadfcd] bg-white text-slate-500"}`}
                        >
                          Exact Answer
                        </button>
                        <button
                          type="button"
                          onClick={() => updateFocusedEditor((prev) => ({ ...prev, integerMode: "range" }))}
                          className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold transition ${currentFocusedEditor.integerMode === "range" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-[#eadfcd] bg-white text-slate-500"}`}
                        >
                          Answer Range
                        </button>
                      </div>
                      {currentFocusedEditor.integerMode === "exact" ? (
                        <Input
                          type="number"
                          step="any"
                          value={currentFocusedEditor.correctAnswerInt}
                          onChange={(event) => updateFocusedEditor((prev) => ({ ...prev, correctAnswerInt: event.target.value }))}
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
                              value={currentFocusedEditor.correctAnswerMin}
                              onChange={(event) => updateFocusedEditor((prev) => ({ ...prev, correctAnswerMin: event.target.value }))}
                              className="h-11 rounded-xl border-[#eadfcd] bg-white"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Maximum</Label>
                            <Input
                              type="number"
                              step="any"
                              value={currentFocusedEditor.correctAnswerMax}
                              onChange={(event) => updateFocusedEditor((prev) => ({ ...prev, correctAnswerMax: event.target.value }))}
                              className="h-11 rounded-xl border-[#eadfcd] bg-white"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Teacher Solution</p>
                  <div className="rounded-2xl border-2 border-[#eadfcd] bg-white p-4">
                    <RichQuestionEditor
                      key={`solution-${currentFocusedQuestion?.id ?? `new-${chapter.id}`}`}
                      ariaLabel="Teacher solution"
                      value={currentFocusedEditor.explanation}
                      onChange={(explanation) => updateFocusedEditor((prev) => ({ ...prev, explanation }))}
                      placeholder="Add solution steps or explanation..."
                      className="border-0 bg-white"
                    />
                    <div className="mt-3 flex items-center gap-2 border-t border-[#eadfcd] pt-3">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          const files = Array.from(event.target.files ?? []);
                          if (!files.length) return;
                          void optimizeEditorImages(files, { maxWidth: 1800, maxHeight: 1800 }).then((images) => {
                            updateFocusedEditor((prev) => ({ ...prev, explanation: appendEditorImages(prev.explanation, images) }));
                          });
                          event.currentTarget.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          const input = event.currentTarget.parentElement?.querySelector("input[type='file']") as HTMLInputElement | null;
                          input?.click();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-orange-600 transition hover:bg-orange-50"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        Add solution images
                      </button>
                      <span className="text-[11px] text-slate-400">Select multiple files together</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {!showFocusedEmptyState ? (
            <div className="shrink-0 border-t border-[#eadfcd] bg-white px-6 py-3">
              <div className="flex items-center justify-between gap-6">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-[#eadfcd] bg-[#fff9ef] px-3 py-1">
                    Q{String(selectedFocusedSlotNumber).padStart(2, "0")}
                  </span>
                  <span className="rounded-full border border-[#eadfcd] bg-[#fff9ef] px-3 py-1">
                    {currentFocusedEditor.points || "1"} point{currentFocusedEditor.points === "1" ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {currentFocusedQuestion ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg border-rose-200 bg-white px-3 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => {
                        if (confirm("Delete this question?")) {
                          deleteQuestionMutation.mutate(currentFocusedQuestion.id);
                        }
                      }}
                      disabled={deleteQuestionMutation.isPending}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg border-[#eadfcd] bg-white px-3"
                      onClick={() => {
                        setIsAddingFocusedQuestion(false);
                        setFocusedAddSubjectName(activeSubject?.title ?? "");
                        setFocusedAddChapterName(chapter.title);
                        setChapterEditor(chapter.id, () => emptyEditor());
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg border-[#eadfcd] bg-white px-3"
                    onClick={() => {
                      if (!previousFocusedQuestion) return;
                      openFocusedQuestion(previousFocusedQuestion.id);
                    }}
                    disabled={!previousFocusedQuestion}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg border-[#eadfcd] bg-white px-3"
                    onClick={() => {
                      if (!nextFocusedQuestion) return;
                      openFocusedQuestion(nextFocusedQuestion.id);
                    }}
                    disabled={!nextFocusedQuestion}
                  >
                    Next
                  </Button>
                  <Button
                    type="button"
                    className="h-9 rounded-lg bg-[#17253d] px-4 text-white hover:bg-[#101b2e]"
                    onClick={() => {
                      if (currentFocusedQuestion) {
                        updateQuestionMutation.mutate({ questionId: currentFocusedQuestion.id, payload: buildPayload(currentFocusedEditor) });
                        return;
                      }
                      addQuestionMutation.mutate({ chapterId: chapter.id, payload: buildPayload(currentFocusedEditor) });
                    }}
                    disabled={!canSaveEditor(currentFocusedEditor) || addQuestionMutation.isPending || updateQuestionMutation.isPending}
                  >
                    <Save className="mr-1.5 h-4 w-4" />
                    {currentFocusedQuestion
                      ? (updateQuestionMutation.isPending ? "Saving..." : "Save Changes")
                      : (addQuestionMutation.isPending ? "Saving..." : "Save Question")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {focusedViewMode === "all" ? (
            <div className="mx-auto w-full max-w-4xl px-6 py-6 pb-24">
              <div className="rounded-2xl border border-[#eadfcd] bg-white p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Chapter Review</p>
                    <h2 className="mt-1 text-xl font-extrabold text-slate-900">{chapter.title}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {chapterQuestions.length} question{chapterQuestions.length === 1 ? "" : "s"} visible in this chapter
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg border-[#eadfcd] bg-white"
                    onClick={() => {
                      if (!activeChapter?.id) return;
                      setFocusedViewMode("single");
                      setIsAddingFocusedQuestion(true);
                      setEditingQuestionId(null);
                      setFocusedAddSubjectName(activeSubject?.title ?? "");
                      setFocusedAddChapterName(activeChapter.title);
                      setChapterEditor(activeChapter.id, () => emptyEditor());
                    }}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add Question
                  </Button>
                </div>
              </div>

              {chapterQuestions.length === 0 ? (
                <div className="mt-5 rounded-2xl border-2 border-dashed border-[#eadfcd] bg-white px-6 py-12 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
                    <FileText className="h-7 w-7" />
                  </div>
                  <p className="mt-4 text-lg font-semibold text-slate-900">No questions in this chapter yet</p>
                  <p className="mt-1 text-sm text-slate-500">Add the first question to start building this chapter.</p>
                </div>
              ) : (
                <div className="mt-5 space-y-5">
                  {chapterQuestions.map((question, questionIndex) => {
                    const questionNumber = activeChapterQuestionNumberById.get(question.id) ?? chapter.questions.findIndex((entry) => entry.id === question.id) + 1;
                    const openReports = (question.reports ?? []).filter((report) => report.status === "open");
                    const startsStarterSection = isStarterQuestion(question) && (questionIndex === 0 || !isStarterQuestion(chapterQuestions[questionIndex - 1]));

                    return (
                      <div key={question.id} className="rounded-2xl border border-[#eadfcd] bg-white p-5 shadow-[0_16px_32px_rgba(15,23,42,0.04)]">
                        {startsStarterSection ? <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-800">Starter Questions</div> : null}
                        <div className="flex items-start gap-3">
                          <span className="chip-orange-soft rounded-full px-3 py-1 text-xs font-bold">
                            Q{questionNumber}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${question.questionType === "multi" ? "bg-violet-100 text-violet-700" : question.questionType === "integer" ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700"}`}>
                                {question.questionType === "mcq" ? "MCQ Single" : question.questionType === "multi" ? "Multi-select" : "Integer"}
                              </span>
                              <Badge variant="outline">{formatQuestionBankDifficulty(question.difficulty)}</Badge>
                              <Badge variant="secondary">{question.points} pts</Badge>
                              {question.topicTag?.trim() ? (
                                <Badge variant="secondary">{question.topicTag.trim()}</Badge>
                              ) : (
                                <Badge variant="outline" className="text-muted-foreground">No topic</Badge>
                              )}
                              {openReports.length > 0 ? (
                                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                  {openReports.length} report{openReports.length === 1 ? "" : "s"}
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
                                <span className="text-xs text-slate-500">Answer:</span>
                                <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">
                                  {question.correctAnswerMin != null && question.correctAnswerMax != null
                                    ? `${question.correctAnswerMin} - ${question.correctAnswerMax}`
                                    : question.correctAnswer}
                                </span>
                              </div>
                            ) : (
                              <div className="mt-4 grid gap-2 md:grid-cols-2">
                                {question.options.map((option, optionIndex) => {
                                  const isCorrect = question.questionType === "multi"
                                    ? question.correctAnswerMulti.includes(optionIndex)
                                    : question.correctAnswer === optionIndex;
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

                            {question.explanation ? (
                              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Explanation</p>
                                <RichQuestionContent content={question.explanation} className="mt-2 text-sm leading-6 text-slate-700" />
                              </div>
                            ) : null}
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setFocusedViewMode("single");
                                openFocusedQuestion(question.id);
                              }}
                            >
                              <Pencil size={13} className="mr-1" /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm("Delete this question?")) deleteQuestionMutation.mutate(question.id);
                              }}
                            >
                              <Trash2 size={13} className="mr-1" /> Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {chapterQuestions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground text-center">
            No questions have been added to this chapter yet.
          </div>
        ) : activeVisibleQuestion ? (
          <>
            <div
              key={activeVisibleQuestion.id}
              ref={(node) => {
                focusedQuestionCardRefs.current[activeVisibleQuestion.id] = node;
              }}
              className={`rounded-lg border p-3 transition ${isFocusedWorkspace && activeFocusedQuestionId === activeVisibleQuestion.id ? "border-[#f97316] bg-[#fffaf3] shadow-[0_10px_30px_rgba(249,115,22,0.08)]" : "border-border bg-white"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="chip-orange-soft border-none">
                      Q{activeVisibleQuestionNumber > 0 ? String(activeVisibleQuestionNumber).padStart(2, "0") : activeVisibleQuestion.id}
                    </Badge>
                    <Badge variant="outline" className="gap-1">{questionTypeIcon(activeVisibleQuestion.questionType)}{questionTypeLabel(activeVisibleQuestion.questionType)}</Badge>
                    <Badge variant="outline">{formatQuestionBankDifficulty(activeVisibleQuestion.difficulty)}</Badge>
                    <Badge variant="secondary">{activeVisibleQuestion.points} pts</Badge>
                    <Badge variant="outline">{chapter.title}</Badge>
                    {activeVisibleQuestion.topicTag?.trim() ? (
                      <Badge variant="secondary">{activeVisibleQuestion.topicTag.trim()}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">No topic</Badge>
                    )}
                    {activeVisibleQuestion.openReportCount > 0 && <Badge variant="destructive">{activeVisibleQuestion.openReportCount} open report</Badge>}
                  </div>
                  <RichQuestionContent
                    content={activeVisibleQuestion.question}
                    className="max-w-full text-sm font-medium leading-7 text-slate-900"
                  />
                  {activeVisibleQuestion.imageData && <img src={activeVisibleQuestion.imageData} alt="Question" className="max-h-52 rounded-lg border border-border object-contain bg-black/10 p-2" />}
                  {activeVisibleQuestion.questionType !== "integer" && activeVisibleQuestion.options.length > 0 && (
                    <div className="grid gap-2 md:grid-cols-2">
                      {activeVisibleQuestion.options.map((option, index) => {
                        const isCorrect = activeVisibleQuestion.questionType === "multi"
                          ? activeVisibleQuestion.correctAnswerMulti.includes(index)
                          : activeVisibleQuestion.correctAnswer === index;
                        return (
                          <div key={index} className={`rounded-md border px-3 py-2 text-sm ${isCorrect ? "border-green-500 bg-green-50 dark:bg-green-950/20" : "border-border"}`}>
                            <div className="flex min-w-0 gap-2">
                              <span className="shrink-0 font-medium">{String.fromCharCode(65 + index)}.</span>
                              <RichQuestionContent content={option} className="min-w-0 flex-1 leading-6 text-slate-800" />
                            </div>
                            {activeVisibleQuestion.optionImages?.[index] && <img src={activeVisibleQuestion.optionImages[index] ?? ""} alt={`Option ${index + 1}`} className="mt-2 max-h-28 rounded border border-border object-contain bg-black/10 p-1.5" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {activeVisibleQuestion.questionType === "integer" && (
                    <p className="text-xs text-muted-foreground">
                      Answer: {activeVisibleQuestion.correctAnswerMin !== null && activeVisibleQuestion.correctAnswerMin !== undefined
                        ? `${activeVisibleQuestion.correctAnswerMin} to ${activeVisibleQuestion.correctAnswerMax}`
                        : activeVisibleQuestion.correctAnswer}
                    </p>
                  )}
                  {activeVisibleQuestion.explanation && (
                    <RichQuestionContent
                      content={activeVisibleQuestion.explanation}
                      className="max-w-full text-xs leading-6 text-muted-foreground"
                    />
                  )}
                  {(activeVisibleQuestion.reports ?? []).length > 0 && (
                    <div className="space-y-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 p-3">
                      {(activeVisibleQuestion.reports ?? []).map((report) => (
                        <div key={report.id} className="text-xs">
                          <span className="font-medium">{report.reporterName}</span>: {report.reason || "Reported issue"}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {availableMoveChapters.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        value={moveTargetByQuestion[activeVisibleQuestion.id] ?? ""}
                        onChange={(event) => setMoveTargetByQuestion((prev) => ({ ...prev, [activeVisibleQuestion.id]: event.target.value }))}
                        className="h-9 min-w-[170px] rounded-md border border-input bg-background px-3 text-xs"
                      >
                        <option value="">Move to chapter</option>
                        {availableMoveChapters.map((chapterOption) => (
                          <option key={chapterOption.id} value={String(chapterOption.id)}>
                            {chapterOption.title}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!moveTargetByQuestion[activeVisibleQuestion.id] || moveQuestionMutation.isPending}
                        onClick={() => moveQuestionMutation.mutate({ questionId: activeVisibleQuestion.id, chapterId: Number(moveTargetByQuestion[activeVisibleQuestion.id]) })}
                      >
                        <ArrowRightLeft size={13} className="mr-1" />
                        Move
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => {
                      setActiveFocusedQuestionId(activeVisibleQuestion.id);
                      setEditingQuestionId(activeVisibleQuestion.id);
                      setEditingState(editorFromQuestion(activeVisibleQuestion));
                    }}>
                      <Hash size={13} className="mr-1" /> {activeVisibleQuestion.topicTag?.trim() ? "Edit Topic" : "Add Topic"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setActiveFocusedQuestionId(activeVisibleQuestion.id);
                      setEditingQuestionId(activeVisibleQuestion.id);
                      setEditingState(editorFromQuestion(activeVisibleQuestion));
                    }}>
                      <Pencil size={13} className="mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => {
                      if (confirm("Delete this question?")) deleteQuestionMutation.mutate(activeVisibleQuestion.id);
                    }}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              </div>

              {editingQuestionId === activeVisibleQuestion.id && (
                <div className="mt-3">
                  {renderEditor(
                    editingState,
                    (updater) => setEditingState((prev) => updater(prev)),
                    <>
                      <Button size="sm" onClick={() => updateQuestionMutation.mutate({ questionId: activeVisibleQuestion.id, payload: buildPayload(editingState) })} disabled={updateQuestionMutation.isPending}>
                        <Save size={13} className="mr-1" />
                        {updateQuestionMutation.isPending ? "Saving..." : "Save Question"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingQuestionId(null)}>Cancel</Button>
                    </>,
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}

        {showFocusedAddComposer ? (
          <div className="rounded-lg border border-[#eadfcd] bg-white p-3 shadow-[0_10px_30px_rgba(249,115,22,0.06)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <Plus size={14} className="text-primary" />
                Add Question
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAddingFocusedQuestion(false);
                  setFocusedAddSubjectName(activeSubject?.title ?? "");
                  setFocusedAddChapterName(chapter.title);
                  setChapterEditor(chapter.id, () => emptyEditor());
                }}
              >
                Cancel
              </Button>
            </div>
            {renderEditor(
              chapterEditor,
              (updater) => setChapterEditor(chapter.id, updater),
              <Button size="sm" onClick={() => addQuestionMutation.mutate({ chapterId: chapter.id, payload: buildPayload(chapterEditor) })} disabled={addQuestionMutation.isPending}>
                <Save size={13} className="mr-1" />
                {addQuestionMutation.isPending ? "Saving..." : "Save Question"}
              </Button>,
            )}
          </div>
        ) : null}

        <div className="pt-2 border-t border-dashed border-border">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Plus size={14} className="text-primary" /> Add question in test format
          </div>
          {renderEditor(
            chapterEditor,
            (updater) => setChapterEditor(chapter.id, updater),
            <Button size="sm" onClick={() => addQuestionMutation.mutate({ chapterId: chapter.id, payload: buildPayload(chapterEditor) })} disabled={addQuestionMutation.isPending}>
              <Save size={13} className="mr-1" />
              {addQuestionMutation.isPending ? "Saving..." : "Save Question"}
            </Button>,
          )}
        </div>
      </div>
    );
  };

  const renderReportedQueue = (compact = false) => <ReportedQuestionQueue
    reports={reports} selectedId={focusedQuestionId} onSelect={openReportedQuestion}
    loading={reportsLoading || Boolean(hasMoreReports) || isFetchingMoreReports}
    failed={reportsError} onRetry={() => void (hasMoreReports ? fetchMoreReports() : refetchReports())} compact={compact}
  />;

  if (isFocusedWorkspace) {
    if (isLoading || examCardsLoading) {
      return <BuilderLoadingScreen />;
    }

    return (
      <div className="question-bank-focused-workspace super-admin-theme flex h-[100dvh] flex-col overflow-x-hidden overflow-y-scroll overscroll-contain bg-[#fffaf2] text-slate-900" style={{ fontFamily: "\"Plus Jakarta Sans\", sans-serif" }}>
        <div className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-3 border-b border-[#eadfcd] bg-white px-4 py-2">
          <button
            type="button"
            onClick={() => setLocation("/admin/question-bank")}
            className="group flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4 transition group-hover:-translate-x-0.5" />
            Back
          </button>
          <span className="h-4 w-px bg-[#e7dbca]" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-sm font-extrabold text-slate-900">{isReportWorkspace ? "Reported Question Workspace" : activeChapter?.title ?? "Question Studio"}</h1>
              <span className="rounded-full border border-[#eadfcd] bg-[#fff9ef] px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {activeQuestionBank?.exam.label ?? focusedExamKey}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {activeSubject?.title ?? "Assigned subject"} · {isReportWorkspace ? activeChapter?.title ?? "Reported questions only" : activeChapter ? `${activeChapterUploaded} uploaded / ${activeChapterTarget} target` : "Question bank builder"}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f1e0be] bg-[#fff7ea] px-2.5 py-1 text-[10px] font-semibold text-[#9a5b15]">
              <FileQuestion className="h-3.5 w-3.5" />
              Question Builder
            </span>
            <div className="flex items-center rounded-lg border border-[#e7dbca] bg-[#fff6e8] p-0.5">
              <button
                type="button"
                onClick={() => setFocusedViewMode("single")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${focusedViewMode === "single" ? "border border-[#e7dbca] bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
              >
                <PenLine className="h-3.5 w-3.5" />
                Single
              </button>
              {focusedQuestionId == null || isReportWorkspace ? (
                <button
                  type="button"
                  onClick={() => setFocusedViewMode("all")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${focusedViewMode === "all" ? "border border-[#e7dbca] bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
                >
                  <List className="h-3.5 w-3.5" />
                  {isReportWorkspace ? "All Reported" : "All Questions"}
                </button>
              ) : null}
            </div>
            {showChapterTargetMeta ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
                <Target className="h-3.5 w-3.5" />
                {activeChapterPending} pending
              </span>
            ) : null}
            {showChapterTargetMeta && activeDeadlineLabel ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e7dbca] bg-[#fffaf1] px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                <CalendarClock className="h-3.5 w-3.5" />
                Due {activeDeadlineLabel}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
              <Gauge className="h-3.5 w-3.5" />
              {activeChapterProgress}% complete
            </span>
          </div>
        </div>

        <div className="flex min-h-[calc(100dvh-3.5rem)] flex-none flex-col items-start lg:flex-row">
          <div className="w-full min-w-0 flex-1">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6 lg:pr-80">
              {!isReportWorkspace && activeChapterOpenReports.length > 0 ? (
                <div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-[0_16px_32px_rgba(15,23,42,0.04)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-500">Open Reports</p>
                      <p className="mt-1 text-sm text-slate-500">Student-reported issues only for this chapter.</p>
                    </div>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                      {activeChapterOpenReports.length} open
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {activeChapterOpenReports.slice(0, 4).map((report) => (
                      <div key={report.id} className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3">
                        <p className="text-sm font-semibold text-slate-900">{report.questionText}</p>
                        <p className="mt-1 text-xs text-slate-500">Reported by {report.reporterName}</p>
                        {report.reason ? <p className="mt-2 text-sm leading-6 text-slate-600">{report.reason}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                {isReportWorkspace && focusedViewMode === "all" ? renderReportedQueue() : isReportWorkspace && !reportsLoading && !hasMoreReports && !reportsError && !reports.some(report => report.questionId === focusedQuestionId) ? (
                  <div className="rounded-xl border border-border bg-card p-6 text-card-foreground">
                    <p className="font-semibold">{reports.length ? "This question no longer has open reports." : "Report queue clear."}</p>
                    <p className="mt-2 text-sm text-muted-foreground">{reports.length ? "Select another reported question from the queue." : "All reported questions have been reviewed."}</p>
                  </div>
                ) : activeChapter ? (
                  renderChapterWorkspace(activeChapter)
                ) : (
                  <div className="rounded-2xl border border-dashed border-[#E5E7EB] bg-white py-10 text-center text-sm text-muted-foreground">
                    Selected chapter could not be found in this question bank.
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="flex h-fit w-full shrink-0 flex-col border-l border-[#eadfcd] bg-[#fff7ea] lg:fixed lg:right-0 lg:top-14 lg:z-10 lg:h-[calc(100dvh-3.5rem)] lg:w-80 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:overscroll-contain">
            {isReportWorkspace ? <div className="p-4">{renderReportedQueue(true)}</div> : <>
            <div className="border-b border-[#eadfcd] px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold text-slate-900">Chapter Workspace</span>
                <span>{activeChapterUploaded}/{activeChapterTarget || activeChapterUploaded} saved</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#efe4d2]">
                <div className="h-full rounded-full bg-[#f97316] transition-all" style={{ width: `${activeChapterProgress}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-md border border-[#eadfcd] bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  {activeSubject?.title ?? "Subject"}
                </span>
                <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  {activeChapterPending} pending
                </span>
                {activeDeadlineLabel ? (
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    Due {activeDeadlineLabel}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="p-4">
              <div className="rounded-2xl border border-[#eadfcd] bg-white">
                <button
                  type="button"
                  onClick={() => setFocusedFiltersOpen((previous) => !previous)}
                  className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold text-slate-500 transition hover:text-slate-900"
                >
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span>Question Filters</span>
                    {focusedActiveFiltersCount > 0 ? (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#f97316] text-[10px] font-bold text-white">
                        {focusedActiveFiltersCount}
                      </span>
                    ) : null}
                  </div>
                  {focusedFiltersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>

                {focusedFiltersOpen ? (
                  <div className="space-y-3 border-t border-[#eadfcd] px-4 pb-4 pt-3">
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Marks</p>
                      <div className="flex flex-wrap gap-1.5">
                        <BuilderFilterChip active={focusedMarksFilter === "all"} label="All" onClick={() => setFocusedMarksFilter("all")} tone="orange" />
                        {focusedAvailableMarks.map((value) => (
                          <BuilderFilterChip
                            key={value}
                            active={focusedMarksFilter === value}
                            label={`${value} mark${value === "1" ? "" : "s"}`}
                            onClick={() => setFocusedMarksFilter(value)}
                            tone="orange"
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Difficulty</p>
                      <div className="flex flex-wrap gap-1.5">
                        <BuilderFilterChip active={focusedDifficultyFilter === "all"} label="All" onClick={() => setFocusedDifficultyFilter("all")} tone="orange" />
                        {focusedAvailableDifficulties.map((value) => (
                          <BuilderFilterChip
                            key={value}
                            active={focusedDifficultyFilter === value}
                            label={formatQuestionBankDifficulty(value)}
                            onClick={() => setFocusedDifficultyFilter(value)}
                            tone={value === "starter" ? "violet" : value}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Question Type</p>
                      <div className="flex flex-wrap gap-1.5">
                        <BuilderFilterChip active={focusedQuestionTypeFilter === "all"} label="All" onClick={() => setFocusedQuestionTypeFilter("all")} tone="violet" />
                        {focusedAvailableQuestionTypes.map((value) => (
                          <BuilderFilterChip
                            key={value}
                            active={focusedQuestionTypeFilter === value}
                            label={value === "mcq" ? "MCQ Single" : value === "multi" ? "Multi-select" : "Integer"}
                            onClick={() => setFocusedQuestionTypeFilter(value)}
                            tone="violet"
                          />
                        ))}
                      </div>
                    </div>

                    {focusedActiveFiltersCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFocusedMarksFilter("all");
                          setFocusedDifficultyFilter("all");
                          setFocusedQuestionTypeFilter("all");
                        }}
                        className="text-[10px] text-slate-400 underline underline-offset-2 transition hover:text-rose-500"
                      >
                        Clear all filters
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="mt-5 rounded-2xl border border-[#eadfcd] bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Questions</span>
                  {focusedActiveFiltersCount > 0 ? (
                    <span className="text-[10px] text-orange-600">{focusedFilteredChapterQuestions.length} matched</span>
                  ) : null}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {focusedVisibleQuestions.map(({ question, slot }) => {
                    const isActive = activeFocusedQuestionId === question.id;
                    const openReportCount = Number(question.openReportCount ?? 0) || 0;

                    return (
                      <button
                        key={question.id}
                        type="button"
                        onClick={() => openFocusedQuestion(question.id)}
                        className={`relative flex h-9 items-center justify-center rounded-md border text-[11px] font-semibold transition ${
                          isActive
                            ? "border-[#f97316] bg-[#f97316] text-white shadow-sm"
                            : "border-[#d9ccb7] bg-white text-slate-700 hover:border-orange-300 hover:bg-orange-50"
                        }`}
                      >
                        {slot}
                        <span className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-white ${getFocusedQuestionDotClass(question)}`} />
                        {openReportCount > 0 ? (
                          <span className="absolute bottom-0.5 right-0.5 flex min-h-[14px] min-w-[14px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                            {openReportCount}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeChapter?.id) return;
                      setIsAddingFocusedQuestion(true);
                      setEditingQuestionId(null);
                      setFocusedAddSubjectName(activeSubject?.title ?? "");
                      setFocusedAddChapterName(activeChapter.title);
                      setChapterEditor(activeChapter.id, () => emptyEditor());
                    }}
                    className={`relative flex h-9 items-center justify-center rounded-md border text-[11px] font-semibold transition ${
                      isAddingFocusedQuestion
                        ? "border-[#f97316] bg-orange-50 text-[#f97316] shadow-sm"
                        : "border-[#d9ccb7] bg-white text-slate-500 hover:border-orange-300 hover:bg-orange-50 hover:text-[#f97316]"
                    }`}
                    aria-label="Add question"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {focusedActiveFiltersCount > 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    {`Showing only ${focusedFilteredChapterQuestions.length} question${focusedFilteredChapterQuestions.length === 1 ? "" : "s"} that match the current filters.`}
                  </p>
                ) : null}
              </div>

              {activeChapterStats.topics.length > 0 ? (
                <div className="mt-5 rounded-2xl border border-[#eadfcd] bg-white p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Topic Tags</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeChapterStats.topics.map((topic) => (
                      <Badge key={topic} variant="secondary">{topic}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeChapterOpenReports.length > 0 ? (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-500" />
                    <p className="text-sm font-semibold text-slate-900">Reports Preview</p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {activeChapterOpenReports.slice(0, 3).map((report) => (
                      <div key={report.id} className="rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2">
                        <p className="text-xs font-semibold text-slate-900">{report.questionText}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{report.reporterName}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            </>}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16" style={{ fontFamily: "\"Plus Jakarta Sans\", Inter, sans-serif" }}>
      <Card className="overflow-hidden border-none bg-[#102147] text-white shadow-[0_24px_60px_rgba(15,23,42,0.18)] hover:shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
        <CardContent className="p-0">
          <div className="grid gap-6 p-6 md:grid-cols-[1.4fr_0.8fr] md:p-8">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="border-none bg-[#f97316] text-white hover:bg-[#f97316]">Teacher Workspace</Badge>
                <span className="text-sm text-white/70">Question bank content management</span>
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
                  Welcome back, {teacherName.split(" ")[1] ?? teacherName}
                </h1>
                <p className="mt-2 max-w-2xl text-white/70">
                  Manage assigned chapters, write question sets, track your own progress, and complete daily targets.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wider text-white/60">Assigned target</p>
                  <p className="mt-2 text-2xl font-bold">{teacherTotals.target.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wider text-white/60">Uploaded</p>
                  <p className="mt-2 text-2xl font-bold text-[#FDBA74]">{teacherTotals.uploaded.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wider text-white/60">Completion</p>
                  <p className="mt-2 text-2xl font-bold">{teacherTotals.progress}%</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12 border border-white/20">
                  <AvatarFallback className="bg-[#f97316] font-semibold text-white">
                    {teacherInitials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">{teacherName}</p>
                  <p className="text-sm text-white/60">{teacherEmail}</p>
                </div>
              </div>
              <div className="mt-6 space-y-4">
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-white/70">Weekly upload goal</span>
                    <span className="font-semibold">
                      {activeSubjectStats.uploaded} / {activeSubjectStats.target || teacherTotals.target}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[#f97316] transition-all"
                      style={{ width: `${getPercent(activeSubjectStats.uploaded, activeSubjectStats.target || teacherTotals.target)}%` }}
                    />
                  </div>
                </div>
                <Button
                  className="w-full gap-2 bg-[#f97316] text-white hover:bg-[#ea580c]"
                  onClick={() => document.getElementById("question-bank-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  <FileText className="h-4 w-4" />
                  Continue Writing Questions
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Assigned Subjects</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{assignedSubjects.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">Across {activeQuestionBank?.exam.label ?? "active exams"}</p>
          </CardContent>
        </Card>
        <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Chapters</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teacherChapters.length}</div>
            <p className="mt-1 text-xs text-[#f97316]">
              {pendingChapterCount} chapters still need uploads
            </p>
          </CardContent>
        </Card>
        <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Questions</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teacherTotals.pending.toLocaleString()}</div>
            <p className="mt-1 text-xs text-muted-foreground">Remaining from assigned target</p>
          </CardContent>
        </Card>
        <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed Sets</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-[#f97316]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedSets}</div>
            <p className="mt-1 flex items-center gap-1 text-xs text-[#f97316]">
              <CheckCircle2 className="h-3 w-3" /> Saved in your question bank
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen size={16} className="text-[#f97316]" />
            Exam Question Bank
          </CardTitle>
          <CardDescription>Choose the super-admin-assigned workspace you want to manage.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {examCardsLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />)}
            </div>
          ) : visibleExamCards.length === 0 ? (
            <div className="rounded-2xl border border-[#E5E7EB] py-10 text-center text-sm text-muted-foreground">
              No assigned question bank cards are available for this teacher yet.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {visibleExamCards.map((exam) => {
                const active = selectedExamKey === exam.key;
                return (
                  <button
                    key={exam.key}
                    type="button"
                    onClick={() => selectExamWorkspace(exam.key)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      active
                        ? "border-[#f97316] bg-[#FFF7ED] shadow-sm"
                        : "border-[#E5E7EB] bg-white hover:border-[#f97316]/40 hover:bg-[#FFF7ED]/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{exam.label}</p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Super-admin-assigned workspace</span>
                          <InfoTip content="Questions added here stay inside the super-admin-owned subject and chapter structure for this exam." />
                        </div>
                      </div>
                      <Badge className={active ? "chip-orange-solid border-none" : "chip-orange-soft border-none"}>
                        {active ? "Open" : "Exam"}
                      </Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2">
                        <p className="text-muted-foreground">Subjects</p>
                        <p className="mt-1 font-semibold text-foreground">{exam.subjectCount}</p>
                      </div>
                      <div className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2">
                        <p className="text-muted-foreground">Chapters</p>
                        <p className="mt-1 font-semibold text-foreground">{exam.chapterCount}</p>
                      </div>
                      <div className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2">
                        <p className="text-muted-foreground">Questions</p>
                        <p className="mt-1 font-semibold text-foreground">{exam.questionCount}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {!selectedExamKey ? (
        <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Choose an exam card to open its subject-wise question bank.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />)}
        </div>
      ) : !activeQuestionBank || assignedSubjects.length === 0 ? (
        <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No super-admin-defined subject cards are available for this exam yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
            <CardHeader className="flex flex-col gap-4 border-b border-[#E5E7EB] sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>My Assigned Subjects</CardTitle>
                <CardDescription>Select a subject to manage chapter-wise question upload targets.</CardDescription>
              </div>
              <Select value={activeSubject ? String(activeSubject.id) : undefined} onValueChange={(value) => setActiveSubjectId(Number(value))}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Choose subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjectSummaries.map((subject) => (
                    <SelectItem key={subject.id} value={String(subject.id)}>
                      {subject.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid gap-0 md:grid-cols-[280px_1fr]">
                <div className="border-b border-[#E5E7EB] p-4 md:border-b-0 md:border-r">
                  <div className="space-y-3">
                    {subjectSummaries.map((subject) => {
                      const isSelected = subject.id === activeSubject?.id;
                      const subjectTheme = getSubjectTheme(subject.title);
                      const subjectAccent = getSubjectAccent(subject.title);
                      return (
                        <button
                          key={subject.id}
                          type="button"
                          onClick={() => setActiveSubjectId(subject.id)}
                          className="w-full rounded-xl border bg-white p-3 text-left transition-all hover:bg-[#F8FAFC]"
                          style={{
                            borderColor: isSelected ? subjectAccent.border : "#E5E7EB",
                            backgroundColor: isSelected ? subjectTheme.softBg : "#FFFFFF",
                            boxShadow: isSelected ? `0 6px 20px ${subjectTheme.softBorder}` : undefined,
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
                              style={{
                                backgroundColor: subjectTheme.softBgStrong,
                                borderColor: subjectTheme.softBorder,
                                color: subjectTheme.color,
                              }}
                            >
                              <SubjectThemeIcon label={subject.title} className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{subject.title}</p>
                              <p className="text-xs text-muted-foreground">{subject.chapters.length} chapters</p>
                            </div>
                            <span className="text-xs font-semibold">{subject.progress}%</span>
                          </div>
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#E5E7EB]">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${subject.progress}%`, backgroundColor: subjectAccent.line }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="p-4">
                  <input
                    ref={subjectImportInputRef}
                    type="file"
                    accept={QUESTION_BANK_JSON_IMPORT_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (activeSubject) {
                        void handleSubjectImport(activeSubject, file);
                      }
                      e.currentTarget.value = "";
                    }}
                  />
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold">{activeSubject?.title} Upload Queue</h3>
                      <p className="text-sm text-muted-foreground">Prioritized chapters with JSON import for this subject.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex h-9 w-fit items-center rounded-full border border-[#FED7AA] bg-[#FFF7E8] px-3 text-xs font-bold text-[#B45309] shadow-[0_8px_18px_rgba(217,119,6,0.12)]">
                        {activeQuestionBank.exam.label}
                      </span>
                      {activeSubject ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 w-9 border-[#D1D5DB] p-0 hover:bg-[#FFF7ED]"
                            onClick={() => void handleSubjectExport(activeSubject)}
                            disabled={exportingSubjectId === activeSubject.id}
                            title={exportingSubjectId === activeSubject.id ? "Exporting subject" : "Export subject"}
                            aria-label={exportingSubjectId === activeSubject.id ? "Exporting subject" : "Export subject"}
                          >
                            <Download className={`h-4 w-4 ${exportingSubjectId === activeSubject.id ? "animate-pulse" : ""}`} />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 w-9 border-[#D1D5DB] p-0 hover:bg-[#FFF7ED]"
                            onClick={() => subjectImportInputRef.current?.click()}
                            disabled={importingSubjectId === activeSubject.id}
                            title={importingSubjectId === activeSubject.id ? "Importing subject" : "Import JSON"}
                            aria-label={importingSubjectId === activeSubject.id ? "Importing subject" : "Import JSON"}
                          >
                            <Upload className={`h-4 w-4 ${importingSubjectId === activeSubject.id ? "animate-pulse" : ""}`} />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Target</p>
                      <p className="mt-2 text-2xl font-bold">{activeSubjectStats.target}</p>
                    </div>
                    <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Uploaded</p>
                      <p className="mt-2 text-2xl font-bold text-[#f97316]">{activeSubjectStats.uploaded}</p>
                    </div>
                    <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Pending</p>
                      <p className="mt-2 text-2xl font-bold">{activeSubjectStats.pending}</p>
                    </div>
                  </div>

                  {chapterRows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#E5E7EB] px-4 py-10 text-center text-sm text-muted-foreground">
                      No chapter cards are available for this subject yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {chapterRows.map((chapter) => (
                        <div
                          key={chapter.id}
                          className="rounded-xl border border-[#E5E7EB] bg-white p-4 transition-colors hover:bg-[#F8FAFC]"
                        >
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,260px)_auto] lg:items-center">
                            <div className="flex min-w-0 gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6] font-semibold text-muted-foreground">
                                {chapter.chapterNumber}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="truncate font-semibold">{chapter.title}</h4>
                                  {chapter.urgency ? (
                                    <Badge variant={chapter.urgency === "High" ? "destructive" : "outline"}>
                                      {chapter.urgency}
                                    </Badge>
                                  ) : null}
                                </div>
                                {chapter.remaining != null || chapter.due ? (
                                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                                    {chapter.remaining != null ? (
                                      <span className="flex items-center gap-1">
                                        <Target className="h-3.5 w-3.5" />
                                        {chapter.remaining} pending
                                      </span>
                                    ) : null}
                                    {chapter.due ? (
                                      <span className="flex items-center gap-1">
                                        <CalendarClock className="h-3.5 w-3.5" />
                                        Due {chapter.due}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="w-full lg:justify-self-stretch">
                              <div className="mb-1 flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Progress</span>
                                <span className="font-medium">{chapter.progress}%</span>
                              </div>
                              <div
                                className="h-2 overflow-hidden rounded-full"
                                style={{ backgroundColor: activeSubjectTheme.softBgStrong }}
                              >
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${chapter.progress}%`, backgroundColor: activeSubjectAccent.line }}
                                />
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-2 border-[#D1D5DB] hover:bg-[#FFF7ED] lg:justify-self-end"
                              onClick={() => setLocation(`/admin/question-bank/exam/${selectedExamKey}/subject/${activeSubject?.id ?? chapter.id}/chapter/${chapter.id}`)}
                            >
                              Work Now
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="border-[#E5E7EB] bg-white/95 xl:col-span-2 hover:shadow-sm">
              <CardHeader>
                <CardTitle>Daily Upload Pace</CardTitle>
                <CardDescription>Questions submitted across your active question bank workload.</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={dailyUploadData}>
                    <defs>
                      <linearGradient id="questionFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#ffffff",
                        border: "1px solid #E5E7EB",
                        borderRadius: "10px",
                        fontSize: "12px",
                      }}
                    />
                    <Area dataKey="questions" stroke="#f97316" strokeWidth={3} fill="url(#questionFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
              <CardHeader>
                <CardTitle>Question Mix</CardTitle>
                <CardDescription>Your current question bank difficulty balance.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {questionMixData.map((item) => {
                  const percent = questionMixTotal > 0 ? Math.round((item.value / questionMixTotal) * 100) : 0;
                  return (
                    <div key={item.label} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                          <span className="font-medium">{item.label}</span>
                        </div>
                        <span className="text-muted-foreground">{item.value} questions</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[#E5E7EB]">
                        <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, backgroundColor: item.color }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="border-[#E5E7EB] bg-white/95 xl:col-span-2 hover:shadow-sm">
              <CardHeader>
                <CardTitle>Today&apos;s Focus</CardTitle>
                <CardDescription>Suggested sequence to complete the teacher-side workload.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {todayFocus.map((item, index) => (
                  <div key={item.text} className="flex gap-3 rounded-xl bg-[#F8FAFC] p-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FFF7ED] text-[#f97316]">
                      <item.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Step {index + 1}</p>
                      <p className="text-sm text-muted-foreground">{item.text}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Question Bank Transfer</CardTitle>
                <CardDescription>Export the full exam workspace or import a JSON bundle back in.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <input
                  ref={examImportInputRef}
                  type="file"
                  accept={QUESTION_BANK_JSON_IMPORT_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    void handleExamImport(file);
                    e.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center border-[#D1D5DB] hover:bg-[#FFF7ED]"
                  onClick={() => void handleExamExport()}
                  disabled={exportingExamKey === selectedExamKey}
                >
                  <Download size={14} className="mr-2" />
                  {exportingExamKey === selectedExamKey ? "Exporting JSON..." : "Export JSON"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center border-[#D1D5DB] hover:bg-[#FFF7ED]"
                  onClick={() => void handleExamPdfExport()}
                  disabled={exportingExamPdfKey === selectedExamKey}
                >
                  <FileText size={14} className="mr-2" />
                  {exportingExamPdfKey === selectedExamKey ? "Exporting PDF..." : "Export PDF"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center border-[#D1D5DB] hover:bg-[#FFF7ED]"
                  onClick={() => examImportInputRef.current?.click()}
                  disabled={importingExamKey === selectedExamKey}
                >
                  <Upload size={14} className="mr-2" />
                  {importingExamKey === selectedExamKey ? "Importing..." : "Import JSON"}
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  JSON import matches super-admin-owned subject and chapter cards.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-sky-200 bg-sky-50/30">
            <CardHeader>
              <CardTitle className="text-base">Import HTML as Starter Questions</CardTitle>
              <CardDescription>Choose the destination subject and chapter. Imported HTML questions are appended at the bottom of that chapter and shown to students under Starter Questions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                ref={questionBankHtmlImportInputRef}
                type="file"
                accept={QUESTION_BANK_HTML_IMPORT_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  void handleQuestionBankHtmlFile(file);
                  event.currentTarget.value = "";
                }}
              />
              <Button type="button" variant="outline" className="border-sky-300 bg-white text-sky-700 hover:bg-sky-50" onClick={() => questionBankHtmlImportInputRef.current?.click()}>
                <FileText className="mr-2 h-4 w-4" /> Choose HTML file
              </Button>
              {questionBankHtmlImport ? (
                <div className="rounded-xl border border-sky-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{questionBankHtmlImport.fileName}</p>
                      <p className="mt-1 text-xs text-slate-500">{questionBankHtmlImport.parsed.questions.length} questions detected · saved as Starter Questions</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setQuestionBankHtmlImport(null)}>Remove</Button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Subject
                      <select
                        className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800"
                        value={questionBankHtmlSubjectId ? String(questionBankHtmlSubjectId) : ""}
                        onChange={(event) => setQuestionBankHtmlSubjectId(Number(event.target.value) || null)}
                      >
                        <option value="">Select subject</option>
                        {(activeQuestionBank?.subjects ?? []).map((subject) => <option key={subject.id} value={subject.id}>{subject.title}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Chapter
                      <select
                        className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800"
                        value={questionBankHtmlChapterId ? String(questionBankHtmlChapterId) : ""}
                        onChange={(event) => setQuestionBankHtmlChapterId(Number(event.target.value) || null)}
                        disabled={!questionBankHtmlSubject}
                      >
                        <option value="">Select chapter</option>
                        {(questionBankHtmlSubject?.chapters ?? []).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
                    <span>Target: {questionBankHtmlSubject?.title ?? "Select subject"} · {questionBankHtmlChapter?.title ?? "Select chapter"}</span>
                    <Button type="button" size="sm" disabled={questionBankHtmlImporting || !questionBankHtmlSubject || !questionBankHtmlChapter} onClick={() => void importQuestionBankHtml()}>
                      <Upload className="mr-1.5 h-4 w-4" /> {questionBankHtmlImporting ? "Importing…" : "Import Starter Questions"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {reports.length > 0 && (
            <Card className="border-[#E5E7EB] bg-white/95 hover:shadow-sm">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-500" />
                  Report Queue
                </CardTitle>
                <CardDescription>Student-reported issues that still need review.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {reports.map((report) => (
                  <div key={report.id} className="flex flex-col items-start gap-3 rounded-xl border border-[#E5E7EB] p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={report.status === "open" ? "destructive" : "secondary"}>{report.status}</Badge>
                        <RichQuestionContent
                          content={report.questionText}
                          className="line-clamp-2 text-sm font-medium leading-6 text-foreground"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">Reported by {report.reporterName}</p>
                      {report.reason && <p className="text-sm text-muted-foreground">{report.reason}</p>}
                    </div>
                    {report.status === "open" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 gap-1.5 border-orange-200 text-orange-700 hover:bg-orange-50"
                        onClick={() => openReportedQuestion(report)}
                      >
                        <Pencil size={13} />
                        Open &amp; edit
                      </Button>
                    ) : null}
                  </div>
                ))}
                {hasMoreReports && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => void fetchMoreReports()}
                    disabled={isFetchingMoreReports}
                  >
                    {isFetchingMoreReports ? "Loading reports..." : "Load more reports"}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

        </div>
      )}
    </div>
  );
}
