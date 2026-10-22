import type { APIRoute } from 'astro';
import { destroySession } from '../../../lib/auth';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  await destroySession(cookies);
  return redirect('/', 303);
};

export const GET: APIRoute = async ({ cookies, redirect }) => {
  await destroySession(cookies);
  return redirect('/', 303);
};
