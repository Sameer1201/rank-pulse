import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CreditCard, IndianRupee, Search, Users } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { buildApiUrl } from "@/lib/api-origin";

interface PaymentRow {
  studentId: number;
  studentName: string;
  email: string;
  phone: string | null;
  subject: string | null;
  feature: "tests" | "analysis" | "question-bank" | "pyq";
  cycle: number;
  paidAt: string;
  amount: number;
  orderId: string;
  paymentId: string;
}

const FEATURE_LABELS: Record<string, { label: string; color: string }> = {
  "tests":         { label: "Tests",        color: "bg-blue-100 text-blue-700" },
  "analysis":      { label: "Analysis",     color: "bg-purple-100 text-purple-700" },
  "question-bank": { label: "Question Bank", color: "bg-orange-100 text-orange-700" },
  "pyq":           { label: "PYQ",          color: "bg-indigo-100 text-indigo-700" },
};

interface Summary {
  totalPayments: number;
  totalRevenue: number;
  uniqueStudents: number;
}

function StatTile({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <Card className="rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-xl font-black text-slate-900">{value}</p>
          <p className="text-xs font-medium text-slate-500">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SuperAdminPayments() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ payments: PaymentRow[]; summary: Summary }>({
    queryKey: ["super-admin-payments-all"],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/users/payments/all`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load payments");
      return res.json();
    },
  });

  const payments = data?.payments ?? [];
  const summary = data?.summary;

  const filtered = payments.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.studentName?.toLowerCase().includes(q) ||
      p.email?.toLowerCase().includes(q) ||
      p.orderId?.toLowerCase().includes(q) ||
      p.paymentId?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Payment History</h1>
        <p className="mt-1 text-sm text-slate-500">All student feature unlock payments across every cycle.</p>
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Total Payments"
            value={String(summary.totalPayments)}
            icon={<CreditCard size={18} className="text-orange-600" />}
            color="bg-orange-50"
          />
          <StatTile
            label="Total Revenue"
            value={`₹${summary.totalRevenue.toLocaleString("en-IN")}`}
            icon={<IndianRupee size={18} className="text-emerald-600" />}
            color="bg-emerald-50"
          />
          <StatTile
            label="Paying Students"
            value={String(summary.uniqueStudents)}
            icon={<Users size={18} className="text-blue-600" />}
            color="bg-blue-50"
          />
        </div>
      )}

      <Card className="rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Search size={15} className="text-slate-400" />
            <Input
              placeholder="Search by name, email, order ID or payment ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm border-0 bg-slate-50 focus-visible:ring-1"
            />
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-slate-400">Loading payments…</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              {payments.length === 0 ? "No payments recorded yet." : "No results match your search."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="pb-3 text-left text-xs font-semibold text-slate-500">#</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold text-slate-500">Student</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold text-slate-500">Email</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold text-slate-500">Feature</th>
                    <th className="pb-3 pr-4 text-center text-xs font-semibold text-slate-500">Cycle</th>
                    <th className="pb-3 pr-4 text-center text-xs font-semibold text-slate-500">Amount</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold text-slate-500">Date & Time</th>
                    <th className="pb-3 text-left text-xs font-semibold text-slate-500">Payment ID</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, idx) => (
                    <tr key={row.orderId} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-2.5 pr-3 text-xs text-slate-400">{idx + 1}</td>
                      <td className="py-2.5 pr-4">
                        <p className="font-semibold text-slate-800">{row.studentName}</p>
                        {row.phone && <p className="text-[11px] text-slate-400">{row.phone}</p>}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-slate-600">{row.email}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${FEATURE_LABELS[row.feature]?.color ?? "bg-slate-100 text-slate-700"}`}>
                          {FEATURE_LABELS[row.feature]?.label ?? row.feature}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-center">
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">
                          #{row.cycle}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-center">
                        <span className="font-bold text-emerald-700">₹{row.amount}</span>
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-slate-600">
                        {format(new Date(row.paidAt), "dd MMM yyyy, hh:mm a")}
                      </td>
                      <td className="py-2.5">
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 break-all">
                          {row.paymentId}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
