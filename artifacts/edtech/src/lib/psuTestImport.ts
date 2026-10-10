import { sanitizeRichHtml, stripRichHtmlToText } from "@/lib/richContent";

type SourceFormat = "saved-test-html" | "question-card-html";

type ImportedDocumentMetadata = {
  sourceFile: string;
  sourceFormat: SourceFormat;
  documentTitle: string;
  documentLanguage: string | null;
  headerText: string | null;
  declaredQuestionCount: number | null;
  importedQuestionCount: number;
  exam: string | null;
  subject: string | null;
  year: number | null;
  documentMetaTags: Array<{ name: string | null; property: string | null; content: string | null; charset: string | null }>;
};

export type PsuTestBundle = {
  version: number;
  exportedAt: string;
  test: {
    title: string;
    description: string | null;
    examType: string;
    examConfig: Record<string, unknown>;
    durationMinutes: number;
    defaultPositiveMarks: number;
    defaultNegativeMarks: number;
    sections: Array<Record<string, unknown>>;
    questions: Array<Record<string, unknown>>;
    metadata: ImportedDocumentMetadata;
  };
};

function readable(element: Element | null) {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function rich(element: Element | null) {
  if (!element) return "";
  const html = sanitizeRichHtml(element.innerHTML.trim());
  return html || stripRichHtmlToText(element.textContent ?? "");
}

function number(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAnswerIndices(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return [];

  // Saved tests normally contain A/B/C/D. Numeric values are accepted for
  // compatibility with older exports where data-correct was zero-based.
  if (/^-?\d+(?:\s*[,;|/]\s*-?\d+)*$/.test(raw)) {
    return raw
      .split(/\s*[,;|/]\s*/)
      .map((entry) => Number(entry))
      .filter((index) => Number.isInteger(index) && index >= 0);
  }

  const answerPart = raw.includes(":") ? raw.split(":").slice(1).join(":") : raw;
  const matches = answerPart.toUpperCase().match(/\b[A-Z]\b/g) ?? [];
  return matches
    .map((letter) => letter.charCodeAt(0) - 65)
    .filter((index) => index >= 0 && index < 26)
    .filter((index, position, values) => values.indexOf(index) === position);
}

function parseQuestionType(value: string | null | undefined, optionCount: number, answerCount: number) {
  const normalized = (value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized.includes("multi") || normalized.includes("msq") || answerCount > 1) return "multi";
  if (normalized.includes("nat") || normalized.includes("integer") || normalized.includes("numeric") || optionCount === 0) return "integer";
  return "mcq";
}

function parseMarks(value: string | null | undefined, fallback: number) {
  const parsed = Number((value ?? "").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : fallback;
}

function parseNegativeMarks(value: string | null | undefined, fallback: number) {
  const raw = (value ?? "").replace(/−/g, "-");
  const parsed = Number(raw.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : fallback;
}

function titleMetadata(title: string) {
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  const parts = title.split(/\s*[-–—|:]\s*/).map((part) => part.trim()).filter(Boolean);
  const firstPart = parts[0] || "";
  const exam = firstPart.split(/\s+/)[0] || null;
  return {
    exam,
    subject: firstPart.replace(new RegExp(`^${exam}\\s*`, "i"), "").replace(/\b(19|20)\d{2}\b/g, "").trim() || null,
    year,
  };
}

function documentMetadata(document: Document, title: string, fileName: string, sourceFormat: SourceFormat, questionCount: number): ImportedDocumentMetadata {
  const header = document.querySelector(".main-header, header");
  const headerText = readable(header) || null;
  const declaredMatch = headerText?.match(/(\d[\d,]*)\s+questions?/i);
  const inferred = titleMetadata(title);
  const exam = document.querySelector('meta[name="exam"]')?.getAttribute("content")?.trim() || inferred.exam;
  const subject = document.querySelector('meta[name="subject"]')?.getAttribute("content")?.trim() || inferred.subject;
  const year = nullableNumber(document.querySelector('meta[name="year"]')?.getAttribute("content")) ?? inferred.year;
  const documentMetaTags = Array.from(document.querySelectorAll("meta")).map((tag) => ({
    name: tag.getAttribute("name"),
    property: tag.getAttribute("property"),
    content: tag.getAttribute("content"),
    charset: tag.getAttribute("charset"),
  }));

  return {
    sourceFile: fileName,
    sourceFormat,
    documentTitle: title,
    documentLanguage: document.documentElement.getAttribute("lang"),
    headerText,
    declaredQuestionCount: declaredMatch ? Number(declaredMatch[1].replace(/,/g, "")) : null,
    importedQuestionCount: questionCount,
    exam,
    subject,
    year,
    documentMetaTags,
  };
}

function durationMinutes(document: Document) {
  const seconds = Number(document.querySelector("#timerWrap")?.getAttribute("data-duration") ?? 0);
  if (seconds > 0) return Math.max(1, Math.round(seconds / 60));
  const durationText = readable(document.querySelector("[data-duration], .duration, .test-duration"));
  const durationMatch = durationText.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|hours?|hrs?)/i);
  if (!durationMatch) return 180;
  const value = Number(durationMatch[1]);
  return /hours?|hrs?/i.test(durationMatch[0]) ? Math.max(1, Math.round(value * 60)) : Math.max(1, Math.round(value));
}

function firstMetadataValue(cards: Element[], selector: string, fallback: string) {
  for (const card of cards) {
    const value = readable(card.querySelector(selector));
    if (value) return value;
  }
  return fallback;
}

function parseQuestion(card: Element, index: number, fileName: string, sourceFormat: SourceFormat, sectionRef: string, sectionTitle: string) {
  const isQuestionCard = card.matches("article.question-card");
  const tags = readable(card.querySelector(".tags")).split("•").map((item) => item.trim()).filter(Boolean);
  const questionElement = card.querySelector(isQuestionCard ? ".question-body" : ".qtext") || card.querySelector(".question-content, .question_text");
  const optionElements = Array.from(card.querySelectorAll(isQuestionCard ? ".options .option" : "label.opt"));
  const options = optionElements.map((option) => rich(option.querySelector(".option-content") || option.querySelector("div") || option)).filter(Boolean);
  const answerBox = readable(card.querySelector(".answer-box"));
  const answerFromBox = answerBox.match(/(?:correct\s+answer|answer)\s*:\s*(.+)$/i)?.[1] ?? answerBox;
  const correctFromOptions = optionElements.flatMap((option, optionIndex) => option.classList.contains("correct-option") ? [optionIndex] : []);
  const correct = parseAnswerIndices(card.getAttribute("data-correct") || answerFromBox);
  const correctIndices = correct.length ? correct : correctFromOptions;
  const marksRaw = isQuestionCard ? readable(card.querySelector(".meta span:nth-child(1)")) : card.getAttribute("data-right") || "1";
  const negativeMarksRaw = isQuestionCard ? readable(card.querySelector(".meta span:nth-child(2)")) : card.getAttribute("data-wrong") || "0";
  const typeRaw = isQuestionCard ? readable(card.querySelector(".meta span:nth-child(3)")) : card.getAttribute("data-qtype") || "mcq";
  const questionType = parseQuestionType(typeRaw, options.length, correctIndices.length);
  const questionNumberText = isQuestionCard ? readable(card.querySelector(".question-header > div:first-child")) : card.getAttribute("data-qnum");
  const questionNumber = Number(questionNumberText?.match(/\d+/)?.[0] ?? index + 1);
  const sourceIdText = isQuestionCard ? readable(card.querySelector(".qid")) : card.getAttribute("data-id");
  const sourceId = sourceIdText?.match(/[A-Za-z0-9_-]+$/)?.[0] || null;
  const solutionElement = card.querySelector(".solution-content") || card.querySelector("details.solution");
  const questionHtml = rich(questionElement) || "Imported question";
  const solutionHtml = rich(solutionElement) || null;
  const answerPlain = stripRichHtmlToText(answerFromBox);
  const rangeMatch = answerPlain.match(/(-?\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*(-?\d+(?:\.\d+)?)/i);
  const exactMatch = answerPlain.match(/^\s*(-?\d+(?:\.\d+)?)\s*$/);
  const optionText = optionElements.map((option) => stripRichHtmlToText(rich(option.querySelector(".option-content") || option.querySelector("div") || option)));
  const positiveMarks = parseMarks(marksRaw, 1);
  const negativeMarks = parseNegativeMarks(negativeMarksRaw, 0);
  const metaSpans = Array.from(card.querySelectorAll(".meta span")).map((item) => readable(item)).filter(Boolean);

  return {
    question: questionHtml,
    questionType,
    sectionRef,
    subjectLabel: sectionTitle,
    options: questionType === "integer" ? [] : options,
    correctAnswer: questionType === "mcq" ? (correctIndices[0] ?? 0) : undefined,
    correctAnswerMulti: questionType === "multi" ? correctIndices : undefined,
    correctAnswerMin: questionType === "integer" && rangeMatch ? Number(rangeMatch[1]) : questionType === "integer" && exactMatch ? Number(exactMatch[1]) : undefined,
    correctAnswerMax: questionType === "integer" && rangeMatch ? Number(rangeMatch[2]) : questionType === "integer" && exactMatch ? Number(exactMatch[1]) : undefined,
    points: positiveMarks,
    negativeMarks,
    solutionText: solutionHtml,
    order: index,
    meta: {
      sourceFile: fileName,
      sourceFormat,
      importedQuestionNumber: questionNumber,
      sourceQuestionNumber: questionNumber,
      sourceId,
      questionText: stripRichHtmlToText(questionHtml),
      optionTexts: optionText,
      answerText: answerBox || null,
      answerRaw: answerFromBox || null,
      correctAnswerIndices: correctIndices,
      marksRaw: marksRaw || null,
      marks: positiveMarks,
      negativeMarksRaw: negativeMarksRaw || null,
      negativeMarks,
      questionTypeRaw: typeRaw || null,
      metadata: metaSpans,
      cardClass: card.getAttribute("class"),
      cardData: Array.from(card.attributes).reduce<Record<string, string>>((result, attribute) => {
        result[attribute.name] = attribute.value;
        return result;
      }, {}),
      tags,
    },
  } satisfies Record<string, unknown>;
}

export function parsePsuTestHtml(source: string, fileName: string): PsuTestBundle {
  const document = new DOMParser().parseFromString(source, "text/html");
  const questionCards = Array.from(document.querySelectorAll("section.card.qcard, article.question-card"));
  if (!questionCards.length) throw new Error("No test questions found. Please use a saved test HTML file with question cards.");

  const sourceFormat: SourceFormat = questionCards.some((card) => card.matches("article.question-card")) ? "question-card-html" : "saved-test-html";
  const title = readable(document.querySelector(".test-title, .main-header h1, h1, title")) || fileName.replace(/\.html?$/i, "") || "Imported PSU Test";
  const metadata = documentMetadata(document, title, fileName, sourceFormat, questionCards.length);
  const firstCard = questionCards[0];
  const firstMeta = Array.from(firstCard.querySelectorAll(".meta span")).map((item) => readable(item)).filter(Boolean);
  const defaultPositiveMarks = sourceFormat === "question-card-html" ? parseMarks(firstMeta[0], 1) : number(firstCard.getAttribute("data-right"), 1);
  const defaultNegativeMarks = sourceFormat === "question-card-html" ? parseNegativeMarks(firstMeta[1], 0) : number(firstCard.getAttribute("data-wrong"), 0);
  const defaultType = firstMeta[2] || firstCard.getAttribute("data-qtype") || "MCQ";
  const sectionTitle = readable(document.querySelector(".main-header h1, .test-title, h1")) || "PSU PYQ";
  const section = { exportRef: "section-1", title: sectionTitle, subjectLabel: sectionTitle, order: 0, questionCount: questionCards.length, marksPerQuestion: defaultPositiveMarks, negativeMarks: defaultNegativeMarks, meta: { sourceFormat, sourceFile: fileName } };
  const questions = questionCards.map((card, index) => parseQuestion(card, index, fileName, sourceFormat, section.exportRef, sectionTitle));
  const questionTypes = [...new Set(questions.map((question) => String(question.questionType)))];
  const declaredType = firstMetadataValue(questionCards, ".meta span:nth-child(3)", defaultType);

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    test: {
      title,
      description: "Imported PSU PYQ test",
      examType: "custom",
      examConfig: {
        testCategory: "pyq",
        isPsuTest: true,
        sourceFormat,
        sourceFile: fileName,
        exam: metadata.exam,
        subject: metadata.subject,
        year: metadata.year,
        questionCount: questionCards.length,
        declaredQuestionCount: metadata.declaredQuestionCount,
        questionTypes,
        questionType: declaredType,
      },
      durationMinutes: durationMinutes(document),
      defaultPositiveMarks,
      defaultNegativeMarks,
      sections: [section],
      questions,
      metadata,
    },
  };
}
