import type { APIRoute } from 'astro';
import { listPosts } from '../lib/queries';
import { getSettings } from '../lib/settings';
import { escapeHtml } from '../lib/utils';

export const GET: APIRoute = async ({ site, url }) => {
  const settings = await getSettings();
  const posts = await listPosts({ limit: 20 });
  const base = (site ?? url).origin;

  const items = posts
    .map((post) => {
      const link = `${base}/posts/${post.slug}`;
      return `    <item>
      <title>${escapeHtml(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(post.published_at ?? post.created_at).toUTCString()}</pubDate>
      <description>${escapeHtml(post.description ?? '')}</description>
${post.tags.map((tag) => `      <category>${escapeHtml(tag.name)}</category>`).join('\n')}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(settings.site_name)}</title>
    <link>${base}</link>
    <description>${escapeHtml(settings.site_description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
};
