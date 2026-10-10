import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, Clock3, MailCheck } from "lucide-react";
import { Link } from "wouter";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useAuth } from "@/contexts/AuthContext";
import {
  deleteCurrentFirebaseUser,
  isFirebaseGoogleConfigured,
  registerWithFirebaseEmailPassword,
} from "@/lib/firebase";
import { buildApiUrl } from "@/lib/api-origin";
import { StudentAccessHoldScreen } from "@/components/student/StudentAccessHoldScreen";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function getRegistrationErrorMessage(error: unknown) {
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? String((error as { code: string }).code)
    : "";
  const messages: Record<string, string> = {
    "auth/email-already-in-use": "This email is already registered. Please sign in or use another email.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/password-does-not-meet-requirements": "Password must meet Firebase security requirements.",
    "auth/weak-password": "Password must be at least 6 characters and harder to guess.",
    "auth/network-request-failed": "Could not connect to the registration service. Check your internet and try again.",
    "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  };
  if (messages[code]) return messages[code];
  return error instanceof Error ? error.message : "Registration failed. Please try again.";
}

export default function RegisterPage() {
  const [form, setForm] = useState({
    fullName: "",
    username: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpState, setOtpState] = useState<{ challengeId: string; expiresAt: number } | null>(null);
  const [otpProof, setOtpProof] = useState("");
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(0);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendingOtp, setResendingOtp] = useState(false);
  const [resendNoticeOpen, setResendNoticeOpen] = useState(false);
  const [resendNoticeSeconds, setResendNoticeSeconds] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [registrationClosedUntil, setRegistrationClosedUntil] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { login } = useAuth();

  useEffect(() => {
    let cancelled = false;
    const checkStatus = () => {
      fetch(buildApiUrl("/api/auth/registration-status"), { credentials: "include" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => {
          if (cancelled) return;
          setRegistrationClosedUntil(payload?.isClosed && payload.closedUntil ? String(payload.closedUntil) : null);
        })
        .catch(() => undefined);
    };
    checkStatus();
    const timer = window.setInterval(checkStatus, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!otpState) {
      setOtpSecondsLeft(0);
      return;
    }
    const updateCountdown = () => {
      setOtpSecondsLeft(Math.max(0, Math.ceil((otpState.expiresAt - Date.now()) / 1000)));
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [otpState]);

  useEffect(() => {
    if (!resendNoticeOpen || resendNoticeSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendNoticeSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendNoticeOpen, resendNoticeSeconds > 0]);

  useEffect(() => {
    if (!otpState || otpSecondsLeft > 0 || !otpProof) return;
    setOtpProof("");
    setOtpCode("");
    setError("Your email verification expired. Request a new OTP and verify it again.");
  }, [otpProof, otpSecondsLeft, otpState]);

  if (registrationClosedUntil) {
    return <StudentAccessHoldScreen closedUntil={registrationClosedUntil} registrationOnly onExpired={() => setRegistrationClosedUntil(null)} />;
  }

  const redirectAfterLogin = (nextUser: any) => {
    const role = nextUser.role;
    if (role === "student" && !nextUser.onboardingComplete) setLocation("/student/profile");
    else if (role === "student" && (nextUser.status === "pending" || nextUser.status === "rejected")) setLocation("/student/pending-approval");
    else if (role === "super_admin") setLocation("/super-admin/dashboard");
    else if (role === "admin") setLocation("/admin/question-bank");
    else setLocation("/student/dashboard");
  };

  const completeFirebaseServerLogin = async (idToken: string) => {
    const response = await fetch(buildApiUrl("/api/auth/firebase-email"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, password: form.password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error ?? "Account created, but automatic sign-in failed.");
    }
    login(payload.user);
    redirectAfterLogin(payload.user);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    if (["fullName", "username", "email"].includes(e.target.name)) {
      setOtpState(null);
      setOtpProof("");
      setOtpCode("");
      setResendNoticeOpen(false);
    }
  };

  const handleSendOtp = async () => {
    setError("");
    const normalizedEmail = form.email.trim().toLowerCase();
    const normalizedUsername = form.username.trim();
    const normalizedFullName = form.fullName.trim();

    if (!normalizedFullName) {
      setError("Name is required");
      return;
    }
    if (!normalizedUsername) {
      setError("User ID is required");
      return;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(normalizedUsername)) {
      setError("User ID may contain only letters, numbers, dots, underscores and hyphens");
      return;
    }
    if (!normalizedEmail) {
      setError("Email is required");
      return;
    }

    if (otpState) return;
    setSaving(true);
    try {
      const otpResponse = await fetch(buildApiUrl("/api/auth/registration-otp/request"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, username: normalizedUsername, fullName: normalizedFullName }),
      });
      const otpPayload = await otpResponse.json().catch(() => ({}));
      if (otpResponse.status === 429) {
        setResendNoticeSeconds(Math.max(1, Number(otpPayload.retryAfterSeconds) || 1));
        setResendNoticeOpen(true);
        return;
      }
      if (!otpResponse.ok) throw new Error(otpPayload.error ?? "Could not send email verification code.");
      setOtpState({ challengeId: otpPayload.challengeId, expiresAt: Number(otpPayload.expiresAt) });
      setOtpCode("");
      setOtpProof("");
    } catch (err: any) {
      setError(getRegistrationErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpState || !/^\d{6}$/.test(otpCode.trim())) {
      setError("Enter the 6-digit code sent to your email.");
      return;
    }
    if (otpSecondsLeft <= 0) {
      setError("This OTP has expired. Please resend a new OTP.");
      return;
    }
    setError("");
    setVerifyingOtp(true);
    try {
      const verifyResponse = await fetch(buildApiUrl("/api/auth/registration-otp/verify"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: otpState.challengeId, email: form.email.trim().toLowerCase(), code: otpCode.trim() }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok) throw new Error(verifyPayload.error ?? "Email verification failed.");
      setOtpProof(String(verifyPayload.proof ?? ""));
      setError("");
    } catch (err: any) {
      setError(getRegistrationErrorMessage(err));
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleSignup = async () => {
    if (!otpState || !otpProof) {
      setError("Verify your email before creating the account.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setError("");
    setRegistering(true);
    let createdClientFirebaseUser = false;
    let registeredOnServer = false;
    try {
      if (!isFirebaseGoogleConfigured()) {
        throw new Error("Email verification is not configured. Please try again later.");
      }
      const normalizedEmail = form.email.trim().toLowerCase();
      const firebaseRegistration = await registerWithFirebaseEmailPassword(normalizedEmail, form.password);
      const firebaseIdToken = firebaseRegistration.idToken;
      createdClientFirebaseUser = true;

      const response = await fetch(buildApiUrl("/api/auth/register"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          username: form.username.trim(),
          password: form.password,
          fullName: form.fullName.trim(),
          idToken: firebaseIdToken,
          otpChallengeId: otpState.challengeId,
          otpProof,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Registration failed. Please try again.");
      registeredOnServer = true;
      await completeFirebaseServerLogin(firebaseIdToken);
    } catch (err: any) {
      if (createdClientFirebaseUser && !registeredOnServer) {
        await deleteCurrentFirebaseUser();
      }
      setError(getRegistrationErrorMessage(err));
    } finally {
      setRegistering(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpState) return;
    if (otpSecondsLeft > 0) {
      setResendNoticeSeconds(otpSecondsLeft);
      setResendNoticeOpen(true);
      return;
    }
    setError("");
    setResendingOtp(true);
    try {
      const response = await fetch(buildApiUrl("/api/auth/registration-otp/request"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim().toLowerCase(), username: form.username.trim(), fullName: form.fullName.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 429) {
        setResendNoticeSeconds(Math.max(1, Number(payload.retryAfterSeconds) || otpSecondsLeft));
        setResendNoticeOpen(true);
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Could not resend the verification code.");
      setOtpState({
        challengeId: payload.challengeId,
        expiresAt: Number(payload.expiresAt),
      });
      setResendNoticeOpen(false);
      setOtpCode("");
      setOtpProof("");
    } catch (err: any) {
      setError(getRegistrationErrorMessage(err));
    } finally {
      setResendingOtp(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <Card className="w-full max-w-md text-center shadow-lg">
          <CardContent className="pt-8 pb-6">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle size={32} className="text-green-600" />
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-2">Registration Submitted!</h2>
            <p className="text-muted-foreground mb-6">
              Your email has been verified and your account has been created successfully. Sign in with your email and password to complete your profile setup. The portal will become fully active after admin approval.
            </p>
            <Button onClick={() => setLocation("/login")} data-testid="button-go-login" className="w-full">
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6">
          <BrandLogo imageClassName="h-14" />
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Student Registration</CardTitle>
            <CardDescription>Create your student account. Admin or super admin approval will be required after setup is complete.</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={(event) => { event.preventDefault(); void handleSignup(); }} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription data-testid="text-error">{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  name="fullName"
                  data-testid="input-fullname"
                  placeholder="Your full name"
                  value={form.fullName}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="username">User ID</Label>
                <Input
                  id="username"
                  name="username"
                  data-testid="input-username"
                  placeholder="Choose your user ID"
                  value={form.username}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <div className="flex items-start gap-2">
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    data-testid="input-email"
                    placeholder="Enter your email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant={otpState ? "outline" : "default"}
                    onClick={() => void (otpState ? handleResendOtp() : handleSendOtp())}
                    disabled={saving || verifyingOtp || resendingOtp || Boolean(otpProof)}
                    className="shrink-0"
                  >
                    {otpProof ? "Email verified" : saving ? "Sending..." : resendingOtp ? "Resending..." : otpState ? "Resend OTP" : "Send OTP"}
                  </Button>
                </div>
              </div>

              {otpState ? (
                <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="otpCode">Enter OTP</Label>
                    <span className={`text-xs font-semibold ${otpSecondsLeft > 0 ? "text-orange-800" : "text-red-600"}`}>
                      {otpSecondsLeft > 0
                        ? `Expires in ${String(Math.floor(otpSecondsLeft / 60)).padStart(2, "0")}:${String(otpSecondsLeft % 60).padStart(2, "0")}`
                        : "OTP expired"}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Input
                      id="otpCode"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="6-digit OTP"
                      value={otpCode}
                      onChange={(event) => { setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setOtpProof(""); }}
                      className="min-w-0 flex-1 bg-white"
                      disabled={Boolean(otpProof) || verifyingOtp}
                      autoFocus
                    />
                    <Button
                      type="button"
                      onClick={() => void handleVerifyOtp()}
                      disabled={verifyingOtp || resendingOtp || Boolean(otpProof) || otpSecondsLeft <= 0}
                      className="shrink-0"
                    >
                      {verifyingOtp ? "Checking..." : otpProof ? "Verified" : "Verify OTP"}
                    </Button>
                  </div>
                  {otpProof ? <p className="text-xs font-medium text-green-700">Email verified. You can create your account now.</p> : <p className="text-xs text-orange-900">We sent the OTP to <strong>{form.email}</strong>. Check your inbox and Spam folder. You can request a new code after the 10-minute expiry.</p>}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  data-testid="input-password"
                  placeholder="Min 6 characters"
                  value={form.password}
                  onChange={handleChange}
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={saving || verifyingOtp || resendingOtp || registering || !otpProof}
                data-testid="button-register"
              >
                {registering ? "Creating account..." : "Create Account"}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="pt-0">
            <p className="text-sm text-muted-foreground text-center w-full">
              Already have an account?{" "}
              <Link href="/login" className="text-primary font-medium hover:underline" data-testid="link-login">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
      <Dialog open={resendNoticeOpen} onOpenChange={setResendNoticeOpen}>
        <DialogContent className="max-w-md overflow-hidden rounded-2xl border-slate-200 p-0">
          <div className="bg-gradient-to-r from-orange-50 via-white to-indigo-50 px-6 py-7">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
              <MailCheck className="h-6 w-6" />
            </div>
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl text-slate-900">Your OTP is on its way</DialogTitle>
              <DialogDescription className="pt-2 text-sm leading-6 text-slate-600">
                Please check <strong className="text-slate-800">{form.email}</strong> inbox and Spam folder. For security, a fresh OTP can be sent after the current 10-minute code expires.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-orange-200 bg-white/90 px-4 py-3">
              <Clock3 className="h-5 w-5 shrink-0 text-orange-600" />
              {resendNoticeSeconds > 0 ? (
                <p className="text-sm font-medium text-slate-700">New OTP available in <span className="font-bold tabular-nums text-orange-700">{String(Math.floor(resendNoticeSeconds / 60)).padStart(2, "0")}:{String(resendNoticeSeconds % 60).padStart(2, "0")}</span></p>
              ) : (
                <p className="text-sm font-medium text-emerald-700">The code expired. You can send a new OTP now.</p>
              )}
            </div>
          </div>
          <DialogFooter className="px-6 pb-6">
            <Button type="button" variant="outline" onClick={() => setResendNoticeOpen(false)}>Close</Button>
            {resendNoticeSeconds === 0 ? <Button type="button" onClick={() => { setResendNoticeOpen(false); void (otpState ? handleResendOtp() : handleSendOtp()); }} disabled={resendingOtp || saving}>{resendingOtp || saving ? "Sending..." : "Send new OTP"}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
