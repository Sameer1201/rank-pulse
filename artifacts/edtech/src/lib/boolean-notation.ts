/** Convert source-only overline styling to a safe semantic marker before
 * field cloning/sanitization discards the source stylesheet. No CSS is run. */
export function preserveBooleanBars(root: Document | Element) {
  // Some standalone exports replace MathML movers at runtime with a CSS-only
  // mrow. Recover that explicit semantic class before sanitation removes it.
  const mathNamespace = "http://www.w3.org/1998/Math/MathML";
  for (const bar of Array.from(root.querySelectorAll("math .boolean-overbar")).reverse()) {
    const doc = bar.ownerDocument;
    const mover = doc.createElementNS(mathNamespace, "mover");
    const base = doc.createElementNS(mathNamespace, "mrow");
    while (bar.firstChild) base.appendChild(bar.firstChild);
    const line = doc.createElementNS(mathNamespace, "mo");
    line.textContent = "¯";
    mover.append(base, line);
    bar.replaceWith(mover);
  }
  for (const mover of root.querySelectorAll("math mover")) {
    const line = mover.lastElementChild;
    if (mover.children.length !== 2 || line?.localName !== "mo"
      || !/^[¯ˉ‾̅―—]+$/.test(line.textContent?.trim() || "")) continue;
    // U+2015 is a text horizontal bar, not a reliable stretchy math accent.
    // Use the standard MathML overbar and explicit accent/stretch semantics.
    if (mover.closest(".katex")) continue;
    mover.setAttribute("accent", "true");
    line.textContent = "¯";
    line.setAttribute("stretchy", "true");
  }
  const mark = (element: Element) => {
    if (!element.closest(".katex, math, script, style")) element.classList.add("boolean-overline");
  };
  for (const element of root.querySelectorAll<HTMLElement>("[style], .overline, .overbar, .over-bar, .bar, .boolean-overline")) {
    if (/\boverline\b/.test(`${element.style?.textDecoration} ${element.style?.textDecorationLine}`)
      || [...element.classList].some(name => /^(?:overline|overbar|over-bar|bar|boolean-overline)$/.test(name))) mark(element);
  }
  for (const sheet of root.querySelectorAll("style")) {
    // Only an explicit overline declaration is interpreted; never retain a
    // source stylesheet, URLs, arbitrary properties or pseudo-element content.
    for (const rule of (sheet.textContent || "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/text-decoration(?:-line)?\s*:[^;}]*\boverline\b/i.test(rule[2])) continue;
      for (const selector of rule[1].split(",")) {
        try { root.querySelectorAll(selector.trim()).forEach(mark); } catch { /* unsupported source selector */ }
      }
    }
  }
}

/** Balanced groups matter: a whole-function bar can contain another bar. */
export function booleanTexRanges(text: string): { index: number; value: string }[] {
  const ranges: { index: number; value: string }[] = [];
  const commands = /\\(?:overline|bar)\s*|\\(?:oplus|otimes|neg|lnot)\b/g;
  for (let match; (match = commands.exec(text));) {
    let end = commands.lastIndex;
    if (/^\\(?:bar|overline)/.test(match[0])) {
      if (text[end] === "{") {
        let depth = 1;
        for (end++; end < text.length && depth; end++) {
          if (text[end - 1] === "\\") continue;
          if (text[end] === "{") depth++;
          if (text[end] === "}") depth--;
        }
        if (depth) continue;
      } else if (/[A-Za-z0-9]/.test(text[end] || "")) end++;
      else continue;
    }
    ranges.push({ index: match.index, value: text.slice(match.index, end) });
    commands.lastIndex = end;
  }
  return ranges;
}
