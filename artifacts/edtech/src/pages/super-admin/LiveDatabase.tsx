import { useState, useEffect, useCallback } from "react";
import {
  Database, RefreshCw, Search, Trash2, Edit2, Save, X,
  ChevronLeft, ChevronRight, Check, AlertTriangle, Eye,
  Table2, BarChart2,
} from "lucide-react";
import { buildApiUrl } from "@/lib/api-origin";

interface TableInfo { table: string; count: number; }
interface Column { column_name: string; data_type: string; is_nullable: string; column_default: string | null; }
interface RowData { [key: string]: any; }

const TABLE_ICONS: Record<string, string> = {
  users: "👤", subjects: "📚", chapters: "📖", tests: "📝", test_sections: "📋",
  test_questions: "❓", submissions: "📤", q_reports: "🚩", question_bank: "🏦",
  sessions: "🔐", notifications: "🔔", direct_messages: "💬", activity_logs: "📊",
  email_send_logs: "📧", password_reset_requests: "🔑", payment_history: "💳",
  classes: "🏫", enrollments: "📌", platform_settings: "⚙️", exam_templates: "🗒️",
};

function getCellColor(type: string | undefined) {
  if (!type) return "text-gray-800";
  if (type.includes("int") || type.includes("numeric") || type.includes("float") || type.includes("double")) return "text-blue-700";
  if (type.includes("bool")) return "text-purple-700";
  if (type.includes("timestamp") || type.includes("date")) return "text-amber-700";
  if (type === "jsonb" || type === "json") return "text-emerald-700";
  if (type.includes("ARRAY") || type.includes("array")) return "text-pink-700";
  return "text-gray-800";
}

function formatCell(val: any, type: string): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") return JSON.stringify(val);
  if (type.includes("timestamp") || type.includes("date")) {
    try { return new Date(val).toLocaleString(); } catch { return String(val); }
  }
  return String(val);
}

export default function LiveDatabase({ embedded = false }: { embedded?: boolean }) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<any>>(new Set());
  const [editingRow, setEditingRow] = useState<{ pk: any; data: RowData } | null>(null);
  const [editValues, setEditValues] = useState<RowData>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [tableSearch, setTableSearch] = useState("");

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchTables = async () => {
    setLoadingTables(true);
    try {
      const res = await fetch(buildApiUrl(`/api/db-viewer/tables`), { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTables(data.tables);
    } catch (e: any) {
      showToast(e.message || "Failed to load tables", "error");
    } finally {
      setLoadingTables(false);
    }
  };

  const fetchRows = useCallback(async (table: string, pg: number, q: string) => {
    setLoadingRows(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(pg * pageSize), search: q });
      const res = await fetch(buildApiUrl(`/api/db-viewer/tables/${table}/rows?${params}`), { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setColumns(data.columns);
      setRows(data.rows);
      setTotal(data.total);
      setSelectedIds(new Set());
    } catch (e: any) {
      showToast(e.message || "Failed to load rows", "error");
    } finally {
      setLoadingRows(false);
    }
  }, [pageSize]);

  useEffect(() => { fetchTables(); }, []);

  useEffect(() => {
    if (selectedTable) {
      setPage(0);
      setSearch("");
      setSearchInput("");
      setSelectedIds(new Set());
      setEditingRow(null);
      fetchRows(selectedTable, 0, "");
    }
  }, [selectedTable]);

  useEffect(() => {
    if (selectedTable) fetchRows(selectedTable, page, search);
  }, [page, search, selectedTable]);

  const pkCol = columns[0]?.column_name ?? "id";

  const handleSelectRow = (pk: any) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pk)) next.delete(pk); else next.add(pk);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r[pkCol])));
    }
  };

  const handleEdit = (row: RowData) => {
    setEditingRow({ pk: row[pkCol], data: row });
    setEditValues({ ...row });
  };

  const handleSave = async () => {
    if (!editingRow || !selectedTable) return;
    setSaving(true);
    try {
      const res = await fetch(buildApiUrl(`/api/db-viewer/tables/${selectedTable}/rows/${editingRow.pk}`), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editValues),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("Row updated successfully");
      setEditingRow(null);
      fetchRows(selectedTable, page, search);
    } catch (e: any) {
      showToast(e.message || "Failed to update row", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedTable || selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} row(s)? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(buildApiUrl(`/api/db-viewer/tables/${selectedTable}/rows`), {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`${data.deleted} row(s) deleted`);
      setSelectedIds(new Set());
      fetchRows(selectedTable, page, search);
      fetchTables();
    } catch (e: any) {
      showToast(e.message || "Failed to delete rows", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(0);
  };

  const totalPages = Math.ceil(total / pageSize);
  const filteredTables = tables.filter((t) => t.table.toLowerCase().includes(tableSearch.toLowerCase()));
  const totalRows = tables.reduce((sum, t) => sum + t.count, 0);

  return (
    <div className={`flex overflow-hidden bg-gray-50 ${embedded ? "h-[680px] rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)]" : "h-[calc(100vh-64px)]"}`}>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${toast.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
          {toast.type === "success" ? <Check size={15} /> : <AlertTriangle size={15} />}
          {toast.msg}
        </div>
      )}

      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r bg-white flex flex-col overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
              <Database size={16} className="text-[#F97316]" /> Live Database
            </h2>
            <button onClick={fetchTables} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 transition">
              <RefreshCw size={14} className={loadingTables ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
            <BarChart2 size={12} />
            <span>{tables.length} tables · {totalRows.toLocaleString()} rows</span>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Filter tables…"
              className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F97316]/30 bg-gray-50"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loadingTables ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse mx-1 mb-1" />
            ))
          ) : filteredTables.map((t) => (
            <button
              key={t.table}
              onClick={() => setSelectedTable(t.table)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all text-xs ${selectedTable === t.table ? "bg-[#FFF3E8] text-[#F97316] font-semibold" : "text-gray-700 hover:bg-gray-50"}`}
            >
              <span className="flex items-center gap-2 truncate">
                <span>{TABLE_ICONS[t.table] ?? "🗃️"}</span>
                <span className="truncate">{t.table}</span>
              </span>
              <span className={`ml-2 shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${selectedTable === t.table ? "bg-[#F97316] text-white" : "bg-gray-100 text-gray-500"}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedTable ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-[#FFF3E8] flex items-center justify-center mb-4">
              <Table2 size={32} className="text-[#F97316]" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Select a table</h3>
            <p className="text-sm text-gray-500">Choose a table from the sidebar to view, edit, or delete rows.</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="bg-white border-b px-4 py-3 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-lg">{TABLE_ICONS[selectedTable] ?? "🗃️"}</span>
                <h2 className="font-bold text-gray-800">{selectedTable}</h2>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{total.toLocaleString()} rows</span>
              </div>

              <form onSubmit={handleSearch} className="flex items-center gap-2 ml-auto">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search rows…"
                    className="pl-8 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F97316]/30 w-52"
                  />
                </div>
                <button type="submit" className="px-3 py-1.5 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#ea6c0a] transition">
                  Search
                </button>
                {search && (
                  <button type="button" onClick={() => { setSearch(""); setSearchInput(""); setPage(0); }} className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700">
                    <X size={14} />
                  </button>
                )}
              </form>

              {selectedIds.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition disabled:opacity-60"
                >
                  <Trash2 size={14} />
                  Delete {selectedIds.size} row{selectedIds.size > 1 ? "s" : ""}
                </button>
              )}

              <button
                onClick={() => fetchRows(selectedTable, page, search)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition"
              >
                <RefreshCw size={15} className={loadingRows ? "animate-spin" : ""} />
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {loadingRows ? (
                <div className="flex items-center justify-center h-40 text-gray-400">
                  <RefreshCw size={20} className="animate-spin mr-2" /> Loading…
                </div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                  <Eye size={32} className="mb-2 opacity-40" />
                  <p className="text-sm">No rows found</p>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-50 border-b">
                      <th className="w-10 px-3 py-2.5 text-left">
                        <input
                          type="checkbox"
                          checked={selectedIds.size === rows.length && rows.length > 0}
                          onChange={handleSelectAll}
                          className="rounded border-gray-300 accent-[#F97316]"
                        />
                      </th>
                      <th className="w-16 px-2 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider">Edit</th>
                      {columns.map((col) => (
                        <th key={col.column_name} className="px-3 py-2.5 text-left text-gray-500 font-semibold uppercase tracking-wider whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            {col.column_name}
                            <span className="text-[9px] text-gray-400 font-normal normal-case">({col.data_type})</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const pk = row[pkCol];
                      const isSelected = selectedIds.has(pk);
                      const isEditing = editingRow?.pk === pk;
                      return (
                        <tr
                          key={i}
                          className={`border-b transition-colors ${isSelected ? "bg-orange-50" : isEditing ? "bg-blue-50" : i % 2 === 0 ? "bg-white" : "bg-gray-50/50"} hover:bg-orange-50/50`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleSelectRow(pk)}
                              className="rounded border-gray-300 accent-[#F97316]"
                            />
                          </td>
                          <td className="px-2 py-2">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={handleSave}
                                  disabled={saving}
                                  className="p-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition"
                                  title="Save"
                                >
                                  <Save size={12} />
                                </button>
                                <button
                                  onClick={() => setEditingRow(null)}
                                  className="p-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                                  title="Cancel"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleEdit(row)}
                                className="p-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
                                title="Edit row"
                              >
                                <Edit2 size={12} />
                              </button>
                            )}
                          </td>
                          {columns.map((col) => {
                            const val = row[col.column_name];
                            const cellColor = getCellColor(col.data_type);
                            const isReadOnly = col.column_name === pkCol || col.column_name === "created_at";
                            return (
                              <td key={col.column_name} className="px-3 py-2 max-w-[200px]">
                                {isEditing && !isReadOnly ? (
                                  <input
                                    value={editValues[col.column_name] === null ? "" : String(editValues[col.column_name] ?? "")}
                                    onChange={(e) => setEditValues((prev) => ({ ...prev, [col.column_name]: e.target.value === "" ? null : e.target.value }))}
                                    className="w-full min-w-[80px] px-1.5 py-0.5 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#F97316]/50"
                                  />
                                ) : (
                                  <span className={`${cellColor} font-mono`} title={val !== null ? String(val) : ""}>
                                    {val === null ? (
                                      <span className="text-gray-300 italic">null</span>
                                    ) : (
                                      <span className="truncate block max-w-[180px]">{formatCell(val, col.data_type)}</span>
                                    )}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {total > pageSize && (
              <div className="bg-white border-t px-4 py-2.5 flex items-center justify-between text-xs text-gray-500">
                <span>
                  Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total.toLocaleString()} rows
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <span className="font-medium">Page {page + 1} / {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
