interface PaperQuestion {
  subject: string | null;
  section: string | null;
  chapter: string | null;
  topic: string | null;
  marks: number;
  type: string;
}

// Rank preparation opportunities by this paper's marks, not by inferred ability.
export function buildTestPreparationPlan(questions: PaperQuestion[], durationMinutes: number) {
  const marksOf = (q: PaperQuestion) => Number.isFinite(q.marks) ? Math.max(0, q.marks) : 0;
  const totalMarks = questions.reduce((sum, q) => sum + marksOf(q), 0);
  const groups = new Map<string, PaperQuestion[]>();
  for (const question of questions) {
    const label = question.subject || question.section || question.chapter || question.topic || "Mixed practice";
    groups.set(label, [...(groups.get(label) ?? []), question]);
  }
  const ranked = [...groups].map(([subject, items]) => ({
    subject, items, marks: items.reduce((sum, q) => sum + marksOf(q), 0),
  })).sort((a, b) => b.marks - a.marks || b.items.length - a.items.length || a.subject.localeCompare(b.subject));
  const blocks = ranked.slice(0, 3).map(({ subject, items, marks }) => {
    const topicMarks = new Map<string, number>();
    for (const question of items) {
      const topic = question.chapter || question.topic;
      if (topic && topic !== subject) topicMarks.set(topic, (topicMarks.get(topic) ?? 0) + marksOf(question));
    }
    const topics = [...topicMarks].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([topic]) => topic);
    const practiceCount = Math.min(5, items.length);
    const minutesPerQuestion = durationMinutes > 0 && questions.length ? durationMinutes / questions.length : 2;
    const practiceMinutes = Math.max(1, Math.ceil(practiceCount * minutesPerQuestion));
    const formats = [...new Set(items.map((q) => q.type === "integer" ? "NAT" : q.type === "multi" ? "MSQ" : "MCQ"))];
    const technique = formats.includes("NAT") ? "Write the formula first; check units and rounding before entering the answer."
      : formats.includes("MSQ") ? "Check each statement separately before selecting the complete answer set."
        : "Solve first, then eliminate options using units, signs and limiting cases.";
    return {
      subject, topics, marks, questionCount: items.length,
      paperShare: totalMarks > 0 ? Math.round(marks / totalMarks * 100) : 0,
      practiceCount, practiceMinutes, targetCorrect: Math.ceil(practiceCount * 0.8),
      formats, technique,
    };
  });
  return {
    totalQuestions: questions.length, totalMarks,
    coveredMarks: blocks.reduce((sum, block) => sum + block.marks, 0),
    sessionMinutes: 10 + blocks.reduce((sum, block) => sum + block.practiceMinutes, 0) + 10,
    blocks,
  };
}
