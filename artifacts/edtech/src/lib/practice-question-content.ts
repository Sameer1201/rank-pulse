import { looksLikeRichHtmlContent } from "@/lib/richContent";

// PDF/Word imports often put a newline in the middle of a sentence at the
// source page's width. Reflow only recognizable prose continuations; lists,
// equations, blank-line paragraphs and semantic HTML remain separate.
function isProseContinuation(before: string, after: string) {
  const line = before.trim().split(/\n/).at(-1) ?? "";
  return line.length >= 35 && (line.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= 6
    && /[A-Za-z0-9µμ,)\]]$/.test(line) && /^[a-z]/.test(after.trimStart())
    && !/^(?:[a-z][.)]|[ivx]+[.)])\s/i.test(after.trimStart())
    && !/^[A-Za-z](?:[_^]\{?\w+\}?)?\s*[=<>]/.test(after.trimStart());
}

export function reflowPracticeQuestion(content: string): string {
  if (!looksLikeRichHtmlContent(content)) {
    return content.replace(/([^\n]+)\n(?=[^\n])/g, (match, before: string, offset: number) =>
      isProseContinuation(before, content.slice(offset + match.length)) ? `${before} ` : match);
  }
  if (typeof DOMParser === "undefined") return content;
  const document = new DOMParser().parseFromString(content, "text/html");
  const protectedLayout = "table, ul, ol, pre, code, figure, svg, math, .katex, .katex-display";
  // Empty source spacers are not question content. Do not touch layout inside
  // figures, lists, tables or math (including hidden semantic KaTeX markup).
  for (const node of Array.from(document.body.querySelectorAll("p, div"))) {
    if (node.closest(protectedLayout) || node.querySelector("img, svg, math, .katex, table, hr")) continue;
    if (!node.textContent?.trim() && node.querySelector("br")) node.remove();
  }
  for (const br of Array.from(document.body.querySelectorAll("br"))) {
    if (br.closest(protectedLayout)) continue;
    const block = br.closest("p, div") ?? document.body;
    const before = document.createRange(); before.selectNodeContents(block); before.setEndBefore(br);
    const after = document.createRange(); after.selectNodeContents(block); after.setStartAfter(br);
    if (isProseContinuation(before.toString(), after.toString())) br.replaceWith(document.createTextNode(" "));
  }
  for (const node of Array.from(document.body.querySelectorAll("p"))) {
    if (!node.isConnected || node.closest(protectedLayout)) continue;
    for (let next = node.nextElementSibling; next?.tagName === "P"; next = node.nextElementSibling) {
      if (next.closest(protectedLayout) || node.querySelector("img, svg, table, .katex-display") || next.querySelector("img, svg, table, .katex-display")) break;
      if (!isProseContinuation(node.textContent ?? "", next.textContent ?? "")) break;
      node.append(document.createTextNode(" "), ...Array.from(next.childNodes)); next.remove();
    }
  }
  return document.body.innerHTML;
}
