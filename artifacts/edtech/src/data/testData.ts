export type QStatus = "correct" | "wrong" | "notVisited" | "notAnswered" | "markedReview";
export type QQuality = "perfect" | "wasted" | "overtime" | "confused" | null;

export interface SubjectSummary {
  key: string;
  label: string;
  score: number;
  max: number;
  percentile: number;
  color: string;
}

export interface PerformanceRow {
  subject: string;
  icon: string;
  totalScore: number;
  maxTotalScore: number;
  attemptedCorrect: number;
  totalQs: number;
  attemptedWrong: number;
  notAttempted: number;
  notVisited: number;
}

export interface TestDataShape {
  testName: string;
  overallScore: number;
  maxScore: number;
  subjects: {
    math: { label: string; score: number; max: number; percentile: number };
    physics: { label: string; score: number; max: number; percentile: number };
    chemistry: { label: string; score: number; max: number; percentile: number };
  };
  subjectSummaries: SubjectSummary[];
  predictedPercentile: number;
  leaderboardRank: number;
  totalParticipants: number;
  questionsAttempted: number;
  totalQuestions: number;
  accuracy: number;
  positiveScore: number;
  marksLost: number;
  timeTaken: number;
  performanceBreakdown: PerformanceRow[];
}

export interface TimeBreakdownRow {
  subject: string;
  icon: string;
  timeSpent: number;
  qsAttempted: number;
  totalQs: number;
  accuracy: number;
}

export interface TimeQualityRow {
  correct: number;
  correctPct: number;
  incorrect: number;
  incorrectPct: number;
  unattempted: number;
  unattemptedPct: number;
  total: number;
}

export interface TimeDataShape {
  breakdown: TimeBreakdownRow[];
  subjectChart: { name: string; time: number; color: string }[];
  qualityOfTime: {
    tabs: string[];
    data: Record<string, TimeQualityRow>;
  };
  journey: { interval: string; correct: number; incorrect: number; overall: number }[];
  graphicalAttempts: { name: string; correct: number; incorrect: number; overall: number }[];
  attemptWindowLabel: string;
}

export interface AttemptDataShape {
  categories: { key: string; label: string; color: string; desc: string; icon: string }[];
  summary: { subject: string; icon: string; perfect: number; wasted: number; overtime: number; confused: number }[];
  chartData: { name: string; perfect: number; wasted: number; overtime: number; confused: number }[];
}

export interface DifficultyRow {
  level: "Easy" | "Moderate" | "Tough";
  correct: number;
  wrong: number;
  notAttempted: number;
  total: number;
}

export interface DifficultyDataShape {
  tabs: string[];
  analysis: Record<string, DifficultyRow[]>;
}

export interface ComparativePerformanceRow {
  student: string;
  icon: string;
  score: number;
  maxScore: number;
  accuracy: number;
}

export interface ComparativeBreakdownRow {
  student: string;
  icon: string;
  attemptedCorrect: number;
  totalQs: number;
  attemptedWrong: number;
  notAttempted: number;
  notVisited: number | null;
}

export interface ComparativeDataShape {
  performance: Record<string, ComparativePerformanceRow[]>;
  breakdown: Record<string, ComparativeBreakdownRow[]>;
}

export interface ComparativeAttemptDataShape {
  tabular: Record<string, { student: string; icon: string; perfect: number; wasted: number; overtime: number; confused: number }[]>;
  graphical: Record<string, { category: string; you: number; topper: number; top10: number; top25: number }[]>;
}

export interface ComparativeTimeDataShape {
  breakdown: Record<string, { student: string; icon: string; timeMins: number; qsPct: number; accuracy: number }[]>;
  hourWise: {
    tabs: readonly string[];
    data: Record<string, { student: string; icon: string; hour1: number; hour2: number; hour3: number }[]>;
  };
  graphical: {
    tabs: readonly string[];
    data: Record<string, { hour: string; you: number; topper: number; top10: number; top25: number }[]>;
  };
  phaseLabels: [string, string, string];
}

export interface ComparativeDifficultyDataShape {
  levels: {
    level: string;
    totals: Record<string, number>;
    rows: Record<string, { student: string; icon: string; correct: number; wrong: number; notAttempted: number }[]>;
  }[];
}

export interface QsQuestion {
  no: number;
  status: QStatus;
  quality: QQuality;
}

export interface QsSection {
  label: string;
  questions: QsQuestion[];
}

export interface QsSubject {
  name: string;
  icon: string;
  color: string;
  sections: QsSection[];
}

export interface QuestionVisit {
  questionId?: number;
  questionNo: number;
  status: "correct" | "wrong" | "skipped" | "markedReview" | "unmarkedReview";
  quality: "perfect" | "wasted" | "overtime" | "confused" | "skipped";
  timesOpened?: number;
}

export interface JourneyInterval {
  label: string;
  icon: "flag" | "clock";
  visits: QuestionVisit[];
}

export interface BreakdownRow {
  qNo: number;
  subject: string;
  chapter: string;
  topic: string;
  difficulty: "Easy" | "Moderate" | "Tough";
  timeSpent: string;
  status: "Answered" | "Not Attempted";
  evaluation: "correct" | "wrong" | "notAttempted";
  overview: string | null;
}

export interface SubjectMovementRow {
  subject: string;
  icon: string;
  label: string;
  qsAttempted: number;
  timeSpent: string;
}

export interface QuestionHistoryEvent {
  atSeconds: number;
  atLabel: string;
  action: "open" | "answer" | "clear" | "review" | "save";
  title: string;
  answerLabel: string | null;
  reviewState?: "marked" | "removed";
}

export interface QuestionHistoryOption {
  key: string;
  content: string;
  image?: string | null;
  isSelected: boolean;
  isCorrect: boolean;
}

export interface QuestionHistoryItem {
  questionId: number;
  questionNo: number;
  subject: string;
  chapter: string;
  topic: string;
  question: string;
  questionType: "MCQ" | "Multi Select" | "Integer";
  status: "correct" | "wrong" | "skipped" | "markedReview" | "unmarkedReview";
  quality: "perfect" | "wasted" | "overtime" | "confused" | "skipped";
  finalAnswerLabel: string;
  correctAnswerLabel: string;
  reviewActive: boolean;
  openedCount: number;
  totalTimeLabel: string;
  options: QuestionHistoryOption[];
  events: QuestionHistoryEvent[];
}

export interface MasteryMapRow {
  label: string;
  currentAccuracy: number;
  baselineAccuracy: number | null;
  trend: number | null;
  attempted: number;
  avgSecondsPerAttempt: number;
  status: "strong" | "building" | "recovering" | "slipping" | "fragile";
  signal: string;
}

export interface ForgettingCurveRow {
  label: string;
  subject: string;
  previousAccuracy: number;
  currentAccuracy: number;
  drop: number;
  retentionPct: number;
  lastSeenDays: number | null;
}

export interface SpeedAccuracyRow {
  label: string;
  accuracy: number;
  avgSecondsPerAttempt: number;
  baselineAccuracy: number | null;
  baselineSecondsPerAttempt: number | null;
  zone: "fast-accurate" | "fast-fragile" | "slow-solid" | "drag-zone";
  insight: string;
}

export interface ErrorRecurrenceRow {
  label: string;
  category: "Topic" | "Difficulty" | "Question Type";
  currentWrong: number;
  previousWrong: number;
  testsHit: number;
  severity: "high" | "medium";
  signal: string;
}

export interface RevisionRoadmapRow {
  title: string;
  priority: "High" | "Medium";
  focusArea: string;
  reason: string;
  actions: string[];
}

export interface AdvancedInsightsDataShape {
  historyDepth: number;
  masteryMap: MasteryMapRow[];
  forgettingCurve: ForgettingCurveRow[];
  speedVsAccuracy: SpeedAccuracyRow[];
  errorRecurrence: ErrorRecurrenceRow[];
  revisionRoadmap: RevisionRoadmapRow[];
}

export interface AnalysisDataset {
  testData: TestDataShape;
  timeData: TimeDataShape;
  attemptData: AttemptDataShape;
  difficultyData: DifficultyDataShape;
  comparativeData: ComparativeDataShape;
  comparativeAttemptData: ComparativeAttemptDataShape;
  comparativeTimeData: ComparativeTimeDataShape;
  comparativeDifficultyData: ComparativeDifficultyDataShape;
  qsByQsData: QsSubject[];
  questionJourneyData: JourneyInterval[];
  questionHistoryData: QuestionHistoryItem[];
  completeBreakdownData: BreakdownRow[];
  subjectMovementData: SubjectMovementRow[];
  advancedInsightsData: AdvancedInsightsDataShape;
}

const emptyDataset: AnalysisDataset = {
  testData: {
    testName: "Test Analysis",
    overallScore: 0,
    maxScore: 0,
    subjects: {
      math: { label: "Section 1", score: 0, max: 0, percentile: 0 },
      physics: { label: "Section 2", score: 0, max: 0, percentile: 0 },
      chemistry: { label: "Section 3", score: 0, max: 0, percentile: 0 },
    },
    subjectSummaries: [],
    predictedPercentile: 0,
    leaderboardRank: 0,
    totalParticipants: 0,
    questionsAttempted: 0,
    totalQuestions: 0,
    accuracy: 0,
    positiveScore: 0,
    marksLost: 0,
    timeTaken: 0,
    performanceBreakdown: [],
  },
  timeData: {
    breakdown: [],
    subjectChart: [],
    qualityOfTime: { tabs: [], data: {} },
    journey: [],
    graphicalAttempts: [],
    attemptWindowLabel: "Test",
  },
  attemptData: {
    categories: [
      { key: "perfect", label: "Perfect Attempt", color: "#22c55e", desc: "Correct attempt solved in time", icon: "check" },
      { key: "wasted", label: "Wasted Attempt", color: "#ef4444", desc: "Incorrect attempt solved quickly", icon: "x" },
      { key: "overtime", label: "Overtime Attempt", color: "#f97316", desc: "Answered after ideal time", icon: "clock" },
      { key: "confused", label: "Confused Attempt", color: "#475569", desc: "Unattempted after spending too much time", icon: "confused" },
    ],
    summary: [],
    chartData: [],
  },
  difficultyData: { tabs: ["Overall"], analysis: { Overall: [] } },
  comparativeData: { performance: { Overall: [] }, breakdown: { Overall: [] } },
  comparativeAttemptData: { tabular: { Overall: [] }, graphical: { Overall: [] } },
  comparativeTimeData: {
    breakdown: { Overall: [] },
    hourWise: { tabs: ["Overall", "Correct", "Incorrect"], data: { Overall: [], Correct: [], Incorrect: [] } },
    graphical: { tabs: ["Correct", "Incorrect"], data: { Correct: [], Incorrect: [] } },
    phaseLabels: ["Phase 1", "Phase 2", "Phase 3"],
  },
  comparativeDifficultyData: { levels: [] },
  qsByQsData: [],
  questionJourneyData: [],
  questionHistoryData: [],
  completeBreakdownData: [],
  subjectMovementData: [],
  advancedInsightsData: {
    historyDepth: 0,
    masteryMap: [],
    forgettingCurve: [],
    speedVsAccuracy: [],
    errorRecurrence: [],
    revisionRoadmap: [],
  },
};

export let testData = emptyDataset.testData;
export let timeData = emptyDataset.timeData;
export let attemptData = emptyDataset.attemptData;
export let difficultyData = emptyDataset.difficultyData;
export let comparativeData = emptyDataset.comparativeData;
export let comparativeAttemptData = emptyDataset.comparativeAttemptData;
export let comparativeTimeData = emptyDataset.comparativeTimeData;
export let comparativeDifficultyData = emptyDataset.comparativeDifficultyData;
export let qsByQsData = emptyDataset.qsByQsData;
export let questionJourneyData = emptyDataset.questionJourneyData;
export let questionHistoryData = emptyDataset.questionHistoryData;
export let completeBreakdownData = emptyDataset.completeBreakdownData;
export let subjectMovementData = emptyDataset.subjectMovementData;
export let advancedInsightsData = emptyDataset.advancedInsightsData;

export function setAnalysisDataset(dataset: AnalysisDataset) {
  testData = dataset.testData;
  timeData = dataset.timeData;
  attemptData = dataset.attemptData;
  difficultyData = dataset.difficultyData;
  comparativeData = dataset.comparativeData;
  comparativeAttemptData = dataset.comparativeAttemptData;
  comparativeTimeData = dataset.comparativeTimeData;
  comparativeDifficultyData = dataset.comparativeDifficultyData;
  qsByQsData = dataset.qsByQsData;
  questionJourneyData = dataset.questionJourneyData;
  questionHistoryData = dataset.questionHistoryData;
  completeBreakdownData = dataset.completeBreakdownData;
  subjectMovementData = dataset.subjectMovementData;
  advancedInsightsData = dataset.advancedInsightsData;
}

export function resetAnalysisDataset() {
  setAnalysisDataset(emptyDataset);
}
