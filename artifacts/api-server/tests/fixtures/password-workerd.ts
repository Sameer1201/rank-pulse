// Local runtime compatibility test only. Never deploy this diagnostic worker.
import { hashPassword, verifyPassword } from '../../src/lib/passwordSecurity';
export default {
  async fetch() {
    const value = await hashPassword('local-runtime-test-only');
    return Response.json({ modern: value.startsWith('scrypt$'),
      valid: await verifyPassword('local-runtime-test-only', value),
      invalid: await verifyPassword('wrong', value) });
  },
};
