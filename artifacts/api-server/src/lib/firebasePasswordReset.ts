/** Firebase validates and consumes its own single-use recovery capability, not a generic login token. */
export async function firebasePasswordReset(apiKey: string | undefined, oobCode: string, newPassword?: string): Promise<string> {
  if (!apiKey?.trim()) throw new Error('Firebase authentication is not configured.');
  if (!oobCode || oobCode.length > 2048) throw new Error('Reset link is invalid or expired.');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${encodeURIComponent(apiKey.trim())}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oobCode, ...(newPassword !== undefined ? { newPassword } : {}) }),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => ({})) as { email?: unknown; requestType?: unknown };
  if (!response.ok || payload.requestType !== 'PASSWORD_RESET' || typeof payload.email !== 'string' || !payload.email.trim()) {
    throw new Error('Reset link is invalid, expired or already used. Please request a new one.');
  }
  return payload.email.trim().toLowerCase();
}
