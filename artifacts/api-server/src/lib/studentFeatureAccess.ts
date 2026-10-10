type StudentFeatureAccess = {
  testsLocked: boolean;
  questionBankLocked: boolean;
  analysisLocked: boolean;
  pyqLocked: boolean;
};

export type StudentFeatureUnlockPricing = {
  testsAmount: number | null;
  questionBankAmount: number | null;
  analysisAmount: number | null;
  pyqAmount: number | null;
};

export type TestsPaymentRecord = {
  paidAt: string;
  amount: number;
  orderId: string;
  paymentId: string;
  cycle: number;
};

export type TestsLockEvent = {
  lockedAt: string;
  lockedByAdminId: number | null;
  cycle: number;
};

export type AnalysisPaymentRecord = {
  paidAt: string;
  amount: number;
  orderId: string;
  paymentId: string;
  cycle: number;
};

export type QuestionBankPaymentRecord = {
  paidAt: string;
  amount: number;
  orderId: string;
  paymentId: string;
  cycle: number;
};

export type PyqPaymentRecord = {
  paidAt: string;
  amount: number;
  orderId: string;
  paymentId: string;
  cycle: number;
};

export type AnalysisLockEvent = {
  lockedAt: string;
  lockedByAdminId: number | null;
  cycle: number;
};

type FeatureKey = "tests" | "question-bank" | "analysis" | "pyq";

const DEFAULT_STUDENT_FEATURE_ACCESS: StudentFeatureAccess = {
  testsLocked: false,
  questionBankLocked: false,
  analysisLocked: false,
  pyqLocked: false,
};

const DEFAULT_STUDENT_FEATURE_UNLOCK_PRICING: StudentFeatureUnlockPricing = {
  testsAmount: null,
  questionBankAmount: null,
  analysisAmount: null,
  pyqAmount: null,
};

function getProfileRecord(raw: unknown) {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function getFeatureAccessRecord(raw: unknown) {
  const profile = getProfileRecord(raw);
  const featureAccess = profile.featureAccess;
  return featureAccess && typeof featureAccess === "object"
    ? (featureAccess as Record<string, unknown>)
    : {};
}

function getFeaturePricingRecord(raw: unknown) {
  const profile = getProfileRecord(raw);
  const featureUnlockPricing = profile.featureUnlockPricing;
  return featureUnlockPricing && typeof featureUnlockPricing === "object"
    ? (featureUnlockPricing as Record<string, unknown>)
    : {};
}

function parsePositiveAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function getStudentFeatureAccess(rawProfile: unknown): StudentFeatureAccess {
  const featureAccess = getFeatureAccessRecord(rawProfile);
  return {
    testsLocked: Boolean(featureAccess.testsLocked),
    questionBankLocked: Boolean(featureAccess.questionBankLocked),
    analysisLocked: Boolean(featureAccess.analysisLocked),
    pyqLocked: Boolean(featureAccess.pyqLocked),
  };
}

export function mergeStudentFeatureAccess(
  rawProfile: unknown,
  updates: Partial<StudentFeatureAccess>,
) {
  const profile = getProfileRecord(rawProfile);
  const current = getStudentFeatureAccess(rawProfile);
  return {
    ...profile,
    featureAccess: {
      ...current,
      ...updates,
    },
  };
}

export function getStudentFeatureUnlockPricing(rawProfile: unknown): StudentFeatureUnlockPricing {
  const pricing = getFeaturePricingRecord(rawProfile);
  return {
    testsAmount: parsePositiveAmount(pricing.testsAmount),
    questionBankAmount: parsePositiveAmount(pricing.questionBankAmount),
    analysisAmount: parsePositiveAmount(pricing.analysisAmount),
    pyqAmount: parsePositiveAmount(pricing.pyqAmount),
  };
}

export function mergeStudentFeatureUnlockPricing(
  rawProfile: unknown,
  updates: Partial<StudentFeatureUnlockPricing>,
) {
  const profile = getProfileRecord(rawProfile);
  const current = getStudentFeatureUnlockPricing(rawProfile);
  return {
    ...profile,
    featureUnlockPricing: {
      ...DEFAULT_STUDENT_FEATURE_UNLOCK_PRICING,
      ...current,
      ...updates,
    },
  };
}

export function getTestsPaymentHistory(rawProfile: unknown): TestsPaymentRecord[] {
  const profile = getProfileRecord(rawProfile);
  const history = profile.testsPaymentHistory;
  if (!Array.isArray(history)) return [];
  return history.filter(
    (item): item is TestsPaymentRecord =>
      item && typeof item === "object" && typeof item.paidAt === "string",
  );
}

export function appendTestsPayment(
  rawProfile: unknown,
  payment: Omit<TestsPaymentRecord, "cycle">,
): Record<string, unknown> {
  const profile = getProfileRecord(rawProfile);
  const existing = getTestsPaymentHistory(rawProfile);
  const cycle = existing.length + 1;
  return {
    ...profile,
    testsPaymentHistory: [...existing, { ...payment, cycle }],
  };
}

export function getTestsLockEvents(rawProfile: unknown): TestsLockEvent[] {
  const profile = getProfileRecord(rawProfile);
  const events = profile.testsLockEvents;
  if (!Array.isArray(events)) return [];
  return events.filter(
    (item): item is TestsLockEvent =>
      item && typeof item === "object" && typeof item.lockedAt === "string",
  );
}

export function appendTestsLockEvent(
  rawProfile: unknown,
  event: Omit<TestsLockEvent, "cycle">,
): Record<string, unknown> {
  const profile = getProfileRecord(rawProfile);
  const existing = getTestsLockEvents(rawProfile);
  const cycle = existing.length + 1;
  return {
    ...profile,
    testsLockEvents: [...existing, { ...event, cycle }],
  };
}

export function getQuestionBankPaymentHistory(rawProfile: unknown): QuestionBankPaymentRecord[] {
  const profile = getProfileRecord(rawProfile);
  const history = profile.questionBankPaymentHistory;
  if (!Array.isArray(history)) return [];
  return history.filter(
    (item): item is QuestionBankPaymentRecord =>
      item && typeof item === "object" && typeof item.paidAt === "string",
  );
}

export function appendQuestionBankPayment(
  rawProfile: unknown,
  payment: Omit<QuestionBankPaymentRecord, "cycle">,
): Record<string, unknown> {
  const profile = getProfileRecord(rawProfile);
  const existing = getQuestionBankPaymentHistory(rawProfile);
  const cycle = existing.length + 1;
  return {
    ...profile,
    questionBankPaymentHistory: [...existing, { ...payment, cycle }],
  };
}

export function getPyqPaymentHistory(rawProfile: unknown): PyqPaymentRecord[] {
  const profile = getProfileRecord(rawProfile);
  const history = profile.pyqPaymentHistory;
  if (!Array.isArray(history)) return [];
  return history.filter(
    (item): item is PyqPaymentRecord =>
      item && typeof item === "object" && typeof item.paidAt === "string",
  );
}

export function appendPyqPayment(
  rawProfile: unknown,
  payment: Omit<PyqPaymentRecord, "cycle">,
): Record<string, unknown> {
  const profile = getProfileRecord(rawProfile);
  const existing = getPyqPaymentHistory(rawProfile);
  return {
    ...profile,
    pyqPaymentHistory: [...existing, { ...payment, cycle: existing.length + 1 }],
  };
}

export function getAnalysisPaymentHistory(rawProfile: unknown): AnalysisPaymentRecord[] {
  const profile = getProfileRecord(rawProfile);
  const history = profile.analysisPaymentHistory;
  if (!Array.isArray(history)) return [];
  return history.filter(
    (item): item is AnalysisPaymentRecord =>
      item && typeof item === "object" && typeof item.paidAt === "string",
  );
}

export function appendAnalysisPayment(
  rawProfile: unknown,
  payment: Omit<AnalysisPaymentRecord, "cycle">,
): Record<string, unknown> {
  const profile = getProfileRecord(rawProfile);
  const existing = getAnalysisPaymentHistory(rawProfile);
  const cycle = existing.length + 1;
  return {
    ...profile,
    analysisPaymentHistory: [...existing, { ...payment, cycle }],
  };
}

export function getAnalysisLockEvents(rawProfile: unknown): AnalysisLockEvent[] {
  const profile = getProfileRecord(rawProfile);
  const events = profile.analysisLockEvents;
  if (!Array.isArray(events)) return [];
  return events.filter(
    (item): item is AnalysisLockEvent =>
      item && typeof item === "object" && typeof item.lockedAt === "string",
  );
}

export function appendAnalysisLockEvent(
  rawProfile: unknown,
  event: Omit<AnalysisLockEvent, "cycle">,
): Record<string, unknown> {
  const profile = getProfileRecord(rawProfile);
  const existing = getAnalysisLockEvents(rawProfile);
  const cycle = existing.length + 1;
  return {
    ...profile,
    analysisLockEvents: [...existing, { ...event, cycle }],
  };
}

export function isStudentFeatureLocked(
  user: { role?: string | null; studentProfileData?: string | null } | null | undefined,
  feature: FeatureKey,
) {
  if (user?.role !== "student") return false;

  let parsedProfile: unknown = null;
  if (typeof user.studentProfileData === "string" && user.studentProfileData.trim()) {
    try {
      parsedProfile = JSON.parse(user.studentProfileData);
    } catch {
      parsedProfile = null;
    }
  }

  const access = getStudentFeatureAccess(parsedProfile);
  if (feature === "tests") return access.testsLocked;
  if (feature === "question-bank") return access.questionBankLocked;
  if (feature === "analysis") return access.analysisLocked;
  return access.pyqLocked;
}

export function ensureStudentFeatureUnlocked(
  user: { role?: string | null; studentProfileData?: string | null } | null | undefined,
  feature: FeatureKey,
  res: { status: (code: number) => { json: (payload: Record<string, unknown>) => void } },
) {
  if (!isStudentFeatureLocked(user, feature)) return true;

  if (feature === "tests") {
    res.status(403).json({
      error: "Tests are locked for this student account. Complete the one-time payment to unlock access.",
      code: "STUDENT_TESTS_LOCKED",
    });
  } else if (feature === "question-bank") {
    res.status(403).json({
      error: "Question bank is locked for this student account. Complete the one-time payment to unlock access.",
      code: "STUDENT_QUESTION_BANK_LOCKED",
    });
  } else if (feature === "analysis") {
    res.status(403).json({
      error: "Full analysis is locked for this student account. Complete the one-time payment to unlock access.",
      code: "STUDENT_ANALYSIS_LOCKED",
    });
  } else {
    res.status(403).json({
      error: "PYQ access is locked for this student account. Complete the one-time payment to unlock access.",
      code: "STUDENT_PYQ_LOCKED",
    });
  }
  return false;
}
