const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function authorized(request, env) {
  const expected = env.AI_HINT_GATEWAY_TOKEN?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && received && received === expected);
}

function aiFailure(error) {
  const detail = error instanceof Error ? error.message : String(error);
  const code = Number(error?.code ?? error?.errors?.[0]?.code ?? (/\b(3036|3040)\b/.exec(detail)?.[1]));
  if (code === 3036 || /daily free allocation|neurons per day/i.test(detail)) return json({ ok: false, code: 3036, error: "Daily Workers AI allocation exhausted" }, 429);
  if (code === 3040 || /out of capacity|rate limit|429/i.test(detail)) return json({ ok: false, code: 3040, error: "Workers AI is temporarily at capacity" }, 429);
  return json({ ok: false, error: "Could not generate a hint" }, 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return json({ ok: true, service: "rankpulse-pyq-ai" });
    }
    if (url.pathname !== "/ai-hint") return json({ ok: false, error: "Not found" }, 404);
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
    if (!authorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
    if (!env.AI) return json({ ok: false, error: "Workers AI is not configured" }, 503);

    try {
      const input = await request.json();
      if (!Array.isArray(input?.messages) || input.messages.length < 1 || input.messages.length > 3) {
        return json({ ok: false, error: "Invalid AI input" }, 400);
      }
      const model = input.response_format?.type === "json_schema" ? "@cf/meta/llama-3.3-70b-instruct-fp8-fast" : "@cf/meta/llama-3.2-3b-instruct";
      const result = await env.AI.run(model, input);
      const completion = result?.choices?.[0]?.message?.content;
      if (typeof completion === "string" && completion.trim()) return json({ response: completion.trim() });
      if (result?.response && typeof result.response === "object" && !Array.isArray(result.response)) return json({ response: result.response });
      if (typeof result?.response !== "string" || !result.response.trim()) {
        return json({ ok: false, error: "Workers AI returned an empty hint" }, 502);
      }
      return json({ response: result.response.trim() });
    } catch (error) {
      console.error("Workers AI generation failed", error instanceof Error ? error.message : "Unknown provider error");
      return aiFailure(error);
    }
  },
};
