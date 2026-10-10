import { useRef } from "react";
import { subjectMovementData } from "@/data/testData";
import { SubjectSectionIcon } from "@/components/ui/subject-section-icon";
import { getSubjectTheme } from "@/lib/subject-theme";

export default function SubjectMovement() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: dir === "left" ? -240 : 240, behavior: "smooth" });
    }
  };

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #e5e7eb", borderTop: "3px solid #111827" }}>
      <div style={{ padding: "20px 24px 16px", borderBottom: "none" }}>
        {/* Scrollable timeline */}
        <div
          ref={scrollRef}
          className="flex items-start gap-0 overflow-x-auto pb-4"
          style={{ scrollbarWidth: "none" }}
        >
          {subjectMovementData.map((step, i) => {
            const isLast = i === subjectMovementData.length - 1;
            const theme = getSubjectTheme(step.subject);
            return (
              <div key={i} className="flex items-start flex-shrink-0">
                {/* Node + content */}
                <div className="flex flex-col items-center" style={{ width: 160 }}>
                  {/* Icon circle */}
                  <div
                    className="w-14 h-14 rounded-full bg-white flex items-center justify-center flex-shrink-0 mb-3"
                    style={{
                      border: `2px solid ${theme.color}`,
                      backgroundColor: theme.softBg,
                      boxShadow: `0 0 0 4px ${theme.softBgStrong}`,
                      color: theme.color,
                    }}
                  >
                    <SubjectSectionIcon label={step.subject} className="w-6 h-6" />
                  </div>
                  {/* Label */}
                  <p className="text-xs font-semibold text-gray-800 text-center leading-snug mb-1 px-1">
                    {step.label}
                  </p>
                  <p className="text-[11px] text-gray-500 text-center">{step.qsAttempted} Qs attempted</p>
                  <p className="text-[11px] text-gray-500 text-center">Spent {step.timeSpent}</p>
                </div>

                {/* Arrow connector */}
                {!isLast && (
                  <div className="flex items-center flex-shrink-0 mt-6" style={{ width: 48 }}>
                    <div className="flex-1 border-t-2 border-dashed border-gray-300" />
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0 -ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-4 pt-2 border-t border-gray-100 mt-2">
          <button
            onClick={() => scroll("left")}
            className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs text-gray-500 font-medium">Swipe left right to view full journey</span>
          <button
            onClick={() => scroll("right")}
            className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
