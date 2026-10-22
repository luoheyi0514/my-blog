import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = (stored || '').split(':');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  try {
    const candidate = scryptSync(password, salt, 64);
    const target = Buffer.from(hash, 'hex');
    if (candidate.length !== target.length) return false;
    return timingSafeEqual(candidate, target);
  } catch {
    return false;
  }
}
