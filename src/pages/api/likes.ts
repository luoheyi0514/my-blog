import type { APIRoute } from 'astro';
import { getPostBySlug, toggleLike } from '../../lib/queries';
import { badRequest, json, readJson, visitorHash } from '../../lib/api';

export const POST: APIRoute = async (context) => {
  const body = await readJson<{ slug?: string }>(context);
  if (!body?.slug) return badRequest('缺少 slug');

  const post = await getPostBySlug(body.slug, true);
  if (!post) return badRequest('文章不存在');

  const result = await toggleLike(post.id, visitorHash(context));
  return json(result);
};
