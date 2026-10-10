export interface Env {
  API_ORIGIN?: string;
}

function getTargetUrl(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = env.API_ORIGIN?.trim() || "https://rankpulse-api.rankpulsee.workers.dev";
  const target = new URL(origin);
  // Keep the incoming `/api/...` path intact.
  // The backend router is mounted under `/api` as well, so stripping the prefix
  // would turn `/api/activity/log` into `/activity/log` and break matching.
  target.pathname = url.pathname;
  target.search = url.search;
  return target.toString();
}

function copyResponseHeaders(source: Response) {
  const headers = new Headers(source.headers);
  const getSetCookie = (source.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;

  if (typeof getSetCookie === "function") {
    headers.delete("set-cookie");
    for (const cookie of getSetCookie.call(source.headers)) {
      headers.append("set-cookie", cookie);
    }
  }

  return headers;
}

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  const targetUrl = getTargetUrl(request, env);
  const headers = new Headers(request.headers);

  // The backend should see the original browser cookies and request metadata,
  // but it must not receive the Pages host as its own origin.
  headers.delete("host");
  headers.delete("content-length");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstreamResponse = await fetch(new Request(targetUrl, init));

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: copyResponseHeaders(upstreamResponse),
  });
}
