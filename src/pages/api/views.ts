import type { APIRoute } from 'astro';
import { getPostBySlug, recordView } from '../../lib/queries';
import { badRequest, json, readJson, visitorHash } from '../../lib/api';

export const POST: APIRoute = async (context) => {
  const body = await readJson<{ slug?: string }>(context);
  if (!body?.slug) return badRequest('缺少 slug');

  const post = await getPostBySlug(body.slug, true);
  if (!post) return badRequest('文章不存在');

  await recordView(post.id, visitorHash(context));
  const updated = await getPostBySlug(body.slug, true);
  return json({ views: updated?.view_count ?? 0 });
};
