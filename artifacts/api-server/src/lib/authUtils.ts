/**
 * Returns only the identity verified by the server's opaque-session middleware.
 * Neither a numeric cookie nor a role cookie can authenticate a request.
 */
export function getSignedUserId(req: any): number | null {
  const id = req.authenticatedUserId;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Like `getSignedUserId` but returns `number` (never null).
 * Call only inside handlers that are already guarded by a `requireAuth`
 * middleware — if the cookie is somehow absent here it throws, which will
 * surface as a 500 rather than a silent null-related runtime crash.
 */
export function getSignedUserIdOrThrow(req: any): number {
  const id = getSignedUserId(req);
  if (id === null) throw new Error("Unauthorized: missing or invalid userId cookie");
  return id;
}
