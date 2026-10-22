import type { APIRoute } from 'astro';
import { getMediaBlob } from '../../../lib/queries';

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('Not found', { status: 404 });

  const row = await getMediaBlob(id);
  if (!row) return new Response('Not found', { status: 404 });

  const data = row.data;
  const buffer =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : (data as unknown as Uint8Array);

  return new Response(buffer, {
    headers: {
      'content-type': row.mime,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
