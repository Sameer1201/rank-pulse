import { useEffect, useMemo, useState } from "react";

import { RichQuestionContent } from "@/components/ui/rich-question-content";
import { questionHistoryData, questionJourneyData, type QuestionHistoryItem, type QuestionVisit } from "@/data/testData";

function StatusIcon({ status }: { status: QuestionVisit["status"] }) {
  if (status === "correct") {
    return (
      <svg className="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" />
      </svg>
    );
  }
  if (status === "wrong") {
    return (
      <svg className="h-4 w-4 text-red-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M14 6l-8 8" />
      </svg>
    );
  }
  if (status === "skipped") {
    return (
      <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
        <path d="M4 5l6 5-6 5V5zm7 0l6 5-6 5V5z" />
      </svg>
    );
  }
  if (status === "markedReview") {
    return (
      <svg className="h-3.5 w-4 text-indigo-500" viewBox="0 0 14 18" fill="currentColor">
        <path d="M0 0h14v18l-7-4-7 4V0z" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-4 text-indigo-300" viewBox="0 0 14 18" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M1 1h12v15l-6-3.5L1 16V1z" />
    </svg>
  );
}

function QualityIcon({ quality }: { quality: QuestionVisit["quality"] }) {
  if (quality === "perfect") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-green-500">
        <svg className="h-2.5 w-2.5 text-green-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-8" />
        </svg>
      </span>
    );
  }
  if (quality === "wasted") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-red-500">
        <svg className="h-2.5 w-2.5 text-red-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M14 6l-8 8" />
        </svg>
      </span>
    );
  }
  if (quality === "overtime") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-orange-500">
        <svg className="h-2.5 w-2.5 text-orange-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="10" cy="10" r="7" />
          <path strokeLinecap="round" d="M10 6v4l2 2" />
        </svg>
      </span>
    );
  }
  if (quality === "confused") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-indigo-500">
        <svg className="h-2.5 w-2.5 text-indigo-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="10" cy="10" r="7" />
          <path strokeLinecap="round" d="M7 8c0-1.657 1.343-3 3-3s3 1.343 3 3c0 2-3 2-3 4" />
          <circle cx="10" cy="15" r="0.5" fill="currentColor" />
        </svg>
      </span>
    );
  }
  return (
    <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
      <path d="M4 5l6 5-6 5V5zm7 0l6 5-6 5V5z" />
    </svg>
  );
}

function statusChip(item: QuestionHistoryItem) {
  if (item.status === "correct") return "bg-green-50 text-green-700 border-green-200";
  if (item.status === "wrong") return "bg-red-50 text-red-700 border-red-200";
  if (item.status === "markedReview") return "bg-indigo-50 text-indigo-700 border-indigo-200";
  if (item.status === "unmarkedReview") return "bg-violet-50 text-violet-700 border-violet-200";
  return "bg-gray-50 text-gray-600 border-gray-200";
}

function qualityChip(item: QuestionHistoryItem) {
  if (item.quality === "perfect") return "bg-green-50 text-green-700 border-green-200";
  if (item.quality === "wasted") return "bg-red-50 text-red-700 border-red-200";
  if (item.quality === "overtime") return "bg-orange-50 text-orange-700 border-orange-200";
  if (item.quality === "confused") return "bg-indigo-50 text-indigo-700 border-indigo-200";
  return "bg-gray-50 text-gray-600 border-gray-200";
}

function QuestionBubble({
  visit,
  active,
  showQuality,
  onClick,
}: {
  visit: QuestionVisit;
  active: boolean;
  showQuality: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-11 flex-col items-center transition-all ${active ? "scale-105" : "hover:-translate-y-0.5"}`}
    >
      <div className="relative">
        {visit.timesOpened && visit.timesOpened > 1 ? (
          <span className={`absolute -right-2 -top-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${active ? "bg-[#1F2937] text-white" : "bg-indigo-50 text-indigo-600"}`}>
            {visit.timesOpened}
          </span>
        ) : null}
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-medium shadow-sm transition-all ${
            active
              ? "border-[#111827] bg-[#111827] text-white"
              : "border-gray-300 bg-white text-gray-700 group-hover:border-[#D97706] group-hover:text-[#D97706]"
          }`}
        >
          {visit.questionNo}
        </div>
      </div>
      <div className="mt-1.5 flex h-5 items-center justify-center">
        {showQuality ? <QualityIcon quality={visit.quality} /> : <StatusIcon status={visit.status} />}
      </div>
    </button>
  );
}

function DetailPanel({ item }: { item: QuestionHistoryItem | null }) {
  if (!item) {
    return (
      <div className="rounded-[28px] border border-dashed border-[#E5E7EB] bg-[#FCFCFD] px-5 py-12 text-center text-sm font-medium text-[#6B7280]">
        Select any question to see full answer/review history.
      </div>
    );
  }

  const showQualityChip = !(item.status === "skipped" && item.quality === "skipped");

  return (
    <div className="rounded-[28px] border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9CA3AF]">
            Q{item.questionNo} · {item.subject}
          </p>
          <div className="mt-3">
            <RichQuestionContent content={item.question} className="text-base font-medium leading-7 text-[#111827]" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChip(item)}`}>{item.status}</span>
          {showQualityChip ? (
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${qualityChip(item)}`}>{item.quality}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-[#FCFCFE] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Final Answer</p>
          <p className="mt-2 text-sm font-semibold text-[#111827]">{item.finalAnswerLabel}</p>
        </div>
        <div className="rounded-2xl bg-[#FCFCFE] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Correct Answer</p>
          <p className="mt-2 text-sm font-semibold text-[#111827]">{item.correctAnswerLabel}</p>
        </div>
        <div className="rounded-2xl bg-[#FCFCFE] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Opened</p>
          <p className="mt-2 text-sm font-semibold text-[#111827]">{item.openedCount} {item.openedCount === 1 ? "time" : "times"}</p>
        </div>
        <div className="rounded-2xl bg-[#FCFCFE] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Time Spent</p>
          <p className="mt-2 text-sm font-semibold text-[#111827]">{item.totalTimeLabel}</p>
        </div>
      </div>

      {item.options.length > 0 ? (
        <div className="mt-5 rounded-[24px] border border-[#EEF2F7] bg-[#FCFCFE] p-4">
          <p className="text-sm font-semibold text-[#111827]">Options</p>
          <div className="mt-3 space-y-2.5">
            {item.options.map((option) => (
              <div
                key={option.key}
                className={`rounded-2xl border px-4 py-3 ${
                  option.isSelected && option.isCorrect
                    ? "border-green-200 bg-green-50"
                    : option.isCorrect
                      ? "border-green-200 bg-green-50"
                      : option.isSelected
                        ? "border-orange-200 bg-orange-50"
                        : "border-[#E5E7EB] bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#111827] px-2 text-xs font-semibold text-white">
                    {option.key}
                  </span>
                  <div className="min-w-0 flex-1">
                    {option.content ? (
                      <RichQuestionContent content={option.content} className="text-sm leading-6 text-[#374151]" />
                    ) : null}
                    {option.image ? (
                      <img
                        src={option.image}
                        alt=""
                        className={`${option.content ? "mt-3" : ""} max-h-40 rounded-lg border border-slate-200 bg-white object-contain`}
                      />
                    ) : null}
                    {!option.content && !option.image ? (
                      <p className="text-sm leading-6 text-[#9CA3AF]">No option content</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {option.isSelected ? (
                        <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[11px] font-semibold text-orange-700">Your selection</span>
                      ) : null}
                      {option.isCorrect ? (
                        <span className="rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700">Correct</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 rounded-[24px] border border-[#EEF2F7] bg-[#FCFCFE] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[#111827]">Action Timeline</p>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#6B7280]">{item.events.length} events</span>
        </div>
        <div className="mt-4 space-y-3">
          {item.events.length > 0 ? (
            item.events.map((event, index) => (
              <div key={`${event.atSeconds}-${event.action}-${index}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-xs font-semibold text-[#111827] shadow-sm">
                    {event.atLabel}
                  </div>
                  {index < item.events.length - 1 ? <div className="mt-2 h-full w-px bg-[#E5E7EB]" /> : null}
                </div>
                <div className="min-w-0 flex-1 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[#111827]">{event.title}</p>
                    <span className="rounded-full bg-[#FFF7E8] px-2.5 py-1 text-[11px] font-semibold text-[#B45309]">
                      {event.action}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {event.answerLabel ? (
                      <span className="rounded-full bg-[#F8FAFC] px-2.5 py-1 text-xs font-medium text-[#475569]">
                        Answer: {event.answerLabel}
                      </span>
                    ) : null}
                    {event.reviewState ? (
                      <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                        Review: {event.reviewState}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-[#E5E7EB] bg-white px-4 py-8 text-center text-sm text-[#6B7280]">
              History snapshots unavailable for this question.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const COLS = 10;

export default function QuestionJourney() {
  const [showQuality, setShowQuality] = useState(false);
  const firstQuestionId = questionHistoryData[0]?.questionId ?? null;
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(firstQuestionId);

  useEffect(() => {
    if (!questionHistoryData.length) {
      setSelectedQuestionId(null);
      return;
    }
    const stillExists = questionHistoryData.some((item) => item.questionId === selectedQuestionId);
    if (!stillExists) {
      setSelectedQuestionId(questionHistoryData[0].questionId);
    }
  }, [firstQuestionId, selectedQuestionId]);

  const selectedQuestion = useMemo(
    () => questionHistoryData.find((item) => item.questionId === selectedQuestionId) ?? null,
    [selectedQuestionId],
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
      <div className="rounded-[28px] border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#111827]">Question Journey</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Click any question bubble to see exact answer/review flow.</p>
          </div>
          <label className="flex cursor-pointer select-none items-center gap-2">
            <span className="text-sm text-[#6B7280]">Show Quality</span>
            <button
              role="switch"
              aria-checked={showQuality}
              type="button"
              onClick={() => setShowQuality((value) => !value)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showQuality ? "bg-indigo-500" : "bg-gray-200"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${showQuality ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-gray-100 pb-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">{showQuality ? <QualityIcon quality="perfect" /> : <StatusIcon status="correct" />} Correct / perfect</span>
          <span className="flex items-center gap-1.5">{showQuality ? <QualityIcon quality="wasted" /> : <StatusIcon status="wrong" />} Wrong / wasted</span>
          <span className="flex items-center gap-1.5">{showQuality ? <QualityIcon quality="overtime" /> : <StatusIcon status="markedReview" />} Review / overtime</span>
          <span className="flex items-center gap-1.5">{showQuality ? <QualityIcon quality="confused" /> : <StatusIcon status="skipped" />} Skipped / confused</span>
        </div>

        <div className="mt-5 space-y-7">
          {questionJourneyData.map((interval) => {
            const rows: QuestionVisit[][] = [];
            for (let i = 0; i < interval.visits.length; i += COLS) {
              rows.push(interval.visits.slice(i, i + COLS));
            }

            return (
              <div key={interval.label}>
                <div className="mb-4 flex items-center gap-2">
                  {interval.icon === "flag" ? (
                    <svg className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v14M3 3l10 3-10 4" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <circle cx="10" cy="10" r="7" />
                      <path strokeLinecap="round" d="M10 6v4l2.5 2.5" />
                    </svg>
                  )}
                  <span className="text-sm font-semibold text-gray-700">{interval.label}</span>
                </div>

                <div className="space-y-4">
                  {rows.map((row, rowIdx) => (
                    <div key={rowIdx} className="flex flex-wrap items-start gap-x-2 gap-y-3">
                      {row.map((visit) => (
                        <QuestionBubble
                          key={`${interval.label}-${visit.questionNo}`}
                          visit={visit}
                          active={selectedQuestionId === visit.questionId}
                          showQuality={showQuality}
                          onClick={() => setSelectedQuestionId(visit.questionId ?? null)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="xl:sticky xl:top-5 xl:self-start">
        <DetailPanel item={selectedQuestion} />
      </div>
    </div>
  );
}
