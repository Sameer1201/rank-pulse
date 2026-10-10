import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { createPortal } from "react-dom";
import {
  Search, LayoutDashboard, BookOpen, ClipboardList,
  Trophy,
  Users, Activity,
  ArrowRight, Zap,
} from "lucide-react";
import { APP_NAME } from "@/lib/brand";

interface CmdItem {
  label: string;
  description?: string;
  href?: string;
  icon: React.ReactNode;
  group: string;
  keywords?: string;
}

function getItems(role: string): CmdItem[] {
  const nav = (label: string, href: string, icon: React.ReactNode, group = "Navigation", desc?: string, kw?: string): CmdItem =>
    ({ label, href, icon, group, description: desc, keywords: kw });

  if (role === "super_admin") return [
    nav("Dashboard", "/super-admin/dashboard", <LayoutDashboard size={15} />, "Navigation", "Overview and summary"),
    nav("Management", "/super-admin/management", <Users size={15} />, "Management", "Manage teachers and students"),
    nav("Question Bank", "/super-admin/question-bank", <BookOpen size={15} />, "Content", "Manage platform question banks"),
    nav("Exam Templates", "/super-admin/exam-templates", <ClipboardList size={15} />, "Content", "Manage exam blueprints"),
    nav("Tests Overview", "/super-admin/tests", <ClipboardList size={15} />, "Analytics", "All tests across platform"),
    nav("User Activity", "/super-admin/activity", <Activity size={15} />, "Analytics", "Engagement and activity logs"),
  ];

  if (role === "admin") return [
    nav("Students", "/admin/students", <Users size={15} />, "Teaching", "View enrolled students"),
    nav("Question Bank", "/admin/question-bank", <BookOpen size={15} />, "Teaching", "Manage assigned content"),
    nav("Tests", "/admin/tests", <ClipboardList size={15} />, "Teaching", "Create and manage tests"),
    nav("Leaderboard", "/leaderboard", <Trophy size={15} />, "Community"),
  ];

  return [
    nav("Dashboard", "/student/dashboard", <LayoutDashboard size={15} />, "Navigation", "Learning overview"),
    nav("Tests", "/student/tests", <ClipboardList size={15} />, "Learning", "Take pending tests"),
    nav("Leaderboard", "/leaderboard", <Trophy size={15} />, "Community"),
  ];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  role: string;
}

export default function CommandPalette({ isOpen, onClose, role }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allItems = getItems(role);
  const filtered = query.trim()
    ? allItems.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.description?.toLowerCase().includes(query.toLowerCase()) ||
        item.keywords?.toLowerCase().includes(query.toLowerCase()) ||
        item.group.toLowerCase().includes(query.toLowerCase())
      )
    : allItems;

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((s) => Math.min(s + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((s) => Math.max(s - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[selectedIdx];
        if (item?.href) { navigate(item.href); onClose(); }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, filtered, selectedIdx, navigate, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  if (!isOpen) return null;

  const groups: Record<string, CmdItem[]> = {};
  for (const item of filtered) {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          <Search size={16} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
          />
          <div className="flex items-center gap-1">
            <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 font-mono">ESC</kbd>
          </div>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground">
              <Search size={28} className="opacity-20 mb-2" />
              <p className="text-sm">No results for "{query}"</p>
            </div>
          ) : (
            Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                  {group}
                </p>
                {items.map((item) => {
                  const idx = filtered.indexOf(item);
                  const isSelected = idx === selectedIdx;
                  return (
                    <button
                      key={item.label}
                      data-idx={idx}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors group ${
                        isSelected
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted/60"
                      }`}
                      onClick={() => { if (item.href) { navigate(item.href); onClose(); } }}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      <span className={`shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isSelected ? "text-primary" : ""}`}>{item.label}</p>
                        {item.description && (
                          <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                        )}
                      </div>
                      {isSelected && <ArrowRight size={13} className="text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2.5 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground bg-muted/30">
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1 py-0.5 font-mono">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1 py-0.5 font-mono">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1 py-0.5 font-mono">Esc</kbd> close</span>
          <span className="ml-auto flex items-center gap-1 opacity-60"><Zap size={10} /> {APP_NAME}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
