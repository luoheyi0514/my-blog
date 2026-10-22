import { randomBytes } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { one, run } from './db';
import { verifyPassword } from './password';
import { nowIso } from './utils';

export const SESSION_COOKIE = 'blog_session';
const SESSION_DAYS = 7;

type LocalUser = NonNullable<App.Locals['user']>;

export async function login(
  email: string,
  password: string,
): Promise<{ user: LocalUser } | { error: string }> {
  const normalized = (email || '').trim().toLowerCase();
  const row = await one<{ id: number; email: string; name: string | null; password_hash: string }>(
    'SELECT id, email, name, password_hash FROM users WHERE email = ?',
    [normalized],
  );
  if (!row) return { error: '邮箱或密码错误' };
  if (!verifyPassword(password, row.password_hash)) return { error: '邮箱或密码错误' };
  return { user: { id: row.id, email: row.email, name: row.name } };
}

export async function createSession(userId: number): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await run('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [
    token,
    userId,
    expires.toISOString(),
    nowIso(),
  ]);
  return { token, expires };
}

export function setSessionCookie(cookies: AstroCookies, token: string, expires: Date) {
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    expires,
  });
}

export function clearSessionCookie(cookies: AstroCookies) {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export async function getSessionUser(cookies: AstroCookies): Promise<LocalUser | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await one<{ id: number; email: string; name: string | null; expires_at: string }>(
    `SELECT u.id, u.email, u.name, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [token],
  );
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await run('DELETE FROM sessions WHERE id = ?', [token]);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

export async function destroySession(cookies: AstroCookies) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) await run('DELETE FROM sessions WHERE id = ?', [token]);
  clearSessionCookie(cookies);
}

/* 简单的登录频率限制（进程内） */
const attempts = new Map<string, { count: number; until: number }>();

export function checkRateLimit(key: string): string | null {
  const record = attempts.get(key);
  if (record && record.until > Date.now() && record.count >= 5) {
    const minutes = Math.ceil((record.until - Date.now()) / 60000);
    return `登录尝试过多，请 ${minutes} 分钟后再试`;
  }
  return null;
}

export function recordFailure(key: string) {
  const record = attempts.get(key);
  if (!record || record.until < Date.now()) {
    attempts.set(key, { count: 1, until: Date.now() + 15 * 60000 });
  } else {
    record.count += 1;
  }
}

export function clearFailures(key: string) {
  attempts.delete(key);
}
