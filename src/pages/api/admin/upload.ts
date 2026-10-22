import type { APIRoute } from 'astro';
import { run } from '../../../lib/db';
import { badRequest, json, requireUser, unauthorized } from '../../../lib/api';
import { nowIso } from '../../../lib/utils';

const MAX_SIZE = 5 * 1024 * 1024;

export const POST: APIRoute = async (context) => {
  if (!requireUser(context)) return unauthorized();

  const form = await context.request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return badRequest('没有收到文件');
  if (file.size > MAX_SIZE) return badRequest('图片超过 5MB，请压缩后再上传');
  if (!file.type.startsWith('image/')) return badRequest('只支持图片文件');

  const width = Number(form?.get('width') ?? 0) || null;
  const height = Number(form?.get('height') ?? 0) || null;
  const buffer = new Uint8Array(await file.arrayBuffer());

  const result = await run(
    'INSERT INTO media (filename, mime, size, width, height, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [file.name || 'image', file.type, file.size, width, height, buffer, nowIso()],
  );

  const id = Number(result.lastInsertRowid);
  return json({ id, url: `/api/media/${id}` });
};
