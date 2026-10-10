// Registration uses `gate`; existing PYQs use GATE EC / GATE ECE.
// Read the GATE workspace consistently without rewriting saved content IDs.
export function pyqExamFilter(column: string, exam: string) {
  if (/^gate(?:[\s_-]|$)/i.test(exam.trim())) {
    return { clause: `LOWER(TRIM(${column})) LIKE 'gate%'`, params: [] as string[] };
  }
  return { clause: `${column} = ?`, params: [exam] };
}
