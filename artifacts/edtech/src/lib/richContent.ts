import katex from "katex";
import { booleanTexRanges, preserveBooleanBars } from "@/lib/boolean-notation";

function isSafeImageSource(src: string) {
  const normalized = src.trim().toLowerCase();
  if (!normalized || normalized.startsWith("javascript:") || normalized.startsWith("vbscript:") || normalized.startsWith("data:text")) return false;
  return (
    normalized.startsWith("data:image/") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("/") ||
    normalized.startsWith("blob:") ||
    !normalized.includes(":")
  );
}

function normalizePlainText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A few older PYQ imports contain the source site's deeply nested span math.
 * The source used nesting and zero-width markers for subscripts and fractions,
 * but the import sanitizer used to discard the visual layout. Recover the
 * small, stable subset of that encoding before the normal sanitizer runs.
 */
function restoreLegacySpanMath(root: HTMLElement) {
  const zeroWidth = /\u200b/g;
  const previousVisibleChar = (node: Node) => {
    let current: Node | null = node;
    while (current?.parentNode) {
      let sibling = current.previousSibling;
      while (sibling) {
        const text = (sibling.textContent || "").replace(zeroWidth, "").trim();
        if (text) return text.slice(-1);
        sibling = sibling.previousSibling;
      }
      current = current.parentNode;
    }
    return "";
  };
  const spans = Array.from(root.querySelectorAll("span")).reverse();
  for (const span of spans) {
    // KaTeX already has the complete semantic and visual layout. Its own
    // zero-width struts must never be interpreted as legacy source markers.
    if (span.closest(".katex, .katex-display, math, .rich-source-content")) continue;
    const visible = (span.textContent || "").replace(zeroWidth, "");
    // The old source encoded inverse functions as two sibling spans, for
    // example `tan` followed by a nested `−1`. Turn the exponent back into a
    // real superscript before the generic span cleanup flattens it.
    const childSpans = Array.from(span.children).filter((child) => child.tagName.toLowerCase() === "span");
    if (childSpans.length >= 2) {
      const functionName = (childSpans[0].textContent || "").replace(zeroWidth, "").trim();
      const inverse = (childSpans[1].textContent || "").replace(zeroWidth, "").trim();
      if (/^(?:arc)?(?:tan|sin|cos|cot|sec|csc|log|ln|sinh|cosh|tanh)$/.test(functionName) && /^[-−+]?\d{1,2}$/.test(inverse)) {
        const superscript = root.ownerDocument.createElement("sup");
        superscript.textContent = inverse;
        childSpans[1].replaceWith(superscript);
      }
    }
    if (
      span.textContent?.includes("\u200b") &&
      /^[A-Za-z0-9+\-−]{1,4}$/.test(visible) &&
      span.parentElement
    ) {
      // The importer used the same zero-width marker for both scripts. In
      // ordinary engineering notation uppercase symbols (`T₁`, `V₂`) are
      // subscripts, while powers after a digit or lowercase variable (`10⁵`,
      // `x³`, `s²`) are superscripts. Preserve that distinction where the
      // surrounding legacy structure still gives us enough context.
      const previous = previousVisibleChar(span);
      const isSuperscript = /[0-9)]/.test(previous) || /[xyzs]/.test(previous);
      const script = root.ownerDocument.createElement(isSuperscript ? "sup" : "sub");
      script.textContent = visible;
      span.replaceWith(script);
      continue;
    }

    const children = Array.from(span.children).filter((child) => child.tagName.toLowerCase() === "span");
    const [denominator, numerator] = children;
    const denominatorText = denominator?.textContent?.replace(zeroWidth, "").trim() || "";
    const numeratorText = numerator?.textContent?.replace(zeroWidth, "").trim() || "";
    if (
      children.length === 2 &&
      denominatorText.length > numeratorText.length &&
      denominatorText.length >= 5 &&
      numeratorText.length > 0 &&
      numeratorText.length <= 16 &&
      /[+=/]/.test(denominatorText) &&
      !/[=+]/.test(numeratorText)
    ) {
      const fraction = root.ownerDocument.createElement("span");
      fraction.className = "math-frac";
      const fractionNumerator = root.ownerDocument.createElement("span");
      fractionNumerator.className = "math-frac-num";
      fractionNumerator.innerHTML = numerator.innerHTML;
      const fractionDenominator = root.ownerDocument.createElement("span");
      fractionDenominator.className = "math-frac-den";
      fractionDenominator.innerHTML = denominator.innerHTML;
      fraction.append(fractionNumerator, fractionDenominator);
      span.replaceChildren(fraction);
    }
  }

  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node as Text);
  textNodes.forEach((node) => {
    if (!node.parentElement?.closest(".katex, .katex-display, math, .rich-source-content")) node.data = node.data.replace(zeroWidth, "");
  });
}

const mathSymbols: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ",
  mu: "μ", pi: "π", sigma: "σ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω",
  leq: "≤", geq: "≥", neq: "≠", pm: "±", times: "×", cdot: "·", infty: "∞",
};

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

/** Convert the plain-text math formats used by imported question banks to readable HTML. */
export function plainTextWithMath(value: string): string {
  if (/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(value)) {
    return value.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g).map((part) => {
      const delimited = /^(?:\$|\\[([])/.test(part);
      if (delimited || /\\(?:frac|sqrt)/.test(part)) {
        const tex = part.replace(/^(?:\$\$|\$|\\[([])|(?:\$\$|\$|\\[)\]])$/g, "");
        return katex.renderToString(tex, { throwOnError: false, trust: false, output: "htmlAndMathml", displayMode: part.startsWith("$$") || part.startsWith("\\[") });
      }
      return booleanTexRanges(part).length ? plainTextWithMath(part) : escapeHtml(part).replace(/\n/g, "<br />");
    }).join("");
  }
  const booleanRanges = booleanTexRanges(value);
  if (booleanRanges.length) {
    let offset = 0;
    let html = "";
    for (const range of booleanRanges) {
      html += plainTextWithMath(value.slice(offset, range.index));
      html += katex.renderToString(range.value, { throwOnError: false, trust: false, output: "htmlAndMathml" });
      offset = range.index + range.value.length;
    }
    return html + plainTextWithMath(value.slice(offset));
  }
  const html = escapeHtml(value)
    .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '<span class="math-frac"><span class="math-frac-num">$1</span><span class="math-frac-den">$2</span></span>')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "√($1)")
    .replace(/\\(?:mathrm|mathbf|mathit|text|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:quad|qquad)/g, " ")
    .replace(/\\[,;:!]/g, " ")
    .replace(/\\([a-zA-Z]+)/g, (_match, name: string) => mathSymbols[name] ?? name)
    .replace(/\^\{([^{}]+)\}/g, "<sup>$1</sup>")
    .replace(/_\{([^{}]+)\}/g, "<sub>$1</sub>")
    .replace(/\^([A-Za-z0-9+\-]+)/g, "<sup>$1</sup>")
    .replace(/_([A-Za-z0-9+\-]+)/g, "<sub>$1</sub>")
    // Common electronics notation is conventionally written as VBE, VCC, IC, etc.
    .replace(/\b([VvIi])([A-Z]{1,3})(?=\s*(?:=|[,:;.]|$))/g, "$1<sub>$2</sub>")
    .replace(/β(?:dc|ac)/gi, (match) => `β<sub>${match.slice(1)}</sub>`)
    .replace(/\n/g, "<br />");
  return html;
}

function renderBareTex(root: HTMLElement) {
  const bareTex = /\^\{[^{}]+\}(?:_\{[^{}]+\})?\s*\\(?:mathrm|mathbf|mathit|text)\{[^{}]+\}(?:\s*,\s*\\(?:quad|qquad))?|\\(?:frac|sqrt)\{[^{}]+\}(?:\{[^{}]+\})?|\^\{[^{}]+\}|_\{[^{}]+\}|\\(?:mathrm|mathbf|mathit|text|operatorname)\{[^{}]+\}|\\(?:quad|qquad|[,;:!])/g;
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest(".katex, math, script, style, pre, code")) continue;
    const booleanRanges = booleanTexRanges(node.data);
    const matches = [
      ...booleanRanges.map(range => ({ index: range.index, 0: range.value })),
      ...[...node.data.matchAll(bareTex)].filter(match => !booleanRanges.some(range => match.index! >= range.index && match.index! < range.index + range.value.length)),
    ].sort((a, b) => a.index! - b.index!);
    if (!matches.length) continue;
    const fragment = root.ownerDocument.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(node.data.slice(offset, match.index));
      const math = root.ownerDocument.createElement("span");
      try {
        math.innerHTML = katex.renderToString(match[0], { throwOnError: false, trust: false, output: "htmlAndMathml" });
        fragment.append(math);
      } catch {
        fragment.append(node.data.slice(match.index!, match.index! + match[0].length));
      }
      offset = match.index! + match[0].length;
    }
    fragment.append(node.data.slice(offset));
    node.replaceWith(fragment);
  }
}

export function stripImageMarkers(value: string | null | undefined) {
  if (!value) return "";
  return normalizePlainText(
    value
      .replace(/\s*\[image\s*\d+\]\s*/gi, " ")
      .replace(/\s{2,}/g, " "),
  );
}

function sanitizeNode(node: Node, insideMath = false) {
  if (node.nodeType === Node.TEXT_NODE) return;

  if (node.nodeType !== Node.ELEMENT_NODE) {
    node.parentNode?.removeChild(node);
    return;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  const isKatex = insideMath || element.classList.contains("katex") || element.classList.contains("katex-display");
  if (["script", "style", "iframe", "object", "embed", "link", "meta"].includes(tagName)) { element.remove(); return; }
  const allowedTags = new Set([
    "p", "div", "span", "br", "img", "strong", "b", "em", "i", "u", "sup", "sub",
    "math", "mrow", "mi", "mo", "mn", "msup", "msub", "msubsup", "mfrac", "mtext", "semantics", "annotation", "msqrt", "mroot", "mover", "munder", "munderover", "mtable", "mtr", "mtd", "mspace", "mpadded", "mstyle", "menclose", "mmultiscripts", "mprescripts", "none",
    "figure", "figcaption", "svg", "path", "circle", "line", "polyline", "rect", "g",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col",
    "ul", "ol", "li", "blockquote", "hr",
  ]);

  if (!allowedTags.has(tagName)) {
    Array.from(element.childNodes).forEach((child) => sanitizeNode(child, isKatex));
    const fragment = element.ownerDocument.createDocumentFragment();
    while (element.firstChild) fragment.appendChild(element.firstChild);
    element.replaceWith(fragment);
    return;
  }

  if (tagName === "img") {
    const lazySrc = element.getAttribute("data-src")
      || element.getAttribute("data-original")
      || element.getAttribute("data-lazy-src")
      || element.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0]
      || "";
    if (!element.getAttribute("src") && lazySrc) element.setAttribute("src", lazySrc);
  }

  Array.from(element.attributes).forEach((attribute) => {
    const attrName = attribute.name.toLowerCase();
    if (isKatex && attrName === "class") {
      const layoutClasses = /^(?:textbb|textfrak|mathboldfrak|textboldfrak|textscr|mathboldsf|textboldsf|mathitsf|textitsf|mainrm|hbox|overline(?:-line)?|underline(?:-line)?|fontsize-ensurer|op-limits|vertical-separator|halfarrow-(?:left|right)|brace-(?:left|center|right)|x-arrow(?:-pad)?|cancel-lap|anglpad|mml-eqn-num|mtr-glue|cd-vert-arrow)$/;
      const classes = attribute.value.split(/\s+/).filter((name) => /^(?:katex-(?:accent|base|display|fix|hdashline|hline|html|inner|mathml|newline|overlay|overline|root|rule|sizing|smash|sout|stretchy|strut|tag|thinbox|underline|vbox|version)|katex(?:-html|-mathml|-display)?|base|strut|pstrut|mord|mop|mbin|mrel|mopen|mclose|mpunct|minner|mspace|mathnormal|mathit|mathrm|mathbf|boldsymbol|mathbb|mathcal|mathfrak|mathscr|mathsf|mathtt|text|textbf|textit|textrm|textsf|texttt|msupsub|vlist(?:-t2?|-r|-s)?|sizing|reset-size\d+|size\d+|mtight|mfrac|frac-line|sqrt|sqrt-sign|root|hide-tail|svg-align|stretchy|delimsizing|delim-size\d+|nulldelimiter|delimcenter|op-symbol|small-op|large-op|mover|munder|accent|accent-body|accent-full|overlay|rule|hline|hdashline|arraycolsep|col-align-[clr]|mtr|mtable|tag|eqn-num|leqno|fleqn|llap|rlap|clap|lap|inner|fix|newline|nobreak|allowbreak|mathchoice|bra|ket|enclosing|cancel-pad|fbox|fcolorbox|boxpad|angl|sout|amsrm|mult|vbox|thinbox|cd-arrow-pad|cd-label-left|cd-label-right)$/.test(name));
      classes.push(...attribute.value.split(/\s+/).filter((name) => layoutClasses.test(name)));
      if (classes.length) element.setAttribute("class", classes.join(" ")); else element.removeAttribute("class");
      return;
    }
    if (isKatex && attrName === "style") {
      const position = element.style.position === "relative" ? "relative" : "";
      const length = /^-?(?:\d*\.)?\d+(?:em|ex|px|pt|%)?$/;
      const safe = Array.from(element.style).map((property) => [property, element.style.getPropertyValue(property)]).filter(([property, value]) => {
        if (/^border(?:-bottom|-top|-left|-right)?-style$/.test(property)) return /^(?:solid|dashed|dotted|none)$/.test(value);
        if (/^(?:margin|padding)$/.test(property)) {
          const parts = value.trim().split(/\s+/);
          return parts.length <= 4 && parts.every((part) => length.test(part));
        }
        return /^(?:height|width|min-width|max-width|top|bottom|left|right|vertical-align|margin(?:-left|-right|-top|-bottom)?|padding(?:-left|-right|-top|-bottom)?|border(?:-bottom|-top|-left|-right)?-width)$/.test(property) && length.test(value);
      });
      element.removeAttribute("style");
      safe.forEach(([property, value]) => element.style.setProperty(property, value));
      if (position) element.style.position = position;
      return;
    }
    if (attrName === "class" && element.classList.contains("boolean-overline")) {
      element.setAttribute("class", "boolean-overline");
      return;
    }
    if (attrName === "class" && attribute.value === "rich-source-content") return;
    if (attrName === "class" && /^(?:math-frac|math-frac-num|math-frac-den)$/.test(attribute.value)) return;
    if (element.namespaceURI === "http://www.w3.org/1998/Math/MathML" && ["display", "mathvariant", "mathsize", "displaystyle", "scriptlevel", "stretchy", "fence", "separator", "accent", "accentunder", "columnalign", "rowspacing", "columnspacing", "linethickness", "encoding"].includes(attrName)) return;
    if (tagName === "img" && (attrName === "src" || attrName === "alt" || attrName === "title")) return;
    if (["svg", "path", "circle", "line", "polyline", "rect", "g"].includes(tagName) && [
      "viewbox", "preserveaspectratio", "width", "height", "d", "cx", "cy", "r", "x", "x1", "x2", "y", "y1", "y2", "points",
      "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "transform",
    ].includes(attrName)) return;
    if ((tagName === "td" || tagName === "th") && (attrName === "colspan" || attrName === "rowspan" || attrName === "scope")) return;
    element.removeAttribute(attribute.name);
  });

  if (tagName === "img") {
    const src = element.getAttribute("src") ?? "";
    if (!isSafeImageSource(src)) {
      element.remove();
      return;
    }
  }

  Array.from(element.childNodes).forEach((child) => sanitizeNode(child, isKatex));

  if (
    !isKatex && (tagName === "p" || tagName === "div" || tagName === "span") &&
    !element.querySelector("img, br, sup, sub, svg, math, .katex") &&
    !normalizePlainText(element.textContent || "")
  ) {
    element.remove();
  }
}

export function looksLikeRichHtmlContent(content: string | null | undefined) {
  if (!content?.trim()) return false;
  return /<img|<\/?(?:p|div|span|br|strong|b|em|i|u|sup|sub|math|mrow|mi|mo|mn|msup|msub|mfrac|figure|table|thead|tbody|tfoot|tr|th|td|svg)\b/i.test(content);
}

export function sanitizeRichHtml(content: string | null | undefined) {
  if (!content?.trim() || typeof DOMParser === "undefined") return "";
  const documentParser = new DOMParser().parseFromString(`<div>${content}</div>`, "text/html");
  const root = documentParser.body.firstElementChild as HTMLElement | null;
  if (!root) return "";
  preserveBooleanBars(root);
  restoreLegacySpanMath(root);
  renderBareTex(root);
  Array.from(root.childNodes).forEach((child) => sanitizeNode(child));
  return root.innerHTML.trim();
}

export function stripRichHtmlToText(content: string | null | undefined) {
  if (!content?.trim()) return "";
  if (!looksLikeRichHtmlContent(content) || typeof DOMParser === "undefined") return stripImageMarkers(content);
  const documentParser = new DOMParser().parseFromString(`<div>${content}</div>`, "text/html");
  const root = documentParser.body.firstElementChild;
  if (!root) return stripImageMarkers(documentParser.body.textContent || "");
  preserveBooleanBars(root);
  const barText = (value: string) => /^[A-Za-z0-9]$/.test(value.trim()) ? `${value.trim()}\u0305` : `¬(${value})`;
  const mathText = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    const element = node as Element;
    const children = Array.from(element.childNodes);
    if (element.tagName?.toLowerCase() === "annotation") return "";
    if (element.tagName?.toLowerCase() === "mover" && /^[¯ˉ‾̅―−-]+$/.test(element.lastElementChild?.textContent?.trim() || "")) {
      return barText(mathText(element.firstElementChild!));
    }
    if (element.tagName?.toLowerCase() === "msub") return `${mathText(children[0])}_${children.slice(1).map(mathText).join("")}`;
    if (element.tagName?.toLowerCase() === "msup") return `${mathText(children[0])}^(${children.slice(1).map(mathText).join("")})`;
    if (element.tagName?.toLowerCase() === "mfrac") return `(${mathText(children[0])})/(${mathText(children[1])})`;
    return children.map(mathText).join("");
  };

  // KaTeX includes both visible HTML and hidden MathML with the original TeX
  // source in an <annotation>. Reading the whole node's textContent leaks that
  // source into list previews and repeats every equation. Keep only the visible
  // rendering when converting rich question HTML to a short text preview.
  for (const math of Array.from(root.querySelectorAll(".katex"))) {
    const semantic = math.querySelector("math");
    const rendered = semantic?.querySelector("mover") ? mathText(semantic) : math.querySelector(".katex-html")?.textContent;
    if (rendered != null) math.replaceWith(documentParser.createTextNode(rendered));
  }
  for (const math of Array.from(root.querySelectorAll("math"))) {
    if (math.querySelector("mover")) math.replaceWith(documentParser.createTextNode(mathText(math)));
  }
  for (const bar of Array.from(root.querySelectorAll(".boolean-overline")).reverse()) {
    bar.replaceWith(documentParser.createTextNode(barText(bar.textContent || "")));
  }
  root.querySelectorAll("annotation").forEach((annotation) => annotation.remove());
  return stripImageMarkers(root.textContent || "");
}
