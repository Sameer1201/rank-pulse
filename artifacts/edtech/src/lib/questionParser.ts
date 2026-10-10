export interface ParsedQuestion {
  questionCode: string;
  qnum: number;
  qtype: string;
  questionText: string;
  optionsText: string[];
  hasImages: boolean;
  marksRight: number;
  marksWrong: number;
  tagsRaw: string;
  subjectRaw: string;
}

export function parseQuestionsFromHTML(html: string): { questions: ParsedQuestion[]; testTitle: string | null } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Try to extract test title
  let testTitle: string | null = null;
  const titleEl =
    doc.querySelector(".test-title") ??
    doc.querySelector("h1") ??
    doc.querySelector("title");
  if (titleEl) {
    const t = titleEl.textContent?.trim();
    if (t) testTitle = t;
  }

  const sections = doc.querySelectorAll(".question");
  const questions: ParsedQuestion[] = [];

  sections.forEach((section) => {
    const questionCode = section.getAttribute("data-qid") ?? section.getAttribute("id") ?? `Q${questions.length + 1}`;
    const qnumStr = section.getAttribute("data-qnum") ?? String(questions.length + 1);
    const qnum = parseInt(qnumStr, 10) || questions.length + 1;
    const qtype = section.getAttribute("data-qtype") ?? "MCQ";
    const marksRight = parseFloat(section.getAttribute("data-marks-right") ?? "1");
    const marksWrong = parseFloat(section.getAttribute("data-marks-wrong") ?? "0");
    const tagsRaw = section.getAttribute("data-tags") ?? "";
    const subjectRaw = section.getAttribute("data-subject") ?? extractSubjectFromTags(tagsRaw);

    const qtextEl = section.querySelector(".qtext");
    let questionText = "";
    let hasImages = false;

    if (qtextEl) {
      const clone = qtextEl.cloneNode(true) as Element;
      const imgs = clone.querySelectorAll("img");
      if (imgs.length > 0) hasImages = true;
      imgs.forEach((img) => {
        img.replaceWith(doc.createTextNode("[IMAGE]"));
      });
      questionText = clone.textContent?.trim().replace(/\s+/g, " ") || "";
    }

    const optEls = section.querySelectorAll("label.opt");
    const optionsText: string[] = [];
    optEls.forEach((optEl) => {
      const clone = optEl.cloneNode(true) as Element;
      const imgs = clone.querySelectorAll("img");
      if (imgs.length > 0) hasImages = true;
      imgs.forEach((img) => {
        img.replaceWith(doc.createTextNode("[IMAGE]"));
      });
      const text = clone.textContent?.trim().replace(/\s+/g, " ") || "";
      optionsText.push(text);
    });

    questions.push({
      questionCode,
      qnum,
      qtype,
      questionText,
      optionsText,
      hasImages,
      marksRight,
      marksWrong,
      tagsRaw,
      subjectRaw,
    });
  });

  return { questions, testTitle };
}

function extractSubjectFromTags(tagsRaw: string): string {
  const parts = tagsRaw.split("•").map((p) => p.trim());
  return parts.length >= 2 ? parts[1].trim() : tagsRaw;
}
