// Manual layout regression fixture: open /tests/rich-content-preview.html with Vite.
import React from "react";
import { createRoot } from "react-dom/client";
import { RichQuestionContent } from "../src/components/ui/rich-question-content";
import "../src/index.css";

const text = `<p>A 2.5 × 10<sup>−4</sup> M solution of a complex has an absorption maximum at 625 nm and an absorbance of 0.90 in a 1.5 cm cuvette. Calculate the absorbance for another concentration.</p><p>${'LongUnbrokenText'.repeat(12)}</p>`;
const table = `<table><tr>${['C₂ᵥ','E','C₂','σᵥ(xz)','σᵥ(yz)','Linear','Quadratic'].map(x=>`<th>${x}</th>`).join('')}</tr><tr>${['A₁','1','1','1','1','z','x², y², z²'].map(x=>`<td>${x}</td>`).join('')}</tr></table>`;
const cell = String.raw`For the cell \(\mathrm{Ag(s)|AgCl(satd),NaCl(aq,m_1)|NaCl(aq,m_2),AgCl(satd)|Ag(s)}\), where \(m_1 > m_2\), the standard cell potential is:`;
const splitCell = String.raw`For the cell \(\mathrm{Ag(s)}|\mathrm{AgCl(satd)},\mathrm{NaCl(aq,}m_1)|\mathrm{NaCl(aq,}m_2),\mathrm{AgCl(satd)}|\mathrm{Ag(s)}\), where \(m_1 > m_2\), the standard cell potential is:`;
createRoot(document.getElementById("root")!).render(<main className="flex flex-wrap gap-8 p-4">{[288, 343].map(width => <section key={width} data-layout-fixture style={{ width, maxWidth: "100%" }} className="rounded-xl border bg-card p-3"><h1 className="mb-4 font-bold">Mobile content ({width}px)</h1><RichQuestionContent content={cell} className="text-base leading-7" /><RichQuestionContent content={splitCell} className="mt-6 text-base leading-7" /><RichQuestionContent content={String.raw`\(-RT\ln(m_1/m_2)\) and \(\frac{a_1+b_2}{c_3+d_4}\)`} className="mt-6" /><RichQuestionContent content={text} /><RichQuestionContent content={table}/></section>)}</main>);
