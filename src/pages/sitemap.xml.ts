import type { APIRoute } from 'astro';
import { getCategories, getSeriesList, getTags, listPosts } from '../lib/queries';

export const GET: APIRoute = async ({ site, url }) => {
  const base = (site ?? url).origin;
  const [posts, categories, tags, seriesList] = await Promise.all([
    listPosts({ limit: 1000 }),
    getCategories(),
    getTags(),
    getSeriesList(),
  ]);

  const staticPaths = ['/', '/posts', '/categories', '/tags', '/archive', '/series', '/til', '/roadmap', '/projects', '/about'];

  const urls = [
    ...staticPaths.map((path) => ({ loc: `${base}${path}`, lastmod: null as string | null })),
    ...posts.map((post) => ({ loc: `${base}/posts/${post.slug}`, lastmod: post.updated_at })),
    ...categories.map((item) => ({ loc: `${base}/categories/${item.slug}`, lastmod: null })),
    ...tags.map((item) => ({ loc: `${base}/tags/${item.slug}`, lastmod: null })),
    ...seriesList.map((item) => ({ loc: `${base}/series/${item.slug}`, lastmod: null })),
  ];

  const body = urls
    .map(
      (item) => `  <url>
    <loc>${item.loc}</loc>${item.lastmod ? `\n    <lastmod>${item.lastmod.slice(0, 10)}</lastmod>` : ''}
  </url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
