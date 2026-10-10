import { useCallback, useMemo, useRef, useState } from "react";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { changeFirebasePassword } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { formatExamDisplayName } from "@/lib/exam-display";
import { optimizeImageToDataUrl } from "@/lib/imageUpload";
import { invalidateStudentContentQueries } from "@/lib/student-content-cache";
import {
  BookOpen,
  CalendarDays,
  Camera,
  CheckCircle,
  CreditCard,
  Loader2,
  Mail,
  Phone,
  Plus,
  Save,
  Shield,
  Trash2,
  Upload,
  User,
} from "lucide-react";
import { format } from "date-fns";
import { buildApiUrl } from "@/lib/api-origin";

function getInitials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").toUpperCase().slice(0, 2);
}

function Avatar({ src, initials }: { src?: string | null; initials: string }) {
  if (src) {
    return <img src={src} alt="Profile" className="h-24 w-24 rounded-full border-4 border-white/20 object-cover shadow-xl" decoding="async" />;
  }
  return (
    <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white/20 bg-gradient-to-br from-violet-600 to-fuchsia-500 text-3xl font-bold text-white shadow-xl">
      {initials}
    </div>
  );
}

export default function StudentProfile() {
  const { user, login } = useAuth();
  const { refetch } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: examOptions = [] } = useQuery<{ exam: string; batchCount: number }[]>({
    queryKey: ["student-profile-exams"],
    queryFn: async () => {
      const response = await fetch(buildApiUrl(`/api/auth/exams`), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load exams");
      return response.json();
    },
  });

  const availableExamOptions = useMemo(() => {
    const examSet = new Set<string>();
    if (user?.subject) examSet.add(user.subject);
    examOptions.forEach((item) => examSet.add(item.exam));
    const fromUser = Array.isArray((user as any)?.additionalExams) ? (user as any).additionalExams : [];
    fromUser.forEach((exam: string) => examSet.add(exam));
    return Array.from(examSet);
  }, [examOptions, user]);

  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>((user as any)?.avatarUrl ?? null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [customExam, setCustomExam] = useState("");
  const [additionalExams, setAdditionalExams] = useState<string[]>(
    Array.isArray((user as any)?.additionalExams) ? (user as any).additionalExams : [],
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const initials = getInitials(user?.fullName ?? user?.username ?? "?");

  const { data: paymentData } = useQuery<{ payments: Array<{ paidAt: string; amount: number; cycle: number; orderId: string; paymentId: string; feature: "tests" | "analysis" | "question-bank" }> }>({
    queryKey: ["student-payment-history"],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/users/me/payment-history`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load payment history");
      return res.json();
    },
    enabled: user?.role === "student",
  });

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB.");
      return;
    }
    setError("");
    try {
      const resized = await optimizeImageToDataUrl(file, { maxWidth: 256, maxHeight: 256, quality: 0.85, outputType: "image/jpeg" });
      setAvatarPreview(resized);
      setAvatarChanged(true);
    } catch {
      setError("Failed to process image.");
    }
  }, []);

  const addExam = (exam: string) => {
    const normalized = exam.trim();
    if (!normalized || normalized === user?.subject) return;
    setAdditionalExams((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
  };

  const removeExam = (exam: string) => {
    setAdditionalExams((prev) => prev.filter((item) => item !== exam));
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      setError("Full name is required");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        additionalExams,
      };
      if (avatarChanged) body.avatarUrl = avatarPreview;

      const response = await fetch(buildApiUrl(`/api/auth/profile`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to update profile");
      }
      const updated = await response.json();
      login(updated);
      await refetch();
      await invalidateStudentContentQueries(queryClient);
      setAvatarChanged(false);
      toast({ title: "Profile updated", description: "Your student profile is now up to date." });
    } catch (err: any) {
      setError(err.message ?? "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!user) return;
    const activeUser = user;
    setPasswordError("");
    setPasswordSaving(true);
    try {
      if (activeUser.role === "student") {
        if (!activeUser.email) {
          throw new Error("Student email is missing. Please contact support.");
        }
        await changeFirebasePassword(currentPassword, newPassword);
        setCurrentPassword("");
        setNewPassword("");
        toast({ title: "Password updated", description: "Your Firebase password has been changed successfully." });
        return;
      }

      const response = await fetch(buildApiUrl(`/api/auth/change-password`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to change password");
      }
      const updated = await response.json();
      login(updated);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
      setCurrentPassword("");
      setNewPassword("");
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
    } catch (err: any) {
      setPasswordError(err.message ?? "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  };

  if (!user) return null;

  const isDirty =
    fullName !== (user.fullName ?? "") ||
    phone !== (user.phone ?? "") ||
    avatarChanged ||
    JSON.stringify(additionalExams) !== JSON.stringify(Array.isArray((user as any)?.additionalExams) ? (user as any).additionalExams : []);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile photo, active exam journey, and account details.</p>
      </div>

      <Card className="overflow-hidden">
        <div className="h-28 bg-gradient-to-br from-violet-600 via-indigo-600 to-cyan-500" />
        <CardContent className="pt-0">
          <div className="-mt-12 flex flex-wrap items-end gap-4">
            <div className="group relative shrink-0">
              <Avatar src={avatarPreview} initials={initials} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Camera size={20} className="text-white" />
              </button>
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <p className="truncate text-xl font-bold">{user.fullName}</p>
              <p className="text-sm text-muted-foreground">@{user.username}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="gap-1 border-[#D8E5FF] bg-[#EFF5FF] text-[#245BDB] hover:bg-[#E8F1FF]"
                >
                  <BookOpen size={12} /> Primary Exam: {formatExamDisplayName(user.subject) || "Not selected"}
                </Badge>
                <Badge variant="outline" className="gap-1"><CalendarDays size={12} /> Active Since: {user.createdAt ? new Date(user.createdAt as any).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—"}</Badge>
              </div>
            </div>
          </div>

          <div
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFileSelect(file);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current?.click()}
            className={`mt-5 cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Upload size={18} className="text-primary" />
            </div>
            <p className="text-sm font-medium">Upload Profile Photo</p>
            <p className="text-xs text-muted-foreground">Click or drag an image here. We will resize it automatically.</p>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />

          {avatarPreview && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-center gap-3">
                <img src={avatarPreview} alt="Preview" className="h-10 w-10 rounded-full object-cover" decoding="async" />
                <div>
                  <p className="text-sm font-medium">Profile photo ready</p>
                  <p className="text-xs text-muted-foreground">Save profile to update it everywhere.</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:bg-red-50 hover:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  setAvatarPreview(null);
                  setAvatarChanged(true);
                }}
              >
                <Trash2 size={14} className="mr-1" /> Remove
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <User size={15} className="text-primary" /> Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium"><User size={12} /> Full Name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium"><Phone size={12} /> Phone Number</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 00000 00000" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Mail size={12} /> Email</Label>
              <Input value={user.email} disabled className="bg-muted/50 text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Shield size={12} /> Username</Label>
              <Input value={user.username} disabled className="bg-muted/50 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen size={15} className="text-primary" /> Exam Preparation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primary Exam</p>
            <p className="mt-1 text-lg font-semibold">{formatExamDisplayName(user.subject) || "Not selected"}</p>
            <p className="mt-1 text-xs text-muted-foreground">This comes from the exam selected at registration and is used for your main batch assignment.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Add Other Exams You Are Preparing For</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    addExam(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select exam to add</option>
                {availableExamOptions
                  .filter((exam) => exam !== user.subject && !additionalExams.includes(exam))
                  .map((exam) => <option key={exam} value={exam}>{formatExamDisplayName(exam) || exam}</option>)}
              </select>
              <div className="flex flex-1 gap-2">
                <Input value={customExam} onChange={(e) => setCustomExam(e.target.value)} placeholder="Or type another exam name" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    addExam(customExam);
                    setCustomExam("");
                  }}
                >
                  <Plus size={14} className="mr-1" /> Add
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {additionalExams.length > 0 ? additionalExams.map((exam) => (
              <Badge
                key={exam}
                variant="secondary"
                className="gap-2 border-[#D8E5FF] bg-[#EFF5FF] px-3 py-1 text-[#245BDB]"
              >
                {formatExamDisplayName(exam) || exam}
                <button type="button" onClick={() => removeExam(exam)} className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
                  <Trash2 size={11} />
                </button>
              </Badge>
            )) : (
              <p className="text-sm text-muted-foreground">No additional exams added yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || !isDirty}>
          {saving ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
          {saving ? "Saving..." : "Save Profile"}
        </Button>
        {!isDirty && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle size={12} /> Up to date
          </span>
        )}
      </div>

      {paymentData?.payments.length ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard size={15} className="text-orange-500" /> Payment History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {paymentData.payments.slice().reverse().map((p) => (
                <div key={p.orderId} className="flex items-center justify-between rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100">
                      <CheckCircle size={14} className="text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {p.feature === "analysis" ? "Full Analysis Unlocked" : p.feature === "question-bank" ? "Question Bank Unlocked" : "Test Access Unlocked"} — Cycle #{p.cycle}
                      </p>
                      <p className="text-xs text-slate-500">{format(new Date(p.paidAt), "dd MMM yyyy, hh:mm a")}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">
                    ₹{p.amount}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield size={15} className="text-primary" /> Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(user as any).mustChangePassword && (
            <Alert>
              <AlertDescription>
                You are using a temporary password. Please change it now before continuing.
              </AlertDescription>
            </Alert>
          )}
          {passwordError && (
            <Alert variant="destructive">
              <AlertDescription>{passwordError}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Current Password</Label>
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current or temporary password" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">New Password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Minimum 6 characters" />
            </div>
          </div>
          <Button onClick={handlePasswordChange} disabled={passwordSaving || !currentPassword || newPassword.length < 6}>
            {passwordSaving ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
            {passwordSaving ? "Updating..." : "Update Password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
