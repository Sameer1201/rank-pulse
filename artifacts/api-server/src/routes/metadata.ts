import { Router } from "express";
import { getSignedUserId } from "../lib/authUtils";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db, aiApiKeysTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

const router = Router();

function getUser(req: any) {
  const userId = getSignedUserId(req);
  const userRole = req.cookies?.userRole ?? null;
  return { userId, userRole };
}

// ─── Provider configs ──────────────────────────────────────────────────────
const PROVIDER_MODELS: Record<string, string> = {
  openrouter: "google/gemini-2.5-flash",
  openai: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  anthropic: "claude-3-5-haiku-20241022",
  google: "gemini-2.0-flash",
};

const OPENAI_COMPAT_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
};

interface StoredKey { id: string; value: string; provider: string; }

async function getApiKeys(): Promise<StoredKey[]> {
  const rows = await db
    .select({ id: aiApiKeysTable.id, value: aiApiKeysTable.value, provider: aiApiKeysTable.provider, limitExhausted: aiApiKeysTable.limitExhausted })
    .from(aiApiKeysTable)
    .orderBy(asc(aiApiKeysTable.priority), asc(aiApiKeysTable.createdAt));
  if (!rows.length) throw new Error("No AI API key configured. Please add one via the AI Keys section.");
  // Skip keys already marked as limit-exhausted; if ALL are exhausted, include them so the error is informative
  const active = rows.filter((r) => !r.limitExhausted);
  return (active.length > 0 ? active : rows).map((r) => ({ id: r.id, value: r.value, provider: r.provider }));
}

async function markKeyExhausted(id: string): Promise<void> {
  try {
    await db.update(aiApiKeysTable).set({ limitExhausted: true }).where(eq(aiApiKeysTable.id, id));
  } catch {
    // best-effort — don't break the request flow
  }
}

function isKeyExhaustedError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Rate limits, quota, auth failures — all mean "this key can't serve, try next"
    if (msg.includes("429") || msg.includes("too many requests") || msg.includes("quota") || msg.includes("rate limit")) return true;
    if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("invalid api key")) return true;
    // Provider-level errors (500, overloaded, unavailable) — try next key
    if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("overloaded") || msg.includes("unavailable")) return true;
  }
  return false;
}

// kept for backward-compat; not used internally anymore
function isRetryableError(err: unknown): boolean { return isKeyExhaustedError(err); }

interface QuestionMeta {
  questionCode: string;
  subject: string;
  chapter: string;
  topic: string;
  difficulty: "easy" | "moderate" | "hard";
  idealTimeSeconds: number;
}

type QuestionInput = {
  questionCode: string;
  questionText: string;
  optionsText: string[];
  hasImages: boolean;
  qtype: string;
  marksRight: number;
  marksWrong: number;
  tagsRaw: string;
  subjectRaw: string;
};

const TAXONOMY = `STRICT SUBJECT-CHAPTER-TOPIC TAXONOMY (MUST only pick from this list):
1. Subject: Mathematics | Chapters: Linear Algebra | Calculus | Vector Calculus | Differential Equation | Complex Analysis
2. Subject: General Aptitude | Chapters: Quantitative Aptitude | Analytical Aptitude | Spatial Aptitude
3. Subject: Verbal Aptitude | Chapters: Parts of Speech | Non-Grammar Vocabulary | Reading Comprehension
4. Subject: COA | Chapters: Introduction | Machine Instructions | Addressing Modes | ALU Data Path and Control Unit | Instruction Pipelining
5. Subject: Analog Electronics | Chapters: Basic Introduction | Diode Circuits | BJT Circuits | MOSFET | Differential Amplifiers | Op-amp | Frequency Response | Feedback | Oscillators | Miscellaneous Topics
6. Subject: Digital Electronics | Chapters: Boolean Theorems and GATES | Combinational Circuits | Sequential Circuits | ADCs & DACs | Miscellaneous Topics
7. Subject: EDC | Chapters: Basics of SC Physics | PN Junction Diode | Bipolar Junction Transistor | MOSFET and MOS Capacitor | Miscellaneous Topics
8. Subject: Network Theory | Chapters: Basic of Network Theory | Network Theorems | Transient Analysis | Single Phase & 3-Phase AC Circuit | Two Port Network
9. Subject: Control System | Chapters: Basic of Control System | Block Diagram and SFG | Time Response Analysis | Stability | Root Locus | Bode Plot | Nyquist Plot and Polar Plot | State Space Analysis | Controller and Compensator
10. Subject: Signal and System | Chapters: Introduction | LTI System | CTFS | CTFT | Sampling | Laplace Transform | DTFT | Z Transform | DFT | DTFS
11. Subject: Communication System | Chapters: AM and FM | Random Variable and Random Process | Pulse Code Modulation | Digital Communication | Noise in Communication | Information Theory | Miscellaneous
12. Subject: EMFT | Chapters: Coordinate System | Vector Calculus | Maxwell Equation | Electromagnetic Wave | Transmission Line`;

function buildPrompt(questions: QuestionInput[], testTitle: string | null): string {
  const payload = questions.map((q) => ({
    questionCode: q.questionCode,
    questionText: q.questionText.substring(0, 600),
    options: q.optionsText.map((o) => o.substring(0, 200)),
    hasImages: q.hasImages,
    type: q.qtype,
    marks: `+${q.marksRight} / -${Math.abs(q.marksWrong)}`,
    rawTags: q.tagsRaw,
  }));
  return `You are an expert exam question classifier for Indian competitive exams (GATE, ESE, etc.).
${testTitle ? `Test title: "${testTitle}"\n` : ""}
${TAXONOMY}

For EACH question, classify using ONLY the taxonomy above. "topic" = concise sub-topic in 2-5 words.

Return a JSON array — EXACT structure per question:
{"questionCode":"<same as input>","subject":"<exact from taxonomy>","chapter":"<exact from taxonomy>","topic":"<sub-topic>","difficulty":"<easy|moderate|hard>","idealTimeSeconds":<integer>}

Difficulty: easy=60-90s, moderate=120-180s, hard=180-300s. NAT type +30-60s extra.
Subject/Chapter must match taxonomy EXACTLY (same spelling, capitalization).

Questions:
${JSON.stringify(payload, null, 2)}

Return ONLY a valid JSON array. No markdown, no code blocks, no explanation.`;
}

function parseJsonResult(text: string): QuestionMeta[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("AI returned invalid JSON: " + text.substring(0, 300));
  return JSON.parse(match[0]) as QuestionMeta[];
}

async function analyzeOpenAICompat(questions: QuestionInput[], testTitle: string | null, apiKey: string, provider: string): Promise<QuestionMeta[]> {
  const client = new OpenAI({ apiKey, baseURL: OPENAI_COMPAT_URLS[provider] });
  const res = await client.chat.completions.create({
    model: PROVIDER_MODELS[provider],
    max_tokens: 8192,
    messages: [{ role: "user", content: buildPrompt(questions, testTitle) }],
  });
  return parseJsonResult(res.choices[0]?.message?.content?.trim() ?? "");
}

async function analyzeAnthropic(questions: QuestionInput[], testTitle: string | null, apiKey: string): Promise<QuestionMeta[]> {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: PROVIDER_MODELS.anthropic,
    max_tokens: 8192,
    messages: [{ role: "user", content: buildPrompt(questions, testTitle) }],
  });
  const text = res.content.find((b) => b.type === "text")?.text?.trim() ?? "";
  return parseJsonResult(text);
}

async function analyzeGoogle(questions: QuestionInput[], testTitle: string | null, apiKey: string): Promise<QuestionMeta[]> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: PROVIDER_MODELS.google });
  const result = await model.generateContent(buildPrompt(questions, testTitle));
  const text = result.response.text().trim();
  return parseJsonResult(text);
}

async function analyzeWithKey(questions: QuestionInput[], testTitle: string | null, { value, provider }: StoredKey): Promise<QuestionMeta[]> {
  if (provider === "anthropic") return analyzeAnthropic(questions, testTitle, value);
  if (provider === "google") return analyzeGoogle(questions, testTitle, value);
  return analyzeOpenAICompat(questions, testTitle, value, provider);
}

// POST /api/metadata/analyze
router.post("/analyze", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { questions, testTitle } = req.body as { questions?: QuestionInput[]; testTitle?: string | null };
  if (!questions?.length) { res.status(400).json({ error: "No questions provided" }); return; }

  try {
    const keys = await getApiKeys();
    const BATCH_SIZE = 10;
    const allMeta: QuestionMeta[] = [];

    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      let lastErr: unknown;
      let succeeded = false;

      for (const key of keys) {
        try {
          const meta = await analyzeWithKey(batch, testTitle ?? null, key);
          allMeta.push(...meta);
          succeeded = true;
          break;
        } catch (err) {
          lastErr = err;
          // Always move to the next key — quota exhausted, auth failure,
          // provider overload, JSON parse error, etc. Never give up early.
          req.log.warn(
            { provider: key.provider, err },
            "Key failed, trying next key if available"
          );
          // Persistently mark quota/rate-limit errors so the UI shows red
          if (isKeyExhaustedError(err)) {
            void markKeyExhausted(key.id);
          }
          continue;
        }
      }

      if (!succeeded) {
        throw new Error(
          `All ${keys.length} key(s) exhausted. Last: ` +
          (lastErr instanceof Error ? lastErr.message : String(lastErr))
        );
      }
    }

    res.json(allMeta);
  } catch (err) {
    req.log.error({ err }, "Failed to analyze questions");
    res.status(500).json({ error: "AI analysis failed: " + (err instanceof Error ? err.message : String(err)) });
  }
});

export default router;
