import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
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

const pageTitles: Record<string, string> = {
  overview: "Overview", advanced: "Advanced Insights", performance: "Performance Analysis", time: "Time Analysis", attempt: "Attempt Analysis", difficulty: "Difficulty Analysis", subject: "Subject Movement", journey: "Question Journey", qsbyqs: "Qs by Qs Analysis",
};
const personalTabs = ["overview", "advanced", "performance", "time", "attempt", "difficulty", "subject", "journey", "qsbyqs"];
const comparativeTabs = ["performance", "attempt", "time", "difficulty"];

function renderPage(activeTab: string, mode: "personal" | "comparative") {
  switch (activeTab) {
    case "overview": return <Overview mode={mode} />;
    case "advanced": return <AdvancedInsights />;
    case "performance": return <PerformanceAnalysis mode={mode} />;
    case "time": return <TimeAnalysis mode={mode} />;
    case "attempt": return <AttemptAnalysis mode={mode} />;
    case "difficulty": return <DifficultyAnalysis mode={mode} />;
    case "subject": return <SubjectMovement />;
    case "journey": return <QuestionJourney />;
    case "qsbyqs": return <QsByQsAnalysis />;
    default: return <Overview mode={mode} />;
  }
}

export default function PSUTestAnalysis() {
  const [, params] = useRoute<{ psuId: string; testId: string }>("/student/psu/:psuId/tests/:testId/analysis");
  const [, setLocation] = useLocation();
  const psuId = Number(params?.psuId); const testId = Number(params?.testId);
  const backToPsu = () => setLocation(`/student/psu?psuId=${psuId}`);
  const [activeTab, setActiveTab] = useState("overview");
  const [mode, setMode] = useState<"personal" | "comparative">("personal");
  const query = useQuery({ queryKey: ["psu-test-analysis", psuId, testId], enabled: Number.isInteger(psuId) && Number.isInteger(testId), queryFn: () => api.get<any>(`/psus/${psuId}/tests/${testId}/analysis`) });
  const dataset = useMemo(() => query.data ? buildAnalysisDataset(query.data) : null, [query.data]);

  useEffect(() => { if (dataset) setAnalysisDataset(dataset); return () => resetAnalysisDataset(); }, [dataset]);

  if (query.isLoading) return <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB]"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#D97706] border-t-transparent" /><p className="text-sm text-[#6B7280]">Preparing PSU test analysis...</p></div></div>;
  if (query.isError || !query.data) return <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB] px-6"><div className="max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold text-[#111827]">Unable to load PSU analysis</h1><p className="mt-2 text-sm text-[#6B7280]">{query.error instanceof Error ? query.error.message : "Submit the test first to view analysis."}</p><button onClick={() => query.refetch()} className="chip-orange-solid mt-4 rounded-full px-5 py-2 text-sm font-semibold">Retry</button></div></div>;
  if (!dataset) return <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB]"><p className="text-sm text-[#6B7280]">Preparing PSU test analysis...</p></div>;

  const summary = { testTitle: query.data.test?.title ?? "PSU Test Analysis", scoreLabel: `${dataset.testData.overallScore}/${dataset.testData.maxScore}`, accuracyLabel: `${dataset.testData.accuracy}%`, percentileLabel: `${dataset.testData.predictedPercentile}%ile`, attemptedLabel: `${dataset.testData.questionsAttempted}/${dataset.testData.totalQuestions}`, timeLabel: `${dataset.testData.timeTaken} min`, rankLabel: query.data.classStats?.totalSubs ? `${query.data.classStats.rank}/${query.data.classStats.totalSubs}` : undefined };
  const tabs = mode === "comparative" ? comparativeTabs : personalTabs;
  const setModeSafely = (next: "personal" | "comparative") => { setMode(next); if (next === "comparative" && !comparativeTabs.includes(activeTab)) setActiveTab("performance"); };

  return <div className="min-h-screen bg-[#F5F7FB]"><div className="lg:flex lg:h-screen"><div className="hidden lg:block"><Sidebar activeTab={activeTab} onTabChange={setActiveTab} mode={mode} onModeChange={setModeSafely} onBack={backToPsu} /></div><main className="flex-1 overflow-auto p-3 sm:p-5 lg:h-full lg:overflow-y-auto lg:p-7"><div className="mb-4 space-y-3 lg:hidden"><div className="flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={backToPsu} className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#475569]"><ArrowLeft className="h-4 w-4" /> Back to PSU</button><button type="button" onClick={() => setLocation(`/student/psu/${psuId}/tests/${testId}/solutions`)} className="chip-orange-solid rounded-full px-4 py-2 text-sm font-semibold">View Solution</button></div><div className="rounded-3xl border border-[#E5E7EB] bg-white p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6B7280]">PSU Test Analysis</p><h1 className="mt-2 text-xl font-bold text-[#111827]">{query.data.test?.title}</h1><div className="mt-3 flex rounded-full bg-[#F3F5F9] p-1"><button type="button" onClick={() => setModeSafely("personal")} className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${mode === "personal" ? "chip-orange-solid" : "text-[#4B5563]"}`}>Personal</button><button type="button" onClick={() => setModeSafely("comparative")} className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${mode === "comparative" ? "chip-orange-solid" : "text-[#4B5563]"}`}>Comparative</button></div></div><div className="-mx-1 overflow-x-auto px-1 pb-1"><div className="flex gap-2">{tabs.map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${activeTab === tab ? "border-[#1F2937] bg-[#1F2937] text-white" : "border-[#E5E7EB] bg-white text-[#1F2937]"}`}>{pageTitles[tab]}</button>)}</div></div></div><div className="hidden lg:block"><Header title={pageTitles[activeTab]} summary={summary} onViewSolutions={() => setLocation(`/student/psu/${psuId}/tests/${testId}/solutions`)} compact={activeTab !== "overview"} /></div><div key={`${activeTab}-${mode}`}>{renderPage(activeTab, mode)}</div></main></div></div>;
}
