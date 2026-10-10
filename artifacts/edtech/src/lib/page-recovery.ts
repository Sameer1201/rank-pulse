const RELOAD_KEY = "rankpulse:chunk-reload-at";
let attemptedReload = false;

export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed|Unable to preload CSS/i.test(message);
}

// Old tabs can request deleted chunks after a deployment. Reload the current
// URL once, with a cross-reload guard so an offline connection cannot loop.
export function recoverChunkLoad(error: unknown) {
  if (!isChunkLoadError(error) || attemptedReload || !navigator.onLine) return false;
  try {
    const lastReload = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - lastReload < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Without a persistent guard, offer the manual reload button instead.
    return false;
  }
  attemptedReload = true;
  window.location.reload();
  return true;
}
