import { useState } from "react";
import { useListUsers, useCreateAdmin, useDeleteUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus, Trash2, UserCheck, Pencil, Mail, User, BookOpen,
  Phone, KeyRound, Eye, EyeOff, CheckCircle, AlertTriangle,
  GraduationCap, Users, CalendarDays,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatExamDisplayName } from "@/lib/exam-display";
import { format } from "date-fns";
import { buildApiUrl } from "@/lib/api-origin";

interface StaffUser {
  id: number;
  fullName: string;
  username: string;
  email: string;
  role: "admin";
  subject?: string | null;
  phone?: string | null;
  status: string;
  createdAt?: string;
  avatarUrl?: string | null;
  mustChangePassword?: boolean;
}

interface EditForm {
  fullName: string;
  email: string;
  subject: string;
  phone: string;
  newPassword: string;
}

interface CreateForm {
  username: string;
  password: string;
  fullName: string;
  email: string;
  subject: string;
  role: "admin";
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function roleLabel(role: StaffUser["role"]) {
  return role === "admin" ? "Teacher" : "Teacher";
}

function roleBadgeClass(role: StaffUser["role"]) {
  return role === "admin" ? "" : "";
}

interface ActivityLog {
  id: number;
  action: string;
  page: string | null;
  detail: string | null;
  createdAt: string;
}

interface StaffActivityDetail {
  user: { id: number; username: string; fullName: string; role: string };
  totalSeconds: number;
  sessions: Array<{ startedAt: string; totalSeconds: number; isActive: boolean }>;
  activities: ActivityLog[];
  stats: {
    testsCreated: number;
    testQuestionsCreated: number;
    questionBankQuestionsCreated: number;
    reportedQuestionsReceived: number;
    openReportedQuestions: number;
  };
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function StaffProfileDialog({ staff }: { staff: StaffUser }) {
  const [open, setOpen] = useState(false);

  const { data: userDetail, isLoading: userLoading } = useQuery<StaffUser>({
    queryKey: ["staff-profile", staff.id],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/users/${staff.id}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled: open,
  });

  const { data: activityDetail, isLoading: activityLoading } = useQuery<StaffActivityDetail>({
    queryKey: ["staff-profile-activity", staff.id],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/activity/user/${staff.id}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
    enabled: open,
  });

  const profile = userDetail ?? staff;
  const stats = activityDetail?.stats ?? {
    testsCreated: 0,
    testQuestionsCreated: 0,
    questionBankQuestionsCreated: 0,
    reportedQuestionsReceived: 0,
    openReportedQuestions: 0,
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-full transition-transform hover:scale-[1.04] focus:outline-none focus:ring-2 focus:ring-primary/50"
          aria-label={`Open profile for ${staff.fullName}`}
        >
          {staff.avatarUrl ? (
            <img src={staff.avatarUrl} alt={staff.fullName} className="h-10 w-10 rounded-full object-cover border border-border" />
          ) : (
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-cyan-600 text-sm font-bold text-white">
              {getInitials(staff.fullName)}
            </div>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Staff Profile</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Card className="border-border/70">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-4">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt={profile.fullName} className="h-16 w-16 rounded-2xl object-cover border border-border" />
                ) : (
                  <div className="h-16 w-16 rounded-2xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-cyan-600 text-lg font-bold text-white">
                    {getInitials(profile.fullName)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-lg font-semibold leading-tight">{profile.fullName}</p>
                  <p className="text-sm text-muted-foreground">@{profile.username}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="secondary" className={roleBadgeClass(profile.role)}>{roleLabel(profile.role)}</Badge>
                    <Badge variant="outline">{profile.status}</Badge>
                    <Badge variant="outline">Managed by Super Admin</Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2"><Mail size={14} className="mt-0.5 text-muted-foreground" /><span>{profile.email || "No email added"}</span></div>
                <div className="flex items-start gap-2"><Phone size={14} className="mt-0.5 text-muted-foreground" /><span>{profile.phone || "No phone added"}</span></div>
                <div className="flex items-start gap-2"><BookOpen size={14} className="mt-0.5 text-muted-foreground" /><span>{formatExamDisplayName(profile.subject) || profile.subject || "No subject assigned"}</span></div>
                <div className="flex items-start gap-2"><CalendarDays size={14} className="mt-0.5 text-muted-foreground" /><span>Joined {profile.createdAt ? format(new Date(profile.createdAt), "MMM d, yyyy") : "Unknown"}</span></div>
                <div className="flex items-start gap-2"><KeyRound size={14} className="mt-0.5 text-muted-foreground" /><span>{profile.mustChangePassword ? "Password reset pending" : "Password active"}</span></div>
              </div>

              <Link href={`/super-admin/activity`}>
                <Button variant="outline" className="w-full gap-1.5">
                  <CalendarDays size={14} /> Open Full Activity Monitor
                </Button>
              </Link>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Activity Snapshot</CardTitle>
              </CardHeader>
              <CardContent>
                {activityLoading ? (
                  <div className="h-20 rounded-xl bg-muted animate-pulse" />
                ) : activityDetail ? (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Time Spent</p>
                      <p className="text-lg font-bold mt-1">{formatDuration(activityDetail.totalSeconds)}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Sessions</p>
                      <p className="text-lg font-bold mt-1">{activityDetail.sessions.length}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Recent Actions</p>
                      <p className="text-lg font-bold mt-1">{activityDetail.activities.length}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Tests Created</p>
                      <p className="text-lg font-bold mt-1">{stats.testsCreated}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Test Questions</p>
                      <p className="text-lg font-bold mt-1">{stats.testQuestionsCreated}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">QB Questions Added</p>
                      <p className="text-lg font-bold mt-1">{stats.questionBankQuestionsCreated}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Reported Questions</p>
                      <p className="text-lg font-bold mt-1">{stats.reportedQuestionsReceived}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Open Reports</p>
                      <p className="text-lg font-bold mt-1">{stats.openReportedQuestions}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No activity found.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent Activity Log</CardTitle>
              </CardHeader>
              <CardContent>
                {userLoading || activityLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, index) => <div key={index} className="h-12 rounded-xl bg-muted animate-pulse" />)}
                  </div>
                ) : activityDetail?.activities.length ? (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {activityDetail.activities.slice(0, 12).map((activity) => (
                      <div key={activity.id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium capitalize">{activity.action.replace(/_/g, " ")}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {activity.detail || activity.page || "Platform interaction"}
                            </p>
                          </div>
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {format(new Date(activity.createdAt), "MMM d, h:mm a")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditStaffDialog({ staff, onUpdated }: { staff: StaffUser; onUpdated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<EditForm>({
    fullName: staff.fullName ?? "",
    email: staff.email ?? "",
    subject: staff.subject ?? "",
    phone: staff.phone ?? "",
    newPassword: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) { setError("Full name is required."); return; }
    if (!form.email.trim()) { setError("Email is required."); return; }
    if (form.newPassword && form.newPassword.length < 6) { setError("Password must be at least 6 characters."); return; }
    setError("");
    setSaving(true);

    try {
      const body: Record<string, string> = {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        subject: form.subject.trim(),
        phone: form.phone.trim(),
      };
      if (form.newPassword.trim()) body.newPassword = form.newPassword.trim();

      const res = await fetch(buildApiUrl(`/api/users/${staff.id}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to update account");
      }

      toast({
        title: `${roleLabel(staff.role)} updated`,
        description: `${form.fullName}'s details have been saved.`,
      });
      setOpen(false);
      setForm((prev) => ({ ...prev, newPassword: "" }));
      onUpdated();
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setError("");
          setForm({
            fullName: staff.fullName ?? "",
            email: staff.email ?? "",
            subject: staff.subject ?? "",
            phone: staff.phone ?? "",
            newPassword: "",
          });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary gap-1.5">
          <Pencil size={14} /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full flex shrink-0 items-center justify-center bg-gradient-to-br from-blue-500 to-cyan-600 text-sm font-bold text-white">
              {getInitials(staff.fullName)}
            </div>
            <div>
              <p className="text-base font-semibold leading-tight">Edit {roleLabel(staff.role)} Account</p>
              <p className="text-xs text-muted-foreground font-normal">@{staff.username}</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {error && (
            <Alert variant="destructive" className="py-2.5">
              <AlertTriangle size={14} className="mr-2" />
              <AlertDescription className="text-sm">{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label className="text-sm flex items-center gap-1.5"><User size={13} /> Full Name</Label>
            <Input name="fullName" value={form.fullName} onChange={handleChange} placeholder="Full name" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm flex items-center gap-1.5"><Mail size={13} /> Email Address</Label>
            <Input name="email" type="email" value={form.email} onChange={handleChange} placeholder="Email address" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm flex items-center gap-1.5"><BookOpen size={13} /> Subject / Department <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input name="subject" value={form.subject} onChange={handleChange} placeholder="e.g. Mathematics" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm flex items-center gap-1.5"><Phone size={13} /> Phone <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input name="phone" value={form.phone} onChange={handleChange} placeholder="+91 98765 43210" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm flex items-center gap-1.5"><KeyRound size={13} /> Reset Password <span className="text-muted-foreground text-xs">(leave blank to keep current)</span></Label>
            <div className="relative">
              <Input
                name="newPassword"
                type={showPassword ? "text" : "password"}
                value={form.newPassword}
                onChange={handleChange}
                placeholder="New password (min 6 chars)"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button className="flex-1 gap-1.5" onClick={handleSave} disabled={saving}>
              {saving ? (
                <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
              ) : (
                <><CheckCircle size={14} /> Save Changes</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SuperAdminAdmins() {
  const { data: users = [], isLoading } = useListUsers();
  const createStaff = useCreateAdmin();
  const deleteUser = useDeleteUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>({
    username: "",
    password: "",
    fullName: "",
    email: "",
    subject: "",
    role: "admin",
  });
  const [error, setError] = useState("");
  const [showCreatePwd, setShowCreatePwd] = useState(false);
  const [search, setSearch] = useState("");

  const staffUsers = (users as StaffUser[]).filter((user) => user.role === "admin");
  const teacherCount = staffUsers.length;
  const activeTeacherCount = staffUsers.filter((user) => user.status === "active").length;

  const filtered = staffUsers.filter((user) =>
    !search.trim() ||
    user.fullName.toLowerCase().includes(search.toLowerCase()) ||
    user.username.toLowerCase().includes(search.toLowerCase()) ||
    user.email?.toLowerCase().includes(search.toLowerCase()) ||
    user.subject?.toLowerCase().includes(search.toLowerCase()) ||
    roleLabel(user.role).toLowerCase().includes(search.toLowerCase())
  );
  const filteredTeachers = filtered;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleCreate = () => {
    setError("");

    if (!form.fullName.trim() || !form.username.trim() || !form.password.trim() || !form.email.trim()) {
      setError("Full name, username, email, and password are required.");
      return;
    }

    createStaff.mutate(
      {
        data: {
          username: form.username.trim(),
          password: form.password,
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          subject: form.subject || undefined,
          role: "admin",
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({
            title: `${roleLabel(form.role)} created`,
            description: `${form.fullName} has been added.`,
          });
          setOpen(false);
          setForm({
            username: "",
            password: "",
            fullName: "",
            email: "",
            subject: "",
            role: "admin",
          });
        },
        onError: (err: any) => {
          setError(err?.data?.error ?? "Failed to create account");
        },
      }
    );
  };

  const handleDelete = (staff: StaffUser) => {
    if (!confirm(`Delete ${roleLabel(staff.role).toLowerCase()} "${staff.fullName}"? This cannot be undone.`)) return;

    deleteUser.mutate(
      { id: staff.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({
            title: `${roleLabel(staff.role)} deleted`,
            description: `${staff.fullName} has been removed.`,
          });
        },
        onError: (err: any) => {
          toast({
            title: `Failed to delete ${roleLabel(staff.role).toLowerCase()}`,
            description: err?.data?.error ?? "The account could not be deleted. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  return (
    <div className="space-y-6">
      <div
        className="relative overflow-hidden rounded-2xl p-6 text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
        style={{ background: "linear-gradient(135deg, #2563eb 0%, #0891b2 52%, #059669 100%)" }}
      >
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-white/70 text-sm mb-1">
              <GraduationCap size={14} /> Staff Accounts
            </div>
            <h1 className="text-2xl font-bold">Teachers</h1>
            <p className="text-white/70 text-sm mt-1">Super admins can create and manage teacher accounts from one place.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 shrink-0">
            <div className="bg-white/10 rounded-xl px-4 py-2.5 min-w-[110px]">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-white/80" />
                <div>
                  <p className="text-lg font-bold leading-tight">{teacherCount}</p>
                  <p className="text-xs text-white/70">Teachers</p>
                </div>
              </div>
            </div>
            <div className="bg-white/10 rounded-xl px-4 py-2.5 min-w-[110px]">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="text-white/80" />
                <div>
                  <p className="text-lg font-bold leading-tight">{activeTeacherCount}</p>
                  <p className="text-xs text-white/70">Active</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-10 translate-x-10" />
        <div className="absolute bottom-0 right-20 w-24 h-24 bg-white/4 rounded-full translate-y-8" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, username, email, subject, or role…"
            className="h-10 w-full rounded-xl border border-slate-300 bg-white py-2 pr-4 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
            style={{ paddingLeft: "2.25rem" }}
          />
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5 shrink-0">
              <Plus size={16} /> Add Staff Account
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Teacher Account</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

              <div className="space-y-1.5">
                <Label className="text-sm flex items-center gap-1.5"><User size={13} /> Full Name</Label>
                <Input name="fullName" placeholder="Full name" value={form.fullName} onChange={handleChange} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm flex items-center gap-1.5"><User size={13} /> Username</Label>
                <Input name="username" placeholder="Login username" value={form.username} onChange={handleChange} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm flex items-center gap-1.5"><Mail size={13} /> Email</Label>
                <Input name="email" type="email" placeholder="Email address" value={form.email} onChange={handleChange} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm flex items-center gap-1.5"><KeyRound size={13} /> Password</Label>
                <div className="relative">
                  <Input
                    name="password"
                    type={showCreatePwd ? "text" : "password"}
                    placeholder="Set a password"
                    value={form.password}
                    onChange={handleChange}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePwd((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCreatePwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm flex items-center gap-1.5"><BookOpen size={13} /> Subject / Department <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  name="subject"
                  placeholder="e.g. Mathematics"
                  value={form.subject}
                  onChange={handleChange}
                />
              </div>

              <Button className="w-full gap-1.5" onClick={handleCreate} disabled={createStaff.isPending}>
                {createStaff.isPending ? (
                  <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</>
                ) : (
                  <><Plus size={14} /> Create Account</>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="pt-4 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-muted-foreground">
            <UserCheck size={32} className="opacity-20 mb-2" />
            <p className="text-sm">{search ? "No staff accounts match your search." : "No teacher accounts created yet."}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="border-b bg-muted/30 pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <GraduationCap size={15} className="text-blue-500" />
              Teachers
              <span className="text-muted-foreground font-normal">({filteredTeachers.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {filteredTeachers.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-muted-foreground">
                <UserCheck size={28} className="opacity-20 mb-2" />
                <p className="text-sm">No teachers found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTeachers.map((staff) => (
                  <div
                    key={staff.id}
                    className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-3.5 transition-all duration-150 hover:border-border hover:shadow-sm"
                  >
                    <StaffProfileDialog staff={staff} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{staff.fullName}</p>
                        <Badge variant="secondary" className={`text-[10px] shrink-0 ${roleBadgeClass(staff.role)}`}>
                          {roleLabel(staff.role)}
                        </Badge>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-muted-foreground">@{staff.username}</span>
                        {staff.email && <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail size={10} />{staff.email}</span>}
                        {staff.subject && <span className="text-xs text-muted-foreground flex items-center gap-1"><BookOpen size={10} />{formatExamDisplayName(staff.subject) || staff.subject}</span>}
                        {staff.phone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone size={10} />{staff.phone}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <EditStaffDialog staff={staff} onUpdated={refresh} />
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive gap-1.5" onClick={() => handleDelete(staff)}>
                        <Trash2 size={14} /> Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
