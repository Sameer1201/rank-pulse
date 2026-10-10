import { looksLikeRichHtmlContent, sanitizeRichHtml, stripRichHtmlToText } from "@/lib/richContent";

/**
 * Some legacy imports lost the original option HTML while keeping a copy of
 * the source answer table inside the question body. Prefer that copy when it
 * contains real math markup (KaTeX/SVG/MathML), so radicals and inverse
 * trigonometric notation can be displayed without importing the subject again.
 */
export function getPyqDisplayOptions(question: string | null | undefined, options: string[]) {
  if (!question || options.length < 2 || !looksLikeRichHtmlContent(question) || typeof DOMParser === "undefined") return options;
  const doc = new DOMParser().parseFromString(question, "text/html");
  // Older HTML sometimes lost the surrounding table tags during import, but
  // retained the four `.option_data` blocks themselves.
  const sourceOptions = Array.from(doc.querySelectorAll(".option_data"));
  const uniqueSourceOptions = sourceOptions.filter((node, index, all) => all.indexOf(node) === index);
  if (uniqueSourceOptions.length !== options.length) return options;
  const rendered = uniqueSourceOptions.map((node) => sanitizeRichHtml((node as HTMLElement).innerHTML));
  const hasRecoverableMath = rendered.some((value) => /class=["'][^"']*katex|<svg\b|<math\b/i.test(value));
  return hasRecoverableMath && rendered.every(Boolean) ? rendered : options;
}

/**
 * Older PYQ imports sometimes stored the answer choices inside the question
 * text as well as in options_json. Keep those legacy rows readable without
 * changing the source data; new imports are already normalized by the parser.
 */
export function stripRepeatedPyqOptions(question: string | null | undefined, options: string[]) {
  if (!question || options.length < 2) return question ?? "";
  if (looksLikeRichHtmlContent(question)) {
    // Remove only a duplicated option table. Flattening the entire question
    // destroys KaTeX fractions, subscripts, powers and inline figures.
    const doc = new DOMParser().parseFromString(question, "text/html");
    const sourceRoot = doc.body.firstElementChild;
    if (doc.body.children.length === 1 && sourceRoot?.classList.contains("rich-source-content") && !sourceRoot.querySelector(".option_data, .answer_table")) return question;
    const optionTexts = options.map(stripRichHtmlToText);
    const embeddedOptions = Array.from(doc.querySelectorAll(".option_data"));
    if (embeddedOptions.length === options.length) {
      const embeddedHtml = embeddedOptions.map((node) => (node as HTMLElement).innerHTML);
      const hasRichSource = embeddedHtml.some((value) => /class=["'][^"']*katex|<svg\b|<math\b/i.test(value));
      if (hasRichSource) {
        embeddedOptions.forEach((node) => {
          // If the parser retained a row/cell, remove the whole source row;
          // malformed legacy markup can leave `.option_data` directly under
          // body, in which case removing the block itself is sufficient.
          (node.closest("tr, td, li") ?? node).remove();
        });
        doc.querySelectorAll(".pp-option-letter").forEach((label) => label.remove());
        doc.querySelectorAll("table").forEach((table) => {
          if (!(table.textContent || "").trim() && !table.querySelector("img, .katex, svg, math")) table.remove();
        });
      }
    }
    doc.querySelectorAll("table").forEach((table) => {
      const text = (table.textContent || "").replace(/[\s\u200b]+/g, "");
      if (optionTexts.every((option) => option && text.includes(option.replace(/[\s\u200b]+/g, "")))) table.remove();
    });

    // Some source pages place the answer labels in loose div/span nodes
    // instead of an answer table. Remove a trailing A/B/C/D block while
    // leaving the question image and all preceding explanation intact.
    const answerText = optionTexts.map((option, index) =>
      `${String.fromCharCode(65 + index)}\\.?\\s*${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ).join("\\s*");
    const marker = new RegExp(answerText, "i");
    const rawText = doc.body.textContent || "";
    const match = rawText.match(marker);
    if (match?.index != null) {
      const start = match.index;
      const end = start + match[0].length;
      const walker = doc.createTreeWalker(doc.body, 4);
      const nodes: Text[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
      let offset = 0;
      for (const node of nodes) {
        const next = offset + node.data.length;
        const from = Math.max(0, start - offset);
        const to = Math.min(node.data.length, end - offset);
        if (to > from) node.data = node.data.slice(0, from) + node.data.slice(to);
        offset = next;
        if (offset >= end) break;
      }
    }
    return doc.body.innerHTML;
  }
  const questionText = stripRichHtmlToText(question).replace(/\s+/g, " ").trim();
  const optionTexts = options.map((option) => stripRichHtmlToText(option).replace(/\s+/g, " ").trim());
  if (!questionText || optionTexts.some((option) => !option)) return question;

  let cursor = 0;
  let firstOptionIndex = -1;
  let matched = 0;
  for (let index = 0; index < optionTexts.length; index += 1) {
    const marker = `${String.fromCharCode(65 + index)}.`;
    const markerIndex = questionText.indexOf(marker, cursor);
    if (markerIndex < 0) break;
    const afterMarker = questionText.slice(markerIndex + marker.length).trimStart();
    if (!afterMarker.includes(optionTexts[index])) break;
    if (firstOptionIndex < 0) firstOptionIndex = markerIndex;
    cursor = markerIndex + marker.length + afterMarker.indexOf(optionTexts[index]) + optionTexts[index].length;
    matched += 1;
  }

  return matched >= 2 && firstOptionIndex > 0 ? questionText.slice(0, firstOptionIndex).trim() : question;
}
