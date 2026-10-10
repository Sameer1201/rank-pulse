/** Parse complete structured responses only; never fill in a truncated answer. */
export function aiResponseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    const text=value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    for(const candidate of [text,text.slice(text.indexOf('{'),text.lastIndexOf('}')+1)]) {
      try {const parsed=JSON.parse(candidate);if(parsed && typeof parsed==='object' && !Array.isArray(parsed))return parsed;} catch { /* Try the complete object inside prose. */ }
    }
  }
  throw new Error('AI_SIMILAR_INVALID_STRUCTURED_RESPONSE');
}

export function aiWorkedSolution(response: Record<string, unknown>): string | null {
  for(const value of [response.calculation,response.explanation,response.solution,response.steps]) {
    if(typeof value==='string' && value.trim())return value.trim();
    if(Array.isArray(value) && value.length && value.every(step=>typeof step==='string' && step.trim()))return value.map((step,i)=>`${i+1}. ${step.trim()}`).join('\n');
  }
  return null;
}
