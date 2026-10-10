import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { buildApiUrl } from "@/lib/api-origin";
import { ArrowLeft } from "lucide-react";
import type { ViewMode } from "@/App";
import { setAnalysisDataset, resetAnalysisDataset } from "@/data/testData";
import { buildAnalysisDataset } from "@/features/test-analysis/buildAnalysisDataset";
import Sidebar from "@/features/test-analysis/components/Sidebar";
import Header from "@/features/test-analysis/components/Header";
import Overview from "@/features/test-analysis/pages/Overview";
import AdvancedInsights from "@/features/test-analysis/pages/AdvancedInsights";
import PerformanceAnalysis from "@/features/test-analysis/pages/PerformanceAnalysis";
import TimeAnalysis from "@/features/test-analysis/pages/TimeAnalysis";
import AttemptAnalysis from "@/features/test-analysis/pages/AttemptAnalysis";
import DifficultyAnalysis from "@/features/test-analysis/pages/DifficultyAnalysis";
import SubjectMovement from "@/features/test-analysis/pages/SubjectMovement";
import QuestionJourney from "@/features/test-analysis/pages/QuestionJourney";
import QsByQsAnalysis from "@/features/test-analysis/pages/QsByQsAnalysis";
import { getSamplePreviewAnalysisData, isSamplePreviewAnalysisId } from "@/pages/student/sampleTestAnalysis";
import { useAuth } from "@/contexts/AuthContext";
import { isStudentFeatureLocked } from "@/lib/student-access";
import { buildStudentUnlockPath } from "@/lib/student-unlock";

const pageTitles: Record<string, string> = {
  overview: "Overview",
  advanced: "Advanced Insights",
  performance: "Performance Analysis",
  time: "Time Analysis",
  attempt: "Attempt Analysis",
  difficulty: "Difficulty Analysis",
  subject: "Subject Movement",
  journey: "Question Journey",
  qsbyqs: "Qs by Qs Analysis",
};

const personalMobileTabs = [
  "overview",
  "advanced",
  "performance",
  "time",
  "attempt",
  "difficulty",
  "subject",
  "journey",
  "qsbyqs",
] as const;

const comparativeMobileTabs = [
  "performance",
  "attempt",
  "time",
  "difficulty",
] as const;

function isGateExamTest(test: {
  examType?: string | null;
  examHeader?: string | null;
  examSubheader?: string | null;
  title?: string | null;
  description?: string | null;
} | null | undefined) {
  const values = [
    test?.examType,
    test?.examHeader,
    test?.examSubheader,
    test?.title,
    test?.description,
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);

  return values.some((value) =>
    value.includes("gate") || value.includes("graduate aptitude test in engineering"),
  );
}

function renderPage(activeTab: string, mode: ViewMode) {
  switch (activeTab) {
    case "overview":
      return <Overview mode={mode} />;
    case "advanced":
      return <AdvancedInsights />;
    case "performance":
      return <PerformanceAnalysis mode={mode} />;
    case "time":
      return <TimeAnalysis mode={mode} />;
    case "attempt":
      return <AttemptAnalysis mode={mode} />;
    case "difficulty":
      return <DifficultyAnalysis mode={mode} />;
    case "subject":
      return <SubjectMovement />;
    case "journey":
      return <QuestionJourney />;
    case "qsbyqs":
      return <QsByQsAnalysis />;
    default:
      return <Overview mode={mode} />;
  }
}

export default function StudentTestAnalysis() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isTestsLocked = isStudentFeatureLocked(user, "tests");
  const isAnalysisLocked = isStudentFeatureLocked(user, "analysis");
  useEffect(() => {
    if (!id) return;
    if (isTestsLocked) {
      setLocation(buildStudentUnlockPath({
        feature: "tests",
        kind: "feature",
        returnTo: `/student/tests/${id}/analysis`,
        backTo: "/student/tests",
      }));
    } else if (isAnalysisLocked) {
      setLocation(buildStudentUnlockPath({
        feature: "analysis",
        kind: "feature",
        returnTo: `/student/tests/${id}/analysis`,
        backTo: "/student/tests",
      }));
    }
  }, [id, isTestsLocked, isAnalysisLocked, setLocation]);
  const [activeTab, setActiveTab] = useState("overview");
  const [mode, setMode] = useState<ViewMode>("personal");
  const [datasetReady, setDatasetReady] = useState(false);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [expandTechnical, setExpandTechnical] = useState(false);
  const isSamplePreview = isSamplePreviewAnalysisId(id);
  const sampleAnalysisData = useMemo(() => getSamplePreviewAnalysisData(id), [id]);

  const analysisQuery = useQuery({
    queryKey: ["student-analysis", id],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/tests/${id}/my-analysis`), { credentials: "include" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to load analysis");
      }
      return response.json();
    },
    enabled: !!id && !isSamplePreview && !isTestsLocked && !isAnalysisLocked,
  });

  const analysisData = isAnalysisLocked ? null : sampleAnalysisData ?? analysisQuery.data;

  const dataset = useMemo(() => {
    if (!analysisData) return null;
    const gateExam = isGateExamTest(analysisData.test);
    return buildAnalysisDataset(analysisData, { expandTechnical: gateExam && expandTechnical });
  }, [analysisData, expandTechnical]);

  const isGateExam = useMemo(() => isGateExamTest(analysisData?.test), [analysisData]);

  const hasTechnicalSections = useMemo(
    () =>
      Boolean(
        (analysisData?.sections ?? []).some((section: { title?: string | null; subjectLabel?: string | null }) =>
          String(section.subjectLabel ?? section.title ?? "").trim().toLowerCase().includes("technical"),
        ),
      ),
    [analysisData],
  );

  useEffect(() => () => resetAnalysisDataset(), []);

  useEffect(() => {
    if (!isGateExam && expandTechnical) {
      setExpandTechnical(false);
    }
  }, [expandTechnical, isGateExam]);

  if (isTestsLocked || isAnalysisLocked) {
    return <div className="py-20 text-center text-muted-foreground">Redirecting to unlock payment...</div>;
  }

  useEffect(() => {
    if (!dataset) {
      setDatasetReady(false);
      return;
    }
    setAnalysisDataset(dataset);
    setDatasetReady(true);
    setDatasetVersion((version) => version + 1);
  }, [dataset]);

  if (!isSamplePreview && analysisQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#D97706] border-t-transparent" />
          <p className="text-sm text-[#6B7280]">Loading test analysis...</p>
        </div>
      </div>
    );
  }

  if (!isSamplePreview && analysisQuery.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB] px-6">
        <div className="max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-[#111827]">Unable to load analysis</h1>
          <p className="mt-2 text-sm text-[#6B7280]">
            {analysisQuery.error instanceof Error ? analysisQuery.error.message : "Something went wrong while loading your test analysis."}
          </p>
          <button
            onClick={() => analysisQuery.refetch()}
            className="chip-orange-solid mt-4 rounded-full px-5 py-2 text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!datasetReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#D97706] border-t-transparent" />
          <p className="text-sm text-[#6B7280]">Preparing analysis dataset...</p>
        </div>
      </div>
    );
  }

  const mobileTabs = mode === "comparative" ? comparativeMobileTabs : personalMobileTabs;
  const headerSummary = dataset && analysisData ? {
    testTitle: analysisData.test?.title ?? "Test Analysis",
    scoreLabel: `${dataset.testData.overallScore}/${dataset.testData.maxScore}`,
    accuracyLabel: `${dataset.testData.accuracy}%`,
    percentileLabel: `${dataset.testData.predictedPercentile}%ile`,
    attemptedLabel: `${dataset.testData.questionsAttempted}/${dataset.testData.totalQuestions}`,
    timeLabel: `${dataset.testData.timeTaken} min`,
    rankLabel:
      analysisData.classStats?.totalSubs && analysisData.classStats.totalSubs > 0
        ? `${analysisData.classStats.rank}/${analysisData.classStats.totalSubs}`
        : undefined,
  } : undefined;

  return (
    <div className="test-analysis-page min-h-screen bg-[#F5F7FB]">
      <div className="lg:flex lg:h-screen">
        <div className="hidden lg:block">
          <Sidebar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            mode={mode}
            onModeChange={setMode}
            onBack={() => setLocation("/student/tests")}
          />
        </div>
        <main className="flex-1 overflow-auto p-3 sm:p-5 lg:h-full lg:overflow-y-auto lg:p-7">
        <div className="mb-4 space-y-3 lg:hidden">
          <div className="flex items-start justify-start">
            <button
              type="button"
              onClick={() => setLocation("/student/tests")}
              className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#475569] shadow-sm transition hover:border-[#CBD5E1] hover:bg-[#F8FAFC] hover:text-[#111827]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
          <div className="rounded-3xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6B7280]">Test Analysis</p>
            <h1 className="mt-2 text-xl font-bold text-[#111827]">{analysisData?.test?.title ?? "Analysis"}</h1>
            <div className="mt-3 flex rounded-full bg-[#F3F5F9] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("personal");
                  if (!personalMobileTabs.includes(activeTab as (typeof personalMobileTabs)[number])) {
                    setActiveTab("overview");
                  }
                }}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                  mode === "personal"
                    ? "chip-orange-solid"
                    : "text-[#4B5563]"
                }`}
              >
                Personal
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("comparative");
                  if (!comparativeMobileTabs.includes(activeTab as (typeof comparativeMobileTabs)[number])) {
                    setActiveTab("performance");
                  }
                }}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                  mode === "comparative"
                    ? "chip-orange-solid"
                    : "text-[#4B5563]"
                }`}
              >
                Comparative
              </button>
            </div>
            {!isSamplePreview ? (
              <button
                type="button"
                onClick={() => setLocation(`/student/tests/${id}/solutions`)}
                disabled={!analysisData?.sections?.length}
                className="chip-orange-solid mt-3 inline-flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                View Solution
              </button>
            ) : null}
          </div>

          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div className="flex gap-2">
              {mobileTabs.map((tabId) => {
                const active = activeTab === tabId;
                return (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setActiveTab(tabId)}
                    className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
                      active
                        ? "border-[#1F2937] bg-[#1F2937] text-white"
                        : "border-[#E5E7EB] bg-white text-[#1F2937]"
                    } snap-start`}
                  >
                    {pageTitles[tabId]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="hidden lg:block">
          <Header
            title={pageTitles[activeTab] || "Overview"}
            summary={headerSummary}
            onViewSolutions={isSamplePreview ? undefined : () => setLocation(`/student/tests/${id}/solutions`)}
            viewSolutionsDisabled={!analysisData?.sections?.length}
            compact={activeTab !== "overview"}
            showExpandTechnical={isGateExam && hasTechnicalSections}
            expandTechnical={expandTechnical}
            onExpandTechnicalChange={setExpandTechnical}
          />
        </div>
        <div key={`${activeTab}-${mode}-${datasetVersion}-${expandTechnical ? "expanded" : "collapsed"}`}>
          {renderPage(activeTab, mode)}
        </div>
        </main>
      </div>
    </div>
  );
}
