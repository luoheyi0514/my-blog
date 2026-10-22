import type { APIRoute } from 'astro';
import { all, one, run } from '../../../lib/db';
import { renderMarkdown } from '../../../lib/markdown';
import { badRequest, json, readJson, requireUser, unauthorized } from '../../../lib/api';
import { nowIso, slugify, slugifyTag } from '../../../lib/utils';

interface SavePayload {
  id?: number | null;
  title?: string;
  slug?: string;
  description?: string;
  content_md?: string;
  category_id?: number | null;
  series_id?: number | null;
  series_order?: number | null;
  cover_url?: string | null;
  status?: 'draft' | 'published';
  published_at?: string | null;
  pinned?: boolean;
  allow_comments?: boolean;
  tags?: string[];
  action?: 'save' | 'publish';
}

async function uniqueSlug(desired: string, excludeId?: number | null): Promise<string> {
  let slug = desired;
  let counter = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await one<{ id: number }>('SELECT id FROM posts WHERE slug = ?', [slug]);
    if (!existing || existing.id === excludeId) return slug;
    counter += 1;
    slug = `${desired}-${counter}`;
  }
}

export const POST: APIRoute = async (context) => {
  const user = requireUser(context);
  if (!user) return unauthorized();

  const body = await readJson<SavePayload>(context);
  if (!body) return badRequest('请求体格式错误');

  const title = (body.title ?? '').trim();
  const content = body.content_md ?? '';
  if (!title) return badRequest('标题不能为空');

  const action = body.action === 'publish' ? 'publish' : 'save';
  const status: 'draft' | 'published' =
    action === 'publish' ? 'published' : body.status === 'published' ? 'published' : 'draft';

  const rendered = await renderMarkdown(content);
  const now = nowIso();

  const existingPost = body.id
    ? await one<{ id: number; slug: string }>('SELECT id, slug FROM posts WHERE id = ?', [body.id])
    : null;

  const desiredSlug = (body.slug ?? '').trim()
    ? slugify(body.slug!.trim())
    : (existingPost?.slug ?? slugify(title));
  const slug = await uniqueSlug(desiredSlug, body.id ?? null);

  let publishedAt = body.published_at ?? null;
  if (status === 'published' && !publishedAt) publishedAt = now;

  const values = [
    slug,
    title,
    body.description ?? null,
    content,
    rendered.html,
    rendered.tocJson,
    body.category_id ?? null,
    body.series_id ?? null,
    body.series_order ?? null,
    body.cover_url ?? null,
    status,
    publishedAt,
    body.pinned ? 1 : 0,
    body.allow_comments === false ? 0 : 1,
    rendered.wordCount,
    rendered.readingTime,
    now,
  ];

  let postId: number;

  if (body.id) {
    const existing = await one<{ id: number }>('SELECT id FROM posts WHERE id = ?', [body.id]);
    if (!existing) return badRequest('文章不存在');

    await run(
      `UPDATE posts SET slug = ?, title = ?, description = ?, content_md = ?, content_html = ?, toc_json = ?,
        category_id = ?, series_id = ?, series_order = ?, cover_url = ?, status = ?, published_at = ?,
        pinned = ?, allow_comments = ?, word_count = ?, reading_time = ?, updated_at = ?
       WHERE id = ?`,
      [...values, body.id],
    );
    postId = body.id;
  } else {
    const result = await run(
      `INSERT INTO posts (slug, title, description, content_md, content_html, toc_json,
        category_id, series_id, series_order, cover_url, status, published_at,
        pinned, allow_comments, word_count, reading_time, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...values, now],
    );
    postId = Number(result.lastInsertRowid);
  }

  // 标签同步
  const tagNames = Array.from(new Set((body.tags ?? []).map((t) => t.trim()).filter(Boolean)));
  await run('DELETE FROM post_tags WHERE post_id = ?', [postId]);
  for (const name of tagNames) {
    const slugOfTag = slugifyTag(name);
    await run('INSERT OR IGNORE INTO tags (name, slug, created_at) VALUES (?, ?, ?)', [name, slugOfTag, now]);
    const tag = await one<{ id: number }>('SELECT id FROM tags WHERE slug = ? OR name = ?', [slugOfTag, name]);
    if (tag) await run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, tag.id]);
  }

  // 清理无引用的标签
  await run(
    'DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM post_tags UNION SELECT tag_id FROM til_tags)',
  );

  return json({ id: postId, slug, status, savedAt: now });
};
