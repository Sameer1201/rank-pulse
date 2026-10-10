import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Clock,
  Calendar,
  CheckCircle,
  TrendingUp,
  Award,
  Target,
  BookOpen,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { buildApiUrl } from "@/lib/api-origin";

type QuestionType = "mcq" | "multi" | "integer";
type TestCategory = "mock" | "subject-wise" | "multi-subject" | "pyq";

interface Question {
  id: number;
  questionType: QuestionType;
  correctAnswer?: number | null;
  correctAnswerMulti?: number[] | null;
  correctAnswerMin?: number | null;
  correctAnswerMax?: number | null;
}

interface Submission {
  score: number;
  totalPoints: number;
  percentage: number;
  submittedAt: string;
  answers: string;
}

interface TestData {
  id: number;
  title: string;
  description: string | null;
  examType: string | null;
  examHeader: string | null;
  examSubheader: string | null;
  examConfig: Record<string, unknown> | null;
  durationMinutes: number;
  scheduledAt: string | null;
  subjectName?: string | null;
  chapterName?: string | null;
  className?: string | null;
  sections: Array<{ subjectLabel?: string | null; title?: string }>;
  questions: Question[];
  submission: Submission | null;
}

function normalizeExamConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeTestCategory(raw: unknown): TestCategory {
  if (typeof raw !== "string") return "mock";
  const n = raw.trim().toLowerCase();
  if (n === "subject-wise" || n === "chapter-wise" || n === "chapter" || n === "subject") return "subject-wise";
  if (n === "multi-subject" || n === "topic-wise" || n === "topic") return "multi-subject";
  if (n === "pyq" || n === "previous year" || n === "previous-year") return "pyq";
  return "mock";
}

function getTestCategoryLabel(cat: TestCategory) {
  if (cat === "subject-wise") return "Subject Wise";
  if (cat === "multi-subject") return "Chapter Wise";
  if (cat === "pyq") return "PYQ";
  return "Mock Test";
}

function getTestCategoryColors(cat: TestCategory) {
  if (cat === "subject-wise") return { bg: "#ecfeff", text: "#0e7490", border: "#a5f3fc" };
  if (cat === "multi-subject") return { bg: "#f5f3ff", text: "#7c3aed", border: "#ddd6fe" };
  if (cat === "pyq") return { bg: "#ecfdf5", text: "#047857", border: "#6ee7b7" };
  return { bg: "#fff7ed", text: "#ea580c", border: "#fed7aa" };
}

function getSubjectLabel(data: TestData) {
  return (
    data.subjectName?.trim() ||
    data.chapterName?.trim() ||
    data.className?.trim() ||
    data.examSubheader?.trim() ||
    data.examHeader?.trim() ||
    "General"
  );
}

function computeAnsweredAndCorrect(questions: Question[], answersJson: string) {
  let answers: Record<string, unknown> = {};
  try { answers = JSON.parse(answersJson); } catch { /**/ }

  let answered = 0;
  let correct = 0;

  for (const q of questions) {
    const raw = answers[String(q.id)];
    const hasAnswer = (() => {
      if (raw === undefined || raw === null || raw === "") return false;
      if (q.questionType === "multi") return Array.isArray(raw) && raw.length > 0;
      if (q.questionType === "integer") {
        const s = String(raw).trim();
        return s !== "" && s !== "-" && s !== ".";
      }
      return true;
    })();

    if (!hasAnswer) continue;
    answered++;

    if (q.questionType === "mcq") {
      if (typeof raw === "number" && raw === q.correctAnswer) correct++;
    } else if (q.questionType === "multi") {
      if (Array.isArray(raw) && Array.isArray(q.correctAnswerMulti)) {
        const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
        if (JSON.stringify(sorted(raw as number[])) === JSON.stringify(sorted(q.correctAnswerMulti))) correct++;
      }
    } else if (q.questionType === "integer") {
      const val = parseFloat(String(raw));
      if (!isNaN(val)) {
        if (q.correctAnswerMin != null && q.correctAnswerMax != null) {
          if (val >= q.correctAnswerMin && val <= q.correctAnswerMax) correct++;
        } else if (q.correctAnswer != null && Math.abs(val - q.correctAnswer) < 0.0001) {
          correct++;
        }
      }
    }
  }

  return { answered, correct };
}

function AnimatedNumber({ value, duration = 1200, suffix = "" }: { value: number; duration?: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    let current = 0;
    const step = value / (duration / 16);
    const timer = setInterval(() => {
      current += step;
      if (current >= value) {
        setDisplay(value);
        clearInterval(timer);
      } else {
        setDisplay(Math.floor(current));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [value, duration]);

  return <>{display}{suffix}</>;
}

function CircularProgress({ percentage }: { percentage: number }) {
  const size = 72;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const arcColor = percentage < 30 ? "#f97316" : percentage < 60 ? "#eab308" : "#22c55e";

  const [offset, setOffset] = useState(circumference);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(circumference * (1 - percentage / 100));
    }, 60);
    return () => clearTimeout(timer);
  }, [percentage, circumference]);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={arcColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div
        className="absolute"
        style={{
          width: size,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          top: 0,
          left: 0,
          height: size,
          transform: "none",
        }}
      >
        <span className="text-[13px] font-black text-[#0f172a]">{Math.round(percentage)}%</span>
      </div>
      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#94a3b8] mt-1">accuracy</span>
    </div>
  );
}

function CircularProgressWrapper({ percentage }: { percentage: number }) {
  const size = 72;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcColor = percentage < 30 ? "#f97316" : percentage < 60 ? "#eab308" : "#22c55e";

  const [offset, setOffset] = useState(circumference);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(circumference * (1 - percentage / 100));
    }, 60);
    return () => clearTimeout(timer);
  }, [percentage, circumference]);

  return (
    <div className="flex flex-col items-center gap-0">
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arcColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", lineHeight: 1 }}>
            {Math.round(percentage)}%
          </span>
        </div>
      </div>
      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#94a3b8", marginTop: 6 }}>
        accuracy
      </span>
    </div>
  );
}

export default function TestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const cardRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = useQuery<TestData>({
    queryKey: ["test-detail-page", id],
    queryFn: async () => {
      const r = await fetch(buildApiUrl(`/api/tests/${id}`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load test");
      return r.json();
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateY(20px) scale(0.97)";
    const timer = requestAnimationFrame(() => {
      el.style.transition = "opacity 400ms ease, transform 400ms cubic-bezier(0.34,1.56,0.64,1)";
      el.style.opacity = "1";
      el.style.transform = "translateY(0) scale(1)";
    });
    return () => cancelAnimationFrame(timer);
  }, []);

  if (isLoading) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #f0f4ff 0%, #fdf4ff 50%, #fff7f0 100%)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid #e2e8f0", borderTopColor: "#6366f1", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Loading result…</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #f0f4ff 0%, #fdf4ff 50%, #fff7f0 100%)" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#64748b", fontSize: 15 }}>Could not load test result.</p>
          <button onClick={() => setLocation("/student/tests")} style={{ marginTop: 16, color: "#6366f1", fontSize: 13, fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>← Back to Tests</button>
        </div>
      </div>
    );
  }

  const sub = data.submission;
  const examConfig = normalizeExamConfig(data.examConfig);
  const category = normalizeTestCategory(examConfig.testCategory ?? "");
  const categoryLabel = getTestCategoryLabel(category);
  const categoryColors = getTestCategoryColors(category);
  const subjectLabel = getSubjectLabel(data);
  const percentage = Math.round(Number(sub?.percentage ?? 0));
  const score = sub ? Math.round(Number(sub.score) * 100) / 100 : 0;
  const maxScore = sub ? Math.round(Number(sub.totalPoints) * 100) / 100 : 0;
  const totalQ = data.questions.length;

  const { answered, correct } = sub
    ? computeAnsweredAndCorrect(data.questions, sub.answers)
    : { answered: 0, correct: 0 };

  const incorrect = Math.max(0, answered - correct);
  const notAnswered = Math.max(0, totalQ - answered);

  const descriptionText = data.description?.trim() &&
    !/^imported from saved html\s*:/i.test(data.description) ? data.description : null;

  const subtitleText = data.examSubheader?.trim() || data.examType?.trim() || null;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "linear-gradient(135deg, #f0f4ff 0%, #fdf4ff 50%, #fff7f0 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .tdr-stat-card { border-radius: 14px; padding: 12px 10px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
        .tdr-btn { flex: 1; border-radius: 12px; padding: 11px 16px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; display: flex; align-items: center; justify-content: center; gap: 7px; transition: all 0.18s ease; }
      `}</style>

      <div
        ref={cardRef}
        style={{
          width: "100%",
          maxWidth: 512,
          backgroundColor: "#ffffff",
          borderRadius: 20,
          boxShadow: "0 20px 60px rgba(99,102,241,0.12)",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {/* Top stripe */}
        <div style={{ height: 4, background: "linear-gradient(90deg, #f97316, #a855f7, #6366f1)" }} />

        {/* Header */}
        <div style={{ padding: "20px 24px 16px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            {/* Left: pills + title + subtitle + description */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {/* Subject pill - purple */}
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999,
                  background: "#ede9fe", color: "#7c3aed", border: "1px solid #c4b5fd",
                  whiteSpace: "nowrap",
                }}>
                  {subjectLabel}
                </span>
                {/* Category pill */}
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999,
                  background: categoryColors.bg, color: categoryColors.text,
                  border: `1px solid ${categoryColors.border}`,
                  whiteSpace: "nowrap",
                }}>
                  {categoryLabel}
                </span>
              </div>

              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", lineHeight: 1.35, margin: 0, marginBottom: subtitleText ? 4 : 0 }}>
                {data.title}
              </h2>

              {subtitleText && (
                <p style={{ fontSize: 13, fontWeight: 600, color: "#6366f1", margin: "0 0 4px" }}>
                  {subtitleText}
                </p>
              )}

              {descriptionText && (
                <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {descriptionText}
                </p>
              )}
            </div>

            {/* Right: circular progress */}
            {sub && <CircularProgressWrapper percentage={percentage} />}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "#f1f5f9", margin: "0 24px" }} />

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "16px 24px" }}>
          {/* Questions */}
          <div className="tdr-stat-card" style={{ background: "#f5f3ff", border: "1px solid #ddd6fe" }}>
            <FileText size={16} color="#7c3aed" />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{totalQ}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginTop: 2 }}>total questions</div>
            </div>
          </div>
          {/* Duration */}
          <div className="tdr-stat-card" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
            <Clock size={16} color="#ea580c" />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{data.durationMinutes}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginTop: 2 }}>minutes</div>
            </div>
          </div>
        </div>

        {/* Dates row */}
        <div style={{ padding: "0 24px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Scheduled */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#64748b", fontSize: 13, fontWeight: 500 }}>
              <Calendar size={14} />
              Scheduled Date
            </div>
            {data.scheduledAt && new Date(data.scheduledAt).getTime() <= Date.now() ? (
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>
                Available now
              </span>
            ) : data.scheduledAt ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
                {format(new Date(data.scheduledAt), "MMM d, yyyy")}
              </span>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>
                Available now
              </span>
            )}
          </div>

          {/* Completed */}
          {sub && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#64748b", fontSize: 13, fontWeight: 500 }}>
                <CheckCircle size={14} color="#16a34a" />
                Completed Date
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
                {format(new Date(sub.submittedAt), "MMM d, yyyy 'at' h:mm aa")}
              </span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "#f1f5f9", margin: "0 24px" }} />

        {/* Performance Breakdown */}
        {sub && (
          <div style={{ padding: "16px 24px" }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.16em", textTransform: "uppercase", margin: "0 0 10px" }}>
              Performance Breakdown
            </p>

            {/* Top row: 3 cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              {/* Total Marks - orange */}
              <div className="tdr-stat-card" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
                <Award size={13} color="#ea580c" />
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
                  <AnimatedNumber value={score} />
                  <span style={{ fontSize: 11, fontWeight: 500, color: "#94a3b8" }}>/{maxScore}</span>
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>Total Marks</div>
              </div>

              {/* Accuracy - purple */}
              <div className="tdr-stat-card" style={{ background: "#f5f3ff", border: "1px solid #ddd6fe" }}>
                <Target size={13} color="#7c3aed" />
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
                  <AnimatedNumber value={percentage} suffix="%" />
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>Accuracy</div>
              </div>

              {/* Total Qs - indigo */}
              <div className="tdr-stat-card" style={{ background: "#eef2ff", border: "1px solid #c7d2fe" }}>
                <BookOpen size={13} color="#6366f1" />
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
                  <AnimatedNumber value={totalQ} />
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>Total Qs</div>
              </div>
            </div>

            {/* Bottom row: 2 cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {/* Answered - green */}
              <div className="tdr-stat-card" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <CheckCircle2 size={13} color="#16a34a" />
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
                  <AnimatedNumber value={answered} />
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>Answered</div>
              </div>

              {/* Not Answered - red */}
              <div className="tdr-stat-card" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
                <XCircle size={13} color="#dc2626" />
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
                  <AnimatedNumber value={notAnswered} />
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>Not Answered</div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
          {/* Close */}
          <button
            className="tdr-btn"
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#64748b" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc"; }}
            onClick={() => setLocation("/student/tests")}
          >
            Close
          </button>

          {/* Full Analysis */}
          <button
            className="tdr-btn"
            style={{
              background: "linear-gradient(135deg, #f97316, #a855f7)",
              color: "#ffffff",
              boxShadow: "0 4px 16px rgba(249,115,22,0.30)",
            }}
            onMouseEnter={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.transform = "translateY(-1px)";
              b.style.boxShadow = "0 6px 20px rgba(249,115,22,0.40)";
            }}
            onMouseLeave={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.transform = "translateY(0)";
              b.style.boxShadow = "0 4px 16px rgba(249,115,22,0.30)";
            }}
            onClick={() => setLocation(`/student/tests/${id}/analysis`)}
          >
            <TrendingUp size={15} />
            Full Analysis
          </button>
        </div>
      </div>
    </div>
  );
}
