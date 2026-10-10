import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff } from "lucide-react";
import {
  clearFirebaseGoogleSession,
  isFirebaseGoogleConfigured,
  sendFirebasePasswordResetEmail,
  signInWithFirebaseEmailPassword,
  signInWithFirebaseGoogle,
} from "@/lib/firebase";
import { buildApiUrl } from "@/lib/api-origin";

function IllustrationScene() {
  return (
    <div className="relative overflow-hidden rounded-[38px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_60px_rgba(17,24,39,0.08)]">
      <div className="relative mx-auto w-full">
        <img
          src="/login-hero-design.png"
          alt="Students collaborating in a digital learning environment"
          className="mx-auto block h-auto w-full select-none object-contain"
          draggable={false}
        />
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const loginMutation = useLogin();
  const firebaseAuthEnabled = isFirebaseGoogleConfigured();

  const redirectAfterLogin = (nextUser: any) => {
    const role = nextUser.role;
    if (role === "student" && !nextUser.onboardingComplete) setLocation("/student/profile");
    else if (role === "student" && (nextUser.status === "pending" || nextUser.status === "rejected")) setLocation("/student/pending-approval");
    else if (nextUser.mustChangePassword && role === "student") setLocation("/student/dashboard");
    else if (role === "super_admin") setLocation("/super-admin/dashboard");
    else if (role === "admin") setLocation("/admin/question-bank");
    else setLocation("/student/dashboard");
  };

  const completeBackendLogin = async (identifier: string, nextPassword: string) => {
    const data = await loginMutation.mutateAsync({ data: { username: identifier, password: nextPassword } });
    login(data.user);
    redirectAfterLogin(data.user);
  };

  const completeFirebaseServerLogin = async (path: string, idToken: string, fallbackMessage: string) => {
    const response = await fetch(buildApiUrl(path), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, ...(path === '/api/auth/firebase-email' ? { password } : {}) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      await clearFirebaseGoogleSession();
      throw new Error(payload.error ?? fallbackMessage);
    }
    login(payload.user);
    redirectAfterLogin(payload.user);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const identifier = username.trim();
    const shouldTryFirebaseEmail = firebaseAuthEnabled && identifier.includes("@");

    if (shouldTryFirebaseEmail) {
      setEmailLoading(true);
      try {
        const { idToken } = await signInWithFirebaseEmailPassword(identifier, password);
        await completeFirebaseServerLogin("/api/auth/firebase-email", idToken, "Firebase email login failed");
        return;
      } catch (firebaseError) {
        try {
          await completeBackendLogin(identifier, password);
          return;
        } catch (backendError: any) {
          const firebaseMessage = firebaseError instanceof Error ? firebaseError.message : "Firebase email login failed";
          setError(backendError?.data?.error ?? backendError?.message ?? firebaseMessage);
          return;
        }
      } finally {
        setEmailLoading(false);
      }
    }

    try {
      await completeBackendLogin(identifier, password);
    } catch (err: any) {
      setError(err?.data?.error ?? err?.message ?? "Login failed. Please check your credentials.");
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setGoogleLoading(true);
    try {
      const { idToken } = await signInWithFirebaseGoogle();
      await completeFirebaseServerLogin("/api/auth/google", idToken, "Google login failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google login failed");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    try {
      const response = await fetch(buildApiUrl("/api/auth/forgot-password-request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: forgotIdentifier }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to start password reset.");
      }

      if (payload.delivery === "client") {
        if (!firebaseAuthEnabled) {
          throw new Error("Firebase password reset is not configured yet.");
        }
        await sendFirebasePasswordResetEmail(payload.email ?? forgotIdentifier);
      }

      toast({
        className: "border-emerald-200 bg-[linear-gradient(135deg,#ffffff_0%,#f0fdf4_58%,#fff7ed_100%)] text-[#111827] shadow-[0_22px_50px_rgba(16,185,129,0.16)]",
        title: "Check your email",
        description: payload.message ?? "If this account exists, check its registered inbox or Spam folder. The next reset email can be sent after 2 hours.",
      });
      setForgotIdentifier("");
      setForgotOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start password reset.";
      toast({
        title: message.includes("already sent recently") ? "Please wait before retrying" : "Reset request failed",
        description: message,
        variant: message.includes("already sent recently") ? undefined : "destructive",
      });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#111827]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-6 lg:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div>
              <BrandLogo imageClassName="h-14" />
              <p className="text-xs uppercase tracking-[0.2em] text-[#6B7280]">Portal Login</p>
            </div>
          </Link>

          <Link href="/register" className="text-sm font-medium text-[#F97316] hover:underline">
            Student signup
          </Link>
        </div>

        <div className="flex flex-1 items-center py-10">
          <div className="grid w-full gap-8 lg:grid-cols-[1.12fr_0.88fr] lg:items-center">
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="hidden lg:block"
            >
              <IllustrationScene />
            </motion.section>

            <motion.section
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.55, delay: 0.08, ease: "easeOut" }}
              className="mx-auto w-full max-w-md rounded-[34px] border border-[#E5E7EB] bg-white p-8 shadow-[0_24px_60px_rgba(17,24,39,0.08)]"
            >
              <div className="space-y-2">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#F97316]">Portal Login</p>
                <h1 className="text-4xl font-black tracking-tight text-[#111827]">Welcome back</h1>
                <p className="text-sm leading-6 text-[#6B7280]">
                  Sign in to continue.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription data-testid="text-error">{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="username" className="text-[#111827]">Email or Username</Label>
                  <Input
                    id="username"
                    data-testid="input-username"
                    placeholder="Enter student or teacher email, or username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username email"
                    required
                    className="h-12 rounded-2xl border-[#E5E7EB] bg-white text-[#111827] placeholder:text-[#9CA3AF]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-[#111827]">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      data-testid="input-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="h-12 rounded-2xl border-[#E5E7EB] bg-white pr-11 text-[#111827] placeholder:text-[#9CA3AF]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="pt-1">
                  <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
                    <DialogTrigger asChild>
                      <button type="button" className="text-sm font-medium text-[#F97316] hover:underline">
                        Forgot password?
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md border-[#E5E7EB] bg-white">
                      <DialogHeader>
                        <DialogTitle>Forgot Password</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleForgotPassword} className="space-y-4">
                        <div className="space-y-1.5">
                          <Label>Email or Username</Label>
                          <Input
                            value={forgotIdentifier}
                            onChange={(e) => setForgotIdentifier(e.target.value)}
                            placeholder="Enter your email or username"
                            required
                          />
                        </div>
                        <Button
                          type="submit"
                          className="h-11 w-full rounded-2xl bg-[#F97316] text-white hover:bg-[#EA580C]"
                          disabled={forgotLoading}
                        >
                          {forgotLoading ? "Sending reset link..." : "Continue Reset"}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>

                <Button
                  type="submit"
                  className="h-12 w-full rounded-2xl bg-[#F97316] text-white hover:bg-[#EA580C]"
                  disabled={loginMutation.isPending || emailLoading || googleLoading}
                  data-testid="button-login"
                >
                  {loginMutation.isPending || emailLoading ? "Signing in..." : "Login"}
                </Button>

                {firebaseAuthEnabled && (
                  <>
                    <div className="flex items-center gap-3 py-1">
                      <div className="h-px flex-1 bg-[#E5E7EB]" />
                      <span className="text-xs font-semibold uppercase tracking-[0.24em] text-[#9CA3AF]">or</span>
                      <div className="h-px flex-1 bg-[#E5E7EB]" />
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 w-full rounded-2xl border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F9FAFB]"
                      onClick={handleGoogleLogin}
                      disabled={googleLoading}
                    >
                      <span className="mr-3 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.9 1.5l2.7-2.6C16.9 3.2 14.7 2.2 12 2.2 6.9 2.2 2.8 6.3 2.8 11.4S6.9 20.6 12 20.6c6.9 0 9.1-4.8 9.1-7.3 0-.5-.1-.8-.1-1.1H12Z" />
                          <path fill="#34A853" d="M2.8 11.4c0 1.6.6 3.1 1.7 4.3l3-2.3c-.4-.6-.6-1.3-.6-2s.2-1.4.6-2l-3-2.3c-1.1 1.2-1.7 2.7-1.7 4.3Z" />
                          <path fill="#FBBC05" d="M12 20.6c2.7 0 4.9-.9 6.6-2.5l-3.2-2.5c-.9.6-2 .9-3.4.9-2.5 0-4.6-1.7-5.4-4l-3.1 2.4c1.6 3.2 4.9 5.7 8.5 5.7Z" />
                          <path fill="#4285F4" d="M18.6 18.1c1.9-1.8 2.5-4.4 2.5-6.7 0-.5-.1-.8-.1-1.1H12v3.9h5.5c-.2 1.1-.9 2.7-2.3 3.8l3.4 2.1Z" />
                        </svg>
                      </span>
                      {googleLoading ? "Opening Google..." : "Continue with Google"}
                    </Button>
                  </>
                )}
              </form>

              <div className="mt-6 border-t border-[#F3F4F6] pt-4 text-center">
                <p className="text-sm text-[#6B7280]">
                  New student?{" "}
                  <Link href="/register" className="font-medium text-[#F97316] hover:underline" data-testid="link-register">
                    Register here
                  </Link>
                </p>
              </div>
            </motion.section>
          </div>
        </div>
      </div>
    </div>
  );
}
