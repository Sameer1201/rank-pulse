import { useEffect } from "react";
import { useLocation } from "wouter";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { Clock3, LogOut, Mail, RefreshCcw, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { formatExamDisplayName } from "@/lib/exam-display";
import { STUDENT_VERIFICATION_CONTACT_EMAIL } from "@/lib/student-access";
import type { AuthUser } from "@/types/auth";
import { buildApiUrl } from "@/lib/api-origin";

export default function StudentPendingApproval() {
  const { user, login, logout } = useAuth();
  const [, setLocation] = useLocation();
  const isRejected = user?.status === "rejected";

  const { data, isFetching, refetch } = useGetCurrentUser({
    query: {
      queryKey: ["student", "pending-approval"],
      refetchInterval: 30000,
      retry: 1,
    },
  });

  useEffect(() => {
    if (!data) return;
    const nextUser = data as AuthUser;
    login(nextUser);

    if (!nextUser.onboardingComplete) {
      setLocation("/student/profile");
      return;
    }

    if (nextUser.status === "approved") {
      setLocation("/student/dashboard");
    }
  }, [data, login, setLocation]);

  const handleLogout = async () => {
    await fetch(buildApiUrl(`/api/auth/logout`), {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    logout();
    setLocation("/login");
  };

  const handleEmailAdmin = () => {
    if (typeof window === "undefined") return;
    const subject = encodeURIComponent("Student verification pending");
    const body = encodeURIComponent("Hi Admin,\n\nMy student account verification is still pending. Please review it.\n");
    window.location.href = `mailto:${STUDENT_VERIFICATION_CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#eef2ff_0%,#ffffff_48%,#f8fafc_100%)] px-4 py-5 text-[#111827] sm:py-6">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-2xl items-center justify-center sm:min-h-[calc(100vh-3rem)]">
        <div className="w-full rounded-[28px] border border-[#E5E7EB] bg-white/95 p-6 shadow-[0_24px_64px_rgba(15,23,42,0.08)] sm:p-7">
          <div className="flex items-center gap-2.5">
            <BrandLogo imageClassName="h-10" />
            <div className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
              isRejected ? "bg-[#FEE2E2] text-[#B91C1C]" : "bg-[#FEF3C7] text-[#B45309]"
            }`}>
              {isRejected ? "Application Rejected" : "Verification Pending"}
            </div>
          </div>

          <div className="mt-6 flex items-start gap-3">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] ${
              isRejected ? "bg-[#FEF2F2] text-[#DC2626]" : "bg-[#FFF7ED] text-[#F97316]"
            }`}>
              <ShieldCheck size={22} />
            </div>
            <div>
              <h1 className="text-[2rem] font-black leading-tight tracking-tight text-[#111827] sm:text-[2.2rem]">
                {isRejected ? "Update needed" : "Setup submitted"}
              </h1>
              <p className="mt-1.5 max-w-lg text-sm leading-6 text-[#6B7280]">
                {isRejected
                  ? "Changes were requested. Update the details and resubmit."
                  : "Profile setup is complete. Full access will unlock after approval."}
              </p>
            </div>
          </div>

          {isRejected && (
            <div className="mt-5 rounded-[20px] border border-[#FECACA] bg-[#FEF2F2] p-4">
              <p className="text-sm font-semibold text-[#B91C1C]">Rejection reason</p>
              <p className="mt-1.5 text-sm leading-6 text-[#7F1D1D]">
                {user?.rejectionReason || "Admin asked you to review and update your submitted details."}
              </p>
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[20px] border border-[#E5E7EB] bg-[#FAFBFF] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#6B7280]">
                <Clock3 size={16} className="text-[#F97316]" />
                Status
              </div>
              <p className="mt-2.5 text-[1.9rem] font-black leading-none text-[#111827]">
                {user?.status === "approved" ? "Approved" : isRejected ? "Rejected" : "Pending"}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-[#6B7280]">
                {isRejected ? "Edit and resubmit" : "Waiting for review"}
              </p>
            </div>

            <div className="rounded-[20px] border border-[#E5E7EB] bg-[#FAFBFF] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6B7280]">Exam</div>
              <p className="mt-2.5 truncate text-[1.9rem] font-black leading-none text-[#111827]">
                {formatExamDisplayName(user?.subject) || "Not selected"}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-[#6B7280]">Locked for review</p>
            </div>

            <div className="rounded-[20px] border border-[#E5E7EB] bg-[#FAFBFF] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6B7280]">Auto check</div>
              <p className="mt-2.5 text-[1.9rem] font-black leading-none text-[#111827]">30s</p>
              <p className="mt-1.5 text-xs leading-5 text-[#6B7280]">Auto refresh enabled</p>
            </div>
          </div>

          <div className="mt-5 rounded-[20px] border border-[#E5E7EB] bg-[#FFF7E8] p-4">
            <p className="text-sm font-semibold text-[#B45309]">{isRejected ? "Next step" : "Next"}</p>
            <div className="mt-2.5 space-y-1.5 text-sm leading-6 text-[#7C2D12]">
              {isRejected ? (
                <>
                  <p>1. Open the form again and fix the details.</p>
                  <p>2. Resubmit to move back to pending review.</p>
                </>
              ) : (
                <>
                  <p>1. Your details are now in the review queue.</p>
                  <p>2. Preview dashboard stays available until approval.</p>
                </>
              )}
            </div>
          </div>

          {!isRejected && (
            <div className="mt-5 rounded-[20px] border border-[#E5E7EB] bg-[#FAFBFF] p-4">
              <p className="text-sm font-semibold text-[#111827]">Need help?</p>
              <div className="mt-2.5 flex items-center gap-2 text-sm font-semibold text-[#111827]">
                <Mail size={16} className="text-[#F97316]" />
                <span>{STUDENT_VERIFICATION_CONTACT_EMAIL}</span>
              </div>
              <p className="mt-1.5 text-sm leading-6 text-[#6B7280]">
                If approval is taking longer than expected, you can follow up here.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2.5">
            {isRejected && (
              <Button
                type="button"
                onClick={() => setLocation("/student/profile")}
                className="h-11 rounded-2xl bg-[#DC2626] px-5 text-white hover:bg-[#B91C1C]"
              >
                Edit details
              </Button>
            )}
            {!isRejected && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/student/dashboard")}
                className="h-11 rounded-2xl border-[#FED7AA] px-5 text-[#F97316] hover:bg-[#FFF7ED]"
              >
                Open preview dashboard
              </Button>
            )}
            <Button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="h-11 rounded-2xl bg-[#F97316] px-5 text-white hover:bg-[#EA580C]"
            >
              <RefreshCcw size={16} className={`mr-2 ${isFetching ? "animate-spin" : ""}`} />
              {isFetching ? "Checking..." : isRejected ? "Refresh" : "Check again"}
            </Button>
            {!isRejected && (
              <Button
                type="button"
                variant="outline"
                onClick={handleEmailAdmin}
                className="h-11 rounded-2xl border-[#E5E7EB] px-5"
              >
                <Mail size={16} className="mr-2" />
                Contact admin
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleLogout}
              className="h-11 rounded-2xl border-[#E5E7EB] px-5"
            >
              <LogOut size={16} className="mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
