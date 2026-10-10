import { useEffect, useRef, useState } from "react";
import { Award, BookOpen, Calendar, CheckCircle, CheckCircle2, Clock, FileText, Target, TrendingUp, XCircle } from "lucide-react";
import { format } from "date-fns";
import AiTestFocusMap from "@/components/student/AiTestFocusMap";

interface Submission {
  score: number;
  totalPoints: number;
  percentage: number;
  passed: boolean;
  submittedAt: string;
  answers: string;
  visitedQuestionIds?: number[] | null;
}

interface AnalysisQ {
  isCorrect?: boolean;
  isSkipped?: boolean;
}

interface TestResultDetailCardProps {
  testId?: number;
  title: string;
  description?: string | null;
  examHeader?: string | null;
  examSubheader?: string | null;
  scheduledAt?: string | null;
  durationMinutes: number;
  submission: Submission;
  questionCount: number;
  answeredCount: number;
  analysisQs?: AnalysisQ[];
  categoryLabel?: string | null;
  subjectLabel?: string | null;
  onClose: () => void;
  onFullAnalysis: () => void;
}

function AnimatedNumber({ value, suffix = "", duration = 1200 }: { value: number; suffix?: string; duration?: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    let current = 0;
    const step = value / (duration / 16);
    const id = setInterval(() => {
      current += step;
      if (current >= value) {
        setDisplay(value);
        clearInterval(id);
      } else {
        setDisplay(Math.floor(current));
      }
    }, 16);
    return () => clearInterval(id);
  }, [value, duration]);

  return <>{display}{suffix}</>;
}

function CircularProgress({ percentage }: { percentage: number }) {
  const size = 72;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const [offset, setOffset] = useState(circumference);
  const [displayPct, setDisplayPct] = useState(0);

  const arcColor =
    percentage < 30 ? "#f97316" : percentage < 60 ? "#eab308" : "#22c55e";

  useEffect(() => {
    const target = circumference - (percentage / 100) * circumference;
    const timer = setTimeout(() => setOffset(target), 50);
    return () => clearTimeout(timer);
  }, [percentage, circumference]);

  useEffect(() => {
    let current = 0;
    const step = percentage / (1200 / 16);
    const id = setInterval(() => {
      current += step;
      if (current >= percentage) {
        setDisplayPct(Math.round(percentage));
        clearInterval(id);
      } else {
        setDisplayPct(Math.floor(current));
      }
    }, 16);
    return () => clearInterval(id);
  }, [percentage]);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
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
          style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
        />
      </svg>
      <div
        style={{
          marginTop: -(size + 4),
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="text-sm font-black text-[#0f172a]">{displayPct}%</span>
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-[#94a3b8]" style={{ marginTop: 2 }}>accuracy</span>
    </div>
  );
}

export default function TestResultDetailCard({
  testId,
  title,
  description,
  examHeader,
  examSubheader,
  scheduledAt,
  durationMinutes,
  submission,
  questionCount,
  answeredCount,
  analysisQs = [],
  categoryLabel,
  subjectLabel,
  onClose,
  onFullAnalysis,
}: TestResultDetailCardProps) {
  const [visible, setVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const score = Math.round((typeof submission.score === "number" ? submission.score : Number(submission.score ?? 0)) * 100) / 100;
  const maxScore = Math.round((typeof submission.totalPoints === "number" ? submission.totalPoints : Number(submission.totalPoints ?? 0)) * 100) / 100;
  const accuracy = Math.round(Number(submission.percentage ?? 0));
  const notAnswered = Math.max(0, questionCount - answeredCount);
  const correctCount = analysisQs.filter((q) => q.isCorrect).length;
  const incorrectCount = analysisQs.filter((q) => !q.isCorrect && !q.isSkipped).length;
  const hasAnalysis = analysisQs.length > 0;

  return (
    <div
      className="test-result-detail-card"
      ref={cardRef}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(20px) scale(0.97)",
        transition: "opacity 400ms ease, transform 400ms ease",
        maxWidth: 512,
        width: "100%",
        margin: "0 auto",
        background: "#ffffff",
        borderRadius: 16,
        border: "1px solid #e2e8f0",
        boxShadow: "0 20px 60px rgba(99,102,241,0.12)",
        overflow: "hidden",
      }}
    >
      {/* Top gradient stripe */}
      <div
        style={{
          height: 4,
          background: "linear-gradient(90deg, #f97316, #a855f7, #6366f1)",
        }}
      />

      {/* Header */}
      <div style={{ padding: "20px 24px 16px" }}>
        <div className="flex items-start justify-between gap-4">
          {/* Left */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-2 mb-3">
              {subjectLabel && (
                <span
                  data-result-tone="violet"
                  style={{
                    background: "#ede9fe",
                    color: "#7c3aed",
                    border: "1px solid #ddd6fe",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 10px",
                    letterSpacing: "0.02em",
                  }}
                >
                  {subjectLabel}
                </span>
              )}
              {categoryLabel && (
                <span
                  data-result-tone="orange"
                  style={{
                    background: "#fff7ed",
                    color: "#ea580c",
                    border: "1px solid #fed7aa",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 10px",
                    letterSpacing: "0.02em",
                  }}
                >
                  {categoryLabel}
                </span>
              )}
            </div>
            <p className="font-bold text-base text-[#0f172a] leading-snug">{title}</p>
            {description && (
              <p className="mt-1 text-xs text-[#94a3b8] leading-relaxed line-clamp-2">{description}</p>
            )}
          </div>

          {/* Right: circular ring */}
          <div className="shrink-0">
            <CircularProgress percentage={accuracy} />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "#f1f5f9", margin: "0 24px" }} />

      {/* Stats row */}
      <div style={{ padding: "16px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div
          data-result-tone="violet"
          style={{
            background: "#f5f3ff",
            border: "1px solid #ddd6fe",
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <FileText size={18} color="#7c3aed" />
          <div>
            <p style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", lineHeight: 1 }}>{questionCount}</p>
            <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginTop: 2 }}>Questions total</p>
          </div>
        </div>
        <div
          data-result-tone="orange"
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Clock size={18} color="#ea580c" />
          <div>
            <p style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", lineHeight: 1 }}>{durationMinutes}</p>
            <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginTop: 2 }}>minutes</p>
          </div>
        </div>
      </div>

      {/* Dates row */}
      <div style={{ padding: "0 24px 16px" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs text-[#64748b]">
            <Calendar size={13} />
            <span>Scheduled Date</span>
          </div>
          {scheduledAt ? (
            <span className="text-xs font-semibold text-[#334155]">
              {format(new Date(scheduledAt), "MMM d, yyyy")}
            </span>
          ) : (
            <span
              data-result-tone="green"
              style={{
                background: "#f0fdf4",
                color: "#16a34a",
                border: "1px solid #bbf7d0",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 10px",
              }}
            >
              Available now
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-[#64748b]">
            <CheckCircle size={13} color="#16a34a" />
            <span>Completed Date</span>
          </div>
          <span className="text-xs font-semibold text-[#334155]">
            {format(new Date(submission.submittedAt), "MMM d, yyyy 'at' h:mm aa")}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "#f1f5f9", margin: "0 24px" }} />

      {/* Performance Breakdown */}
      <div style={{ padding: "16px 24px" }}>
        {testId ? <AiTestFocusMap testId={testId} label="Performance Breakdown" /> : <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginBottom: 10,
          }}
        >Performance Breakdown</p>}

        {/* Top 3 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div
            data-result-tone="orange"
            style={{
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              borderRadius: 10,
              padding: "10px 8px",
              textAlign: "center",
            }}
          >
            <Award size={14} color="#ea580c" style={{ margin: "0 auto 4px" }} />
            <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Marks</p>
            <p style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
              <AnimatedNumber value={score} />
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>/{maxScore}</span>
            </p>
          </div>
          <div
            data-result-tone="violet"
            style={{
              background: "#f5f3ff",
              border: "1px solid #ddd6fe",
              borderRadius: 10,
              padding: "10px 8px",
              textAlign: "center",
            }}
          >
            <Target size={14} color="#7c3aed" style={{ margin: "0 auto 4px" }} />
            <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Accuracy</p>
            <p style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
              <AnimatedNumber value={accuracy} suffix="%" />
            </p>
          </div>
          <div
            data-result-tone="indigo"
            style={{
              background: "#eef2ff",
              border: "1px solid #c7d2fe",
              borderRadius: 10,
              padding: "10px 8px",
              textAlign: "center",
            }}
          >
            <BookOpen size={14} color="#6366f1" style={{ margin: "0 auto 4px" }} />
            <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Qs</p>
            <p style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
              <AnimatedNumber value={questionCount} />
            </p>
          </div>
        </div>

        {/* Bottom 2 */}
        {hasAnalysis ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div
              data-result-tone="green"
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 10,
                padding: "10px 8px",
                textAlign: "center",
              }}
            >
              <CheckCircle2 size={14} color="#16a34a" style={{ margin: "0 auto 4px" }} />
              <p style={{ fontSize: 10, fontWeight: 600, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.08em" }}>Correct</p>
              <p style={{ fontSize: 17, fontWeight: 900, color: "#16a34a", marginTop: 2 }}>
                <AnimatedNumber value={correctCount} />
              </p>
            </div>
            <div
              data-result-tone="red"
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 10,
                padding: "10px 8px",
                textAlign: "center",
              }}
            >
              <XCircle size={14} color="#dc2626" style={{ margin: "0 auto 4px" }} />
              <p style={{ fontSize: 10, fontWeight: 600, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.08em" }}>Incorrect</p>
              <p style={{ fontSize: 17, fontWeight: 900, color: "#dc2626", marginTop: 2 }}>
                <AnimatedNumber value={incorrectCount} />
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div
              data-result-tone="green"
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 10,
                padding: "10px 8px",
                textAlign: "center",
              }}
            >
              <CheckCircle2 size={14} color="#16a34a" style={{ margin: "0 auto 4px" }} />
              <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Answered</p>
              <p style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
                <AnimatedNumber value={answeredCount} />
              </p>
            </div>
            <div
              data-result-tone="red"
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 10,
                padding: "10px 8px",
                textAlign: "center",
              }}
            >
              <XCircle size={14} color="#dc2626" style={{ margin: "0 auto 4px" }} />
              <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Not Answered</p>
              <p style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
                <AnimatedNumber value={notAnswered} />
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
        <button
          onClick={onClose}
          className="test-result-close-button"
          style={{
            flex: 1,
            padding: "10px 0",
            borderRadius: 10,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            color: "#64748b",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
            transition: "background 200ms",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8fafc")}
        >
          Close
        </button>
        <button
          onClick={onFullAnalysis}
          style={{
            flex: 1,
            padding: "10px 0",
            borderRadius: 10,
            background: "linear-gradient(135deg, #f97316, #a855f7)",
            border: "none",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            boxShadow: "0 4px 16px rgba(249,115,22,0.3)",
            transition: "transform 200ms, box-shadow 200ms",
          }}
          onMouseEnter={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.transform = "translateY(-1px)";
            btn.style.boxShadow = "0 6px 20px rgba(249,115,22,0.4)";
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.transform = "translateY(0)";
            btn.style.boxShadow = "0 4px 16px rgba(249,115,22,0.3)";
          }}
        >
          <TrendingUp size={15} />
          Full Analysis
        </button>
      </div>
    </div>
  );
}
