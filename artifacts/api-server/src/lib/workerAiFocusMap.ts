function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const candidate of [text, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch { /* Try the JSON object surrounded by model prose. */ }
  }
  return null;
}

// Workers AI may return parsed JSON in `response`, a JSON string, or a chat
// completion. Keep this boundary independent of the model's response envelope.
export function readAiFocusMap(result: unknown): Record<string, unknown> {
  const envelope = isRecord(result) ? result : {};
  const choice = Array.isArray(envelope.choices) ? envelope.choices[0] : null;
  const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : null;
  for (const candidate of [envelope.response, content]) {
    const parsed = parseObject(candidate);
    if (parsed && typeof parsed.headline === "string" && parsed.headline.trim()
      && Array.isArray(parsed.focusAreas) && Array.isArray(parsed.strengths)
      && Array.isArray(parsed.studyFlow) && parsed.studyFlow.some((step) => typeof step === "string" && step.trim())
      && parsed.focusAreas.every((item) => isRecord(item) && ["topic", "evidence", "action"].every((key) => typeof item[key] === "string"))
      && parsed.strengths.every((item) => isRecord(item) && typeof item.topic === "string" && typeof item.evidence === "string")) {
      return parsed;
    }
  }
  throw new Error("AI_FOCUS_MAP_INVALID_RESPONSE");
}
