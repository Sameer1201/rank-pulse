import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  FileText,
  Lock,
  Pencil,
  Plus,
  Search,
  Target,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { buildApiUrl } from "@/lib/api-origin";

const SUBJECT_COLORS = ["#f97316", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6"];

const TAG_COLORS: Record<string, string> = {
  Core: "bg-blue-100 text-blue-700 border-blue-200",
  Important: "bg-orange-100 text-orange-700 border-orange-200",
  "Weak Area": "bg-red-100 text-red-700 border-red-200",
  Optional: "bg-gray-100 text-gray-700 border-gray-200",
};

interface QuestionItem {
  id: number;
}

interface ChapterItem {
  id: number;
  title: string;
  description?: string | null;
  targetQuestions?: number | null;
  questions: QuestionItem[];
}

interface SubjectItem {
  id: number;
  title: string;
  description?: string | null;
  teacherId?: number | null;
  teacherName?: string | null;
  teacherUsername?: string | null;
  chapters: ChapterItem[];
}

interface QuestionBankDetailResponse {
  class: { id: number; title: string; subject: string; isLocked?: boolean };
  subjects: SubjectItem[];
  savedBucket: QuestionItem[];
}

interface DecoratedChapter extends ChapterItem {
  chapterNumber: number;
  tag: "Core" | "Important" | "Weak Area" | "Optional";
  questionsUploaded: number;
  questionsTarget: number;
}

interface DecoratedSubject extends SubjectItem {
  abbreviation: string;
  color: string;
  chapterCount: number;
  questionsUploaded: number;
  questionsTarget: number;
  chapters: DecoratedChapter[];
}

interface TeacherSummary {
  key: string;
  name: string;
  username?: string | null;
  assignedSubjects: Array<{ id: number; abbreviation: string; color: string }>;
  questionsUploaded: number;
}

interface BulkOutlineSubject {
  title: string;
  chapters: string[];
}

function getInitials(name?: string | null) {
  if (!name) return "PL";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getSubjectAbbreviation(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "SB";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function getChapterTarget(chapter: ChapterItem) {
  return Math.max(chapter.targetQuestions ?? 0, chapter.questions.length);
}

function getCompletion(uploaded: number, target: number) {
  if (target <= 0) return uploaded > 0 ? 100 : 0;
  return Math.min(Math.round((uploaded / target) * 100), 100);
}

function getChapterTag(chapter: ChapterItem): DecoratedChapter["tag"] {
  const uploaded = chapter.questions.length;
  const target = getChapterTarget(chapter);
  const progress = getCompletion(uploaded, target);

  if (progress >= 100) return "Core";
  if (progress < 40) return "Weak Area";
  if (target >= 50) return "Important";
  return "Optional";
}

function parseBulkOutline(value: string): BulkOutlineSubject[] {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const subjects: BulkOutlineSubject[] = [];
  let current: BulkOutlineSubject | null = null;

  for (const line of lines) {
    const subjectMatch = line.match(/^(?:[^A-Za-z0-9]*\s*)?\d+[.)]\s+(.+)$/);
    if (subjectMatch) {
      current = { title: subjectMatch[1]!.trim(), chapters: [] };
      subjects.push(current);
      continue;
    }

    if (!current) {
      current = { title: line, chapters: [] };
      subjects.push(current);
      continue;
    }

    current.chapters.push(line.replace(/^[•\-–—]\s*/, "").trim());
  }

  return subjects
    .map((subject) => ({
      title: subject.title,
      chapters: subject.chapters.filter(Boolean),
    }))
    .filter((subject) => subject.title);
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry, index) => (
        <p key={`${entry.name}-${index}`} style={{ color: entry.color }} className="text-xs">
          {entry.name}: {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
        </p>
      ))}
    </div>
  );
}

export default function PlannerQuestionBankDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const classId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const basePath = "/super-admin";
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [subjectDialogMode, setSubjectDialogMode] = useState<"create" | "edit">("create");
  const [chapterDialogMode, setChapterDialogMode] = useState<"create" | "edit">("create");
  const [editingSubjectId, setEditingSubjectId] = useState<number | null>(null);
  const [editingChapterId, setEditingChapterId] = useState<number | null>(null);
  const [subjectToDelete, setSubjectToDelete] = useState<DecoratedSubject | null>(null);
  const [chapterToDelete, setChapterToDelete] = useState<DecoratedChapter | null>(null);
  const [questionBankDeleteOpen, setQuestionBankDeleteOpen] = useState(false);
  const [subjectTitle, setSubjectTitle] = useState("");
  const [subjectDescription, setSubjectDescription] = useState("");
  const [subjectError, setSubjectError] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterDescription, setChapterDescription] = useState("");
  const [chapterTargetQuestions, setChapterTargetQuestions] = useState("");
  const [chapterError, setChapterError] = useState("");
  const [bulkOutline, setBulkOutline] = useState("");
  const [bulkError, setBulkError] = useState("");

  const { data: detail, isLoading: detailLoading } = useQuery<QuestionBankDetailResponse>({
    queryKey: ["planner-question-bank-detail", classId],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/question-bank/classes/${classId}`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load question bank detail");
      return response.json();
    },
    enabled: Number.isInteger(classId) && classId > 0,
  });

  const invalidateDetail = () => {
    queryClient.invalidateQueries({ queryKey: ["planner-question-bank-detail", classId] });
    queryClient.invalidateQueries({ queryKey: ["planner-question-bank-cards"] });
  };

  const resetSubjectDialog = () => {
    setSubjectDialogOpen(false);
    setSubjectDialogMode("create");
    setEditingSubjectId(null);
    setSubjectTitle("");
    setSubjectDescription("");
    setSubjectError("");
  };

  const resetChapterDialog = () => {
    setChapterDialogOpen(false);
    setChapterDialogMode("create");
    setEditingChapterId(null);
    setChapterTitle("");
    setChapterDescription("");
    setChapterTargetQuestions("");
    setChapterError("");
  };

  const saveSubjectMutation = useMutation({
    mutationFn: async () => {
      const isEditing = subjectDialogMode === "edit" && editingSubjectId !== null;
      const response = await fetch(
        isEditing
          ? buildApiUrl(`/api/question-bank/subjects/${editingSubjectId}`)
          : buildApiUrl(`/api/question-bank/classes/${classId}/subjects`),
        {
          method: isEditing ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: subjectTitle.trim(),
            description: subjectDescription.trim() || undefined,
          }),
        },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed to ${isEditing ? "update" : "add"} subject`);
      }

      return response.json();
    },
    onSuccess: (saved: { id?: number }) => {
      invalidateDetail();
      resetSubjectDialog();
      if (typeof saved?.id === "number") setSelectedSubjectId(saved.id);
      toast({ title: subjectDialogMode === "edit" ? "Subject updated" : "Subject added" });
    },
    onError: (error: Error) => {
      setSubjectError(error.message);
    },
  });

  const saveChapterMutation = useMutation({
    mutationFn: async () => {
      const isEditing = chapterDialogMode === "edit" && editingChapterId !== null;
      const subjectId = activeSubject?.id;

      if (!isEditing && !subjectId) {
        throw new Error("Select a subject first.");
      }

      const response = await fetch(
        isEditing
          ? buildApiUrl(`/api/question-bank/chapters/${editingChapterId}`)
          : buildApiUrl(`/api/question-bank/subjects/${subjectId}/chapters`),
        {
          method: isEditing ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: chapterTitle.trim(),
            description: chapterDescription.trim() || undefined,
            targetQuestions: chapterTargetQuestions.trim() ? Math.max(Number(chapterTargetQuestions) || 0, 0) : 0,
          }),
        },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed to ${isEditing ? "update" : "add"} chapter`);
      }

      return response.json();
    },
    onSuccess: () => {
      invalidateDetail();
      resetChapterDialog();
      if (activeSubject?.id) setSelectedSubjectId(activeSubject.id);
      toast({ title: chapterDialogMode === "edit" ? "Chapter updated" : "Chapter added" });
    },
    onError: (error: Error) => {
      setChapterError(error.message);
    },
  });

  const deleteSubjectMutation = useMutation({
    mutationFn: async (subjectId: number) => {
      const response = await fetch(buildApiUrl(`/api/question-bank/subjects/${subjectId}`), {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to delete subject");
      }
    },
    onSuccess: () => {
      invalidateDetail();
      setSubjectToDelete(null);
      setSelectedSubjectId(null);
      toast({ title: "Subject deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not delete subject", description: error.message, variant: "destructive" });
    },
  });

  const deleteChapterMutation = useMutation({
    mutationFn: async (chapterId: number) => {
      const response = await fetch(buildApiUrl(`/api/question-bank/chapters/${chapterId}`), {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to delete chapter");
      }
    },
    onSuccess: () => {
      invalidateDetail();
      setChapterToDelete(null);
      toast({ title: "Chapter deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not delete chapter", description: error.message, variant: "destructive" });
    },
  });

  const deleteQuestionBankMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(buildApiUrl(`/api/question-bank/cards/${classId}`), {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to delete question bank");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planner-question-bank-cards"] });
      queryClient.removeQueries({ queryKey: ["planner-question-bank-detail", classId] });
      setQuestionBankDeleteOpen(false);
      toast({
        title: "Question bank deleted",
        description: "The active question bank has been removed.",
      });
      setLocation(`${basePath}/question-bank`);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not delete question bank",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const examSubjects = useMemo<DecoratedSubject[]>(() => {
    return (detail?.subjects ?? []).map((subject, index) => {
      const chapters = subject.chapters.map((chapter, chapterIndex) => {
        const questionsUploaded = chapter.questions.length;
        const questionsTarget = getChapterTarget(chapter);
        return {
          ...chapter,
          chapterNumber: chapterIndex + 1,
          tag: getChapterTag(chapter),
          questionsUploaded,
          questionsTarget,
        };
      });

      return {
        ...subject,
        abbreviation: getSubjectAbbreviation(subject.title),
        color: SUBJECT_COLORS[index % SUBJECT_COLORS.length]!,
        chapterCount: chapters.length,
        questionsUploaded: chapters.reduce((sum, chapter) => sum + chapter.questionsUploaded, 0),
        questionsTarget: chapters.reduce((sum, chapter) => sum + chapter.questionsTarget, 0),
        chapters,
      };
    });
  }, [detail?.subjects]);

  const activeSubject = useMemo(() => {
    if (selectedSubjectId) {
      return examSubjects.find((subject) => subject.id === selectedSubjectId) ?? examSubjects[0];
    }
    return examSubjects[0];
  }, [examSubjects, selectedSubjectId]);

  const isLocked = Boolean(detail?.class.isLocked);

  const bulkImportMutation = useMutation({
    mutationFn: async () => {
      if (isLocked) {
        throw new Error("This question bank is locked. Unlock it from the active question bank card first.");
      }
      const parsedSubjects = parseBulkOutline(bulkOutline);
      if (parsedSubjects.length === 0) {
        throw new Error("Paste at least one subject with chapters.");
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      const response = await fetch(buildApiUrl(`/api/question-bank/classes/${classId}/structure-sync`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects: parsedSubjects }),
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to sync structure.");
      }

      return response.json();
    },
    onSuccess: ({ createdSubjects, createdChapters, firstSubjectId }) => {
      invalidateDetail();
      setBulkDialogOpen(false);
      setBulkOutline("");
      setBulkError("");
      if (firstSubjectId) setSelectedSubjectId(firstSubjectId);
      toast({
        title: "Question bank updated",
        description: `${createdSubjects} subjects and ${createdChapters} chapters synced.`,
      });
    },
    onError: (error: Error) => {
      if (error.name === "AbortError") {
        setBulkError("Sync took too long. Please try again in a moment.");
        return;
      }
      setBulkError(error.message);
    },
  });

  const openCreateSubjectDialog = () => {
    if (isLocked) {
      toast({
        title: "Question bank locked",
        description: "Unlock this question bank from the active card before editing subjects or chapters.",
        variant: "destructive",
      });
      return;
    }
    resetSubjectDialog();
    setSubjectDialogMode("create");
    setSubjectDialogOpen(true);
  };

  const openEditSubjectDialog = (subject: DecoratedSubject) => {
    if (isLocked) {
      toast({
        title: "Question bank locked",
        description: "Unlock this question bank from the active card before editing subjects or chapters.",
        variant: "destructive",
      });
      return;
    }
    setSubjectDialogMode("edit");
    setEditingSubjectId(subject.id);
    setSubjectTitle(subject.title);
    setSubjectDescription(subject.description ?? "");
    setSubjectError("");
    setSubjectDialogOpen(true);
  };

  const openCreateChapterDialog = () => {
    if (isLocked) {
      toast({
        title: "Question bank locked",
        description: "Unlock this question bank from the active card before editing subjects or chapters.",
        variant: "destructive",
      });
      return;
    }
    resetChapterDialog();
    setChapterDialogMode("create");
    setChapterDialogOpen(true);
  };

  const openEditChapterDialog = (chapter: DecoratedChapter) => {
    if (isLocked) {
      toast({
        title: "Question bank locked",
        description: "Unlock this question bank from the active card before editing subjects or chapters.",
        variant: "destructive",
      });
      return;
    }
    setChapterDialogMode("edit");
    setEditingChapterId(chapter.id);
    setChapterTitle(chapter.title);
    setChapterDescription(chapter.description ?? "");
    setChapterTargetQuestions(String(chapter.questionsTarget));
    setChapterError("");
    setChapterDialogOpen(true);
  };

  const teacherSummaries = useMemo<TeacherSummary[]>(() => {
    const map = new Map<string, TeacherSummary>();

    examSubjects.forEach((subject) => {
      const key = String(subject.teacherId ?? subject.title);
      const existing = map.get(key);
      const entry = existing ?? {
        key,
        name: subject.teacherName ?? "Assigned teacher",
        username: subject.teacherUsername ?? null,
        assignedSubjects: [],
        questionsUploaded: 0,
      };

      entry.assignedSubjects.push({
        id: subject.id,
        abbreviation: subject.abbreviation,
        color: subject.color,
      });
      entry.questionsUploaded += subject.questionsUploaded;
      map.set(key, entry);
    });

    return Array.from(map.values()).sort((left, right) => right.questionsUploaded - left.questionsUploaded);
  }, [examSubjects]);

  const subjectBarData = useMemo(
    () =>
      examSubjects.map((subject) => ({
        name: subject.abbreviation,
        Uploaded: subject.questionsUploaded,
        Remaining: Math.max(subject.questionsTarget - subject.questionsUploaded, 0),
        color: subject.color,
      })),
    [examSubjects],
  );

  const tagPieData = useMemo(() => {
    if (!activeSubject) return [];
    const tagCounts = activeSubject.chapters.reduce<Record<string, number>>((accumulator, chapter) => {
      accumulator[chapter.tag] = (accumulator[chapter.tag] || 0) + 1;
      return accumulator;
    }, {});
    return Object.entries(tagCounts).map(([name, value]) => ({ name, value }));
  }, [activeSubject]);

  const tagColorMap: Record<string, string> = {
    Core: "#3b82f6",
    Important: "#f97316",
    "Weak Area": "#ef4444",
    Optional: "#9ca3af",
  };

  const chapterBarData = useMemo(
    () =>
      activeSubject?.chapters.map((chapter) => ({
        name: `Ch ${chapter.chapterNumber}`,
        Uploaded: chapter.questionsUploaded,
        Target: chapter.questionsTarget,
      })) ?? [],
    [activeSubject],
  );

  const filteredChapters = useMemo(() => {
    if (!activeSubject) return [];
    const term = searchQuery.trim().toLowerCase();
    if (!term) return activeSubject.chapters;
    return activeSubject.chapters.filter((chapter) => {
      return chapter.title.toLowerCase().includes(term) || String(chapter.chapterNumber).includes(term);
    });
  }, [activeSubject, searchQuery]);

  const handleAddSubject = () => {
    setSubjectError("");
    if (!subjectTitle.trim()) {
      setSubjectError("Subject title is required.");
      return;
    }
    saveSubjectMutation.mutate();
  };

  const handleAddChapter = () => {
    setChapterError("");
    if (chapterDialogMode === "create" && !activeSubject) {
      setChapterError("Select a subject first.");
      return;
    }
    if (!chapterTitle.trim()) {
      setChapterError("Chapter title is required.");
      return;
    }
    saveChapterMutation.mutate();
  };

  const handleBulkImport = () => {
    setBulkError("");
    if (isLocked) {
      setBulkError("This question bank is locked. Unlock it from the active question bank card first.");
      return;
    }
    if (!bulkOutline.trim()) {
      setBulkError("Paste the subject and chapter outline first.");
      return;
    }
    bulkImportMutation.mutate();
  };

  if (detailLoading) {
    return (
      <div className="space-y-6">
        <div className="h-28 w-full rounded-2xl bg-muted animate-pulse" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <div className="space-y-6 lg:col-span-3">
            <div className="h-28 rounded-2xl bg-muted animate-pulse" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="h-72 rounded-2xl bg-muted animate-pulse" />
              <div className="h-72 rounded-2xl bg-muted animate-pulse" />
            </div>
            <div className="h-80 rounded-2xl bg-muted animate-pulse" />
          </div>
          <div className="h-96 rounded-2xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
        Question bank not found.
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <div className="flex items-center text-sm text-muted-foreground mb-2 space-x-1">
          <Link href={`${basePath}/question-bank`}>
            <span className="hover:text-foreground cursor-pointer transition-colors">Question Bank</span>
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground font-medium">{detail.class.title}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{detail.class.title} Question Bank</h1>
            <p className="text-muted-foreground mt-1">
              {`Manage subject names, chapters, and uploads for ${detail.class.subject}.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setBulkDialogOpen(true)} disabled={isLocked}>
              <FileText className="h-4 w-4" /> Paste Syllabus
            </Button>
            <Button variant="outline" className="gap-2" onClick={openCreateSubjectDialog} disabled={isLocked}>
              <Plus className="h-4 w-4" /> Add Subject
            </Button>
            <Button
              variant="outline"
              className="gap-2 text-destructive hover:text-destructive"
              onClick={() => setQuestionBankDeleteOpen(true)}
              disabled={isLocked}
            >
              <Trash2 className="h-4 w-4" /> Delete Question Bank
            </Button>
            <Button
              className="gap-2"
              disabled={isLocked}
              onClick={() =>
                toast({
                  title: "Assign Teacher",
                  description: "Teacher assignment UI clone is shown here; backend wiring stays separate for now.",
                })
              }
            >
              <UserPlus className="h-4 w-4" /> Assign Teacher
            </Button>
          </div>
        </div>
      </div>

      {isLocked ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <Lock className="h-4 w-4" />
          <AlertDescription>
            This question bank is locked. Subject, chapter, and syllabus sync edits are disabled until it is unlocked from the active question bank card.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <div>
            <h3 className="text-lg font-semibold mb-3">Subjects</h3>
            <div className="flex overflow-x-auto pb-4 gap-3 snap-x">
              {examSubjects.length === 0 ? (
                <Card className="min-w-full">
                  <CardContent className="p-8 text-center text-muted-foreground">
                    No subjects added yet.
                  </CardContent>
                </Card>
              ) : (
                examSubjects.map((subject) => {
                  const isSelected = subject.id === activeSubject?.id;
                  const progress = getCompletion(subject.questionsUploaded, subject.questionsTarget);

                  return (
                    <div
                      key={subject.id}
                      onClick={() => setSelectedSubjectId(subject.id)}
                      className={`shrink-0 snap-start flex flex-col gap-3 p-4 rounded-xl border cursor-pointer transition-all min-w-[220px] ${
                        isSelected
                          ? "border-primary ring-1 ring-primary/20 bg-primary/5"
                          : "border-border bg-card hover:border-border/80 hover:bg-accent/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex items-center justify-center h-10 w-10 rounded-full font-bold text-white shrink-0"
                          style={{ backgroundColor: subject.color }}
                        >
                          {subject.abbreviation}
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <h4 className="font-semibold text-sm truncate">{subject.title}</h4>
                          <p className="text-xs text-muted-foreground">{subject.chapterCount} Chapters</p>
                        </div>
                      </div>
                      <div className="space-y-1.5 mt-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Progress</span>
                          <span className="font-medium">{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Subject Upload vs Target</CardTitle>
                <CardDescription className="text-xs">Questions uploaded vs target per subject</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={subjectBarData} barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="Uploaded" stackId="a" radius={[0, 0, 0, 0]}>
                      {subjectBarData.map((entry, index) => (
                        <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                    <Bar dataKey="Remaining" stackId="a" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {activeSubject && tagPieData.length > 0 ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Chapter Tags — {activeSubject.title}</CardTitle>
                  <CardDescription className="text-xs">Distribution of chapter difficulty tags</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie
                        data={tagPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={60}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {tagPieData.map((entry, index) => (
                          <Cell key={`${entry.name}-${index}`} fill={tagColorMap[entry.name] || "#ccc"} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
                    {tagPieData.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-1 text-xs text-muted-foreground">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tagColorMap[entry.name] || "#ccc" }} />
                        {entry.name} ({entry.value})
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {activeSubject && chapterBarData.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Chapter-wise Progress — {activeSubject.title}</CardTitle>
                <CardDescription className="text-xs">Uploaded vs target questions for each chapter</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chapterBarData} barSize={14} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={36}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: "11px" }}
                      formatter={(value) => <span style={{ color: "hsl(var(--foreground))" }}>{value}</span>}
                    />
                    <Bar dataKey="Target" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Uploaded" fill={activeSubject.color} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ) : null}

          {activeSubject ? (
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/40 pb-4">
                <div>
                  <CardTitle className="text-xl flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: activeSubject.color }} />
                    {activeSubject.title} Chapters
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {activeSubject.description || "Manage chapter-wise question targets and uploads."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search chapters..."
                      className="pl-9 w-[220px] bg-muted/50"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </div>
                  {!isLocked ? (
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => openEditSubjectDialog(activeSubject)}>
                      <Pencil className="h-4 w-4" /> Edit Subject
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 text-destructive hover:text-destructive"
                    onClick={() => setSubjectToDelete(activeSubject)}
                    disabled={isLocked}
                  >
                    <Trash2 className="h-4 w-4" /> Delete Subject
                  </Button>
                  <Button variant="secondary" size="sm" className="gap-2" onClick={openCreateChapterDialog} disabled={isLocked}>
                    <Plus className="h-4 w-4" /> Add Chapter
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border/40">
                  {filteredChapters.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      No chapters found matching "{searchQuery}"
                    </div>
                  ) : (
                    filteredChapters.map((chapter) => {
                      const progress = getCompletion(chapter.questionsUploaded, chapter.questionsTarget);
                      return (
                        <div
                          key={chapter.id}
                          className="p-4 hover:bg-muted/30 transition-colors flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group"
                        >
                          <div className="flex gap-4 items-start sm:items-center flex-1">
                            <div className="bg-muted text-muted-foreground w-10 h-10 rounded-lg flex items-center justify-center font-semibold shrink-0">
                              {chapter.chapterNumber}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h5 className="font-semibold">{chapter.title}</h5>
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded-full border ${TAG_COLORS[chapter.tag]} font-medium`}
                                >
                                  {chapter.tag}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                  <Target className="h-3.5 w-3.5" /> Target: {chapter.questionsTarget}
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Uploaded: {chapter.questionsUploaded}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-6 w-full sm:w-auto">
                            <div className="w-full sm:w-32 space-y-1.5">
                              <div className="flex justify-between text-xs">
                                <span className="font-medium text-foreground">{progress}%</span>
                              </div>
                              <Progress value={progress} className="h-2" />
                            </div>
                            <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              {!isLocked ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0"
                                  onClick={() => openEditChapterDialog(chapter)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="shrink-0 text-destructive hover:text-destructive"
                                onClick={() => setChapterToDelete(chapter)}
                                disabled={isLocked}
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
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card className="border-border/50 shadow-sm sticky top-6">
            <CardHeader className="pb-4 border-b border-border/40">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Assigned Teachers
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 p-0">
              <div className="divide-y divide-border/40">
                {teacherSummaries.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No teachers assigned yet.
                  </div>
                ) : (
                  teacherSummaries.map((teacher) => (
                    <div key={teacher.key} className="p-4 hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 border border-border/50">
                          <AvatarFallback className="bg-primary/10 text-primary font-medium">
                            {getInitials(teacher.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 overflow-hidden">
                          <h5 className="font-medium text-sm truncate">{teacher.name}</h5>
                          <p className="text-xs text-muted-foreground truncate">
                            {teacher.username ? `@${teacher.username}` : "Assigned teacher"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                          Handling Subjects
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {teacher.assignedSubjects.map((subject) => (
                            <Badge key={subject.id} variant="outline" className="text-xs font-normal bg-card">
                              <div className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: subject.color }} />
                              {subject.abbreviation}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-border/40 flex justify-between items-center text-sm">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" /> Total Uploads
                        </span>
                        <span className="font-semibold">{teacher.questionsUploaded}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="p-4 border-t border-border/40">
                <Button
                  variant="outline"
                  className="w-full text-primary border-primary/20 hover:bg-primary/5"
                  onClick={() =>
                    toast({
                      title: "View All Teachers",
                      description: "Teacher list UI is cloned here; full management can be connected separately.",
                    })
                  }
                >
                  View All Teachers
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={bulkDialogOpen} onOpenChange={(open) => {
        setBulkDialogOpen(open);
        if (!open) {
          setBulkError("");
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste Subject + Chapter Outline</DialogTitle>
            <DialogDescription>
              Paste the syllabus in the same format as your GATE ECE list. Numbered lines become subjects, and the lines below them become chapters.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {bulkError ? (
              <Alert variant="destructive">
                <AlertDescription>{bulkError}</AlertDescription>
              </Alert>
            ) : null}

            {isLocked ? (
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertDescription>
                  This question bank is currently locked. Unlock it from the active question bank card to sync subjects and chapters.
                </AlertDescription>
              </Alert>
            ) : null}

            <Textarea
              value={bulkOutline}
              onChange={(event) => setBulkOutline(event.target.value)}
              rows={16}
              placeholder={"1. Engineering Mathematics\nLinear Algebra\nCalculus\n2. Networks\nCircuit laws\nNetwork theorems"}
              className="font-mono text-sm"
              disabled={isLocked || bulkImportMutation.isPending}
            />

            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleBulkImport} disabled={isLocked || bulkImportMutation.isPending}>
                {bulkImportMutation.isPending ? "Syncing..." : "Sync Structure"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={subjectDialogOpen} onOpenChange={(open) => (open ? setSubjectDialogOpen(true) : resetSubjectDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{subjectDialogMode === "edit" ? "Edit Subject" : "Add Subject"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {subjectError ? (
              <Alert variant="destructive">
                <AlertDescription>{subjectError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label>Subject Name</Label>
              <Input
                value={subjectTitle}
                onChange={(event) => setSubjectTitle(event.target.value)}
                placeholder="e.g. Mathematics, Organic Chemistry"
                disabled={isLocked || saveSubjectMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={subjectDescription}
                onChange={(event) => setSubjectDescription(event.target.value)}
                placeholder="Scope or notes for this subject…"
                rows={4}
                disabled={isLocked || saveSubjectMutation.isPending}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetSubjectDialog}>Cancel</Button>
              <Button className="min-w-[140px]" onClick={handleAddSubject} disabled={isLocked || saveSubjectMutation.isPending}>
                {saveSubjectMutation.isPending ? "Saving..." : subjectDialogMode === "edit" ? "Save Subject" : "Add Subject"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={chapterDialogOpen} onOpenChange={(open) => (open ? setChapterDialogOpen(true) : resetChapterDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{chapterDialogMode === "edit" ? "Edit Chapter" : "Add Chapter"}</DialogTitle>
            {activeSubject ? (
              <DialogDescription>
                {chapterDialogMode === "edit"
                  ? `Update chapter details for ${activeSubject.title}.`
                  : `Add a new chapter under ${activeSubject.title}.`}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {chapterError ? (
              <Alert variant="destructive">
                <AlertDescription>{chapterError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label>Chapter Name</Label>
              <Input
                value={chapterTitle}
                onChange={(event) => setChapterTitle(event.target.value)}
                placeholder="e.g. Network Theorems"
                disabled={isLocked || saveChapterMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={chapterDescription}
                onChange={(event) => setChapterDescription(event.target.value)}
                placeholder="Add a short chapter brief…"
                rows={3}
                disabled={isLocked || saveChapterMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Target Questions</Label>
              <Input
                type="number"
                min="0"
                value={chapterTargetQuestions}
                onChange={(event) => setChapterTargetQuestions(event.target.value)}
                placeholder="50"
                disabled={isLocked || saveChapterMutation.isPending}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetChapterDialog}>Cancel</Button>
              <Button className="min-w-[140px]" onClick={handleAddChapter} disabled={isLocked || saveChapterMutation.isPending}>
                {saveChapterMutation.isPending ? "Saving..." : chapterDialogMode === "edit" ? "Save Chapter" : "Add Chapter"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!subjectToDelete} onOpenChange={(open) => !open && setSubjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete subject?</AlertDialogTitle>
            <AlertDialogDescription>
              {subjectToDelete
                ? `${subjectToDelete.title} and all of its chapters will be removed from this active question bank.`
                : "This subject will be removed from the question bank."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => subjectToDelete && deleteSubjectMutation.mutate(subjectToDelete.id)}
              disabled={isLocked || deleteSubjectMutation.isPending}
            >
              {deleteSubjectMutation.isPending ? "Deleting..." : "Delete Subject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!chapterToDelete} onOpenChange={(open) => !open && setChapterToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chapter?</AlertDialogTitle>
            <AlertDialogDescription>
              {chapterToDelete
                ? `${chapterToDelete.title} will be removed from ${activeSubject?.title ?? "this subject"}.`
                : "This chapter will be removed from the subject."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => chapterToDelete && deleteChapterMutation.mutate(chapterToDelete.id)}
              disabled={isLocked || deleteChapterMutation.isPending}
            >
              {deleteChapterMutation.isPending ? "Deleting..." : "Delete Chapter"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={questionBankDeleteOpen} onOpenChange={setQuestionBankDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete question bank?</AlertDialogTitle>
            <AlertDialogDescription>
              {`${detail.class.title} and all of its subjects, chapters, and questions will be removed permanently.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteQuestionBankMutation.mutate()}
              disabled={isLocked || deleteQuestionBankMutation.isPending}
            >
              {deleteQuestionBankMutation.isPending ? "Deleting..." : "Delete Question Bank"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
