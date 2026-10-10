import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { formatExamDisplayName } from "@/lib/exam-display";
import { optimizeImageToDataUrl } from "@/lib/imageUpload";
import {
  Camera, User, Mail, Phone, BookOpen, Shield, CheckCircle,
  Upload, Trash2, Save, Loader2,
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-origin";

function Avatar({ src, initials, size = 96 }: { src?: string | null; initials: string; size?: number }) {
  if (src) {
    return (
      <img
        src={src}
        alt="Profile"
        className="rounded-full object-cover border-4 border-white/20 shadow-xl"
        decoding="async"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white font-bold border-4 border-white/20 shadow-xl"
      style={{ width: size, height: size, fontSize: size / 3 }}
    >
      {initials}
    </div>
  );
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function AdminProfile() {
  const { user, login } = useAuth();
  const { refetch } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>((user as any)?.avatarUrl ?? null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (JPG, PNG, WebP, GIF)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB");
      return;
    }
    setError("");
    try {
      const resized = await optimizeImageToDataUrl(file, { maxWidth: 256, maxHeight: 256, quality: 0.85, outputType: "image/jpeg" });
      setAvatarPreview(resized);
      setAvatarChanged(true);
    } catch {
      setError("Failed to process image. Please try another file.");
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleSave = async () => {
    if (!fullName.trim()) { setError("Full name is required"); return; }
    setError("");
    setSaving(true);
    try {
      const body: any = { fullName: fullName.trim(), phone: phone.trim() };
      if (avatarChanged) body.avatarUrl = avatarPreview; // base64 or null
      const r = await fetch(buildApiUrl(`/api/auth/profile`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to save");
      }
      const updated = await r.json();
      login(updated); // update AuthContext + localStorage
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
      setAvatarChanged(false);
      toast({ title: "Profile updated!", description: "Your changes have been saved." });
    } catch (err: any) {
      setError(err.message ?? "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarPreview(null);
    setAvatarChanged(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  if (!user) return null;

  const initials = getInitials(user.fullName ?? user.username ?? "?");
  const isDirty = fullName !== (user.fullName ?? "") || phone !== (user.phone ?? "") || avatarChanged;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your personal information and profile picture</p>
      </div>

      {/* Avatar hero card */}
      <Card className="overflow-hidden">
        <div className="h-24 bg-gradient-to-br from-blue-600 via-blue-700 to-cyan-600" />
        <CardContent className="pt-0 pb-6">
          <div className="flex items-end gap-4 -mt-12 mb-4">
            {/* Avatar with upload overlay */}
            <div className="relative group shrink-0">
              <Avatar src={avatarPreview} initials={initials} size={88} />
              {/* Click overlay */}
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                title="Change photo"
              >
                <Camera size={20} className="text-white" />
              </button>
            </div>

            <div className="mb-1 min-w-0">
              <p className="text-lg font-bold truncate">{user.fullName}</p>
              <p className="text-sm text-muted-foreground">@{user.username}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Shield size={11} className="text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Teacher / Admin</span>
              </div>
            </div>
          </div>

          {/* Upload area */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            className={`border-2 border-dashed rounded-xl p-5 flex flex-col items-center gap-2 transition-colors cursor-pointer ${
              dragOver
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                : "border-border hover:border-blue-400 hover:bg-muted/30"
            }`}
            onClick={() => fileRef.current?.click()}
          >
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Upload size={18} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Upload Profile Photo</p>
              <p className="text-xs text-muted-foreground">Drag & drop or click to browse · JPG, PNG, WebP · Max 10MB</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Photo will be auto-resized to 256×256
              </p>
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
            data-testid="input-avatar-file"
          />

          {avatarPreview && (
            <div className="flex items-center justify-between mt-3 p-2.5 rounded-lg bg-muted/50 border border-border">
              <div className="flex items-center gap-2.5">
                <img src={avatarPreview} alt="Preview" className="w-9 h-9 rounded-full object-cover" decoding="async" />
                <div>
                  <p className="text-xs font-medium">New photo selected</p>
                  <p className="text-[10px] text-muted-foreground">Click Save to apply</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={(e) => { e.stopPropagation(); handleRemoveAvatar(); }}
                data-testid="button-remove-avatar"
              >
                <Trash2 size={13} className="mr-1" /> Remove
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User size={15} className="text-blue-500" /> Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <User size={12} /> Full Name <span className="text-red-500">*</span>
              </Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                data-testid="input-full-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <Phone size={12} /> Phone Number
              </Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 00000 00000"
                data-testid="input-phone"
              />
            </div>
          </div>

          {/* Read-only fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Mail size={12} /> Email Address
              </Label>
              <Input value={user.email} disabled className="bg-muted/50 text-muted-foreground" />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <BookOpen size={12} /> Subject
              </Label>
              <Input value={formatExamDisplayName(user.subject) || "—"} disabled className="bg-muted/50 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Shield size={12} /> Username (cannot change)
            </Label>
            <Input value={user.username} disabled className="bg-muted/50 text-muted-foreground" />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              className="gap-2"
              onClick={handleSave}
              disabled={saving || !isDirty}
              data-testid="button-save-profile"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Saving..." : "Save Profile"}
            </Button>
            {!isDirty && (
              <span className="text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle size={12} /> Up to date
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Account info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield size={15} className="text-blue-500" /> Account Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Role</p>
              <p className="text-sm font-semibold capitalize">{user.role.replace("_", " ")}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Status</p>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <p className="text-sm font-semibold capitalize">{user.status}</p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 border border-border col-span-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Member Since</p>
              <p className="text-sm font-semibold">
                {user.createdAt ? new Date(user.createdAt as any).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" }) : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
