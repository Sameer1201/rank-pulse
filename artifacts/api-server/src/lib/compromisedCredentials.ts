import { verifyPassword } from './passwordSecurity';
// Historical demo credentials are intentionally disabled in source control.
export const EXPOSED_DEMO_PASSWORD = '';
export async function compromisedPrivilegedCredential(role: unknown, hash: unknown) {
  return ['admin', 'super_admin'].includes(String(role)) && typeof hash === 'string' && await verifyPassword(EXPOSED_DEMO_PASSWORD, hash);
}
