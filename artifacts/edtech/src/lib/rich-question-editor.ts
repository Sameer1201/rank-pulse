import { looksLikeRichHtmlContent, plainTextWithMath, sanitizeRichHtml } from "@/lib/richContent";

/** Render text/HTML without flattening images, superscripts or Boolean bars. */
export function richEditorHtml(value: string): string {
  if (!value) return "";
  if (!looksLikeRichHtmlContent(value)) return sanitizeRichHtml(plainTextWithMath(value));
  // Parse in an inert document and sanitize only after delimiter conversion;
  // rendering bare TeX first would leave stray dollars around its math tree.
  const doc = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  const walker = doc.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest(".katex, math, pre, code, script, style")) continue;
    if (!/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(node.data)) continue;
    const template = doc.createElement("template");
    template.innerHTML = plainTextWithMath(node.data);
    node.replaceWith(template.content);
  }
  return sanitizeRichHtml(root.innerHTML);
}

/** Protect rendered math's duplicate visual/MathML trees from ordinary typing. */
export function protectEditorMath(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".katex-display, .katex").forEach((node) => {
    if (!node.parentElement?.closest(".katex-display, .katex")) node.contentEditable = "false";
  });
}

export function serializeRichEditor(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[contenteditable], [data-editor-selected]").forEach((node) => {
    node.removeAttribute("contenteditable");
    node.removeAttribute("data-editor-selected");
  });
  // Browser-only empty paragraphs must not make an unanswered field nonempty.
  if (!clone.textContent?.replace(/\u00a0/g, " ").trim() && !clone.querySelector("img, svg, math, table, hr")) return "";
  return sanitizeRichHtml(clone.innerHTML);
}
