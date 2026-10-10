const rawApiOrigin =
  import.meta.env.VITE_API_ORIGIN ||
  import.meta.env.VITE_BACKEND_URL ||
  "";

export const API_ORIGIN = rawApiOrigin.replace(/\/+$/, "");

export function buildApiUrl(path: string) {
  if (!path.startsWith("/")) return path;
  return API_ORIGIN ? `${API_ORIGIN}${path}` : path;
}
