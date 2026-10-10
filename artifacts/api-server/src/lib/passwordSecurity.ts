import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
const PREFIX = 'scrypt$16384$8$5$';
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  if (!password || password.length > 1024) throw new Error('Invalid password length');
  const salt = randomBytes(16).toString('hex');
  return PREFIX + salt + '$' + (await derive(password, salt)).toString('hex');
}
export async function verifyPassword(password: string, stored: string) {
  if (!password || password.length > 1024) return false;
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const legacy = createHash('sha256').update(password + 'edtech_salt_2024').digest();
    return timingSafeEqual(legacy, Buffer.from(stored, 'hex'));
  }
  if (!stored.startsWith(PREFIX)) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{64}$/.test(parts[5])) return false;
  return timingSafeEqual(await derive(password, parts[4]), Buffer.from(parts[5], 'hex'));
}
export function isLegacyPasswordHash(stored: string) { return /^[a-f0-9]{64}$/i.test(stored); }
export function isSupportedPasswordHash(stored: string) {
  return isLegacyPasswordHash(stored) || /^scrypt\$16384\$8\$5\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(stored);
}
