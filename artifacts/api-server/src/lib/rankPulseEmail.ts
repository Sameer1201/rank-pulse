export type RankPulseEmailOptions = {
  preheader: string;
  eyebrow: string;
  title: string;
  introHtml: string;
  contentHtml?: string;
  actionLabel?: string;
  actionUrl?: string;
  footerNote?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

/** Shared, email-client-safe RankPulse layout used by transactional messages. */
export function renderRankPulseEmail({
  preheader,
  eyebrow,
  title,
  introHtml,
  contentHtml = "",
  actionLabel,
  actionUrl,
  footerNote = "This is an automated message from RankPulse.",
}: RankPulseEmailOptions) {
  const action = actionLabel && actionUrl
    ? `<tr><td align="center" style="padding:28px 32px 12px;"><a href="${actionUrl}" style="display:inline-block;padding:15px 28px;border-radius:12px;background:#f97316;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;">${actionLabel}</a></td></tr><tr><td style="padding:5px 32px 25px;text-align:center;font-size:12px;line-height:1.7;color:#7b8494;">If the button does not open, use this link:<br><a href="${actionUrl}" style="color:#c2410c;word-break:break-all;">${actionUrl}</a></td></tr>`
    : "";

  return `<!doctype html><html lang="en" data-rankpulse-layout="shared"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${eyebrow} | RankPulse</title></head>
    <body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#172033;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fb;padding:30px 12px;">
        <tr><td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;overflow:hidden;border-radius:24px;background:#ffffff;box-shadow:0 18px 55px rgba(25,37,65,.11);">
            <tr><td style="padding:20px 30px;background:#111a2e;border-bottom:4px solid #fb923c;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:22px;font-weight:800;letter-spacing:-.5px;color:#ffffff;">Rank<span style="color:#fb923c;">Pulse</span></td><td align="right" style="font-size:10px;font-weight:700;letter-spacing:1.8px;color:#aab5c9;">${eyebrow}</td></tr></table>
            </td></tr>
            <tr><td style="padding:34px 32px 20px;background:linear-gradient(145deg,#fff7ed 0%,#ffffff 72%);">
              <h1 style="margin:0 0 12px;font-size:28px;line-height:1.22;letter-spacing:-.5px;color:#111a2e;">${title}</h1>
              <div style="font-size:15px;line-height:1.75;color:#58657a;">${introHtml}</div>
            </td></tr>
            ${contentHtml ? `<tr><td style="padding:8px 32px 12px;">${contentHtml}</td></tr>` : ""}
            ${action}
            <tr><td style="padding:18px 30px;background:#111a2e;text-align:center;color:#aab5c9;font-size:11px;line-height:1.7;"><span style="font-weight:800;letter-spacing:1.5px;color:#ffffff;">RANK<span style="color:#fb923c;">PULSE</span></span><br>Your preparation, with a clearer pulse.<br>${footerNote}</td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;
}

/** Adds the shared RankPulse shell to legacy email bodies while preserving their content. */
export function ensureRankPulseEmailLayout(html: string, subject: string, messageType = "Notification") {
  if (html.includes('data-rankpulse-layout="shared"')) return html;

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || subject;
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const bodyContent = body
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<html[^>]*>|<\/html>|<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .trim();
  const label = messageType.replace(/[^a-z0-9 -]/gi, " ").replace(/\s+/g, " ").trim().slice(0, 48) || "Notification";

  return renderRankPulseEmail({
    preheader: escapeHtml(subject),
    eyebrow: escapeHtml(label),
    title: escapeHtml(title),
    introHtml: "A new update from RankPulse is included below.",
    contentHtml: bodyContent,
    footerNote: "You received this message because of activity on your RankPulse account.",
  });
}
