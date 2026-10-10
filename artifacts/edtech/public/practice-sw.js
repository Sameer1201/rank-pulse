// Cache only the public application shell. NEVER cache API, auth or exam responses.
const CACHE = "rankpulse-practice-shell-v1";
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  if (event.data?.type !== "PREPARE_SHELL") return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const assets = [...new Set((event.data.assets || []).filter(value => {
        try { const url = new URL(value); return url.origin === self.location.origin && url.pathname.startsWith("/assets/"); } catch { return false; }
      }))];
      const shell = await fetch("/", {cache:"no-store"});
      if (!shell.ok || (event.data.entry && !(await shell.clone().text()).includes(event.data.entry))) throw new Error("Refresh after app update");
      await cache.addAll(assets);
      await cache.put("/",shell);
      event.ports[0]?.postMessage({ ok: true });
    } catch { event.ports[0]?.postMessage({ ok: false }); }
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE), saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok) await cache.put(request,response.clone());
      return response;
    })());
  } else if (request.mode === "navigate" && /^\/student\/(question-bank(?:\/|$)|pyq(?:\/|$)|offline-practice(?:\/|$))/.test(url.pathname)) {
    // Prefer a brief network attempt, not an indefinite spinner on connected but
    // unusable Wi-Fi. Public shell only; API/auth responses are never cached.
    event.respondWith((async()=>{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),1500);
      try {
        const response=await fetch(request,{signal:controller.signal});
        if(response.ok){await response.clone().arrayBuffer();return response;}
        const saved=await(await caches.open(CACHE)).match('/');
        return saved||response;
      } catch {
        const saved=await(await caches.open(CACHE)).match('/');
        return saved||new Response('Connect once to prepare offline practice.',{status:503});
      } finally {clearTimeout(timer);}
    })());
  }
});
