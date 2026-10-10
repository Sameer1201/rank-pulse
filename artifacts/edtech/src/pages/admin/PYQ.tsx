import { type ClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, BarChart3, Bold, BookOpen, ChevronRight, ClipboardPaste, Crop, FileUp, Files, Flag, ImagePlus, LineChart, Pencil, Plus, Redo2, Replace, Search, SlidersHorizontal, Undo2, Lock, Unlock, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { parsePyqHtml, type ParsedPyqImport } from "@/lib/pyqImport";
import { stripRichHtmlToText } from "@/lib/richContent";
import { getPyqDisplayOptions, stripRepeatedPyqOptions } from "@/lib/pyqContent";
import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { PyqReportedQuestionEditor } from "@/components/admin/PyqReportedQuestionEditor";
import { ChapterThemeIcon, SubjectThemeIcon, getSubjectAccent, getSubjectTheme } from "@/lib/subject-theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatExamDisplayName } from "@/lib/exam-display";
import { normalizeAdminExamKey, readAdminExamQuery, readAdminExamSelection, testBelongsToAdminExam } from "@/lib/admin-exam-selection";

type PyqQuestion = {
  id: number;
  exam: string;
  subject: string;
  chapter: string;
  marks: string | null;
  year: number;
  paper: string | null;
  question: string;
  questionType: string;
  options: string[];
  correctAnswer: number | null;
  answerText: string | null;
  explanation: string | null;
  imageData?: string | null;
};

type PyqResponse = { questions: PyqQuestion[] };
type PyqSubject = { exam: string; subject: string; questionCount: number; chapterCount: number; attemptedCount?: number };
type PyqChapter = { chapter: string; chapterOrder: number; questionCount: number; attemptedCount?: number };
type JamSolutionStudent = { id: number; fullName?: string | null; username?: string | null; email?: string | null; subject?: string | null; additionalExams?: string[] | null; profileDetails?: { preparation?: { targetExam?: string | null } | null } | null; status?: string | null };
type BulkImportItem = {
  id: string;
  fileName: string;
  parsed: ParsedPyqImport;
  subject: string;
  chapterMode: "detected" | "single";
  chapter: string;
};

type RichImageField = "question" | "explanation" | "option";
type ImportCropState = {
  questionIndex: number;
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  target: { kind: "question-image" } | { kind: "rich"; field: RichImageField; optionIndex?: number };
};

type EditableRichContentProps = {
  label: string;
  content: string;
  onChange: (content: string) => void;
  editingEnabled: boolean;
  onCropImage?: (src: string) => void;
};

function readImageFile(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

async function readClipboardImage() {
  if (!navigator.clipboard?.read) throw new Error("Clipboard image access is not available. Use Add image instead.");
  const clipboardItems = await navigator.clipboard.read();
  for (const item of clipboardItems) {
    const imageType = item.types.find((type) => type.startsWith("image/"));
    if (imageType) return readImageFile(await item.getType(imageType));
  }
  throw new Error("No image found in the clipboard.");
}

function insertImageIntoHtml(content: string, imageData: string, replaceExisting: boolean) {
  const documentRoot = new DOMParser().parseFromString(`<div>${content}</div>`, "text/html").body.firstElementChild;
  if (!documentRoot) return content;
  const existing = documentRoot.querySelector("img");
  if (replaceExisting && existing) {
    existing.setAttribute("src", imageData);
  } else {
    const image = documentRoot.ownerDocument.createElement("img");
    image.src = imageData;
    image.alt = "Imported figure";
    image.style.maxWidth = "100%";
    image.style.height = "auto";
    documentRoot.append(documentRoot.ownerDocument.createElement("br"), image);
  }
  return documentRoot.innerHTML;
}

function replaceFirstImageInHtml(content: string, imageData: string) {
  const documentRoot = new DOMParser().parseFromString(`<div>${content}</div>`, "text/html").body.firstElementChild;
  const image = documentRoot?.querySelector("img");
  if (!documentRoot || !image) return content;
  image.setAttribute("src", imageData);
  return documentRoot.innerHTML;
}

type CropRect = { left: number; top: number; width: number; height: number };

function FreeCropEditor({ src, onApply, onCancel }: { src: string; onApply: (rect: CropRect) => void; onCancel: () => void }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<CropRect>({ left: 0, top: 0, width: 100, height: 100 });
  const interactionRef = useRef<{ mode: "move" | "resize"; handle?: string; startX: number; startY: number; rect: CropRect } | null>(null);

  const startMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = { mode: "move", startX: event.clientX, startY: event.clientY, rect };
  };
  const startResize = (event: ReactPointerEvent<HTMLElement>, handle: string) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = { mode: "resize", handle, startX: event.clientX, startY: event.clientY, rect };
  };
  const updateSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    const frame = frameRef.current?.getBoundingClientRect();
    if (!interaction || !frame) return;
    const dx = ((event.clientX - interaction.startX) / frame.width) * 100;
    const dy = ((event.clientY - interaction.startY) / frame.height) * 100;
    const start = interaction.rect;
    if (interaction.mode === "move") {
      setRect({ ...start, left: Math.max(0, Math.min(100 - start.width, start.left + dx)), top: Math.max(0, Math.min(100 - start.height, start.top + dy)) });
      return;
    }
    const handle = interaction.handle ?? "";
    const minSize = 4;
    let left = start.left;
    let top = start.top;
    let right = start.left + start.width;
    let bottom = start.top + start.height;
    if (handle.includes("w")) left = Math.max(0, Math.min(right - minSize, start.left + dx));
    if (handle.includes("e")) right = Math.min(100, Math.max(left + minSize, start.left + start.width + dx));
    if (handle.includes("n")) top = Math.max(0, Math.min(bottom - minSize, start.top + dy));
    if (handle.includes("s")) bottom = Math.min(100, Math.max(top + minSize, start.top + start.height + dy));
    setRect({ left, top, width: right - left, height: bottom - top });
  };
  const finishInteraction = () => { interactionRef.current = null; };
  const handles = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];

  return <div className="space-y-4">
    <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 bg-slate-100 p-2">
      <div ref={frameRef} className="relative mx-auto inline-block max-w-full select-none touch-none leading-[0]" onPointerMove={updateSelection} onPointerUp={finishInteraction} onPointerCancel={finishInteraction}>
        <img src={src} alt="Crop preview" className="block max-h-[55vh] max-w-full object-contain" draggable={false} />
        <div className="pointer-events-none absolute inset-0 bg-black/45" />
        <div className="absolute border-2 border-orange-500 bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]" style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }} onPointerDown={startMove}>
          {handles.map((handle) => <span key={handle} className={`pointer-events-auto absolute h-3 w-3 rounded-full border-2 border-white bg-orange-500 shadow ${handle.includes("n") ? "-top-1.5" : handle.includes("s") ? "-bottom-1.5" : "top-1/2 -translate-y-1/2"} ${handle.includes("w") ? "-left-1.5" : handle.includes("e") ? "-right-1.5" : "left-1/2 -translate-x-1/2"} ${handle === "nw" || handle === "se" ? "cursor-nwse-resize" : handle === "ne" || handle === "sw" ? "cursor-nesw-resize" : handle === "n" || handle === "s" ? "cursor-ns-resize" : "cursor-ew-resize"}`} onPointerDown={(event) => startResize(event, handle)} />)}
        </div>
      </div>
    </div>
    <p className="text-xs text-slate-500">Drag the selection to move it. Drag any corner or edge handle to resize the free crop area.</p>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="button" onClick={() => onApply(rect)}>Apply crop</Button></div>
  </div>;
}

function formatImportYearLabel(exam: string, year: number) {
  if (!year) return null;
  const formattedExam = formatExamDisplayName(exam) || exam;
  const prefix = /gate/i.test(formattedExam) ? "GATE" : /net/i.test(formattedExam) ? "NET" : formattedExam;
  return `${prefix} ${year}`;
}

function EditableRichContent({ label, content, onChange, editingEnabled, onCropImage }: EditableRichContentProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageMode, setImageMode] = useState<"add" | "replace">("add");
  const historyRef = useRef<string[]>([content || ""]);
  const historyIndexRef = useRef(0);
  const applyingHistoryRef = useRef(false);
  const [, setHistoryVersion] = useState(0);

  useEffect(() => {
    const nextContent = content || "";
    const nextHtml = nextContent || "<br>";
    // Keep the contentEditable DOM in charge while typing. React's
    // dangerouslySetInnerHTML would rewrite the node after every keystroke,
    // which moves the caret back to the beginning of the editor.
    if (!editorRef.current || editorRef.current.innerHTML === nextHtml) return;
    editorRef.current.innerHTML = nextHtml;
    historyRef.current = [nextContent];
    historyIndexRef.current = 0;
    setHistoryVersion((version) => version + 1);
  }, [content, editingEnabled]);

  const emitChange = () => {
    const nextContent = editorRef.current?.innerHTML ?? "";
    if (!applyingHistoryRef.current && historyRef.current[historyIndexRef.current] !== nextContent) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push(nextContent);
      historyIndexRef.current += 1;
    }
    setHistoryVersion((version) => version + 1);
    onChange(nextContent);
  };

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    requestAnimationFrame(emitChange);
  };

  const applyHistory = (direction: -1 | 1) => {
    const nextIndex = historyIndexRef.current + direction;
    if (nextIndex < 0 || nextIndex >= historyRef.current.length || !editorRef.current) return;
    historyIndexRef.current = nextIndex;
    const nextContent = historyRef.current[nextIndex] ?? "";
    applyingHistoryRef.current = true;
    editorRef.current.innerHTML = nextContent || "<br>";
    setHistoryVersion((version) => version + 1);
    onChange(nextContent);
    requestAnimationFrame(() => { applyingHistoryRef.current = false; });
  };

  const handleHistoryShortcut = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const isUndo = key === "z" && !event.shiftKey;
    const isRedo = key === "y" || (key === "z" && event.shiftKey);
    if (!isUndo && !isRedo) return;
    event.preventDefault();
    editorRef.current?.focus();
    applyHistory(isUndo ? -1 : 1);
  };

  const handlePaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"));
    const file = imageItem?.getAsFile() ?? event.clipboardData.files?.[0];
    if (!file) return;
    event.preventDefault();
    try {
      const imageData = await readImageFile(file);
      const nextContent = insertImageIntoHtml(editorRef.current?.innerHTML ?? content, imageData, false);
      if (editorRef.current) editorRef.current.innerHTML = nextContent || "<br>";
      emitChange();
    } catch {
      // Keep the browser editor intact when the clipboard image cannot be read.
    }
  };

  const handlePasteImageButton = async () => {
    try {
      const imageData = await readClipboardImage();
      const nextContent = insertImageIntoHtml(editorRef.current?.innerHTML ?? content, imageData, false);
      if (editorRef.current) editorRef.current.innerHTML = nextContent || "<br>";
      emitChange();
    } catch {
      // Clipboard permissions vary by browser; the file picker remains available.
    }
  };

  const handleDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    try {
      const nextContent = insertImageIntoHtml(editorRef.current?.innerHTML ?? content, await readImageFile(file), false);
      if (editorRef.current) editorRef.current.innerHTML = nextContent || "<br>";
      emitChange();
    } catch {
      // Keep the editor unchanged when a dropped image cannot be read.
    }
  };

  const openImagePicker = (mode: "add" | "replace") => {
    setImageMode(mode);
    imageInputRef.current?.click();
  };

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  return <div className="rounded-xl border border-slate-200 bg-white">
    {editingEnabled ? <>
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        {label ? <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span> : null}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Bold" title="Bold" onClick={() => exec("bold")}><Bold className="h-3.5 w-3.5" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="New line" title="New line" onClick={() => exec("insertHTML", "<br>")}><LineChart className="h-3.5 w-3.5 rotate-90" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={() => applyHistory(-1)}><Undo2 className="h-3.5 w-3.5" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Redo" title="Redo (Ctrl/Cmd+Y)" disabled={!canRedo} onClick={() => applyHistory(1)}><Redo2 className="h-3.5 w-3.5" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Add image" title="Add image" onClick={() => openImagePicker("add")}><ImagePlus className="h-3.5 w-3.5" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Paste image" title="Paste image from clipboard" onClick={() => void handlePasteImageButton()}><ClipboardPaste className="h-3.5 w-3.5" /></Button>
        {/<img\b/i.test(content) ? <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Replace image" title="Replace image" onClick={() => openImagePicker("replace")}><Replace className="h-3.5 w-3.5" /></Button> : null}
        {/<img\b/i.test(content) && onCropImage ? <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Crop image" title="Crop image" onClick={() => { const src = editorRef.current?.querySelector("img")?.getAttribute("src"); if (src) onCropImage(src); }}><Crop className="h-3.5 w-3.5" /></Button> : null}
        <input ref={imageInputRef} className="hidden" type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { try { const nextContent = insertImageIntoHtml(editorRef.current?.innerHTML ?? content, await readImageFile(file), imageMode === "replace"); if (editorRef.current) editorRef.current.innerHTML = nextContent || "<br>"; emitChange(); } catch {} } event.target.value = ""; }} />
      </div>
      <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={emitChange} onBlur={emitChange} onPaste={handlePaste} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void handleDrop(event)} onKeyDown={handleHistoryShortcut} className="min-h-[3rem] whitespace-pre-wrap p-3 text-sm text-slate-800 outline-none [&_img]:my-2 [&_img]:max-w-full" />
    </> : <div className={label ? "p-3" : "p-0"}>{label ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p> : null}<RichQuestionContent content={content || "<span class=\"text-slate-400\">Not added</span>"} className="text-sm text-slate-800" /></div>}
  </div>;
}

type PyqAdminProgress = {
  students: number;
  attemptedQuestions: number;
  solvedQuestions: number;
  attempts: number;
  correctAttempts: number;
  accuracy: number;
};

type PyqReport = {
  id: number;
  questionId: number;
  questionText: string;
  exam: string;
  subject: string;
  chapter: string;
  year: number;
  reporterName: string;
  reason: string;
  status: string;
  createdAt: number;
};

function validateNumericImport(questions: ParsedPyqImport["questions"]) {
  questions.forEach((question, index) => {
    if (question.questionType !== "integer") return;
    const { answerMin: min, answerMax: max } = question;
    if ((min === null) !== (max === null) || (min !== null && max !== null && (!Number.isFinite(min) || !Number.isFinite(max) || min > max))) {
      throw new Error(`Question ${index + 1}: enter a valid minimum and maximum numeric answer.`);
    }
  });
}

function ImportNumericAnswer({ question, editing, onChange }: { question: ParsedPyqImport["questions"][number]; editing: boolean; onChange: (update: Partial<ParsedPyqImport["questions"][number]>) => void }) {
  return <div className="rounded-lg border border-orange-300/40 bg-orange-500/5 p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Correct numeric answer · NAT</p>
    <p className="mt-1 text-xs text-muted-foreground">Use an exact answer or an accepted numeric range. NAT questions have no options.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <label className="text-xs text-muted-foreground">Numeric answer<input aria-label="Numeric answer" type="text" inputMode="decimal" disabled={!editing} value={stripRichHtmlToText(question.answerText)} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm text-foreground disabled:opacity-80" onChange={(event) => { const value = event.target.value; const number = value.trim() ? Number(value) : NaN; onChange({ answerText: value || null, answerMin: Number.isFinite(number) ? number : null, answerMax: Number.isFinite(number) ? number : null }); }} /></label>
      <label className="text-xs text-muted-foreground">Minimum answer<input aria-label="Minimum answer" type="number" step="any" disabled={!editing} value={question.answerMin ?? ""} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm text-foreground disabled:opacity-80" onChange={(event) => onChange({ answerText: null, answerMin: event.target.value === "" ? null : Number(event.target.value) })} /></label>
      <label className="text-xs text-muted-foreground">Maximum answer<input aria-label="Maximum answer" type="number" step="any" disabled={!editing} value={question.answerMax ?? ""} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm text-foreground disabled:opacity-80" onChange={(event) => onChange({ answerText: null, answerMax: event.target.value === "" ? null : Number(event.target.value) })} /></label>
    </div>
  </div>;
}

export default function AdminPYQ() {
  const [location] = useLocation();
  const selectedExamKey = useMemo(() => {
    return readAdminExamQuery(location) || readAdminExamSelection(location);
  }, [location]);
  const pyqExamMatchesSelection = (storedExam: string) => {
    const selected = normalizeAdminExamKey(selectedExamKey);
    const stored = normalizeAdminExamKey(storedExam);
    if (!selected) return true;
    if (selected === "gate") return stored === "gate" || stored.startsWith("gate-");
    if (selected === "jam-chemistry") return stored === "jam-chemistry";
    return stored === selected || stored.startsWith(`${selected}-`) || stored.includes(selected);
  };
  const [deletionLocked, setDeletionLocked] = useState(true);
  const [parsedImport, setParsedImport] = useState<ParsedPyqImport | null>(null);
  const [fileName, setFileName] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [importSubject, setImportSubject] = useState("");
  const [importChapterMode, setImportChapterMode] = useState<"detected" | "single">("detected");
  const [importChapter, setImportChapter] = useState("");
  const [bulkImports, setBulkImports] = useState<BulkImportItem[]>([]);
  const [bulkImportProgress, setBulkImportProgress] = useState(0);
  const [imageTargetIndex, setImageTargetIndex] = useState<number | null>(null);
  const [cropState, setCropState] = useState<ImportCropState | null>(null);
  const [previewEditing, setPreviewEditing] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<PyqSubject | null>(null);
  const [editingReport, setEditingReport] = useState<PyqReport | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<PyqChapter | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "mcq" | "multi" | "integer">("all");
  const [markFilter, setMarkFilter] = useState<"all" | "1" | "2">("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [jamAccountSearch, setJamAccountSearch] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const bulkImportInputRef = useRef<HTMLInputElement>(null);
  const questionImageInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const questionsQuery = useQuery({
    queryKey: ["pyq-questions", "admin", selectedSubject?.exam, selectedSubject?.subject, selectedChapter?.chapter, typeFilter, markFilter, yearFilter],
    enabled: Boolean(selectedSubject && selectedChapter),
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100", exam: selectedSubject!.exam, subject: selectedSubject!.subject, chapter: selectedChapter!.chapter });
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (markFilter !== "all") params.set("marks", markFilter);
      if (yearFilter !== "all") params.set("year", yearFilter);
      return api.get<PyqResponse>(`/pyq/questions?${params.toString()}`);
    },
  });
  const subjectsQuery = useQuery({
    queryKey: ["pyq-subjects", "admin", selectedExamKey],
    queryFn: async () => {
      const result = await api.get<{ subjects: PyqSubject[] }>(normalizeAdminExamKey(selectedExamKey) === "gate" || !selectedExamKey
        ? "/pyq/subjects"
        : `/pyq/subjects?exam=${encodeURIComponent(formatExamDisplayName(selectedExamKey) || selectedExamKey)}`);
      if (!selectedExamKey) return result;
      return {
        subjects: result.subjects.filter((item) => pyqExamMatchesSelection(item.exam)),
      };
    },
  });

  useEffect(() => {
    if (!selectedSubject || !selectedExamKey) return;
    if (!pyqExamMatchesSelection(selectedSubject.exam)) {
      setSelectedSubject(null);
      setSelectedChapter(null);
    }
  }, [selectedExamKey, selectedSubject]);
  const chaptersQuery = useQuery({
    queryKey: ["pyq-chapters", "admin", selectedSubject?.exam, selectedSubject?.subject],
    enabled: Boolean(selectedSubject),
    queryFn: () => api.get<{ chapters: PyqChapter[] }>(`/pyq/chapters?exam=${encodeURIComponent(selectedSubject!.exam)}&subject=${encodeURIComponent(selectedSubject!.subject)}`),
  });
  const importChaptersQuery = useQuery({
    queryKey: ["pyq-import-chapters", "admin", selectedExamKey, importSubject.trim()],
    enabled: Boolean(parsedImport && importSubject.trim()),
    queryFn: () => api.get<{ chapters: PyqChapter[] }>(`/pyq/chapters?exam=${encodeURIComponent(formatExamDisplayName(selectedExamKey) || parsedImport!.exam)}&subject=${encodeURIComponent(importSubject.trim())}`),
  });
  const progressQuery = useQuery({
    queryKey: ["pyq-admin-progress", selectedExamKey],
    queryFn: () => normalizeAdminExamKey(selectedExamKey) === "gate"
      ? api.get<PyqAdminProgress>("/pyq/progress/admin-summary")
      : api.get<PyqAdminProgress>(`/pyq/progress/admin-summary?exam=${encodeURIComponent(formatExamDisplayName(selectedExamKey) || selectedExamKey)}`),
  });
  const reportsQuery = useQuery({
    queryKey: ["pyq-reports", "open", selectedExamKey],
    queryFn: () => normalizeAdminExamKey(selectedExamKey) === "gate"
      ? api.get<{ reports: PyqReport[] }>("/pyq/reports?status=open&limit=100")
      : api.get<{ reports: PyqReport[] }>(`/pyq/reports?status=open&limit=100&exam=${encodeURIComponent(formatExamDisplayName(selectedExamKey) || selectedExamKey)}`),
  });
  const jamSolutionAccessEnabled = normalizeAdminExamKey(selectedExamKey) === "jam-chemistry";
  const jamStudentsQuery = useQuery({
    queryKey: ["pyq-jam-solution-students"],
    enabled: jamSolutionAccessEnabled,
    queryFn: () => api.get<JamSolutionStudent[]>("/users?role=student"),
  });
  const jamSolutionAccessQuery = useQuery({
    queryKey: ["pyq-jam-solution-access"],
    enabled: jamSolutionAccessEnabled,
    queryFn: () => api.get<{ studentIds: number[] }>("/pyq/jam-solution-access"),
  });
  const jamSolutionAccessMutation = useMutation({
    mutationFn: ({ studentId, enabled }: { studentId: number; enabled: boolean }) => api.patch("/pyq/jam-solution-access", { studentId, enabled }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["pyq-jam-solution-access"] }); toast({ title: "JAM PYQ access updated" }); },
    onError: (error: Error) => toast({ title: "Could not update account access", description: error.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      if (!parsedImport) throw new Error("Choose a PYQ HTML file first");
      validateNumericImport(parsedImport.questions);
      const subject = importSubject.trim();
      if (!subject) throw new Error("Select or add a subject before importing");
      if (importChapterMode === "single" && !importChapter.trim()) throw new Error("Select or add a chapter before importing");
      const questions = parsedImport.questions.map((question) => ({
        ...question,
        chapter: importChapterMode === "single" ? importChapter.trim() : question.chapter,
      }));
      return api.post<{ imported: number; chapters: number }>("/pyq/import", {
        ...parsedImport,
        exam: formatExamDisplayName(selectedExamKey) || parsedImport.exam,
        subject,
        questions,
        replaceChapter: importChapterMode === "single" ? importChapter.trim() : null,
      });
    },
    onMutate: () => setImportProgress(12),
    onSuccess: (result) => {
      setImportProgress(100);
      setParsedImport(null);
      setFileName("");
      setImportSubject("");
      setImportChapter("");
      setImportChapterMode("detected");
      setPreviewEditing(false);
      queryClient.invalidateQueries({ queryKey: ["pyq-questions", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-subjects", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-chapters", "admin"] });
      toast({ title: "Subject imported", description: `${result.imported} questions across ${result.chapters} chapters are now live.` });
    },
    onError: (error: Error) => {
      setImportProgress(0);
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async () => {
      if (bulkImports.length === 0) throw new Error("Choose at least one PYQ HTML file");
      const results: { imported: number; chapters: number }[] = [];
      for (const [index, item] of bulkImports.entries()) {
        validateNumericImport(item.parsed.questions);
        const subject = item.subject.trim();
        if (!subject) throw new Error(`${item.fileName}: select or add a subject`);
        if (item.chapterMode === "single" && !item.chapter.trim()) throw new Error(`${item.fileName}: select or add a chapter`);
        const questions = item.parsed.questions.map((question) => ({
          ...question,
          chapter: item.chapterMode === "single" ? item.chapter.trim() : question.chapter,
        }));
        const result = await api.post<{ imported: number; chapters: number }>("/pyq/import", {
          ...item.parsed,
          exam: formatExamDisplayName(selectedExamKey) || item.parsed.exam,
          subject,
          questions,
          replaceChapter: item.chapterMode === "single" ? item.chapter.trim() : null,
        });
        results.push(result);
        setBulkImportProgress(Math.round(((index + 1) / bulkImports.length) * 100));
      }
      return results;
    },
    onMutate: () => setBulkImportProgress(0),
    onSuccess: (results) => {
      setBulkImports([]);
      queryClient.invalidateQueries({ queryKey: ["pyq-questions", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-subjects", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-chapters", "admin"] });
      toast({ title: "Bulk import complete", description: `${results.reduce((sum, result) => sum + result.imported, 0)} questions imported from ${results.length} files.` });
    },
    onError: (error: Error) => toast({ title: "Bulk import stopped", description: error.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!importMutation.isPending) return;
    const timer = window.setInterval(() => setImportProgress((current) => Math.min(90, current + 6)), 350);
    return () => window.clearInterval(timer);
  }, [importMutation.isPending]);

  const deleteMutation = useMutation({
    mutationFn: ({ id, exam }: { id: number; exam: string }) => {
      if (deletionLocked) throw new Error("Unlock deletion first");
      return api.delete(`/pyq/questions/${id}?exam=${encodeURIComponent(exam)}`);
    },
    onSuccess: (_result, variables) => {
      setSelectedChapter((current) => current && current.questionCount > 0
        ? { ...current, questionCount: current.questionCount - 1 }
        : current);
      queryClient.invalidateQueries({ queryKey: ["pyq-questions", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-subjects", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-chapters", "admin"] });
      toast({ title: "Question deleted", description: `Removed from ${variables.exam}.` });
    },
    onError: (error: Error) => toast({ title: "Delete failed", description: error.message, variant: "destructive" }),
  });

  const deleteChapterMutation = useMutation({
    mutationFn: ({ exam, subject, chapter }: { exam: string; subject: string; chapter: string }) => { if (deletionLocked) throw new Error("Unlock deletion first"); return api.delete(`/pyq/chapters?exam=${encodeURIComponent(exam)}&subject=${encodeURIComponent(subject)}&chapter=${encodeURIComponent(chapter)}`); },
    onSuccess: () => {
      setSelectedChapter(null);
      queryClient.invalidateQueries({ queryKey: ["pyq-questions", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-subjects", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-chapters", "admin"] });
      toast({ title: "Chapter deleted" });
    },
    onError: (error: Error) => toast({ title: "Chapter delete failed", description: error.message, variant: "destructive" }),
  });

  const renameChapterMutation = useMutation({
    mutationFn: ({ exam, subject, chapter, nextChapter }: { exam: string; subject: string; chapter: string; nextChapter: string }) => {
      if (deletionLocked) throw new Error("Unlock chapter rename first");
      return api.patch(`/pyq/chapters?exam=${encodeURIComponent(exam)}`, { exam, subject, chapter, nextChapter });
    },
    onSuccess: (_data, variables) => {
      setSelectedChapter((current) => current && current.chapter === variables.chapter ? { ...current, chapter: variables.nextChapter } : current);
      queryClient.invalidateQueries({ queryKey: ["pyq-questions", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-subjects", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-chapters", "admin"] });
      toast({ title: "Chapter renamed", description: `${variables.chapter} → ${variables.nextChapter}` });
    },
    onError: (error: Error) => toast({ title: "Chapter rename failed", description: error.message, variant: "destructive" }),
  });

  const deleteSubjectMutation = useMutation({
    mutationFn: ({ exam, subject }: { exam: string; subject: string }) => { if (deletionLocked) throw new Error("Unlock deletion first"); return api.delete(`/pyq/subjects?exam=${encodeURIComponent(exam)}&subject=${encodeURIComponent(subject)}`); },
    onSuccess: () => {
      setSelectedSubject(null);
      setSelectedChapter(null);
      queryClient.invalidateQueries({ queryKey: ["pyq-questions", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-subjects", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-chapters", "admin"] });
      toast({ title: "Subject deleted" });
    },
    onError: (error: Error) => toast({ title: "Subject delete failed", description: error.message, variant: "destructive" }),
  });

  const renameSubjectMutation = useMutation({
    mutationFn: ({ exam, subject, nextSubject }: { exam: string; subject: string; nextSubject: string }) => api.patch(`/pyq/subjects?exam=${encodeURIComponent(exam)}`, { exam, subject, nextSubject }),
    onSuccess: (_data, variables) => {
      setSelectedSubject((current) => current && current.exam === variables.exam && current.subject === variables.subject ? { ...current, subject: variables.nextSubject } : current);
      queryClient.invalidateQueries({ queryKey: ["pyq-subjects", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-chapters", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["pyq-questions", "admin"] });
      toast({ title: "Subject renamed", description: `${variables.subject} → ${variables.nextSubject}` });
    },
    onError: (error: Error) => toast({ title: "Subject rename failed", description: error.message, variant: "destructive" }),
  });

  const rejectReportMutation = useMutation({
    mutationFn: (report: PyqReport) => api.patch(`/pyq/reports/${report.id}/reject?exam=${encodeURIComponent(report.exam)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pyq-reports", "open"] });
      toast({ title: "Report rejected", description: "The report has been marked as reviewed." });
    },
    onError: (error: Error) => toast({ title: "Could not reject report", description: error.message, variant: "destructive" }),
  });

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parsePyqHtml(await file.text(), file.name);
      setParsedImport(parsed);
      setPreviewEditing(false);
      setFileName(file.name);
      const detectedChapters = [...new Set(parsed.questions.map((question) => question.chapter).filter(Boolean))];
      setImportSubject(parsed.subject);
      setImportChapterMode(detectedChapters.length === 1 ? "single" : "detected");
      setImportChapter(detectedChapters.length === 1 ? detectedChapters[0]! : "");
      toast({ title: "HTML ready", description: `${parsed.subject}: ${parsed.questions.length} questions found.` });
    } catch (error) {
      setParsedImport(null);
      setFileName("");
      setImportSubject("");
      setImportChapter("");
      setImportChapterMode("detected");
      setPreviewEditing(false);
      toast({ title: "Invalid HTML file", description: error instanceof Error ? error.message : "Could not read file", variant: "destructive" });
    }
    event.target.value = "";
  }

  async function handleBulkFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const parsedItems: BulkImportItem[] = [];
    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      try {
        const parsed = parsePyqHtml(await file.text(), file.name);
        const detectedChapters = [...new Set(parsed.questions.map((question) => question.chapter).filter(Boolean))];
        parsedItems.push({
          id: `${Date.now()}-${index}-${file.name}`,
          fileName: file.name,
          parsed,
          subject: parsed.subject,
          chapterMode: detectedChapters.length === 1 ? "single" : "detected",
          chapter: detectedChapters.length === 1 ? detectedChapters[0]! : "",
        });
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "Could not read file"}`);
      }
    }
    if (parsedItems.length > 0) setBulkImports((current) => [...current, ...parsedItems]);
    if (failures.length > 0) toast({ title: "Some files were skipped", description: failures.join(" | "), variant: "destructive" });
    else toast({ title: "Bulk files ready", description: `${parsedItems.length} HTML files are ready to import.` });
    event.target.value = "";
  }

  const updateBulkImport = (id: string, update: Partial<Pick<BulkImportItem, "subject" | "chapterMode" | "chapter">>) => {
    setBulkImports((items) => items.map((item) => item.id === id ? { ...item, ...update } : item));
  };

  const updateImportedQuestion = (questionIndex: number, update: Partial<ParsedPyqImport["questions"][number]>) => {
    setParsedImport((current) => current ? { ...current, questions: current.questions.map((question, index) => index === questionIndex ? { ...question, ...update } : question) } : current);
  };

  const setImportedCorrectAnswer = (questionIndex: number, optionIndex: number) => {
    const question = parsedImport?.questions[questionIndex];
    if (!question || question.questionType === "integer") return;
    const isMulti = question.questionType === "multi";
    const nextAnswers = isMulti
      ? (question.correctAnswers.includes(optionIndex)
        ? question.correctAnswers.filter((index) => index !== optionIndex)
        : [...question.correctAnswers, optionIndex].sort((a, b) => a - b))
      : [optionIndex];
    updateImportedQuestion(questionIndex, {
      correctAnswers: nextAnswers,
      correctAnswer: nextAnswers[0] ?? null,
    });
  };

  const openImportCrop = (questionIndex: number, src: string, target: ImportCropState["target"]) => {
    setCropState({ questionIndex, src, left: 0, top: 0, width: 100, height: 100, target });
  };

  const cropImage = (state: NonNullable<typeof cropState>) => new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const left = Math.max(0, Math.min(100, state.left));
      const top = Math.max(0, Math.min(100, state.top));
      const width = Math.max(1, Math.min(100 - left, state.width));
      const height = Math.max(1, Math.min(100 - top, state.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * width / 100));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * height / 100));
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("Canvas is unavailable")); return; }
      context.drawImage(image, image.naturalWidth * left / 100, image.naturalHeight * top / 100, image.naturalWidth * width / 100, image.naturalHeight * height / 100, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Could not crop image"));
    image.src = state.src;
  });

  async function handleQuestionImageFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && imageTargetIndex != null) {
      try {
        updateImportedQuestion(imageTargetIndex, { imageData: await readImageFile(file) });
        toast({ title: "Image added", description: "The image will be included with this question." });
      } catch (error) {
        toast({ title: "Image upload failed", description: error instanceof Error ? error.message : "Could not read image", variant: "destructive" });
      }
    }
    event.target.value = "";
  }

  async function handleQuestionImagePaste(questionIndex: number) {
    try {
      updateImportedQuestion(questionIndex, { imageData: await readClipboardImage() });
      toast({ title: "Image pasted", description: "The clipboard image will be included with this question." });
    } catch (error) {
      toast({ title: "Image paste failed", description: error instanceof Error ? error.message : "Copy an image first, then try again.", variant: "destructive" });
    }
  }

  async function handleQuestionImageDrop(event: ReactDragEvent<HTMLDivElement>, questionIndex: number) {
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    try {
      updateImportedQuestion(questionIndex, { imageData: await readImageFile(file) });
      toast({ title: "Image added", description: "The dropped image will be included with this question." });
    } catch (error) {
      toast({ title: "Image drop failed", description: error instanceof Error ? error.message : "Could not read the dropped image.", variant: "destructive" });
    }
  }

  const importChapters = parsedImport ? [...new Set(parsedImport.questions.map((question) => question.chapter))] : [];
  const availableImportChapters = useMemo(() => {
    const detected = parsedImport ? parsedImport.questions.map((question) => question.chapter).filter(Boolean) : [];
    const existing = importChaptersQuery.data?.chapters.map((chapter) => chapter.chapter) ?? [];
    return [...new Set([...existing, ...detected])];
  }, [importChaptersQuery.data?.chapters, parsedImport]);
  const importChapterLabel = importChapterMode === "single"
    ? importChapter || "No chapter selected"
    : importChapters.length > 1 ? `Keep ${importChapters.length} chapters from HTML` : importChapters[0] || "HTML chapters";
  const visibleReports = useMemo(
    () => (reportsQuery.data?.reports ?? []).filter((report) => testBelongsToAdminExam({ title: report.exam }, selectedExamKey)),
    [reportsQuery.data?.reports, selectedExamKey],
  );
  const visibleQuestions = useMemo(() => questionsQuery.data?.questions ?? [], [questionsQuery.data?.questions]);
  const jamSolutionStudents = useMemo(() => (jamStudentsQuery.data ?? []).filter((student) => {
    const studentExams = [student.subject, ...(student.additionalExams ?? []), student.profileDetails?.preparation?.targetExam];
    if (!studentExams.some((exam) => typeof exam === "string" && /chemistry/i.test(exam))) return false;
    const search = jamAccountSearch.trim().toLowerCase();
    if (!search) return true;
    return `${student.fullName ?? ""} ${student.username ?? ""} ${student.email ?? ""}`.toLowerCase().includes(search);
  }), [jamStudentsQuery.data, jamAccountSearch]);
  const jamSolutionStudentIds = new Set(jamSolutionAccessQuery.data?.studentIds ?? []);
  const selectedSubjectTheme = getSubjectTheme(selectedSubject?.subject ?? "overall");
  const selectedSubjectAccent = getSubjectAccent(selectedSubject?.subject ?? "overall");
  const resetFilters = () => { setTypeFilter("all"); setMarkFilter("all"); setYearFilter("all"); };
  const hasActiveFilters = typeFilter !== "all" || markFilter !== "all" || yearFilter !== "all";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {editingReport ? <PyqReportedQuestionEditor key={`${editingReport.exam}-${editingReport.questionId}`} report={editingReport} onClose={() => setEditingReport(null)} /> : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-100 text-orange-600"><FileUp size={22} /></span>
          <div><h1 className="text-2xl font-bold text-slate-900">PYQ Manager</h1><p className="mt-1 text-sm text-slate-500">Manage imported PYQs subject-wise and chapter-wise.</p></div>
        </div>
        <div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" aria-label={deletionLocked ? "Unlock PYQ deletion" : "Lock PYQ deletion"} title={deletionLocked ? "Deletion locked — click to unlock" : "Deletion unlocked — click to lock"} aria-pressed={deletionLocked} onClick={() => setDeletionLocked((locked) => !locked)}>{deletionLocked ? <Lock size={20} /> : <Unlock size={20} />}</Button><button type="button" aria-label="Import subject HTML" title="Import one subject HTML" onClick={() => importInputRef.current?.click()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600 transition hover:border-orange-400 hover:bg-orange-100"><FileUp size={21} /></button><button type="button" aria-label="Bulk import PYQ HTML" title="Bulk import multiple PYQ HTML files" onClick={() => bulkImportInputRef.current?.click()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 text-violet-600 transition hover:border-violet-400 hover:bg-violet-100"><Files size={21} /></button><input ref={importInputRef} className="hidden" type="file" accept=".html,text/html" onChange={handleFile} /><input ref={bulkImportInputRef} className="hidden" type="file" accept=".html,text/html" multiple onChange={handleBulkFiles} /></div>
      </div>

      {jamSolutionAccessEnabled ? <Card className="border-violet-200 bg-violet-50/40">
        <CardHeader className="pb-3"><CardTitle className="text-lg">JAM Chemistry · One-time solution review</CardTitle><p className="text-sm text-slate-600">Selected students can submit each PYQ once. Their answer and solution remain visible when they return; this feature does not add to attempt counts.</p></CardHeader>
        <CardContent className="space-y-3">
          <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input aria-label="Search student accounts" className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm" placeholder="Search student name, username or email" value={jamAccountSearch} onChange={(event) => setJamAccountSearch(event.target.value)} /></div>
          {jamStudentsQuery.isLoading || jamSolutionAccessQuery.isLoading ? <p className="py-3 text-center text-sm text-slate-500">Loading Chemistry student accounts…</p> : jamStudentsQuery.isError || jamSolutionAccessQuery.isError ? <p className="py-3 text-sm text-rose-600">Could not load JAM solution account settings.</p> : <div className="max-h-64 divide-y divide-violet-100 overflow-y-auto rounded-xl border border-violet-100 bg-white">
            {jamSolutionStudents.map((student) => {
              const enabled = jamSolutionStudentIds.has(student.id);
              return <label key={student.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-violet-50/70">
                <input type="checkbox" checked={enabled} disabled={jamSolutionAccessMutation.isPending} onChange={(event) => jamSolutionAccessMutation.mutate({ studentId: student.id, enabled: event.target.checked })} className="h-4 w-4 accent-violet-600" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{student.fullName || student.username || `Student ${student.id}`}</span><span className="block truncate text-xs text-slate-500">{student.email || student.username || `ID ${student.id}`}</span></span>
                {enabled ? <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">Enabled</span> : null}
              </label>;
            })}
            {jamSolutionStudents.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">No Chemistry student accounts match.</p> : null}
          </div>}
          <p className="text-xs text-slate-500">Enabled for {jamSolutionStudentIds.size} account{jamSolutionStudentIds.size === 1 ? "" : "s"}. Selection only appears while the admin exam is JAM Chemistry.</p>
        </CardContent>
      </Card> : null}

      {bulkImports.length > 0 ? <Card className="border-violet-200 bg-violet-50/30">
        <CardHeader className="flex flex-row items-start justify-between space-y-0"><div><CardTitle className="text-lg">Bulk PYQ import</CardTitle><p className="text-sm text-slate-600">{bulkImports.length} HTML files ready. Each file will import into the selected exam one by one.</p></div><Button type="button" size="sm" disabled={bulkImportMutation.isPending} onClick={() => bulkImportMutation.mutate()}><Upload size={15} />{bulkImportMutation.isPending ? `${bulkImportProgress}%` : "Import all"}</Button></CardHeader>
        <CardContent className="space-y-3">
          <datalist id="pyq-bulk-subject-options">{subjectsQuery.data?.subjects.map((item) => <option key={`${item.exam}-${item.subject}`} value={item.subject} />)}</datalist>
          {bulkImports.map((item) => {
            const detectedChapters = [...new Set(item.parsed.questions.map((question) => question.chapter).filter(Boolean))];
            return <div key={item.id} className="rounded-xl border border-violet-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{item.fileName}</p><p className="text-xs text-slate-500">{item.parsed.questions.length} questions · {detectedChapters.length} detected chapters</p></div><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-500" aria-label={`Remove ${item.fileName}`} title="Remove file" disabled={bulkImportMutation.isPending} onClick={() => setBulkImports((items) => items.filter((current) => current.id !== item.id))}><X className="h-4 w-4" /></Button></div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subject<input list="pyq-bulk-subject-options" className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800" value={item.subject} onChange={(event) => updateBulkImport(item.id, { subject: event.target.value })} /></label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chapter target<select className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800" value={item.chapterMode === "detected" ? "__detected__" : item.chapter} onChange={(event) => { const value = event.target.value; updateBulkImport(item.id, value === "__detected__" ? { chapterMode: "detected" } : { chapterMode: "single", chapter: value }); }}><option value="__detected__">Keep chapters from HTML ({detectedChapters.length})</option>{detectedChapters.map((chapter) => <option key={chapter} value={chapter}>{chapter}</option>)}</select></label>
              </div>
              {item.chapterMode === "single" ? <input className="mt-2 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" placeholder="Selected/new chapter name" value={item.chapter} onChange={(event) => updateBulkImport(item.id, { chapter: event.target.value })} /> : null}
            </div>;
          })}
          {bulkImportMutation.isPending ? <div className="h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full bg-violet-500 transition-all" style={{ width: `${bulkImportProgress}%` }} /></div> : null}
        </CardContent>
      </Card> : null}

      {parsedImport ? <Card className="border-orange-200 bg-orange-50/40">
        <CardHeader><CardTitle className="text-lg">Import destination</CardTitle><p className="text-sm text-slate-600">Select an existing subject/chapter or use the plus button to add a new name. The selected exam is used automatically.</p></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="pyq-import-subject">Subject</label>
            <div className="mt-1 flex gap-2">
              <select id="pyq-import-subject" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" value={importSubject} onChange={(event) => setImportSubject(event.target.value)}>
                <option value="">Select subject</option>
                {subjectsQuery.data?.subjects.map((item) => <option key={`${item.exam}-${item.subject}`} value={item.subject}>{item.subject}</option>)}
                {importSubject && !subjectsQuery.data?.subjects.some((item) => item.subject === importSubject) ? <option value={importSubject}>{importSubject} (new)</option> : null}
              </select>
              <Button type="button" variant="outline" size="icon" aria-label="Add subject" title="Add subject" onClick={() => { const next = window.prompt("New subject name", importSubject || parsedImport.subject)?.trim(); if (next) setImportSubject(next); }}><Plus className="h-4 w-4" /></Button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="pyq-import-chapter">Chapter</label>
            <div className="mt-1 flex gap-2">
              <select id="pyq-import-chapter" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" value={importChapterMode === "detected" ? "__detected__" : importChapter} onChange={(event) => { const value = event.target.value; if (value === "__detected__") { setImportChapterMode("detected"); return; } setImportChapterMode("single"); setImportChapter(value); }} disabled={!importSubject.trim()}>
                <option value="__detected__">Keep chapters from HTML ({importChapters.length})</option>
                {availableImportChapters.map((chapter) => <option key={chapter} value={chapter}>{chapter}</option>)}
              </select>
              <Button type="button" variant="outline" size="icon" aria-label="Add chapter" title="Add chapter" disabled={!importSubject.trim()} onClick={() => { const next = window.prompt("New chapter name", importChapter)?.trim(); if (next) { setImportChapter(next); setImportChapterMode("single"); } }}><Plus className="h-4 w-4" /></Button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Target: {importSubject || "Select a subject"} · {importChapterLabel}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 md:col-span-2">
            <div><p className="font-semibold text-emerald-900">{importSubject || parsedImport.subject}</p><p className="text-xs text-emerald-800">{fileName} · {parsedImport.questions.length} questions · {importChapterLabel}</p></div>
            <div className="flex items-center gap-2"><Button type="button" size="sm" disabled={importMutation.isPending || !importSubject.trim() || (importChapterMode === "single" && !importChapter.trim())} onClick={() => importMutation.mutate()}><Upload size={15} />{importMutation.isPending ? `${importProgress}%` : "Import"}</Button>{importMutation.isPending ? <div className="h-2 w-20 overflow-hidden rounded-full bg-emerald-100"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${importProgress}%` }} /></div> : null}</div>
          </div>
        </CardContent>
      </Card> : null}

      {parsedImport ? <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle>Import preview</CardTitle><p className="text-sm text-slate-500">Preview is read-only by default. Enable editing to modify text and images before importing.</p></div><Button type="button" variant={previewEditing ? "default" : "outline"} size="sm" onClick={() => setPreviewEditing((enabled) => !enabled)}><Pencil className="mr-1.5 h-4 w-4" />{previewEditing ? "Editing enabled" : "Enable editing"}</Button></CardHeader>
        <CardContent className="max-h-[75vh] space-y-5 overflow-y-auto overscroll-contain pr-3">
          <input ref={questionImageInputRef} className="hidden" type="file" accept="image/*" onChange={handleQuestionImageFile} />
          {parsedImport.questions.map((question, questionIndex) => <section key={`${question.chapter}-${question.year}-${questionIndex}`} className="space-y-4 rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-500">Question {questionIndex + 1} · {question.chapter}{formatImportYearLabel(parsedImport.exam || selectedExamKey, question.year) ? ` · ${formatImportYearLabel(parsedImport.exam || selectedExamKey, question.year)}` : ""}</div>
            <EditableRichContent label="Question text" content={question.question} editingEnabled={previewEditing} onChange={(content) => updateImportedQuestion(questionIndex, { question: content })} onCropImage={(src) => openImportCrop(questionIndex, src, { kind: "rich", field: "question" })} />
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void handleQuestionImageDrop(event, questionIndex)}>
              {question.imageData ? <img src={question.imageData} alt="Question figure" className="max-h-56 max-w-full rounded-lg border border-slate-200 object-contain" /> : <p className="text-sm text-slate-500">No separate question image added.</p>}
              {previewEditing ? <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setImageTargetIndex(questionIndex); questionImageInputRef.current?.click(); }}><ImagePlus className="mr-1.5 h-4 w-4" />{question.imageData ? "Replace image" : "Add image"}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleQuestionImagePaste(questionIndex)}><ClipboardPaste className="mr-1.5 h-4 w-4" />Paste image</Button>
                {question.imageData ? <Button type="button" variant="outline" size="sm" onClick={() => openImportCrop(questionIndex, question.imageData!, { kind: "question-image" })}><Crop className="mr-1.5 h-4 w-4" />Crop</Button> : null}
              </div> : null}
            </div>
            {question.questionType === "integer" ? <ImportNumericAnswer question={question} editing={previewEditing} onChange={(update) => updateImportedQuestion(questionIndex, update)} /> : <><div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-orange-800">Correct answer</p><p className="text-xs text-orange-700">{question.questionType === "multi" ? "Select all correct options" : "Click one option to set the answer"}</p></div><div className="mt-2 flex flex-wrap gap-2">{question.options.map((_option, optionIndex) => { const selected = question.correctAnswers.includes(optionIndex); return <button key={optionIndex} type="button" onClick={() => setImportedCorrectAnswer(questionIndex, optionIndex)} className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition ${selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-orange-300 bg-white text-orange-800 hover:border-orange-500 hover:bg-orange-100"}`} aria-pressed={selected}>{String.fromCharCode(65 + optionIndex)}{selected ? " ✓" : ""}</button>; })}</div></div>
            <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Options</p>{question.options.map((option, optionIndex) => { const selected = question.correctAnswers.includes(optionIndex); return <div key={optionIndex} className={`flex gap-3 rounded-lg border p-3 ${selected ? "border-emerald-300 bg-emerald-50/40" : ""}`}><span className="pt-3 font-semibold">{String.fromCharCode(65 + optionIndex)}.{selected ? <span className="ml-1 text-xs text-emerald-700">✓</span> : null}</span><div className="min-w-0 flex-1"><EditableRichContent label="" content={option} editingEnabled={previewEditing} onChange={(content) => updateImportedQuestion(questionIndex, { options: question.options.map((current, index) => index === optionIndex ? content : current) })} onCropImage={(src) => openImportCrop(questionIndex, src, { kind: "rich", field: "option", optionIndex })} /></div></div>; })}</div></>}
            {question.explanation ? <div className="rounded-lg bg-emerald-50 p-4"><EditableRichContent label="Solution" content={question.explanation} editingEnabled={previewEditing} onChange={(content) => updateImportedQuestion(questionIndex, { explanation: content })} onCropImage={(src) => openImportCrop(questionIndex, src, { kind: "rich", field: "explanation" })} /></div> : <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 p-3"><p className="mb-2 text-sm text-emerald-800">No solution text. Add it below if required.</p><EditableRichContent label="Solution" content="" editingEnabled={previewEditing} onChange={(content) => updateImportedQuestion(questionIndex, { explanation: content || null })} onCropImage={(src) => openImportCrop(questionIndex, src, { kind: "rich", field: "explanation" })} /></div>}
          </section>)}
        </CardContent>
      </Card> : null}

      <Dialog open={Boolean(cropState)} onOpenChange={(open) => { if (!open) setCropState(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Free crop image</DialogTitle><DialogDescription>Drag the crop box and resize it with the handles.</DialogDescription></DialogHeader>
          {cropState ? <FreeCropEditor src={cropState.src} onCancel={() => setCropState(null)} onApply={async (rect) => { try { const cropped = await cropImage({ ...cropState, ...rect }); const target = cropState.target; const currentQuestion = parsedImport?.questions[cropState.questionIndex]; if (!currentQuestion) return; if (target.kind === "question-image") { updateImportedQuestion(cropState.questionIndex, { imageData: cropped }); } else { const fieldContent = target.field === "question" ? currentQuestion.question : target.field === "explanation" ? currentQuestion.explanation ?? "" : currentQuestion.options[target.optionIndex ?? 0] ?? ""; const updatedContent = replaceFirstImageInHtml(fieldContent, cropped); if (target.field === "question") updateImportedQuestion(cropState.questionIndex, { question: updatedContent }); else if (target.field === "explanation") updateImportedQuestion(cropState.questionIndex, { explanation: updatedContent || null }); else updateImportedQuestion(cropState.questionIndex, { options: currentQuestion.options.map((option, optionIndex) => optionIndex === (target.optionIndex ?? 0) ? updatedContent : option) }); } setCropState(null); toast({ title: "Image cropped" }); } catch (error) { toast({ title: "Crop failed", description: error instanceof Error ? error.message : "Could not crop image", variant: "destructive" }); } }} /> : null}
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Card className="border-orange-100">
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><BarChart3 size={18} className="text-orange-500" /> Student PYQ progress</CardTitle></CardHeader>
          <CardContent>
            {progressQuery.isLoading ? <p className="py-6 text-sm text-slate-500">Loading progress...</p> : progressQuery.isError ? <p className="py-6 text-sm text-red-600">{(progressQuery.error as Error).message}</p> : <div className="grid grid-cols-2 gap-3">
              <AdminProgressStat label="Students" value={progressQuery.data?.students ?? 0} />
              <AdminProgressStat label="Attempted questions" value={progressQuery.data?.attemptedQuestions ?? 0} />
              <AdminProgressStat label="Solved questions" value={progressQuery.data?.solvedQuestions ?? 0} />
              <AdminProgressStat label="Total attempts" value={progressQuery.data?.attempts ?? 0} />
              <AdminProgressStat label="Correct attempts" value={progressQuery.data?.correctAttempts ?? 0} />
              <AdminProgressStat label="Accuracy" value={`${progressQuery.data?.accuracy ?? 0}%`} />
            </div>}
          </CardContent>
        </Card>

        <Card className="border-rose-100">
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Flag size={18} className="text-rose-500" /> Student reports <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">{visibleReports.length} open</span></CardTitle></CardHeader>
          <CardContent>
            {reportsQuery.isLoading ? <p className="py-6 text-sm text-slate-500">Loading reports...</p> : reportsQuery.isError ? <p className="py-6 text-sm text-red-600">{(reportsQuery.error as Error).message}</p> : visibleReports.length === 0 ? <p className="py-6 text-sm text-slate-500">No open student reports.</p> : <div className="max-h-[430px] space-y-3 overflow-y-auto pr-1">
              {visibleReports.map((report) => <div key={report.id} className="rounded-2xl border border-border bg-card p-4 text-card-foreground">
                <div className="flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-muted px-2.5 py-1">{report.subject} · {report.chapter} · {report.year}</span><span className="rounded-full bg-muted px-2.5 py-1">by {report.reporterName || "Student"}</span></div>
                <RichQuestionContent content={report.questionText} className="mt-3 max-h-24 overflow-hidden text-sm font-medium" />
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-rose-600 dark:text-rose-400">{report.reason}</p>
                <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => setEditingReport(report)}><Pencil className="mr-1.5 h-4 w-4" />Open &amp; fix</Button><Button type="button" variant="outline" size="sm" disabled={rejectReportMutation.isPending} onClick={() => rejectReportMutation.mutate(report)}>Reject</Button></div>
              </div>)}
            </div>}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200">
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><BookOpen size={18} className="text-orange-500" /> PYQ subjects and chapters</CardTitle></CardHeader>
        <CardContent>
          {!selectedSubject ? (
            subjectsQuery.isLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading subjects...</p> : subjectsQuery.isError ? <p className="py-8 text-center text-sm text-red-600">{(subjectsQuery.error as Error).message}</p> : subjectsQuery.data?.subjects.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No PYQ subjects uploaded yet.</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{subjectsQuery.data?.subjects.map((item, index) => { const accent = getSubjectAccent(item.subject, index); return <div key={`${item.exam}-${item.subject}`} className="rounded-2xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" style={{ background: accent.bg, borderColor: accent.border }}><button type="button" onClick={() => { setSelectedSubject(item); setSelectedChapter(null); }} className="w-full text-left"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: accent.badgeBg }}><SubjectThemeIcon label={item.subject} index={index} className="h-6 w-6" color={accent.text} /></div><h3 className="font-semibold text-slate-900">{item.subject}</h3><p className="mt-1 text-sm text-slate-500">{item.exam}</p><div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-600"><span className="rounded-full bg-white/80 px-2.5 py-1">{item.chapterCount} chapters</span><span className="rounded-full bg-white/80 px-2.5 py-1">{item.questionCount} questions</span></div></button>{!deletionLocked ? <Button type="button" variant="outline" size="sm" aria-label="Delete subject" title="Delete subject" className="mt-3 h-8 w-8 border-rose-200 p-0 text-rose-600 hover:bg-rose-50" disabled={deleteSubjectMutation.isPending} onClick={() => { if (window.confirm(`Delete subject ${item.subject}? All its chapters and questions will be deleted.`)) deleteSubjectMutation.mutate({ exam: item.exam, subject: item.subject }); }}><Trash2 size={14} /></Button> : null}</div>; })}</div>
          ) : (
            <div className="space-y-5">
              {!selectedChapter && !deletionLocked ? <div className="flex justify-end"><Button type="button" variant="outline" size="sm" disabled={renameSubjectMutation.isPending} onClick={() => { const nextSubject = window.prompt("New subject name", selectedSubject.subject)?.trim(); if (nextSubject && nextSubject !== selectedSubject.subject) renameSubjectMutation.mutate({ exam: selectedSubject.exam, subject: selectedSubject.subject, nextSubject }); }}><Pencil className="mr-1.5 h-4 w-4" /> Rename subject</Button></div> : null}
              <div className="flex flex-wrap items-center gap-2 text-sm"><Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedSubject(null); setSelectedChapter(null); }}><ArrowLeft className="mr-1 h-4 w-4" /> Subjects</Button><ChevronRight className="h-4 w-4 text-slate-300" /><span className="font-semibold text-slate-800">{selectedSubject.subject}</span>{selectedChapter ? <><ChevronRight className="h-4 w-4 text-slate-300" /><span className="font-semibold text-slate-800">{selectedChapter.chapter}</span></> : null}</div>
              {!selectedChapter ? chaptersQuery.isLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading chapters...</p> : chaptersQuery.isError ? <p className="py-8 text-center text-sm text-red-600">{(chaptersQuery.error as Error).message}</p> : chaptersQuery.data?.chapters.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No chapters found for this subject.</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{chaptersQuery.data?.chapters.map((item, index) => <div key={item.chapter} className="rounded-2xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" style={{ background: selectedSubjectAccent.bg, borderColor: selectedSubjectAccent.border }}><button type="button" onClick={() => setSelectedChapter(item)} className="w-full text-left"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: selectedSubjectAccent.badgeBg }}><ChapterThemeIcon label={item.chapter} index={index} className="h-5 w-5" color={selectedSubjectTheme.color} /></div><h3 className="font-semibold text-slate-900">{item.chapter}</h3><p className="mt-1 text-sm text-slate-500">Chapter {item.chapterOrder + 1}</p><div className="mt-3 flex gap-2 text-xs font-medium text-slate-600"><span className="rounded-full bg-white/80 px-2.5 py-1">{item.questionCount} questions</span><span className="rounded-full bg-white/80 px-2.5 py-1">{item.attemptedCount ?? 0} attempted</span></div></button><div className="mt-3 flex items-center gap-2">{!deletionLocked ? <Button type="button" variant="outline" size="sm" aria-label="Rename chapter" title="Rename chapter" className="h-8 w-8 border-orange-200 p-0 text-orange-600 hover:bg-orange-50" disabled={renameChapterMutation.isPending} onClick={() => { const nextChapter = window.prompt("New chapter name", item.chapter)?.trim(); if (nextChapter && nextChapter !== item.chapter) renameChapterMutation.mutate({ exam: selectedSubject.exam, subject: selectedSubject.subject, chapter: item.chapter, nextChapter }); }}><Pencil size={14} /></Button> : null}{!deletionLocked ? <Button type="button" variant="outline" size="sm" aria-label="Delete chapter" title="Delete chapter" className="h-8 w-8 border-rose-200 p-0 text-rose-600 hover:bg-rose-50" disabled={deleteChapterMutation.isPending} onClick={() => { if (window.confirm(`Delete chapter ${item.chapter}? All its questions will be deleted.`)) deleteChapterMutation.mutate({ exam: selectedSubject.exam, subject: selectedSubject.subject, chapter: item.chapter }); }}><Trash2 size={14} /></Button> : null}</div></div>)}</div> : <div className="rounded-2xl border p-5" style={{ background: selectedSubjectAccent.bg, borderColor: selectedSubjectAccent.border }}><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: selectedSubjectAccent.badgeBg }}><SubjectThemeIcon label={selectedSubject.subject} className="h-5 w-5" color={selectedSubjectTheme.color} /></div><div><h3 className="font-semibold text-slate-900">{selectedChapter.chapter}</h3><p className="text-sm text-slate-500">{selectedSubject.subject} · {selectedChapter.questionCount} questions</p></div></div><Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => setSelectedChapter(null)}><ArrowLeft className="mr-1 h-4 w-4" /> Back to chapters</Button></div>}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedChapter ? <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle>{selectedChapter.chapter} questions ({visibleQuestions.length})</CardTitle><div className="relative"><Button type="button" variant="outline" size="icon" className={`h-8 w-8 rounded-lg ${hasActiveFilters ? "border-orange-300 bg-orange-50 text-orange-700" : "text-slate-500"}`} aria-label="Open filters" title="Filters" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal className="h-3.5 w-3.5" />{hasActiveFilters ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500" /> : null}</Button>{filtersOpen ? <div className="absolute right-0 top-10 z-20 grid w-56 gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"><label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type<select className="mt-1 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | "mcq" | "multi" | "integer")}><option value="all">All types</option><option value="mcq">MCQ</option><option value="multi">MSQ</option><option value="integer">NAT</option></select></label><label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Marks<select className="mt-1 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs" value={markFilter} onChange={(event) => setMarkFilter(event.target.value as "all" | "1" | "2")}><option value="all">All marks</option><option value="1">1 mark</option><option value="2">2 marks</option></select></label><label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Year<input type="number" min="1900" max="2200" placeholder="All years" className="mt-1 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs" value={yearFilter === "all" ? "" : yearFilter} onChange={(event) => setYearFilter(event.target.value || "all")} /></label></div> : null}</div></CardHeader>
        <CardContent>
          {questionsQuery.isLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading chapter questions...</p> : questionsQuery.isError ? <p className="py-8 text-center text-sm text-red-600">{(questionsQuery.error as Error).message}</p> : visibleQuestions.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No questions in this chapter.</p> : (
            <div className="space-y-3">{visibleQuestions.map((item) => { const displayOptions = getPyqDisplayOptions(item.question, item.options); return <div key={item.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="mb-2 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-orange-50 px-2.5 py-1 text-orange-700">{item.exam}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{item.subject} · {item.chapter} · {item.year}</span>{item.paper ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{item.paper}</span> : null}</div><RichQuestionContent content={stripRepeatedPyqOptions(item.question, displayOptions)} className="text-sm font-medium text-slate-800" />{item.imageData ? <img src={item.imageData} alt="Question figure" className="mt-3 max-h-52 max-w-full rounded-lg border border-slate-200 object-contain" /> : null}<div className="mt-3 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">{displayOptions.map((option, index) => <div key={index} className={index === item.correctAnswer ? "font-semibold text-emerald-700" : ""}><span className="mr-1">{String.fromCharCode(65 + index)}.</span><RichQuestionContent content={option} className="inline" /></div>)}</div></div>{!deletionLocked ? <Button type="button" variant="outline" size="sm" aria-label="Delete question" title="Delete question" className="border-rose-200 text-rose-600 hover:bg-rose-50" disabled={deleteMutation.isPending} onClick={() => { if (window.confirm(`Delete this question from ${item.exam}? This also removes its saved state, progress and reports.`)) deleteMutation.mutate({ id: item.id, exam: item.exam }); }}><Trash2 size={14} /> Delete</Button> : null}</div></div>; })}</div>
          )}
        </CardContent>
      </Card> : null}
    </div>
  );
}

function AdminProgressStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-900">{value}</p></div>;
}
