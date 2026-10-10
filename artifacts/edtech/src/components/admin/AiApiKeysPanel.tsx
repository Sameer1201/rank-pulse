import { useState, useEffect } from "react";
import { buildApiUrl } from "@/lib/api-origin";

const PROVIDERS = [
  { value: "openrouter",   label: "OpenRouter",               icon: "🔗", hint: "openrouter.ai — Claude, Gemini, GPT sab ek key se",            placeholder: "sk-or-..."      },
  { value: "openai",       label: "OpenAI",                   icon: "🤖", hint: "platform.openai.com — GPT-4o-mini",                             placeholder: "sk-..."         },
  { value: "anthropic",    label: "Anthropic",                icon: "🧠", hint: "console.anthropic.com — Claude 3.5 Haiku",                       placeholder: "sk-ant-..."     },
  { value: "google",       label: "Google AI Studio",         icon: "✨", hint: "aistudio.google.com — Gemini 2.0 Flash",                         placeholder: "AIza..."        },
  { value: "groq",         label: "Groq",                     icon: "⚡", hint: "console.groq.com — Llama 3.3 70B (fast, free)",                  placeholder: "gsk_..."        },
  { value: "nvidia",       label: "NVIDIA NIM",               icon: "🖥️", hint: "build.nvidia.com — NVIDIA hosted models",                        placeholder: "nvapi-..."      },
  { value: "mistral",      label: "Mistral (La Plateforme)",  icon: "🌊", hint: "console.mistral.ai — Mistral Large, Pixtral",                     placeholder: "..."            },
  { value: "codestral",    label: "Mistral (Codestral)",      icon: "💻", hint: "codestral.mistral.ai — Code-focused Mistral model",               placeholder: "..."            },
  { value: "huggingface",  label: "HuggingFace",              icon: "🤗", hint: "huggingface.co/inference-providers — Open-source models",         placeholder: "hf_..."         },
  { value: "vercel",       label: "Vercel AI Gateway",        icon: "▲",  hint: "ai.vercel.com — Vercel's unified AI gateway",                     placeholder: "..."            },
  { value: "kilo",         label: "Kilo Gateway",             icon: "🔧", hint: "kilo.ai — Multi-provider AI gateway",                             placeholder: "..."            },
  { value: "opencodezen",  label: "OpenCode Zen",             icon: "🔮", hint: "opencode.ai — OpenCode Zen provider",                             placeholder: "..."            },
  { value: "cerebras",     label: "Cerebras",                 icon: "🧬", hint: "inference.cerebras.ai — Ultra-fast inference",                    placeholder: "csk-..."        },
  { value: "cohere",       label: "Cohere",                   icon: "🌐", hint: "dashboard.cohere.com — Command R+ and other models",              placeholder: "..."            },
];

const PROVIDER_BADGE_COLORS: Record<string, string> = {
  openrouter:  "bg-purple-100 text-purple-700",
  openai:      "bg-green-100 text-green-700",
  anthropic:   "bg-orange-100 text-orange-700",
  google:      "bg-blue-100 text-blue-700",
  groq:        "bg-yellow-100 text-yellow-700",
  nvidia:      "bg-emerald-100 text-emerald-700",
  mistral:     "bg-indigo-100 text-indigo-700",
  codestral:   "bg-violet-100 text-violet-700",
  huggingface: "bg-amber-100 text-amber-700",
  vercel:      "bg-slate-100 text-slate-700",
  kilo:        "bg-teal-100 text-teal-700",
  opencodezen: "bg-fuchsia-100 text-fuchsia-700",
  cerebras:    "bg-cyan-100 text-cyan-700",
  cohere:      "bg-rose-100 text-rose-700",
};

export interface SavedKey {
  id: string;
  label: string;
  provider: string;
  masked: string;
  priority: number;
  limitExhausted: boolean;
  createdAt: string;
}

async function fetchKeys(): Promise<SavedKey[]> {
  const res = await fetch(buildApiUrl(`/api/ai-config/apikeys`), { credentials: "include" });
  if (!res.ok) return [];
  return res.json();
}

export default function AiApiKeysPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [keys, setKeys] = useState<SavedKey[]>([]);
  const [provider, setProvider] = useState("openrouter");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);

  const load = async () => { setKeys(await fetchKeys()); };
  useEffect(() => { load(); }, []);

  const selectedProvider = PROVIDERS.find((p) => p.value === provider)!;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) { setError("API key cannot be empty"); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl(`/api/ai-config/apikeys`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ label: label.trim() || undefined, apiKey: apiKey.trim(), provider }),
      });
      const data = await res.json();
      if (res.ok && data.ok) { setLabel(""); setApiKey(""); await load(); }
      else setError(data.error || "Failed to save key");
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(buildApiUrl(`/api/ai-config/apikeys/${id}`), { method: "DELETE", credentials: "include" });
      await load();
    } finally { setDeleting(null); }
  };

  const handleResetLimit = async (id: string) => {
    setResetting(id);
    try {
      await fetch(buildApiUrl(`/api/ai-config/apikeys/${id}/reset-limit`), { method: "PATCH", credentials: "include" });
      await load();
    } finally { setResetting(null); }
  };

  const exhaustedCount = keys.filter((k) => k.limitExhausted).length;

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#F8FAFC] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-[#0F172A]">🔑 AI API Keys</span>
          <span className="text-xs text-[#64748B]">({keys.length} key{keys.length !== 1 ? "s" : ""} configured)</span>
          {exhaustedCount > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-600">
              {exhaustedCount} limit exhausted
            </span>
          )}
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-[#94A3B8] transition-transform ${open ? "rotate-180" : ""}`}><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {open && (
        <div className="border-t border-[#F1F5F9] px-5 py-4 space-y-4">
          {/* Existing keys */}
          {keys.length > 0 && (
            <div className="space-y-2">
              {keys.map((k) => (
                <div
                  key={k.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    k.limitExhausted
                      ? "border-red-200 bg-red-50"
                      : "border-[#F1F5F9] bg-[#F8FAFC]"
                  }`}
                >
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PROVIDER_BADGE_COLORS[k.provider] ?? "bg-gray-100 text-gray-700"}`}>
                    {PROVIDERS.find((p) => p.value === k.provider)?.label ?? k.provider}
                  </span>
                  <span className={`text-xs font-medium flex-1 truncate ${k.limitExhausted ? "text-red-700" : "text-[#374151]"}`}>
                    {k.label}
                  </span>
                  {k.limitExhausted && (
                    <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                      Limit exhausted
                    </span>
                  )}
                  <span className="font-mono text-xs text-[#94A3B8]">{k.masked}</span>
                  {k.limitExhausted && (
                    <button
                      onClick={() => handleResetLimit(k.id)}
                      disabled={resetting === k.id}
                      className="rounded px-2 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                      title="Reset limit — retry this key"
                    >
                      {resetting === k.id ? "…" : "Reset"}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(k.id)}
                    disabled={deleting === k.id}
                    className="p-1 rounded hover:bg-red-50 hover:text-red-500 text-[#94A3B8] transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Provider tabs */}
          <div className="flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setProvider(p.value)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  provider === p.value
                    ? "border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]"
                    : "border-[#E5E7EB] text-[#374151] hover:bg-[#F8FAFC]"
                }`}
              >
                <span>{p.icon}</span>{p.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-[#64748B] rounded-lg bg-[#F8FAFC] px-3 py-2">{selectedProvider.hint}</p>

          <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional)"
              className="w-36 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={selectedProvider.placeholder}
              required
              autoComplete="off"
              className="flex-1 min-w-[160px] rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-mono placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
            />
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors"
            >
              {loading
                ? <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                : <>+ Add</>
              }
            </button>
          </form>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
