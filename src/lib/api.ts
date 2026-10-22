import { createHash } from 'node:crypto';
import type { APIContext } from 'astro';

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function badRequest(message: string) {
  return json({ error: message }, 400);
}

export function unauthorized() {
  return json({ error: '未登录或没有权限' }, 401);
}

export function requireUser(context: APIContext): App.Locals['user'] {
  return context.locals.user ?? null;
}

/** 匿名访客标识：IP + UA 的哈希，用于阅读量/点赞去重 */
export function visitorHash(context: APIContext): string {
  const ip = (context.clientAddress as string) || '0.0.0.0';
  const ua = context.request.headers.get('user-agent') ?? '';
  return createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32);
}

export async function readJson<T>(context: APIContext): Promise<T | null> {
  try {
    return (await context.request.json()) as T;
  } catch {
    return null;
  }
}
