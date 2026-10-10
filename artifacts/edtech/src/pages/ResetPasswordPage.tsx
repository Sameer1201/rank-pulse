import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/ui/brand-logo";
import {
  verifyFirebaseResetCode,
} from "@/lib/firebase";
import { buildApiUrl } from "@/lib/api-origin";

function readResetParams() {
  const params = new URLSearchParams(window.location.search);
  let continueUrl = '';
  try {
    const raw = params.get('continueUrl')?.trim();
    if (raw) {
      const target = new URL(raw, window.location.origin);
      if (target.origin === window.location.origin && ['http:', 'https:'].includes(target.protocol)) continueUrl = target.href;
    }
  } catch { /* Never redirect password recovery to an untrusted origin. */ }
  return {
    oobCode: params.get("oobCode")?.trim() ?? "",
    continueUrl,
    expiresAt: Number(params.get("expiresAt") ?? "0"),
    sig: params.get("sig")?.trim() ?? "",
  };
}

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function getReadableResetError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : "";
  const defaultUsedMessage =
    "This reset link has already been used or is no longer valid. Password reset links can only be used once, so please request a new one.";

  if (rawMessage.includes("auth/invalid-action-code")) {
    return defaultUsedMessage;
  }

  if (rawMessage.includes("auth/expired-action-code")) {
    return "This reset link has expired. Please request a new password reset link.";
  }

  if (rawMessage.includes("auth/weak-password")) {
    return "Your new password is too weak. Please choose a stronger password.";
  }

  if (rawMessage.includes("auth/user-disabled")) {
    return "This account is currently disabled. Please contact support or your admin.";
  }

  if (rawMessage.includes("auth/user-not-found")) {
    return "This account was not found anymore. Please request a fresh reset link.";
  }

  return rawMessage || defaultUsedMessage;
}

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [{ oobCode, continueUrl, expiresAt, sig }] = useState(readResetParams);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState<"checking" | "ready" | "success" | "invalid">("checking");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, expiresAt - Date.now()));
  const hasSignedResetEnvelope = Boolean(sig && Number.isFinite(expiresAt) && expiresAt > 0);

  useEffect(() => {
    let active = true;

    async function verifyCode() {
      if (!oobCode) {
        setStatus("invalid");
        setError(getReadableResetError(new Error("auth/invalid-action-code")));
        return;
      }

      try {
        let nextRemainingMs = 0;

        if (hasSignedResetEnvelope) {
          const response = await fetch(buildApiUrl("/api/auth/password-reset-link/validate"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oobCode, expiresAt, sig }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error ?? "This reset link has expired or is invalid.");
          }
          nextRemainingMs = Number(payload.remainingMs ?? Math.max(0, expiresAt - Date.now()));
        }

        const nextEmail = await verifyFirebaseResetCode(oobCode);
        if (!active) return;
        setEmail(nextEmail);
        setRemainingMs(nextRemainingMs);
        setStatus("ready");
      } catch (verifyError) {
        if (!active) return;
        setStatus("invalid");
        setError(getReadableResetError(verifyError));
      }
    }

    void verifyCode();
    return () => {
      active = false;
    };
  }, [expiresAt, hasSignedResetEnvelope, oobCode, sig]);

  useEffect(() => {
    if (status !== "ready" || !hasSignedResetEnvelope) return;

    const timer = window.setInterval(() => {
      const nextRemaining = Math.max(0, expiresAt - Date.now());
      setRemainingMs(nextRemaining);

      if (nextRemaining <= 0) {
        setStatus("invalid");
        setError("This reset link has expired. Please request a new one.");
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [expiresAt, hasSignedResetEnvelope, status]);

  const passwordError = useMemo(() => {
    if (!password && !confirmPassword) return "";
    if (password.length > 0 && password.length < 6) return "Password must be at least 6 characters.";
    if (confirmPassword && password !== confirmPassword) return "Passwords do not match.";
    return "";
  }, [confirmPassword, password]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status !== "ready") return;

    if (hasSignedResetEnvelope && remainingMs <= 0) {
      setStatus("invalid");
      setError("This reset link has expired. Please request a new one.");
      return;
    }

    if (!password || !confirmPassword) {
      setError("Enter and confirm your new password.");
      return;
    }

    if (passwordError) {
      setError(passwordError);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const syncResponse = await fetch(buildApiUrl("/api/auth/password-reset/finalize"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oobCode,
          email,
          newPassword: password,
        }),
      });
      const syncPayload = await syncResponse.json().catch(() => ({}));
      if (!syncResponse.ok) {
        throw new Error(syncPayload.error ?? "Password reset could not be completed. Please try again.");
      }

      setStatus("success");
      setPassword("");
      setConfirmPassword("");
    } catch (submitError) {
      setError(getReadableResetError(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#111827]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-6 lg:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div>
              <BrandLogo imageClassName="h-14" />
              <p className="text-xs uppercase tracking-[0.2em] text-[#6B7280]">Password Reset</p>
            </div>
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <Card className="w-full max-w-lg rounded-[34px] border border-[#E5E7EB] bg-white shadow-[0_24px_60px_rgba(17,24,39,0.08)]">
            <CardHeader className="space-y-2">
              <CardTitle className="text-3xl font-black tracking-tight text-[#111827]">
                Reset your password
              </CardTitle>
              <CardDescription className="text-sm leading-6 text-[#6B7280]">
                {status === "success"
                  ? "Your password has been updated successfully."
                  : "Choose a new password for your Rank Pulse account."}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {status === "checking" ? (
                <div className="flex min-h-[180px] items-center justify-center">
                  <div className="flex items-center gap-3 text-sm text-[#6B7280]">
                    <Loader2 className="h-5 w-5 animate-spin text-[#F97316]" />
                    Verifying your reset link...
                  </div>
                </div>
              ) : status === "invalid" ? (
                <div className="space-y-5">
                  <Alert variant="destructive">
                    <AlertDescription>{error || "This reset link is no longer valid."}</AlertDescription>
                  </Alert>
                  <Button
                    className="h-12 w-full rounded-2xl bg-[#F97316] text-white hover:bg-[#EA580C]"
                    onClick={() => setLocation("/login")}
                  >
                    Back to Login
                  </Button>
                </div>
              ) : status === "success" ? (
                <div className="space-y-5">
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                      <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                    </div>
                    <p className="mt-4 text-sm text-emerald-800">
                      Password updated for <span className="font-semibold">{email}</span>
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      className="h-12 flex-1 rounded-2xl bg-[#F97316] text-white hover:bg-[#EA580C]"
                      onClick={() => setLocation("/login")}
                    >
                      Go to Login
                    </Button>
                    {continueUrl ? (
                      <Button
                        variant="outline"
                        className="h-12 flex-1 rounded-2xl border-[#E5E7EB]"
                        onClick={() => {
                          window.location.href = continueUrl;
                        }}
                      >
                        Continue
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#374151]">
                    Resetting password for <span className="font-semibold">{email}</span>
                  </div>

                  {hasSignedResetEnvelope ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">Link expires in</span>
                        <span className="rounded-full bg-white px-3 py-1 font-mono text-sm font-semibold tracking-[0.16em] text-[#D97706]">
                          {formatCountdown(remainingMs)}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {error ? (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="reset-password" className="text-[#111827]">New password</Label>
                    <div className="relative">
                      <Input
                        id="reset-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Minimum 6 characters"
                        autoComplete="new-password"
                        className="h-12 rounded-2xl border-[#E5E7EB] bg-white pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#6B7280]"
                      >
                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reset-password-confirm" className="text-[#111827]">Confirm new password</Label>
                    <div className="relative">
                      <Input
                        id="reset-password-confirm"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Re-enter the new password"
                        autoComplete="new-password"
                        className="h-12 rounded-2xl border-[#E5E7EB] bg-white pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((current) => !current)}
                        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#6B7280]"
                      >
                        {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  {passwordError ? (
                    <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{passwordError}</span>
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    disabled={saving || Boolean(passwordError)}
                    className="h-12 w-full rounded-2xl bg-[#F97316] text-white hover:bg-[#EA580C]"
                  >
                    {saving ? "Updating password..." : "Save New Password"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
