type SampleAnalysisSection = {
  id: number;
  title: string;
  subjectLabel?: string | null;
  questionCount?: number | null;
  order?: number;
  meta?: Record<string, unknown> | null;
};

type SampleInteractionLogEntry = {
  at: number;
  questionId: number;
  sectionLabel: string;
  action: "open" | "answer" | "clear" | "review" | "save";
  answerSnapshot?: unknown;
  reviewState?: "marked" | "removed";
};

type SampleAnalysisQuestion = {
  id: number;
  order: number;
  question: string;
  options?: string[] | null;
  optionImages?: (string | null)[] | null;
  sectionId?: number | null;
  subjectLabel?: string | null;
  subjectName?: string | null;
  chapterName?: string | null;
  topicTag?: string | null;
  meta?: Record<string, unknown> | null;
  questionType?: string | null;
  points: number;
  negativeMarks?: number | null;
  myAnswer: unknown;
  correctAnswer?: number | null;
  correctAnswerMulti?: number[] | null;
  correctAnswerMin?: number | null;
  correctAnswerMax?: number | null;
  isCorrect: boolean;
  isSkipped: boolean;
  isFlagged: boolean;
  myTime: number;
};

export type SampleAnalysisResponse = {
  test: {
    id: number;
    title: string;
    description?: string | null;
    examType?: string | null;
    examHeader?: string | null;
    examSubheader?: string | null;
    durationMinutes: number;
    passingScore?: number | null;
    totalQuestions: number;
  };
  sections: SampleAnalysisSection[];
  submission: {
    score: number;
    totalPoints: number;
    percentage: number;
    passed: boolean;
    submittedAt?: string | null;
    totalTime: number;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    flaggedCount: number;
    questionTimings?: Record<string, number> | null;
    flaggedQuestions?: number[] | null;
    visitedQuestionIds?: number[] | null;
    reviewQuestionIds?: number[] | null;
    interactionLog?: SampleInteractionLogEntry[] | null;
  };
  classStats: {
    totalSubs: number;
    classAvg: number;
    classPassRate: number;
    rank: number;
    percentile: number;
  };
  perQuestion: SampleAnalysisQuestion[];
  advancedInsights?: null;
};

const SAMPLE_ANALYSIS_SECTIONS: SampleAnalysisSection[] = [
  { id: 1, title: "General Aptitude", subjectLabel: "General Aptitude", questionCount: 5, order: 1 },
  { id: 2, title: "Signals & Systems", subjectLabel: "Signals & Systems", questionCount: 5, order: 2 },
  { id: 3, title: "Control Systems", subjectLabel: "Control Systems", questionCount: 5, order: 3 },
];

function createQuestion(options: {
  id: number;
  order: number;
  question: string;
  sectionId: number;
  subjectName: string;
  chapterName: string;
  topicTag: string;
  difficulty: "easy" | "moderate" | "tough";
  estimatedTimeSeconds: number;
  questionType?: "mcq" | "multi" | "integer";
  optionsList?: string[];
  points?: number;
  negativeMarks?: number;
  myAnswer: unknown;
  correctAnswer?: number;
  correctAnswerMulti?: number[];
  correctAnswerMin?: number;
  correctAnswerMax?: number;
  isCorrect: boolean;
  isSkipped?: boolean;
  isFlagged?: boolean;
  myTime: number;
}): SampleAnalysisQuestion {
  return {
    id: options.id,
    order: options.order,
    question: options.question,
    options: options.questionType === "integer" ? [] : (options.optionsList ?? ["Option A", "Option B", "Option C", "Option D"]),
    optionImages: null,
    sectionId: options.sectionId,
    subjectLabel: options.subjectName,
    subjectName: options.subjectName,
    chapterName: options.chapterName,
    topicTag: options.topicTag,
    meta: {
      subjectName: options.subjectName,
      chapterName: options.chapterName,
      topicTag: options.topicTag,
      difficulty: options.difficulty,
      estimatedTimeSeconds: options.estimatedTimeSeconds,
    },
    questionType: options.questionType ?? "mcq",
    points: options.points ?? 2,
    negativeMarks: options.negativeMarks ?? 0.5,
    myAnswer: options.myAnswer,
    correctAnswer: options.correctAnswer,
    correctAnswerMulti: options.correctAnswerMulti ?? null,
    correctAnswerMin: options.correctAnswerMin ?? null,
    correctAnswerMax: options.correctAnswerMax ?? null,
    isCorrect: options.isCorrect,
    isSkipped: options.isSkipped ?? false,
    isFlagged: options.isFlagged ?? false,
    myTime: options.myTime,
  };
}

const SAMPLE_ANALYSIS_QUESTIONS: SampleAnalysisQuestion[] = [
  createQuestion({
    id: 5001,
    order: 1,
    question: "Choose the best completion for the sentence to keep the meaning precise.",
    sectionId: 1,
    subjectName: "General Aptitude",
    chapterName: "Verbal Ability",
    topicTag: "Sentence Completion",
    difficulty: "easy",
    estimatedTimeSeconds: 60,
    myAnswer: 1,
    correctAnswer: 1,
    isCorrect: true,
    myTime: 70,
  }),
  createQuestion({
    id: 5002,
    order: 2,
    question: "A train crosses a platform in 45 seconds. Find the missing relation from the given options.",
    sectionId: 1,
    subjectName: "General Aptitude",
    chapterName: "Quantitative Aptitude",
    topicTag: "Time and Distance",
    difficulty: "moderate",
    estimatedTimeSeconds: 75,
    myAnswer: 0,
    correctAnswer: 2,
    isCorrect: false,
    myTime: 95,
  }),
  createQuestion({
    id: 5003,
    order: 3,
    question: "Enter the missing value for the number series.",
    sectionId: 1,
    subjectName: "General Aptitude",
    chapterName: "Logical Reasoning",
    topicTag: "Series",
    difficulty: "moderate",
    estimatedTimeSeconds: 90,
    questionType: "integer",
    myAnswer: "42",
    correctAnswerMin: 42,
    correctAnswerMax: 42,
    isCorrect: true,
    myTime: 88,
  }),
  createQuestion({
    id: 5004,
    order: 4,
    question: "Identify the correct conclusion from the given statements.",
    sectionId: 1,
    subjectName: "General Aptitude",
    chapterName: "Logical Reasoning",
    topicTag: "Conclusions",
    difficulty: "easy",
    estimatedTimeSeconds: 60,
    myAnswer: 3,
    correctAnswer: 3,
    isCorrect: true,
    myTime: 65,
  }),
  createQuestion({
    id: 5005,
    order: 5,
    question: "Select all grammatically correct statements.",
    sectionId: 1,
    subjectName: "General Aptitude",
    chapterName: "Verbal Ability",
    topicTag: "Grammar",
    difficulty: "moderate",
    estimatedTimeSeconds: 90,
    questionType: "multi",
    myAnswer: [0, 1],
    correctAnswerMulti: [0, 2],
    isCorrect: false,
    isFlagged: true,
    myTime: 120,
  }),
  createQuestion({
    id: 5006,
    order: 6,
    question: "For x(t)=e^(-2t)u(t), identify the Laplace transform.",
    sectionId: 2,
    subjectName: "Signals & Systems",
    chapterName: "Laplace Transform",
    topicTag: "Basic Transforms",
    difficulty: "easy",
    estimatedTimeSeconds: 90,
    myAnswer: 0,
    correctAnswer: 0,
    isCorrect: true,
    myTime: 130,
  }),
  createQuestion({
    id: 5007,
    order: 7,
    question: "Find the ROC for the given bilateral Laplace transform expression.",
    sectionId: 2,
    subjectName: "Signals & Systems",
    chapterName: "Laplace Transform",
    topicTag: "ROC",
    difficulty: "tough",
    estimatedTimeSeconds: 150,
    myAnswer: null,
    correctAnswer: 2,
    isCorrect: false,
    isSkipped: true,
    myTime: 80,
  }),
  createQuestion({
    id: 5008,
    order: 8,
    question: "Choose the correct Fourier transform pair.",
    sectionId: 2,
    subjectName: "Signals & Systems",
    chapterName: "Fourier Transform",
    topicTag: "Transform Pairs",
    difficulty: "moderate",
    estimatedTimeSeconds: 120,
    myAnswer: 2,
    correctAnswer: 2,
    isCorrect: true,
    myTime: 150,
  }),
  createQuestion({
    id: 5009,
    order: 9,
    question: "Determine whether the given system is causal and stable.",
    sectionId: 2,
    subjectName: "Signals & Systems",
    chapterName: "System Properties",
    topicTag: "Stability",
    difficulty: "moderate",
    estimatedTimeSeconds: 120,
    myAnswer: 1,
    correctAnswer: 1,
    isCorrect: true,
    myTime: 175,
  }),
  createQuestion({
    id: 5010,
    order: 10,
    question: "Select all valid statements about sampling and aliasing.",
    sectionId: 2,
    subjectName: "Signals & Systems",
    chapterName: "Sampling",
    topicTag: "Aliasing",
    difficulty: "moderate",
    estimatedTimeSeconds: 135,
    questionType: "multi",
    myAnswer: [1, 3],
    correctAnswerMulti: [1, 3],
    isCorrect: true,
    myTime: 160,
  }),
  createQuestion({
    id: 5011,
    order: 11,
    question: "Find the steady state error constant for the given unity feedback system.",
    sectionId: 3,
    subjectName: "Control Systems",
    chapterName: "Steady State Error",
    topicTag: "Error Constants",
    difficulty: "moderate",
    estimatedTimeSeconds: 120,
    myAnswer: 2,
    correctAnswer: 0,
    isCorrect: false,
    myTime: 145,
  }),
  createQuestion({
    id: 5012,
    order: 12,
    question: "Enter the damping ratio for the given second order response.",
    sectionId: 3,
    subjectName: "Control Systems",
    chapterName: "Time Response",
    topicTag: "Damping Ratio",
    difficulty: "moderate",
    estimatedTimeSeconds: 120,
    questionType: "integer",
    myAnswer: "8",
    correctAnswerMin: 8,
    correctAnswerMax: 8,
    isCorrect: true,
    isFlagged: true,
    myTime: 155,
  }),
  createQuestion({
    id: 5013,
    order: 13,
    question: "Choose the correct root locus statement for the given transfer function.",
    sectionId: 3,
    subjectName: "Control Systems",
    chapterName: "Root Locus",
    topicTag: "Branches",
    difficulty: "easy",
    estimatedTimeSeconds: 90,
    myAnswer: 1,
    correctAnswer: 1,
    isCorrect: true,
    myTime: 140,
  }),
  createQuestion({
    id: 5014,
    order: 14,
    question: "Select the correct Nyquist stability interpretation.",
    sectionId: 3,
    subjectName: "Control Systems",
    chapterName: "Frequency Response",
    topicTag: "Nyquist",
    difficulty: "moderate",
    estimatedTimeSeconds: 135,
    myAnswer: 3,
    correctAnswer: 3,
    isCorrect: true,
    myTime: 170,
  }),
  createQuestion({
    id: 5015,
    order: 15,
    question: "Choose the correct state transition matrix property.",
    sectionId: 3,
    subjectName: "Control Systems",
    chapterName: "State Space",
    topicTag: "Transition Matrix",
    difficulty: "easy",
    estimatedTimeSeconds: 90,
    myAnswer: 2,
    correctAnswer: 2,
    isCorrect: true,
    myTime: 107,
  }),
];

const SAMPLE_QUESTION_TIMINGS = SAMPLE_ANALYSIS_QUESTIONS.reduce<Record<string, number>>((acc, question) => {
  acc[String(question.id)] = question.myTime;
  return acc;
}, {});

const SAMPLE_REVIEW_QUESTION_IDS = [5005, 5007, 5012];
const SAMPLE_FLAGGED_QUESTION_IDS = [5005, 5012];
const SAMPLE_VISITED_QUESTION_IDS = SAMPLE_ANALYSIS_QUESTIONS.map((question) => question.id);

function buildInteractionLog(questions: SampleAnalysisQuestion[]): SampleInteractionLogEntry[] {
  let elapsed = 0;
  const log: SampleInteractionLogEntry[] = [];

  questions.forEach((question) => {
    const sectionLabel = question.subjectName?.trim() || question.subjectLabel?.trim() || "Section";
    const questionTime = Math.max(20, Math.round(question.myTime || 0));
    const answerAt = elapsed + Math.max(8, Math.round(questionTime * 0.6));
    const saveAt = elapsed + questionTime;

    log.push({
      at: elapsed,
      questionId: question.id,
      sectionLabel,
      action: "open",
    });

    if (question.isSkipped) {
      log.push({
        at: answerAt,
        questionId: question.id,
        sectionLabel,
        action: "clear",
      });
    } else {
      log.push({
        at: answerAt,
        questionId: question.id,
        sectionLabel,
        action: "answer",
        answerSnapshot: question.myAnswer,
      });
    }

    if (SAMPLE_REVIEW_QUESTION_IDS.includes(question.id)) {
      log.push({
        at: Math.min(saveAt - 2, answerAt + 8),
        questionId: question.id,
        sectionLabel,
        action: "review",
        reviewState: "marked",
      });
    }

    log.push({
      at: saveAt,
      questionId: question.id,
      sectionLabel,
      action: "save",
      answerSnapshot: question.isSkipped ? null : question.myAnswer,
    });

    elapsed = saveAt;
  });

  return log;
}

const SAMPLE_SUBMITTED_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const SAMPLE_TOTAL_TIME = SAMPLE_ANALYSIS_QUESTIONS.reduce((sum, question) => sum + question.myTime, 0);
const SAMPLE_INTERACTION_LOG = buildInteractionLog(SAMPLE_ANALYSIS_QUESTIONS);

const SAMPLE_PREVIEW_ANALYSIS_DATA: Record<number, SampleAnalysisResponse> = {
  [-103]: {
    test: {
      id: -103,
      title: "Signals & Systems Practice Result",
      description: "Sample completed attempt shown in preview mode.",
      examType: "gate",
      examHeader: "GATE 2026",
      examSubheader: "EC",
      durationMinutes: 45,
      passingScore: 35,
      totalQuestions: 15,
    },
    sections: SAMPLE_ANALYSIS_SECTIONS,
    submission: {
      score: 20.5,
      totalPoints: 30,
      percentage: 68.33,
      passed: true,
      submittedAt: SAMPLE_SUBMITTED_AT,
      totalTime: SAMPLE_TOTAL_TIME,
      correctCount: 11,
      wrongCount: 3,
      skippedCount: 1,
      flaggedCount: SAMPLE_FLAGGED_QUESTION_IDS.length,
      questionTimings: SAMPLE_QUESTION_TIMINGS,
      flaggedQuestions: SAMPLE_FLAGGED_QUESTION_IDS,
      visitedQuestionIds: SAMPLE_VISITED_QUESTION_IDS,
      reviewQuestionIds: SAMPLE_REVIEW_QUESTION_IDS,
      interactionLog: SAMPLE_INTERACTION_LOG,
    },
    classStats: {
      totalSubs: 184,
      classAvg: 16.8,
      classPassRate: 46,
      rank: 28,
      percentile: 84.78,
    },
    perQuestion: SAMPLE_ANALYSIS_QUESTIONS,
    advancedInsights: null,
  },
};

export function isSamplePreviewAnalysisId(value: string | number | null | undefined) {
  const id = Number(value);
  return Number.isInteger(id) && Object.prototype.hasOwnProperty.call(SAMPLE_PREVIEW_ANALYSIS_DATA, id);
}

export function getSamplePreviewAnalysisData(value: string | number | null | undefined) {
  const id = Number(value);
  if (!Number.isInteger(id)) return null;
  return SAMPLE_PREVIEW_ANALYSIS_DATA[id] ?? null;
}
