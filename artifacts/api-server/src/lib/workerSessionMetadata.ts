export function recordedValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && !/^unknown(?:\s+(?:browser|device|location|ip))?$/i.test(text) ? text : null;
}

export function parseSessionUserAgent(value: unknown) {
  const userAgent = recordedValue(value);
  const ua = userAgent ?? "";
  const browserName = /Edg(?:e|A|iOS)?\//i.test(ua) ? "Edge"
    : /(?:OPR|OPiOS|Opera)\//i.test(ua) ? "Opera"
    : /SamsungBrowser\//i.test(ua) ? "Samsung Internet"
    : /(?:Firefox|FxiOS)\//i.test(ua) ? "Firefox"
    : /(?:Chrome|CriOS)\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari" : null;
  const deviceType = /bot|crawler|spider/i.test(ua) ? "Bot"
    : /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? "Tablet"
    : /iPhone|iPod|Mobile|Android/i.test(ua) ? "Mobile"
    : /Windows|Macintosh|X11|Linux|CrOS/i.test(ua) ? "Desktop" : null;
  return { browserName, deviceType, userAgent };
}

export function readSessionMetadata(request: Request) {
  // Cloudflare supplies these fields for the incoming visitor request.
  // https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties
  const cf = (request as Request & { cf?: { city?: unknown; region?: unknown; country?: unknown } }).cf;
  const ipAddress = recordedValue(request.headers.get("cf-connecting-ip"));
  const city = recordedValue(cf?.city);
  const region = recordedValue(cf?.region);
  const countryCode = recordedValue(cf?.country) ?? recordedValue(request.headers.get("cf-ipcountry"));
  let country: string | null = null;
  if (countryCode && /^[A-Z]{2}$/i.test(countryCode) && countryCode.toUpperCase() !== "XX") {
    country = new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode.toUpperCase()) ?? countryCode;
  }
  const parts = [...new Set([city, region, country].filter((part): part is string => Boolean(part)))];
  const localIp = ipAddress && /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$)/.test(ipAddress);
  return {
    ipAddress,
    locationLabel: parts.length ? parts.join(", ") : localIp ? "Local network" : null,
    ...parseSessionUserAgent(request.headers.get("user-agent")),
  };
}
