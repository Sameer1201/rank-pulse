import React from "react";
import { createRoot } from "react-dom/client";
import { RichQuestionContent } from "../src/components/ui/rich-question-content";
import "../src/index.css";

const options = [String.raw`\overline{A}B+C\overline{D}+B\overline{C}`, String.raw`A\overline{B}+\overline{C}D+\overline{B}C`, String.raw`A\overline{B}+C\overline{D}+BC`, "AB+BC+CD"];
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-4xl p-8 text-xl">
  <h1 className="mb-6">Boolean overbar regression — original Q23</h1>
  <RichQuestionContent content={String.raw`The complement of \[F=(A+\overline{B})(\overline{C}+D)(\overline{B}+C)\] is`} />
  {options.map((option,i)=><div key={option} className="my-5 flex gap-5 rounded-xl border bg-card p-5"><b>{"ABCD"[i]}</b><RichQuestionContent content={`\\(${option}\\)`}/></div>)}
  <RichQuestionContent content={String.raw`Whole/nested bars: \(\overline{A+\overline{B}}\oplus C\)`} />
</main>);
