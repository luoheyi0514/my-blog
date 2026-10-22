import { all, one, run, scalar } from './db';
import { nowIso } from './utils';
import type {
  Category,
  Media,
  Post,
  PostListItem,
  Project,
  RoadmapArea,
  RoadmapItem,
  Series,
  Tag,
  Til,
} from './types';

/* ------------------------------------------------------------------ */
/* 文章                                                                */
/* ------------------------------------------------------------------ */
export interface ListOptions {
  limit?: number;
  offset?: number;
  categorySlug?: string;
  tagSlug?: string;
  search?: string;
  seriesId?: number;
  excludeId?: number;
  pinnedFirst?: boolean;
}

function buildPublishedFilter(options: ListOptions, alias = 'p') {
  const where = [
    `${alias}.status = 'published'`,
    `${alias}.published_at IS NOT NULL`,
    `${alias}.published_at <= ?`,
    `${alias}.deleted_at IS NULL`,
  ];
  const args: unknown[] = [nowIso()];

  if (options.categorySlug) {
    where.push(`${alias}.category_id = (SELECT id FROM categories WHERE slug = ?)`);
    args.push(options.categorySlug);
  }
  if (options.tagSlug) {
    where.push(
      `EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ${alias}.id AND t.slug = ?)`,
    );
    args.push(options.tagSlug);
  }
  if (options.search) {
    where.push(`(${alias}.title LIKE ? OR ${alias}.description LIKE ? OR ${alias}.content_md LIKE ?)`);
    const like = `%${options.search}%`;
    args.push(like, like, like);
  }
  if (options.seriesId) {
    where.push(`${alias}.series_id = ?`);
    args.push(options.seriesId);
  }
  if (options.excludeId) {
    where.push(`${alias}.id != ?`);
    args.push(options.excludeId);
  }
  return { where: where.join(' AND '), args };
}

async function attachTags<T extends { id: number }>(items: T[]): Promise<(T & { tags: Tag[] })[]> {
  if (!items.length) return items.map((item) => ({ ...item, tags: [] }));
  const ids = items.map((item) => item.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all<{ post_id: number; id: number; name: string; slug: string }>(
    `SELECT pt.post_id, t.id, t.name, t.slug
       FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.post_id IN (${placeholders})`,
    ids,
  );
  const map = new Map<number, Tag[]>();
  for (const row of rows) {
    const list = map.get(row.post_id) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    map.set(row.post_id, list);
  }
  return items.map((item) => ({ ...item, tags: map.get(item.id) ?? [] }));
}

export async function listPosts(options: ListOptions = {}): Promise<PostListItem[]> {
  const { where, args } = buildPublishedFilter(options);
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;
  const order = options.pinnedFirst === false ? '' : 'p.pinned DESC, ';

  const rows = await all<PostListItem>(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where}
      ORDER BY ${order}p.published_at DESC, p.id DESC
      LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  return attachTags(rows);
}

export async function countPosts(options: ListOptions = {}): Promise<number> {
  const { where, args } = buildPublishedFilter(options);
  return (await scalar<number>(`SELECT COUNT(*) FROM posts p WHERE ${where}`, args)) ?? 0;
}

export async function getPostBySlug(slug: string, includeUnpublished = false): Promise<PostListItem | null> {
  const condition = includeUnpublished
    ? `p.slug = ? AND p.deleted_at IS NULL`
    : `p.slug = ? AND p.status = 'published' AND p.published_at IS NOT NULL AND p.published_at <= ? AND p.deleted_at IS NULL`;
  const args = includeUnpublished ? [slug] : [slug, nowIso()];

  const row = await one<PostListItem>(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM posts p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${condition}`,
    args,
  );
  if (!row) return null;
  const [withTags] = await attachTags([row]);
  return withTags ?? null;
}

export async function getPostById(id: number): Promise<Post | null> {
  return one<Post>('SELECT * FROM posts WHERE id = ?', [id]);
}

export async function getPostTags(postId: number): Promise<Tag[]> {
  return all<Tag>(
    `SELECT t.* FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ? ORDER BY t.name`,
    [postId],
  );
}

export async function getAdjacentPosts(post: Post) {
  const prev = await one<{ slug: string; title: string }>(
    `SELECT slug, title FROM posts
      WHERE status = 'published' AND deleted_at IS NULL AND published_at <= ?
        AND published_at < ?
      ORDER BY published_at DESC LIMIT 1`,
    [nowIso(), post.published_at],
  );
  const next = await one<{ slug: string; title: string }>(
    `SELECT slug, title FROM posts
      WHERE status = 'published' AND deleted_at IS NULL AND published_at <= ?
        AND published_at > ?
      ORDER BY published_at ASC LIMIT 1`,
    [nowIso(), post.published_at],
  );
  return { prev, next };
}

export async function getRelatedPosts(postId: number, tagIds: number[], limit = 3): Promise<PostListItem[]> {
  if (!tagIds.length) {
    const rows = await all<PostListItem>(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM posts p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.published_at <= ? AND p.id != ?
        ORDER BY p.published_at DESC LIMIT ?`,
      [nowIso(), postId, limit],
    );
    return attachTags(rows);
  }
  const placeholders = tagIds.map(() => '?').join(',');
  const rows = await all<PostListItem>(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, COUNT(pt.tag_id) AS matched
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       JOIN post_tags pt ON pt.post_id = p.id
      WHERE pt.tag_id IN (${placeholders})
        AND p.status = 'published' AND p.deleted_at IS NULL AND p.published_at <= ? AND p.id != ?
      GROUP BY p.id
      ORDER BY matched DESC, p.published_at DESC
      LIMIT ?`,
    [...tagIds, nowIso(), postId, limit],
  );
  return attachTags(rows);
}

export async function getSeriesPosts(seriesId: number, includeUnpublished = false): Promise<Post[]> {
  const condition = includeUnpublished
    ? `series_id = ? AND deleted_at IS NULL`
    : `series_id = ? AND status = 'published' AND deleted_at IS NULL AND published_at <= ?`;
  const args = includeUnpublished ? [seriesId] : [seriesId, nowIso()];
  return all<Post>(
    `SELECT * FROM posts WHERE ${condition} ORDER BY series_order ASC, published_at ASC`,
    args,
  );
}

/* ------------------------------------------------------------------ */
/* 分类 / 标签 / 专栏                                                   */
/* ------------------------------------------------------------------ */
export async function getCategories(withCount = true): Promise<Category[]> {
  if (!withCount) return all<Category>('SELECT * FROM categories ORDER BY sort_order, id');
  return all<Category>(
    `SELECT c.*,
            (SELECT COUNT(*) FROM posts p
              WHERE p.category_id = c.id AND p.status = 'published' AND p.deleted_at IS NULL AND p.published_at <= ?) AS post_count
       FROM categories c
      ORDER BY c.sort_order, c.id`,
    [nowIso()],
  );
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  return one<Category>('SELECT * FROM categories WHERE slug = ?', [slug]);
}

export async function getTags(withCount = true): Promise<Tag[]> {
  if (!withCount) return all<Tag>('SELECT * FROM tags ORDER BY name');
  return all<Tag>(
    `SELECT t.*,
            (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id = pt.post_id
              WHERE pt.tag_id = t.id AND p.status = 'published' AND p.deleted_at IS NULL AND p.published_at <= ?) AS count
       FROM tags t
      ORDER BY count DESC, t.name ASC`,
    [nowIso()],
  );
}

export async function getTagBySlug(slug: string): Promise<Tag | null> {
  return one<Tag>('SELECT * FROM tags WHERE slug = ?', [slug]);
}

export async function getSeriesList(withCount = true): Promise<Series[]> {
  if (!withCount) return all<Series>('SELECT * FROM series ORDER BY sort_order, id');
  return all<Series>(
    `SELECT s.*,
            (SELECT COUNT(*) FROM posts p
              WHERE p.series_id = s.id AND p.status = 'published' AND p.deleted_at IS NULL AND p.published_at <= ?) AS post_count,
            (SELECT MAX(p.updated_at) FROM posts p WHERE p.series_id = s.id AND p.status = 'published') AS updated_at
       FROM series s
      ORDER BY s.sort_order, s.id`,
    [nowIso()],
  );
}

export async function getSeriesBySlug(slug: string): Promise<Series | null> {
  return one<Series>('SELECT * FROM series WHERE slug = ?', [slug]);
}

export async function getSeriesById(id: number): Promise<Series | null> {
  return one<Series>('SELECT * FROM series WHERE id = ?', [id]);
}

/* ------------------------------------------------------------------ */
/* TIL                                                                 */
/* ------------------------------------------------------------------ */
async function attachTilTags(items: Til[]): Promise<Til[]> {
  if (!items.length) return items;
  const ids = items.map((item) => item.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all<{ til_id: number; id: number; name: string; slug: string }>(
    `SELECT tt.til_id, t.id, t.name, t.slug
       FROM til_tags tt JOIN tags t ON t.id = tt.tag_id
      WHERE tt.til_id IN (${placeholders})`,
    ids,
  );
  const map = new Map<number, Tag[]>();
  for (const row of rows) {
    const list = map.get(row.til_id) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    map.set(row.til_id, list);
  }
  return items.map((item) => ({ ...item, tags: map.get(item.id) ?? [] }));
}

export async function listTils(
  options: { limit?: number; offset?: number; tagSlug?: string; search?: string } = {},
): Promise<Til[]> {
  const where = [`t.status = 'published'`, `t.published_at IS NOT NULL`, `t.published_at <= ?`, `t.deleted_at IS NULL`];
  const args: unknown[] = [nowIso()];
  if (options.tagSlug) {
    where.push(
      `EXISTS (SELECT 1 FROM til_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.til_id = t.id AND g.slug = ?)`,
    );
    args.push(options.tagSlug);
  }
  if (options.search) {
    where.push(`(t.title LIKE ? OR t.content_md LIKE ?)`);
    args.push(`%${options.search}%`, `%${options.search}%`);
  }
  const rows = await all<Til>(
    `SELECT t.* FROM tils t WHERE ${where.join(' AND ')} ORDER BY t.published_at DESC LIMIT ? OFFSET ?`,
    [...args, options.limit ?? 20, options.offset ?? 0],
  );
  return attachTilTags(rows);
}

export async function countTils(options: { tagSlug?: string } = {}): Promise<number> {
  const where = [`t.status = 'published'`, `t.published_at IS NOT NULL`, `t.published_at <= ?`, `t.deleted_at IS NULL`];
  const args: unknown[] = [nowIso()];
  if (options.tagSlug) {
    where.push(
      `EXISTS (SELECT 1 FROM til_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.til_id = t.id AND g.slug = ?)`,
    );
    args.push(options.tagSlug);
  }
  return (await scalar<number>(`SELECT COUNT(*) FROM tils t WHERE ${where.join(' AND ')}`, args)) ?? 0;
}

/* ------------------------------------------------------------------ */
/* 学习路线 / 项目                                                      */
/* ------------------------------------------------------------------ */
export async function getRoadmap(): Promise<RoadmapArea[]> {
  const areas = await all<RoadmapArea>('SELECT * FROM roadmap_areas ORDER BY sort_order, id');
  const items = await all<RoadmapItem>('SELECT * FROM roadmap_items ORDER BY sort_order, id');
  const links = await all<{ id: number; item_id: number; type: string; target_id: number; label: string | null }>(
    'SELECT * FROM roadmap_links',
  );
  const postSlugs = await all<{ id: number; slug: string }>(
    `SELECT id, slug FROM posts WHERE deleted_at IS NULL`,
  );
  const seriesSlugs = await all<{ id: number; slug: string }>('SELECT id, slug FROM series');
  const slugMap = {
    post: new Map(postSlugs.map((p) => [p.id, p.slug])),
    series: new Map(seriesSlugs.map((s) => [s.id, s.slug])),
  };

  return areas.map((area) => ({
    ...area,
    items: items
      .filter((item) => item.area_id === area.id)
      .map((item) => ({
        ...item,
        links: links
          .filter((link) => link.item_id === item.id)
          .map((link) => ({
            ...link,
            href:
              link.type === 'til'
                ? `/til#til-${link.target_id}`
                : link.type === 'series'
                  ? `/series/${slugMap.series.get(link.target_id) ?? ''}`
                  : `/posts/${slugMap.post.get(link.target_id) ?? ''}`,
          })),
      })),
  }));
}

export async function getProjects(): Promise<Project[]> {
  return all<Project>(
    'SELECT * FROM projects ORDER BY featured DESC, sort_order ASC, id DESC',
  );
}

/* ------------------------------------------------------------------ */
/* 统计 / 归档                                                          */
/* ------------------------------------------------------------------ */
export async function getStats() {
  const postCount = (await scalar<number>(`SELECT COUNT(*) FROM posts WHERE status='published' AND deleted_at IS NULL AND published_at <= ?`, [nowIso()])) ?? 0;
  const draftCount = (await scalar<number>(`SELECT COUNT(*) FROM posts WHERE status='draft' AND deleted_at IS NULL`)) ?? 0;
  const tilCount = (await scalar<number>(`SELECT COUNT(*) FROM tils WHERE status='published' AND deleted_at IS NULL`)) ?? 0;
  const seriesCount = (await scalar<number>('SELECT COUNT(*) FROM series')) ?? 0;
  const words = (await scalar<number>(`SELECT COALESCE(SUM(word_count),0) FROM posts WHERE status='published' AND deleted_at IS NULL`)) ?? 0;
  const views = (await scalar<number>(`SELECT COALESCE(SUM(view_count),0) FROM posts`)) ?? 0;
  const likes = (await scalar<number>(`SELECT COALESCE(SUM(like_count),0) FROM posts`)) ?? 0;
  const categoryCount = (await scalar<number>('SELECT COUNT(*) FROM categories')) ?? 0;
  return { postCount, draftCount, tilCount, seriesCount, words, views, likes, categoryCount };
}

export async function getArchive(): Promise<PostListItem[]> {
  const rows = await all<PostListItem>(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM posts p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.published_at <= ?
      ORDER BY p.published_at DESC`,
    [nowIso()],
  );
  return attachTags(rows);
}

/* ------------------------------------------------------------------ */
/* 媒体                                                                */
/* ------------------------------------------------------------------ */
export async function listMedia(limit = 60, offset = 0): Promise<Media[]> {
  return all<Media>(
    'SELECT id, filename, mime, size, width, height, created_at FROM media ORDER BY id DESC LIMIT ? OFFSET ?',
    [limit, offset],
  );
}

export async function getMediaBlob(id: number) {
  return one<{ data: ArrayBuffer; mime: string }>('SELECT data, mime FROM media WHERE id = ?', [id]);
}

export async function getMediaUsage(): Promise<number> {
  return (await scalar<number>('SELECT COALESCE(SUM(size),0) FROM media')) ?? 0;
}

/* ------------------------------------------------------------------ */
/* 阅读量 / 点赞                                                        */
/* ------------------------------------------------------------------ */
export async function recordView(postId: number, visitorHash: string) {
  const day = new Date().toISOString().slice(0, 10);
  const existing = await one<{ id: number }>(
    'SELECT id FROM post_views WHERE post_id = ? AND visitor_hash = ? AND day = ?',
    [postId, visitorHash, day],
  );
  if (existing) return;
  await run('INSERT INTO post_views (post_id, visitor_hash, day, created_at) VALUES (?, ?, ?, ?)', [
    postId,
    visitorHash,
    day,
    nowIso(),
  ]);
  await run('UPDATE posts SET view_count = view_count + 1 WHERE id = ?', [postId]);
}

export async function toggleLike(postId: number, visitorHash: string) {
  const existing = await one<{ post_id: number }>(
    'SELECT post_id FROM post_likes WHERE post_id = ? AND visitor_hash = ?',
    [postId, visitorHash],
  );
  if (existing) {
    await run('DELETE FROM post_likes WHERE post_id = ? AND visitor_hash = ?', [postId, visitorHash]);
    await run('UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?', [postId]);
  } else {
    await run('INSERT INTO post_likes (post_id, visitor_hash, created_at) VALUES (?, ?, ?)', [
      postId,
      visitorHash,
      nowIso(),
    ]);
    await run('UPDATE posts SET like_count = like_count + 1 WHERE id = ?', [postId]);
  }
  const count = (await scalar<number>('SELECT like_count FROM posts WHERE id = ?', [postId])) ?? 0;
  return { liked: !existing, count };
}

/* ------------------------------------------------------------------ */
/* 后台：文章管理                                                       */
/* ------------------------------------------------------------------ */
export async function adminListPosts(options: {
  status?: string;
  search?: string;
  categoryId?: number;
  deleted?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<PostListItem[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (options.deleted) {
    where.push('p.deleted_at IS NOT NULL');
  } else {
    where.push('p.deleted_at IS NULL');
  }
  if (options.status && options.status !== 'all') {
    where.push('p.status = ?');
    args.push(options.status);
  }
  if (options.categoryId) {
    where.push('p.category_id = ?');
    args.push(options.categoryId);
  }
  if (options.search) {
    where.push('(p.title LIKE ? OR p.slug LIKE ?)');
    args.push(`%${options.search}%`, `%${options.search}%`);
  }
  const rows = await all<PostListItem>(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM posts p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.updated_at DESC
      LIMIT ? OFFSET ?`,
    [...args, options.limit ?? 50, options.offset ?? 0],
  );
  return attachTags(rows);
}

export async function adminCountPosts(status?: string, deleted = false): Promise<number> {
  const where: string[] = [deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const args: unknown[] = [];
  if (status && status !== 'all') {
    where.push('status = ?');
    args.push(status);
  }
  return (await scalar<number>(`SELECT COUNT(*) FROM posts WHERE ${where.join(' AND ')}`, args)) ?? 0;
}

export async function adminListTils(options: { limit?: number; offset?: number; deleted?: boolean } = {}): Promise<Til[]> {
  const rows = await all<Til>(
    `SELECT * FROM tils WHERE ${options.deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'}
      ORDER BY COALESCE(published_at, created_at) DESC LIMIT ? OFFSET ?`,
    [options.limit ?? 50, options.offset ?? 0],
  );
  return attachTilTags(rows);
}

export async function getTilById(id: number): Promise<Til | null> {
  return one<Til>('SELECT * FROM tils WHERE id = ?', [id]);
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                */
/* ------------------------------------------------------------------ */
export async function searchAll(query: string, limit = 20) {
  const posts = await listPosts({ search: query, limit });
  const tils = await listTils({ search: query, limit: Math.max(5, Math.floor(limit / 2)) });
  return { posts, tils };
}
