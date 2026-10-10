import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { PageLoading } from "@/components/PageRecovery";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { PremiumWhiteLoader } from "@/components/ui/PremiumWhiteLoader";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { OfflinePracticeManager } from "@/components/student/OfflinePractice";
import { canResumeBufferedPractice } from "@/lib/practice-network";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { isStudentPendingVerification, isStudentRejectedVerification } from "@/lib/student-access";
import { buildApiUrl } from "@/lib/api-origin";
import { StudentAccessHoldScreen } from "@/components/student/StudentAccessHoldScreen";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ShieldCheck } from "lucide-react";
// Layout is imported statically so the nav shell renders immediately (no suspense flicker)
import Layout from "@/components/Layout";

const importSuperAdminDashboard = () => import("@/pages/super-admin/Dashboard");
const importSuperAdminManagement = () => import("@/pages/super-admin/Management");
const importSuperAdminAiHints = () => import("@/pages/super-admin/AiHints");
const importSendNotification = () => import("@/pages/super-admin/SendNotification");
const importPlannerExamTemplates = () => import("@/pages/planner/ExamTemplates");
const importPlannerQuestionBank = () => import("@/pages/planner/QuestionBank");
const importAdminStudents = () => import("@/pages/admin/Students");
const importAdminQuestionBank = () => import("@/pages/admin/QuestionBank");
const importAdminPYQ = () => import("@/pages/admin/PYQ");
const importPSU = () => import("@/pages/PSU");
const importPSUTestAnalysis = () => import("@/pages/PSUTestAnalysis");
const importPSUTestSolutions = () => import("@/pages/PSUTestSolutions");
const importPSUQuestionBank = () => import("@/pages/PSUQuestionBank");
const importAdminTests = () => import("@/pages/admin/Tests");
const importStudentDashboard = () => import("@/pages/student/Dashboard");
const importStudentTests = () => import("@/pages/student/Tests");
const importStudentQuestionBankDashboard = () => import("@/pages/student/question-bank/Dashboard");
const importStudentPYQ = () => import("@/pages/student/PYQ");
const importStudentProfile = () => import("@/pages/student/Profile");
const importStudentUnlockFeature = () => import("@/pages/student/UnlockFeature");

const NotFound = lazy(() => import("@/pages/not-found"));
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const RegisterPage = lazy(() => import("@/pages/RegisterPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const AboutPage = lazy(() => import("@/pages/AboutPage"));
const ContactPage = lazy(() => import("@/pages/ContactPage"));
const PrivacyPolicyPage = lazy(() => import("@/pages/PrivacyPolicyPage"));
const TermsPage = lazy(() => import("@/pages/TermsPage"));
const RefundPolicyPage = lazy(() => import("@/pages/RefundPolicyPage"));
const CheckoutInfoPage = lazy(() => import("@/pages/CheckoutInfoPage"));
const SuperAdminDashboard = lazy(importSuperAdminDashboard);
const SuperAdminManagement = lazy(importSuperAdminManagement);
const SuperAdminAiHints = lazy(importSuperAdminAiHints);
const SuperAdminPayments = lazy(() => import("@/pages/super-admin/Payments"));
const SendNotification = lazy(importSendNotification);
const TeacherPerformance = lazy(() => import("@/pages/super-admin/TeacherPerformance"));
const SuperAdminTests = lazy(() => import("@/pages/super-admin/Tests"));
const SuperAdminActivity = lazy(() => import("@/pages/super-admin/Activity"));
const SuperAdminDataTransfer = lazy(() => import("@/pages/super-admin/DataTransfer"));
const SuperAdminLiveDatabase = lazy(() => import("@/pages/super-admin/LiveDatabase"));
const AdminStudents = lazy(importAdminStudents);
const AdminProfile = lazy(() => import("@/pages/admin/Profile"));
const AdminAnalytics = lazy(() => import("@/pages/admin/Analytics"));
const AdminQuestionBank = lazy(importAdminQuestionBank);
const AdminPYQ = lazy(importAdminPYQ);
const PSU = lazy(importPSU);
const PSUTestAnalysis = lazy(importPSUTestAnalysis);
const PSUTestSolutions = lazy(importPSUTestSolutions);
const PSUQuestionBank = lazy(importPSUQuestionBank);
const AdminTests = lazy(importAdminTests);
const AdminTestBuilder = lazy(() => import("@/pages/admin/TestBuilder"));
const TestAnalytics = lazy(() => import("@/pages/admin/TestAnalytics"));
const PlannerExamTemplates = lazy(importPlannerExamTemplates);
const PlannerQuestionBank = lazy(importPlannerQuestionBank);
const PlannerQuestionBankDetail = lazy(() => import("@/pages/planner/QuestionBankDetail"));
const StudentDashboard = lazy(importStudentDashboard);
const StudentTestAnalysis = lazy(() => import("@/pages/student/TestAnalysis"));
const StudentTestSolutions = lazy(() => import("@/pages/student/TestSolutions"));
const StudentTestDetailPage = lazy(() => import("@/pages/student/TestDetailPage"));
const StudentQuestionBankDashboard = lazy(importStudentQuestionBankDashboard);
const StudentPYQ = lazy(importStudentPYQ);
const StudentSavedQuestions = lazy(() => import("@/pages/student/question-bank/SavedQuestions"));
const StudentQuestionBankExamPage = lazy(() => import("@/pages/student/question-bank/ExamPage"));
const StudentQuestionBankSubjectPage = lazy(() => import("@/pages/student/question-bank/SubjectPage"));
const StudentQuestionBankChapterPage = lazy(() => import("@/pages/student/question-bank/ChapterPage"));
const StudentQuestionBankQuestionPage = lazy(() => import("@/pages/student/question-bank/QuestionPage"));
const StudentReviewBucket = lazy(() => import("@/pages/student/ReviewBucket"));
const StudentProfile = lazy(importStudentProfile);
const StudentUnlockFeaturePage = lazy(importStudentUnlockFeature);
const StudentPendingApproval = lazy(() => import("@/pages/student/PendingApproval"));
const StudentTests = lazy(importStudentTests);
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const ActivityFeed = lazy(() => import("@/pages/ActivityFeed"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
    },
  },
});

export type ViewMode = "personal" | "comparative";

function getCurrentIndexScriptPath() {
  if (typeof document === "undefined") return null;
  const script = document.querySelector('script[type="module"][src*="/assets/index-"]');
  const src = script?.getAttribute("src");
  if (!src) return null;

  try {
    return new URL(src, window.location.origin).pathname;
  } catch {
    return src;
  }
}

function extractIndexScriptPath(html: string) {
  const match = html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/i);
  if (!match?.[1]) return null;

  try {
    return new URL(match[1], window.location.origin).pathname;
  } catch {
    return match[1];
  }
}

function useDeployRefresh() {
  const currentScriptPathRef = useRef<string | null>(null);
  const reloadTriggeredRef = useRef(false);

  // The preview server is used for local testing and can change build assets while
  // the app is open. Avoid a forced reload there so the current route is preserved.
  if (
    import.meta.env.DEV ||
    (typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"))
  ) {
    return;
  }

  useEffect(() => {
    currentScriptPathRef.current = getCurrentIndexScriptPath();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    const checkForNewDeploy = async () => {
      if (cancelled || reloadTriggeredRef.current) return;

      try {
        const response = await fetch(`${import.meta.env.BASE_URL || "/"}?deploy-check=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const html = await response.text();
        const latestScriptPath = extractIndexScriptPath(html);
        const currentScriptPath = currentScriptPathRef.current ?? getCurrentIndexScriptPath();

        if (latestScriptPath && currentScriptPath && latestScriptPath !== currentScriptPath) {
          reloadTriggeredRef.current = true;
          window.location.reload();
        }
      } catch {
        // Ignore transient network errors
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForNewDeploy();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkForNewDeploy();
      }
    }, 5 * 60_000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, []);
}

function scheduleIdlePrefetch(work: () => void) {
  if (typeof window === "undefined") return () => {};

  if ("requestIdleCallback" in window) {
    const idleId = (window as Window & {
      requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback(work, { timeout: 1800 });

    return () => {
      if ("cancelIdleCallback" in window) {
        (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId);
      }
    };
  }

  const timeoutId = globalThis.setTimeout(work, 900);
  return () => globalThis.clearTimeout(timeoutId);
}

function warmLikelyRouteChunks(role: string) {
  if (role === "super_admin") {
    void importSuperAdminDashboard();
    void importSuperAdminManagement();
    void importPlannerQuestionBank();
    void importPlannerExamTemplates();
    void importSendNotification();
    return;
  }

  if (role === "admin") {
    void importAdminQuestionBank();
    void importAdminPYQ();
    void importAdminStudents();
    void importAdminTests();
    return;
  }

  void importStudentDashboard();
  void importStudentTests();
  void importStudentQuestionBankDashboard();
  void importStudentPYQ();
  void importStudentProfile();
}

function AppLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fffaf2] px-4 py-8">
      <div className="w-full max-w-xl">
        <PremiumWhiteLoader progress={72} />
      </div>
    </div>
  );
}

function studentNeedsOnboarding(user: { role: string; onboardingComplete?: boolean }) {
  return user.role === "student" && !user.onboardingComplete;
}

const STUDENT_ONBOARDING_RETURN_TO_KEY = "student-onboarding-return-to";

function isPendingStudentPreviewAnalysisPath(location: string) {
  return /^\/student\/tests\/-\d+\/analysis$/.test(location);
}

function ProtectedRoute({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading && !canResumeBufferedPractice(user, location)) {
    return <AppLoader />;
  }

  if (!user) {
    return <RedirectTo href="/" />;
  }

  if (!roles.includes(user.role)) {
    return <RedirectTo href="/" />;
  }

  if (user.role === "student") {
    if (studentNeedsOnboarding(user) && location !== "/student/profile") {
      return <RedirectTo href="/student/profile" />;
    }

    if (
      isStudentPendingVerification(user) &&
      ![
        "/student/dashboard",
        "/student/pending-approval",
        "/student/profile",
        "/student/tests",
         "/student/question-bank",
         "/student/question-bank/saved",
        "/student/pyq",
        "/student/psu",
      ].includes(location)
      && !isPendingStudentPreviewAnalysisPath(location)
      && !location.startsWith("/student/psu/")
    ) {
      return <RedirectTo href="/student/dashboard" />;
    }

    if (isStudentRejectedVerification(user) && location !== "/student/pending-approval" && location !== "/student/profile") {
      return <RedirectTo href="/student/pending-approval" />;
    }

    if (studentNeedsOnboarding(user) && location === "/") {
      return <RedirectTo href="/student/profile" />;
    }

    if (!studentNeedsOnboarding(user) && user.status === "approved" && location === "/student/pending-approval") {
      return <RedirectTo href="/student/dashboard" />;
    }
  }

  return <>{children}</>;
}

function getRoleHomePath(role: string, user?: { onboardingComplete?: boolean; status?: string | null }) {
  if (role === "super_admin") return "/super-admin/dashboard";
  if (role === "admin") return "/admin/question-bank";
  if (!user?.onboardingComplete) return "/student/profile";
  if (user.status === "pending") return "/student/pending-approval";
  if (user.status === "rejected") return "/student/pending-approval";
  return "/student/dashboard";
}

function RedirectTo({ href }: { href: string }) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation(href);
  }, [href, setLocation]);

  return <AppLoader />;
}

function StudentAccessWindowGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [showPriorityWelcome, setShowPriorityWelcome] = useState(false);
  const accessQuery = useQuery<{ isClosed: boolean; closedUntil: string | null; priorityAccess?: boolean }>({
    queryKey: ["student-access-window"],
    enabled: user?.role === "student",
    queryFn: async () => {
      const response = await fetch(buildApiUrl("/api/auth/registration-status"), { credentials: "include" });
      if (!response.ok) throw new Error("Could not load access window");
      return response.json();
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });

  const isPriorityStudent = user?.role === "student" && Boolean(
    accessQuery.data?.priorityAccess ?? (user as AuthUserWithPriority).priorityAccess,
  );
  const priorityStudentId = user?.role === "student" ? String(user.id) : "";
  const priorityWindowActive = isPriorityStudent && Boolean(accessQuery.data?.isClosed);

  useEffect(() => {
    if (!priorityWindowActive || !priorityStudentId || typeof window === "undefined") return;

    const storageKey = `priority-access-welcome-seen:${priorityStudentId}`;
    try {
      if (window.localStorage.getItem(storageKey) === "1") return;
      window.localStorage.setItem(storageKey, "1");
      setShowPriorityWelcome(true);
    } catch {
      // If storage is unavailable, keep the popup usable for this session.
      setShowPriorityWelcome(true);
    }
  }, [priorityStudentId, priorityWindowActive]);

  if (user?.role === "student" && !isPriorityStudent && accessQuery.data?.isClosed && accessQuery.data.closedUntil) {
    return <StudentAccessHoldScreen closedUntil={accessQuery.data.closedUntil} onExpired={() => void accessQuery.refetch()} />;
  }

  return (
    <>
      {children}
      <Dialog open={showPriorityWelcome} onOpenChange={setShowPriorityWelcome}>
        <DialogContent className="max-w-md" data-testid="priority-access-welcome">
          <DialogHeader>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 sm:mx-0">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <DialogTitle className="text-xl">Priority access enabled</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              You have priority access right now. You can continue using the website while new student registration is paused.
            </DialogDescription>
          </DialogHeader>
          <Button type="button" onClick={() => setShowPriorityWelcome(false)} className="w-full bg-red-600 text-white hover:bg-red-700">
            Continue learning
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

type AuthUserWithPriority = { priorityAccess?: boolean };

function AppRouter() {
  const { user, isLoading } = useAuth();
  useActivityTracker(!!user);

  useEffect(() => {
    if (isLoading || !user) return;
    return scheduleIdlePrefetch(() => {
      warmLikelyRouteChunks(user.role);
    });
  }, [isLoading, user]);

  return (
    <>
      <StudentAccessWindowGate>
      <Switch>
      <Route path="/">
        {isLoading ? (
          <AppLoader />
        ) : user ? (
          <RedirectTo href={getRoleHomePath(user.role, user)} />
        ) : (
          <LandingPage />
        )}
      </Route>


      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/privacy-policy" component={PrivacyPolicyPage} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/refund-policy" component={RefundPolicyPage} />
      <Route path="/checkout" component={CheckoutInfoPage} />

      {/* Super Admin Routes */}
      <Route path="/super-admin/dashboard">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SuperAdminDashboard /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/ai-hints">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SuperAdminAiHints /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/management">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SuperAdminManagement /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/admins">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SuperAdminManagement initialTab="admins" /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/students">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SuperAdminManagement initialTab="students" /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/tests">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SuperAdminTests /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/activity">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SuperAdminActivity /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/payments">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SuperAdminPayments /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/send-notification">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SendNotification /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/teacher-performance">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><TeacherPerformance /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/exam-templates">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><PlannerExamTemplates /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/question-bank">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><PlannerQuestionBank /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/question-bank/:id">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><PlannerQuestionBankDetail /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/super-admin/data-transfer">
        <ProtectedRoute roles={["super_admin"]}>
          <Layout><SuperAdminDataTransfer /></Layout>
        </ProtectedRoute>
      </Route>
      {/* Admin Routes */}
      <Route path="/admin/profile">
        <ProtectedRoute roles={["admin"]}>
          <Layout><AdminProfile /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/dashboard">
        <ProtectedRoute roles={["admin"]}>
          <RedirectTo href="/admin/question-bank" />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/students">
        <ProtectedRoute roles={["admin"]}>
          <Layout><AdminStudents /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/tests">
        <ProtectedRoute roles={["admin"]}>
          <Layout><AdminTests /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/tests/:id/builder">
        <ProtectedRoute roles={["admin"]}>
          <AdminTestBuilder />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/psu/:psuId/tests/:id/builder">
        <ProtectedRoute roles={["admin", "super_admin"]}>
          <AdminTestBuilder />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/question-bank/exam/:examKey/subject/:subjectId/chapter/:chapterId">
        <ProtectedRoute roles={["admin"]}>
          <AdminQuestionBank />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/question-bank">
        <ProtectedRoute roles={["admin"]}>
          <Layout><AdminQuestionBank /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/pyq">
        <ProtectedRoute roles={["admin"]}>
          <Layout><AdminPYQ /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/psu">
        <ProtectedRoute roles={["admin"]}>
          <Layout><PSU /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/tests/:id/analytics">
        <ProtectedRoute roles={["admin", "super_admin"]}>
          <Layout><TestAnalytics /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/analytics">
        <ProtectedRoute roles={["admin", "super_admin"]}>
          <Layout><AdminAnalytics /></Layout>
        </ProtectedRoute>
      </Route>
      {/* Student Routes */}
      <Route path="/student/dashboard">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentDashboard /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/tests">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentTests /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/tests/review-bucket">
        <ProtectedRoute roles={["student"]}>
          <StudentReviewBucket />
        </ProtectedRoute>
      </Route>
      <Route path="/student/question-bank">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentQuestionBankDashboard /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/pyq">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentPYQ /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/offline-practice">
        <ProtectedRoute roles={["student"]}>
          <RedirectTo href="/student/question-bank" />
        </ProtectedRoute>
      </Route>
      <Route path="/student/psu">
        <ProtectedRoute roles={["student"]}>
          <Layout><PSU /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/psu/:psuId/tests/:testId/analysis">
        <ProtectedRoute roles={["student"]}>
          <PSUTestAnalysis />
        </ProtectedRoute>
      </Route>
      <Route path="/student/psu/:psuId/tests/:testId/solutions">
        <ProtectedRoute roles={["student"]}>
          <StudentTestSolutions />
        </ProtectedRoute>
      </Route>
      <Route path="/student/psu/:psuId/review-bucket">
        <ProtectedRoute roles={["student"]}>
          <StudentReviewBucket />
        </ProtectedRoute>
      </Route>
      <Route path="/student/psu/:psuId/tests/:testId">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentTests /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/psu/:psuId/question-bank">
        <ProtectedRoute roles={["student"]}>
          <Layout><PSUQuestionBank /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/question-bank/saved">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentSavedQuestions /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/question-bank/exam/:examId">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentQuestionBankExamPage /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/question-bank/exam/:examId/subject/:subjectId">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentQuestionBankSubjectPage /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/question-bank/exam/:examId/subject/:subjectId/chapter/:chapterId">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentQuestionBankChapterPage /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/question-bank/exam/:examId/subject/:subjectId/chapter/:chapterId/question/:questionId">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentQuestionBankQuestionPage /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/tests/:id/result">
        <ProtectedRoute roles={["student"]}>
          <StudentTestDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/student/tests/:id/analysis">
        <ProtectedRoute roles={["student"]}>
          <StudentTestAnalysis />
        </ProtectedRoute>
      </Route>
      <Route path="/student/tests/:id/solutions">
        <ProtectedRoute roles={["student"]}>
          <StudentTestSolutions />
        </ProtectedRoute>
      </Route>
      <Route path="/student/profile">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentProfile /></Layout>
        </ProtectedRoute>
      </Route>
      <Route path="/student/pending-approval">
        <ProtectedRoute roles={["student"]}>
          <StudentPendingApproval />
        </ProtectedRoute>
      </Route>
      <Route path="/student/unlock/:feature">
        <ProtectedRoute roles={["student"]}>
          <Layout><StudentUnlockFeaturePage /></Layout>
        </ProtectedRoute>
      </Route>

      {/* Shared — accessible to all logged-in roles */}
      <Route path="/leaderboard">
        <ProtectedRoute roles={["super_admin", "admin", "student"]}>
          <Layout><Leaderboard /></Layout>
        </ProtectedRoute>
      </Route>

      {/* Activity Feed — all logged-in roles */}
      <Route path="/activity">
        <ProtectedRoute roles={["super_admin", "admin", "student"]}>
          <Layout><ActivityFeed /></Layout>
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
      </Switch>
      </StudentAccessWindowGate>
      {!user ? <div className="fixed bottom-4 right-4 z-[100] sm:bottom-6 sm:right-6"><ThemeToggle /></div> : null}
    </>
  );
}

function App() {
  useDeployRefresh();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ThemeProvider>
            <AuthProvider>
              <OfflinePracticeManager />
              <Suspense fallback={<PageLoading />}>
                <AppRouter />
              </Suspense>
              <Toaster />
            </AuthProvider>
          </ThemeProvider>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
