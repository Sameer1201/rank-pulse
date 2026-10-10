import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { AiHint } from "@/components/student/AiHint";
import { Textarea } from "@/components/ui/textarea";

export default function SuperAdminAiHints() {
  const [question, setQuestion] = useState("");
  const [rawOptions, setRawOptions] = useState("");
  const options = rawOptions.split("\n").map((option) => option.trim()).filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-600"><Lightbulb className="h-4 w-4" /> Premium learning</div>
        <h1 className="text-2xl font-bold tracking-tight">AI Hint</h1>
        <p className="mt-1 text-sm text-muted-foreground">Preview a short question idea and a formula or concept hint. This tool is available to Super Admin; students need Priority Access.</p>
      </div>
      <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <label className="block space-y-2 text-sm font-medium">
          <span>Question</span>
          <Textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Paste a question…" rows={6} maxLength={5000} />
        </label>
        <label className="block space-y-2 text-sm font-medium">
          <span>Options (optional, one per line)</span>
          <Textarea value={rawOptions} onChange={(event) => setRawOptions(event.target.value)} placeholder={"Option A\nOption B\nOption C"} rows={4} />
        </label>
        {question.trim() ? <AiHint key={`${question}\n${rawOptions}`} question={question.trim()} options={options} source="question-bank" /> : <p className="text-sm text-muted-foreground">Enter a question to enable the AI Hint button.</p>}
      </section>
    </div>
  );
}
