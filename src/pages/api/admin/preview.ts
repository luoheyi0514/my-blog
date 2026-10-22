import type { APIRoute } from 'astro';
import { renderHtml } from '../../../lib/markdown';
import { badRequest, json, readJson, requireUser, unauthorized } from '../../../lib/api';

export const POST: APIRoute = async (context) => {
  if (!requireUser(context)) return unauthorized();

  const body = await readJson<{ markdown?: string }>(context);
  if (typeof body?.markdown !== 'string') return badRequest('缺少 markdown 内容');

  const html = await renderHtml(body.markdown);
  return json({ html });
};
