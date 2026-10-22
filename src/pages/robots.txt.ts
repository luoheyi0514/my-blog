import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ site, url }) => {
  const base = (site ?? url).origin;
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api

Sitemap: ${base}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
