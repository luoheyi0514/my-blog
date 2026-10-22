import type { APIRoute } from 'astro';
import { searchAll } from '../../lib/queries';
import { excerpt } from '../../lib/utils';
import { json } from '../../lib/api';

export const GET: APIRoute = async ({ url }) => {
  const query = (url.searchParams.get('q') ?? '').trim();
  if (!query) return json({ results: [] });

  const { posts, tils } = await searchAll(query, 12);
  const results = [
    ...posts.map((post) => ({
      title: post.title,
      href: `/posts/${post.slug}`,
      type: 'post',
      snippet: post.description || excerpt(post.content_md, 90),
    })),
    ...tils.map((til) => ({
      title: til.title,
      href: `/til#til-${til.id}`,
      type: 'til',
      snippet: excerpt(til.content_md, 90),
    })),
  ];

  return json({ results });
};
