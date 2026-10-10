import type { User as ApiUser } from "@workspace/api-client-react";

export interface StudentProfileDetails {
  dateOfBirth: string;
  whatsappOnSameNumber: boolean;
  whatsappNumber: string;
  address: {
    country: string;
    state: string;
    district: string;
    street: string;
    city: string;
    pincode: string;
  };
  preparation: {
    classLevel: string;
    board: string;
    targetYear: string;
    targetExam: string;
    institutionName: string;
    collegeName: string;
    universityName: string;
  };
  learningMode: {
    mode: string;
    provider: string;
  };
  hearAboutUs: string;
  dashboard?: {
    dailyQuestionGoal?: number;
  };
  featureAccess?: {
    testsLocked?: boolean;
    questionBankLocked?: boolean;
    analysisLocked?: boolean;
    pyqLocked?: boolean;
  };
  featureUnlockPricing?: {
    testsAmount?: number | null;
    questionBankAmount?: number | null;
    analysisAmount?: number | null;
    pyqAmount?: number | null;
  };
}

export interface StudentFeatureAccess {
  testsLocked?: boolean;
  questionBankLocked?: boolean;
  analysisLocked?: boolean;
  pyqLocked?: boolean;
}

export interface AuthUser extends ApiUser {
  priorityAccess?: boolean;
  onboardingComplete?: boolean;
  onboardingDraftStep?: number | null;
  profileDetails?: StudentProfileDetails | null;
  rejectionReason?: string | null;
  studentFeatureAccess?: StudentFeatureAccess | null;
  studentFeaturePricing?: {
    testsAmount?: number | null;
    questionBankAmount?: number | null;
    analysisAmount?: number | null;
    pyqAmount?: number | null;
  } | null;
}
