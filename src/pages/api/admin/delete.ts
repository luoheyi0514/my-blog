import type { APIRoute } from 'astro';
import { run } from '../../../lib/db';
import { badRequest, json, readJson, requireUser, unauthorized } from '../../../lib/api';
import { nowIso } from '../../../lib/utils';

export const POST: APIRoute = async (context) => {
  if (!requireUser(context)) return unauthorized();

  const body = await readJson<{ id?: number }>(context);
  if (!body?.id) return badRequest('缺少 id');

  await run('UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), body.id]);
  return json({ ok: true });
};
