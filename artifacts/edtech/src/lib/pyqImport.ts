import { plainTextWithMath, sanitizeRichHtml, stripRichHtmlToText } from "@/lib/richContent";
import katex from "katex";
import { preserveBooleanBars } from "@/lib/boolean-notation";

function normalizeImportedTex(tex: string) {
  // A few HTML exports turn the `\frac` backslash into a form-feed control
  // character when the equation is embedded in ordinary prose. Recover the
  // intended command before strict KaTeX parsing sees it.
  return tex.replace(/\u000Crac/g, "\\frac");
}

export type ParsedPyqQuestion = {
  chapter: string;
  chapterOrder: number;
  questionNumber: number;
  marks: string | null;
  year: number;
  paper: string | null;
  question: string;
  questionType: "mcq" | "multi" | "integer";
  options: string[];
  correctAnswer: number | null;
  correctAnswers: number[];
  answerText: string | null;
  answerMin: number | null;
  answerMax: number | null;
  explanation: string | null;
  sourceUrl: string | null;
  imageData: string | null;
};

export type ParsedPyqImport = {
  exam: string;
  subject: string;
  sourceName: string;
  questions: ParsedPyqQuestion[];
};

function richContent(element: Element | null) {
  if (!element) return "";
  const clone = element.cloneNode(true) as Element;
  if (clone.querySelector(".katex-error")) throw new Error("The source contains an invalid equation. Correct it in the original HTML before importing.");
  // Explicit source notation is authoritative. Do not run the legacy span
  // guesses on new imports, either now or when the saved HTML is rendered.
  const renderTex = (tex: string, displayMode: boolean) => katex.renderToString(normalizeImportedTex(tex), {
    throwOnError: true, trust: false, output: "htmlAndMathml", displayMode,
    maxExpand: 1000,
  });
  // The edited PYQ HTML uses these source-only wrappers to make equations
  // look right in the standalone document. If they are sanitized as-is, the
  // visual fraction markup is flattened into text (for example `1/2` becomes
  // `12`). Convert the authoritative TeX data before sanitizing the clone so
  // the imported preview and the persisted rich content keep real math.
  const sourceMath = Array.from(clone.querySelectorAll<HTMLElement>(
    ".tex-inline[data-tex-source], .tex-block[data-tex-source], .math-html[data-tex], .math-shell[data-tex]",
  ));
  for (const sourceSpan of sourceMath) {
    if (sourceSpan.closest(".katex, .katex-display, math")) continue;
    const tex = sourceSpan.getAttribute("data-tex-source") ?? sourceSpan.getAttribute("data-tex") ?? "";
    if (!tex.trim()) continue;
    try {
      const replacement = clone.ownerDocument.createElement("span");
      replacement.innerHTML = renderTex(tex, sourceSpan.classList.contains("tex-block") || Boolean(sourceSpan.querySelector('math[display="block"]')));
      sourceSpan.replaceWith(replacement);
    } catch {
      // Keep the original source node for the tolerant legacy cleanup if an
      // individual export contains unsupported TeX; one bad marker should
      // not make the whole subject impossible to import.
    }
  }
  for (const script of Array.from(clone.querySelectorAll('script[type^="math/tex"]'))) {
    const replacement = clone.ownerDocument.createElement("span");
    replacement.innerHTML = renderTex(script.textContent || "", /mode\s*=\s*display/.test(script.getAttribute("type") || ""));
    script.replaceWith(replacement);
  }
  // Some exports use explicit CSS scripts rather than <sub>/<sup> tags.
  clone.querySelectorAll<HTMLElement>("span[style]").forEach((span) => {
    if (span.closest(".katex, math")) return;
    const align = span.style.verticalAlign;
    if (align !== "sub" && align !== "super") return;
    const script = clone.ownerDocument.createElement(align === "sub" ? "sub" : "sup");
    script.innerHTML = span.innerHTML;
    span.replaceWith(script);
  });
  // TeX in prose needs typesetting before sanitation; never process text
  // inside already-rendered equations or execute any source-page scripts.
  const walker = clone.ownerDocument.createTreeWalker(clone, 4);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const delimiters = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;
  for (const node of nodes) {
    if (node.parentElement?.closest(".katex, math, script, style, pre, code")) continue;
    const matches = [...node.data.matchAll(delimiters)];
    if (!matches.length) continue;
    const fragment = clone.ownerDocument.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(node.data.slice(offset, match.index));
      const math = clone.ownerDocument.createElement("span");
      math.innerHTML = renderTex(match[1] ?? match[2] ?? match[3] ?? match[4], match[1] != null || match[2] != null);
      fragment.append(math);
      offset = match.index! + match[0].length;
    }
    fragment.append(node.data.slice(offset));
    node.replaceWith(fragment);
  }
  const html = sanitizeRichHtml(`<div class="rich-source-content">${clone.innerHTML}</div>`);
  const cleaned = new DOMParser().parseFromString(html, "text/html").body;
  return cleaned.textContent?.trim() || cleaned.querySelector("img, svg, math") ? html : "";
}

function textContent(element: Element | null) {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
}

function extractYear(value: string | null | undefined) {
  const match = value?.match(/\b(?:19|20|21)\d{2}\b/);
  return match ? Number(match[0]) : 0;
}

/** Preserve matching columns after the source page's CSS is removed. */
function preserveMatchingLayout(root: Element) {
  root.querySelectorAll(".match, .match-table").forEach((match) => {
    const items = Array.from(match.children).filter((item) => Boolean(textContent(item)));
    if (items.length < 2) return;

    const table = match.ownerDocument.createElement("table");
    table.className = "match-layout";
    const body = match.ownerDocument.createElement("tbody");
    for (let index = 0; index < items.length; index += 2) {
      const row = match.ownerDocument.createElement("tr");
      const left = match.ownerDocument.createElement("td");
      const right = match.ownerDocument.createElement("td");
      left.style.width = "50%";
      right.style.width = "50%";
      left.append(items[index].cloneNode(true));
      if (items[index + 1]) right.append(items[index + 1].cloneNode(true));
      row.append(left, right);
      body.append(row);
    }
    table.append(body);
    match.replaceWith(table);
  });
}

function removeQuestionMetadata(root: Element) {
  // Edited PYQ exports use `.year` for the inline `[GATE 2000]` label.
  // It belongs in the metadata field, never in the question body.
  root.querySelectorAll(".year, .qyear, .gate-year, .year-tag, .gate-tag, .yearline, .gate").forEach((node) => node.remove());

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const trailingMetadata = /\s*(?:\[(?:GATE|IIT\s+JAM|JAM|NET|JEE|NEET|CUET)\s+\d{4}\]|(?:GATE|IIT\s+JAM|JAM|NET|JEE|NEET|CUET)\s*\d{4}\s*(?:MCQ|MSQ|NAT|INTEGER)?|(?:MCQ|MSQ|NAT|INTEGER))\s*$/i;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    let cleaned = node.data;
    let previous = "";
    // A few exports append both `[GATE 2004]` and `GATE 2004` as separate
    // nodes. Strip all trailing copies, not just the first one encountered.
    while (cleaned !== previous) {
      previous = cleaned;
      cleaned = cleaned.replace(trailingMetadata, "");
    }
    if (cleaned !== node.data) {
      node.data = cleaned;
    }
  }
}

function numberFrom(value: string | null | undefined, fallback: number) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeQuestionType(value: string | null | undefined): ParsedPyqQuestion["questionType"] {
  const type = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (type === "NAT" || type === "INTEGER" || type === "NUMERICAL") return "integer";
  if (type === "MSQ" || type === "MCQ_MULTI" || type === "MULTI" || type === "MULTIPLE") return "multi";
  return "mcq";
}

function numericAnswerBounds(answer: string | null | undefined) {
  const value = stripRichHtmlToText(answer).replace(/\u2212/g, "-")
    .replace(/^[✓\s]*(?:(?:correct|published|official)\s+answer|answer\s+key|accepted\s+range|answer|ans\.?|range)\s*:\s*/i, "").trim();
  const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
  const range = value.match(new RegExp(`^(${number})\\s*(?:to|[-–—])\\s*(${number})$`, "i"));
  const exact = value.match(new RegExp(`^(${number})$`, "i"));
  const min = range ? Number(range[1]) : exact ? Number(exact[1]) : null;
  const max = range ? Number(range[2]) : exact ? Number(exact[1]) : null;
  return { min, max };
}

function importedQuestionType(explicit: string | null | undefined, hasOptions: boolean, answer: string | null | undefined, answerCount = 0): ParsedPyqQuestion["questionType"] {
  // A numerical answer (e.g. 2) is not the option index C. Explicit source
  // types remain authoritative even when an export omits option text.
  if (explicit?.trim()) return normalizeQuestionType(explicit);
  if (!hasOptions && numericAnswerBounds(answer).min !== null) return "integer";
  return answerCount > 1 ? "multi" : "mcq";
}

// Only choice-based answer-key exports need placeholders. NAT questions
// keep their numerical answer and never receive artificial A/B/C/D choices.
function clickOnlyOptions() {
  return ["", "", "", ""];
}

const clickOptionLabels = ["A", "B", "C", "D"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function embeddedString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

// Source exports use labels such as "Not stated" when the official year is
// unavailable. Keep that information without inventing a year.
function embeddedYear(value: unknown) {
  const parsed = Number(embeddedString(value));
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200 ? parsed : 0;
}

function embeddedImage(document: Document, value: unknown) {
  let src = "";
  let mime = "image/png";
  if (typeof value === "string" && value.trim()) {
    src = value.trim();
  } else if (isRecord(value)) {
    const b64 = embeddedString(value.b64 ?? value.base64 ?? value.data);
    mime = embeddedString(value.mime ?? value.mimeType) || mime;
    if (b64) src = b64.startsWith("data:") ? b64 : `data:${mime};base64,${b64}`;
  }
  if (!src || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(src)) return null;
  const image = document.createElement("img");
  image.setAttribute("src", src);
  image.setAttribute("alt", "Question figure");
  return image;
}

function embeddedRichContent(document: Document, value: unknown, imageValue?: unknown) {
  const wrapper = document.createElement("div");
  wrapper.textContent = embeddedString(value);
  const image = embeddedImage(document, imageValue);
  if (image) {
    wrapper.append(document.createElement("br"), image);
  }
  try {
    return richContent(wrapper);
  } catch {
    // Hybrid exports sometimes contain valid-looking TeX such as a bare
    // superscript isotope (`^{204}`), which strict KaTeX rejects. Keep the
    // question importable and let the existing tolerant renderer display the
    // math as readable text instead of dropping the whole subject.
    const fallback = plainTextWithMath(embeddedString(value));
    return sanitizeRichHtml(`${fallback}${image?.outerHTML ?? ""}`);
  }
}

function embeddedAnswerIndexes(value: unknown, labels: string[]) {
  const rawValues = Array.isArray(value) ? value : embeddedString(value).split(/[\s,;/|]+/).filter(Boolean);
  return rawValues.map((raw) => {
    const text = embeddedString(raw).toUpperCase().replace(/[().]/g, "");
    const byLabel = labels.findIndex((label) => label.toUpperCase() === text);
    if (byLabel >= 0) return byLabel;
    const numeric = Number(text);
    if (!Number.isInteger(numeric)) return -1;
    return numeric >= 0 && numeric < labels.length ? numeric : numeric - 1;
  }).filter((index, position, values) => index >= 0 && index < labels.length && values.indexOf(index) === position);
}

function parseEmbeddedPyqData(document: Document, raw: string, sourceName: string): ParsedPyqImport {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("The HTML contains an embedded data block, but it is not valid JSON.");
  }
  if (!Array.isArray(data) || data.length === 0 || !data.every(isRecord)) {
    throw new Error("The embedded PYQ data block does not contain a question list.");
  }

  const first = data[0];
  const subject = embeddedString(first.subject) || "Untitled Subject";
  const exam = embeddedString(first.exam)
    || document.querySelector('meta[name="exam"]')?.getAttribute("content")?.trim()
    || document.title.match(/\b(GATE|JAM|IIT\s+JAM|JEE|NEET|CUET)\b/i)?.[1]
    || "GATE ECE";
  const chapterOrders = new Map<string, number>();
  const questions = data.map((item, index) => {
    const chapter = embeddedString(item.chapter) || "General";
    if (!chapterOrders.has(chapter)) chapterOrders.set(chapter, chapterOrders.size);
    const optionsData = Array.isArray(item.options) ? item.options : [];
    const sourceOptions = optionsData.map((option) => isRecord(option)
      ? embeddedRichContent(document, option.text, option.image)
      : embeddedRichContent(document, option)).filter(Boolean);
    const hasSourceOptions = sourceOptions.length > 0;
    const answerRaw = item.answer;
    const questionType = importedQuestionType(embeddedString(item.question_type ?? item.questionType ?? item.type), hasSourceOptions, embeddedString(answerRaw));
    const options = questionType === "integer" ? [] : hasSourceOptions ? sourceOptions : clickOnlyOptions();
    const optionLabels = hasSourceOptions
      ? optionsData.map((option, optionIndex) => isRecord(option) && embeddedString(option.label) || String.fromCharCode(65 + optionIndex))
      : clickOptionLabels;
    const correctAnswers = questionType === "mcq" || questionType === "multi"
      ? embeddedAnswerIndexes(answerRaw, optionLabels).filter((answer) => hasSourceOptions || /\b[A-D]\b/i.test(embeddedString(answerRaw)))
      : [];
    const answerText = embeddedString(answerRaw) || null;
    const bounds = numericAnswerBounds(answerText);
    return {
      chapter,
      chapterOrder: chapterOrders.get(chapter) ?? 0,
      questionNumber: Number.isInteger(Number(item.question_number)) ? Number(item.question_number) : index + 1,
      marks: embeddedString(item.marks) || null,
      year: embeddedYear(item.year),
      paper: embeddedString(item.paper) || (embeddedString(item.source_pages) ? `PDF p.${embeddedString(item.source_pages)}` : null),
      question: embeddedRichContent(document, item.stem ?? item.question, item.stem_image),
      questionType,
      options,
      correctAnswer: correctAnswers[0] ?? null,
      correctAnswers,
      answerText,
      answerMin: bounds.min,
      answerMax: bounds.max,
      explanation: embeddedRichContent(document, item.solution_text ?? item.explanation, item.solution_image) || null,
      sourceUrl: embeddedString(item.source_url) || null,
      imageData: null,
    } satisfies ParsedPyqQuestion;
  });

  questions.forEach((question, index) => {
    if (!question.question) throw new Error(`Question ${index + 1}: Question content is missing.`);
    for (const [field, limit] of [["question", 2_000_000], ["explanation", 2_000_000], ["answerText", 4000]] as const) {
      if ((question[field]?.length ?? 0) > limit) throw new Error(`Question ${index + 1}: ${field} is too large to import intact.`);
    }
  });
  return { exam, subject, sourceName, questions };
}

function parseQCardPyqImport(document: Document, sourceName: string): ParsedPyqImport {
  const cards = Array.from(document.querySelectorAll("article.q-card"));
  if (!cards.length) throw new Error("No q-card elements found in this HTML file.");

  const firstCard = cards[0];
  const subject = firstCard.getAttribute("data-subject")?.trim()
    || document.querySelector('meta[name="subject"]')?.getAttribute("content")?.trim()
    || textContent(document.querySelector("h1"))
    || "Untitled Subject";
  const title = document.title.trim();
  const exam = firstCard.getAttribute("data-exam")?.trim()
    || document.querySelector('meta[name="exam"]')?.getAttribute("content")?.trim()
    || title.match(/\b(GATE|JAM|IIT\s+JAM|NET|JEE|NEET|CUET)\b/i)?.[1]
    || "GATE ECE";
  const chapterOrders = new Map<string, number>();

  const richCardField = (card: Element, selector: string) => {
    const field = card.querySelector(selector)?.cloneNode(true) as Element | null;
    if (!field) return "";
    // Editable source pages keep labels and crop controls beside the actual
    // content. They should never become part of the imported question.
    field.querySelectorAll("summary, .media-top, .image-actions, .figcap, button").forEach((node) => node.remove());
    if (selector.includes(".stem") || selector.includes(".question-content")) {
      preserveMatchingLayout(field);
      removeQuestionMetadata(field);
    }
    return richContent(field);
  };

  const imageSource = (image: Element | null) => {
    const src = image?.getAttribute("src")?.trim() || image?.getAttribute("data-src")?.trim() || "";
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(src) ? src : null;
  };

  const questions = cards.map((card, index) => {
    try {
      const chapter = card.getAttribute("data-chapter")?.trim() || "General";
      if (!chapterOrders.has(chapter)) chapterOrders.set(chapter, chapterOrders.size);
      const chapterOrder = chapterOrders.get(chapter) ?? 0;
      // Newer q-card exports use `.option-pick` rather than the older
      // `.option-row`/`[data-role]` shape. Preserve text choices and figures
      // from both formats.
      const optionRows = Array.from(card.querySelectorAll(".option-pick, .option-row"));
      const sourceOptions = optionRows.map((row) => {
        const option = document.createElement("div");
        const optionText = row.querySelector(".option-text, .option_data, .answer_col")?.cloneNode(true) as Element | null;
        if (optionText) {
          optionText.querySelectorAll(".option-letter, .pp-option-letter, .option-card-head, .image-actions").forEach((node) => node.remove());
          if (textContent(optionText) && !/^image\s+option$/i.test(textContent(optionText))) option.append(optionText);
        }
        const image = row.querySelector(".option-media img, [data-role^=\"option-\"] img, img");
        if (image) option.append(document.createElement("br"), image.cloneNode(true));
        return richContent(option);
      }).filter(Boolean);
      const hasSourceOptions = sourceOptions.length > 0;
      const optionLabels = hasSourceOptions ? optionRows.map((row, optionIndex) =>
        row.getAttribute("data-option")?.trim().toUpperCase()
        || row.querySelector(".option-pick")?.getAttribute("data-value")?.trim().toUpperCase()
        || String.fromCharCode(65 + optionIndex),
      ) : clickOptionLabels;
      const answerRaw = card.getAttribute("data-answer")?.trim()
        || textContent(card.querySelector(".answer-value"));
      const answerText = richCardField(card, ".answer-reveal, .answer.answer-correct, .answer-correct") || answerRaw || null;
      const questionType = importedQuestionType(card.getAttribute("data-type"), hasSourceOptions, answerText);
      const options = questionType === "integer" ? [] : hasSourceOptions ? sourceOptions : clickOnlyOptions();
      const correctAnswers = questionType === "mcq" || questionType === "multi"
      ? embeddedAnswerIndexes(answerRaw, optionLabels).filter((answer) => hasSourceOptions || /\b[A-D]\b/i.test(answerRaw))
      : [];
      const bounds = numericAnswerBounds(answerText);
      const questionNumber = numberFrom(card.getAttribute("data-chapter-qno"), index + 1);
      const paper = Array.from(card.querySelectorAll(".chips span"))
        .map((chip) => textContent(chip))
        .find((value) => /^PDF\s+p\./i.test(value)) || null;
      return {
        chapter,
        chapterOrder,
        questionNumber,
        marks: card.getAttribute("data-marks")?.trim() || null,
        year: extractYear(card.getAttribute("data-year"))
          || extractYear(textContent(card.querySelector(".stem, .question-content"))),
        paper,
        question: richCardField(card, ".stem") || richCardField(card, ".question-content"),
        questionType,
        options,
        correctAnswer: correctAnswers[0] ?? null,
        correctAnswers,
        answerText,
        answerMin: bounds.min,
        answerMax: bounds.max,
        explanation: richCardField(card, ".solution") || null,
        sourceUrl: null,
        imageData: imageSource(card.querySelector(".question-media img, [data-role=\"stem\"] img")),
      } satisfies ParsedPyqQuestion;
    } catch (error) {
      throw new Error(`Question ${index + 1}: ${error instanceof Error ? error.message : "Could not preserve question content"}`);
    }
  });

  questions.forEach((question, index) => {
    if (!question.question) throw new Error(`Question ${index + 1}: Question content is missing.`);
    for (const [field, limit] of [["question", 2_000_000], ["explanation", 2_000_000], ["answerText", 4000]] as const) {
      if ((question[field]?.length ?? 0) > limit) throw new Error(`Question ${index + 1}: ${field} is too large to import intact. Reduce embedded image size in the source HTML.`);
    }
  });
  return { exam, subject, sourceName, questions };
}

function parseEditedQuestionPage(document: Document, sourceName: string): ParsedPyqImport {
  // Edited source pages also contain `.mini-card` blocks for shared data and
  // the answer key. Those are page furniture, not standalone questions. Only
  // the numbered article cards have the question structure we can import.
  const cards = Array.from(document.querySelectorAll("article.qcard"));
  if (!cards.length) throw new Error("No questions found in this edited HTML file.");

  const chips = Array.from(document.querySelectorAll(".meta .chip")).map((chip) => textContent(chip));
  const subject = chips.find((value) => /^subject\s*:/i.test(value))?.replace(/^subject\s*:\s*/i, "").trim()
    || document.querySelector('meta[name="subject"]')?.getAttribute("content")?.trim()
    || textContent(document.querySelector("h1"))
    || "Untitled Subject";
  const chapter = chips.find((value) => /^chapter\s*:/i.test(value))?.replace(/^chapter\s*:\s*/i, "").trim()
    || "General";
  const title = document.title.trim();
  const exam = document.querySelector('meta[name="exam"]')?.getAttribute("content")?.trim()
    || title.match(/\b(GATE|JAM|IIT\s+JAM|NET|JEE|NEET|CUET)\b/i)?.[1]
    || "GATE ECE";
  const chapterOrders = new Map<string, number>();
  chapterOrders.set(chapter, 0);

  const imageSource = (image: Element | null) => {
    const src = image?.getAttribute("src")?.trim() || image?.getAttribute("data-src")?.trim() || "";
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(src) ? src : null;
  };

  const cleanRichClone = (element: Element | null, removeAnswer = false) => {
    if (!element) return "";
    const clone = element.cloneNode(true) as Element;
    clone.querySelectorAll("button, .img-edit-controls, .crop-btn, .figcap, .answer, .ansline").forEach((node) => node.remove());
    if (removeAnswer) clone.querySelectorAll(".solution, .solution-inner").forEach((node) => node.remove());
    preserveMatchingLayout(clone);
    removeQuestionMetadata(clone);
    return richContent(clone);
  };

  const optionData = (card: Element) => {
    const rows = Array.from(card.querySelectorAll(":scope > .opts .opt, .qhead + .opts .opt"));
    const labels = rows.map((row, index) => {
      const label = row.querySelector(":scope > b")?.textContent?.trim().replace(/[().]/g, "");
      return label || String.fromCharCode(65 + index);
    });
    const sourceOptions = rows.map((row) => {
      const clone = row.cloneNode(true) as Element;
      clone.querySelector(":scope > b")?.remove();
      clone.querySelectorAll("button, .img-edit-controls, .crop-btn").forEach((node) => node.remove());
      return richContent(clone);
    }).filter(Boolean);
    const options = sourceOptions;
    if (!rows.length) labels.push(...clickOptionLabels);
    return { labels, options };
  };

  const answerData = (card: Element, labels: string[]) => {
    const answerElement = card.querySelector(":scope > .solution .answer, :scope > .ansline")
      || card.querySelector(".answer, .ansline");
    // Interactive numerical exports store the current key on the card and
    // label the worked solution "Published answer". Do not read the student's
    // .num-answer value (which can contain an attempted answer) as the key.
    const raw = card.getAttribute("data-answer")?.trim() || textContent(answerElement)
      || textContent(card.querySelector(".correct-reveal .correct-number"));
    const value = raw.replace(/^[✓\s]*(?:(?:correct|published|official)\s+answer|answer\s+key|answer)\s*:\s*/i, "").trim();
    const letterValues = value.match(/\b[A-Z]\b/gi) ?? [];
    const correctAnswers = embeddedAnswerIndexes(letterValues.length ? letterValues : value, labels);
    const numericValue = value.match(/^(-?\d+(?:\.\d+)?)$/)?.[1];
    const range = value.match(/^(-?\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*(-?\d+(?:\.\d+)?)$/i);
    return {
      raw,
      value,
      correctAnswers,
      answerMin: range ? Number(range[1]) : numericValue ? Number(numericValue) : null,
      answerMax: range ? Number(range[2]) : numericValue ? Number(numericValue) : null,
    };
  };

  const questions = cards.map((card, index) => {
    try {
      const isMainCard = card.matches("article.qcard");
      const { labels, options: sourceOptions } = optionData(card);
      const answer = answerData(card, labels);
      const explicitType = card.getAttribute("data-type")
        || (card.querySelector(":scope > .numeric-line input.num-answer") ? "NAT" : null);
      const questionType = importedQuestionType(explicitType, sourceOptions.length > 0, answer.value, answer.correctAnswers.length);
      const options = questionType === "integer" ? [] : sourceOptions.length ? sourceOptions : clickOnlyOptions();
      const questionClone = (isMainCard ? card.querySelector(":scope > .qhead .qtext") : card.cloneNode(true)) as Element | null;
      if (!isMainCard && questionClone) {
        questionClone.querySelectorAll(":scope > .opts, :scope > .figure, :scope > .ansline, :scope > .img-edit-controls").forEach((node) => node.remove());
        questionClone.querySelector(":scope > b")?.remove();
      }
      // Only a figure that is a direct child of the question card belongs to
      // the question. A solution can contain its own `.figure` (for example
      // a worked molecular diagram); searching the whole card would copy
      // that answer image into the separate question-image slot as well.
      const questionFigure = Array.from(card.children).find((child) => child.matches(".figure"));
      const figure = questionFigure?.querySelector("img") ?? null;
      const question = cleanRichClone(questionClone);
      const explanationElement = isMainCard
        ? card.querySelector(":scope > .solution .solution-inner, .solution-inner")
        : null;
      let explanation = cleanRichClone(explanationElement);
      if (!options.length && answer.value) {
        const answerHtml = cleanRichClone(card.querySelector(":scope > .ansline, .answer, .ansline"));
        explanation = sanitizeRichHtml(`${explanation}${answerHtml ? `<p><strong>Answer:</strong> ${answerHtml}</p>` : ""}`) || explanation;
      }
      const numberText = textContent(card.querySelector(":scope > .qhead .qnum, :scope > b"));
      const questionNumber = numberFrom(numberText.match(/\d+/)?.[0], index + 1);
      const gateLabel = textContent(card.querySelector(":scope > .qhead .qtext .year, :scope > .qhead .qtext .gate-year, :scope > .qhead .qtext .year-tag, .qtext .year, .qtext .gate-year, .qtext .year-tag, .year, .gate-year, .year-tag, .gate-tag, .gate"));
      const year = extractYear(gateLabel)
        || extractYear(card.getAttribute("data-year"))
        || extractYear(textContent(card.querySelector(":scope > .qhead .qtext")));
      return {
        chapter,
        chapterOrder: chapterOrders.get(chapter) ?? 0,
        questionNumber,
        marks: null,
        year,
        paper: null,
        question,
        questionType,
        options,
        correctAnswer: questionType === "integer" ? null : answer.correctAnswers[0] ?? null,
        correctAnswers: questionType === "integer" ? [] : answer.correctAnswers,
        answerText: answer.value || null,
        answerMin: numericAnswerBounds(answer.value).min,
        answerMax: numericAnswerBounds(answer.value).max,
        explanation: explanation || null,
        sourceUrl: null,
        imageData: imageSource(figure),
      } satisfies ParsedPyqQuestion;
    } catch (error) {
      throw new Error(`Question ${index + 1}: ${error instanceof Error ? error.message : "Could not preserve question content"}`);
    }
  });

  questions.forEach((question, index) => {
    if (!question.question) throw new Error(`Question ${index + 1}: Question content is missing.`);
    for (const [field, limit] of [["question", 2_000_000], ["explanation", 2_000_000], ["answerText", 4000]] as const) {
      if ((question[field]?.length ?? 0) > limit) throw new Error(`Question ${index + 1}: ${field} is too large to import intact. Reduce embedded image size in the source HTML.`);
    }
  });
  return { exam, subject, sourceName, questions };
}

export function parsePyqHtml(source: string, sourceName: string): ParsedPyqImport {
  const document = new DOMParser().parseFromString(source, "text/html");
  preserveBooleanBars(document);
  const embeddedData = document.querySelector("script#data")?.textContent?.trim();
  if (embeddedData) return parseEmbeddedPyqData(document, embeddedData, sourceName);
  if (document.querySelector("article.q-card")) return parseQCardPyqImport(document, sourceName);
  if (document.querySelector("article.qcard, .mini-card")) return parseEditedQuestionPage(document, sourceName);
  const subject = document.querySelector('meta[name="subject"]')?.getAttribute("content")?.trim()
    || textContent(document.querySelector(".subject-header h1"))
    || textContent(document.querySelector("h1"))
    || "Untitled Subject";
  const title = document.title.trim();
  const exam = document.querySelector('meta[name="exam"]')?.getAttribute("content")?.trim()
    || title.split("—")[1]?.trim()
    || title.split("-").slice(1).join("-").trim()
    || "GATE ECE";
  const chapterSections = Array.from(document.querySelectorAll("section.chapter"));
  const sectionOrder = new Map<Element, number>(chapterSections.map((section, index) => [section, index]));
  const cards = Array.from(document.querySelectorAll("article.question-card"));

  const questions = cards.map((card, index) => {
    try {
    const section = card.closest("section.chapter");
    const chapter = card.getAttribute("data-chapter")?.trim()
      || textContent(section?.querySelector(".chapter-header h2, h2") || null)
      || "General";
    const chapterOrder = section ? (sectionOrder.get(section) ?? 0) : 0;
    const questionElement = card.querySelector(".question-content .question_text, .question_text, .question-content");
    const questionContainer = card.querySelector(".question-content") || questionElement;
    const rows = Array.from(card.querySelectorAll(".answer_table tr"));
    const optionRows = rows
      .map((row) => {
        const optionElement = (row.querySelector(".option_data") || row.querySelector(".answer_col"))?.cloneNode(true) as Element | undefined;
        optionElement?.querySelectorAll(".pp-option-letter").forEach((label) => label.remove());
        return { row, option: richContent(optionElement ?? null) };
      })
      .filter(({ option }) => Boolean(option));
    const sourceOptions = optionRows.map(({ option }) => option);
    const hasSourceOptions = sourceOptions.length > 0;
    const sourceCorrectAnswers = optionRows.flatMap(({ row }, rowIndex) => {
      const isCorrect = row.classList.contains("pp-correct-option")
        || row.classList.contains("correct-option")
        || row.getAttribute("data-value") === "1";
      return isCorrect ? [rowIndex] : [];
    }).filter((answer, index, answers) => answers.indexOf(answer) === index);
    const answerElement = card.querySelector(".answer.answer-correct, .answer-correct");
    const answerText = richContent(answerElement) || null;
    const answerPlain = stripRichHtmlToText(answerText);
    const questionType = importedQuestionType(card.getAttribute("data-type"), hasSourceOptions, answerPlain);
    const options = questionType === "integer" ? [] : hasSourceOptions ? sourceOptions : clickOnlyOptions();
    const correctAnswers = questionType === "integer" ? [] : hasSourceOptions
      ? sourceCorrectAnswers
      : embeddedAnswerIndexes(answerPlain, clickOptionLabels).filter((answer) => /\b[A-D]\b/i.test(answerPlain));
    const correctAnswer = correctAnswers[0] ?? null;
    const bounds = numericAnswerBounds(answerPlain);
    const questionNumber = numberFrom(questionElement?.getAttribute("data-value"), index + 1);
    const sourceLink = card.querySelector(".year_sub_chap_link a[href]");
    const questionClone = questionContainer?.cloneNode(true) as Element | undefined;
    // Keep every question figure, including siblings of .question_text, but
    // store choices separately so they cannot appear twice in the student UI.
    questionClone?.querySelectorAll(".answer_table, .question_heading_table, .option_data, .pp-option-letter, .answer-correct, .solution-content").forEach((node) => node.remove());
    const questionRoot = questionClone ?? questionElement;
    if (questionRoot) {
      preserveMatchingLayout(questionRoot);
      removeQuestionMetadata(questionRoot);
    }
    return {
      chapter,
      chapterOrder,
      questionNumber,
      marks: card.getAttribute("data-marks")?.trim() || null,
      year: extractYear(card.getAttribute("data-year"))
        || extractYear(textContent(questionElement)),
      paper: textContent(sourceLink) || null,
      question: richContent(questionRoot),
      questionType,
      options,
      correctAnswer,
      correctAnswers,
      answerText,
      answerMin: bounds.min,
      answerMax: bounds.max,
      explanation: richContent(card.querySelector(".solution-content .mtq_explanation-text, .solution-content")) || null,
      sourceUrl: sourceLink?.getAttribute("href")?.trim() || null,
      imageData: null,
    } satisfies ParsedPyqQuestion;
    } catch (error) {
      throw new Error(`Question ${index + 1}: ${error instanceof Error ? error.message : "Could not preserve question content"}`);
    }
  });

  if (questions.length === 0) throw new Error("No question-card elements found in this HTML file.");
  questions.forEach((question, index) => {
    if (!question.question) throw new Error(`Question ${index + 1}: Question content is missing.`);
    // Reject oversized HTML before the API's text limits can cut an equation
    // or embedded figure in half. The existing subject has not been changed.
    for (const [field, limit] of [["question", 2_000_000], ["explanation", 2_000_000], ["answerText", 4000]] as const) {
      if ((question[field]?.length ?? 0) > limit) throw new Error(`Question ${index + 1}: ${field} is too large to import intact. Reduce embedded image size in the source HTML.`);
    }
  });
  return { exam, subject, sourceName, questions };
}
