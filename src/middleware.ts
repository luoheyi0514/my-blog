import { defineMiddleware } from 'astro:middleware';
import { ensureReady } from './lib/db';
import { getSessionUser } from './lib/auth';

const PUBLIC_ADMIN_PATHS = ['/admin/login'];

export const onRequest = defineMiddleware(async (context, next) => {
  await ensureReady();

  context.locals.user = await getSessionUser(context.cookies);

  const { pathname, search } = context.url;
  const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/');
  const isPublic = PUBLIC_ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isAdminPage && !isPublic && !context.locals.user) {
    const target = encodeURIComponent(pathname + search);
    return context.redirect(`/admin/login?next=${target}`);
  }

  if (isPublic && context.locals.user && !pathname.startsWith('/api/')) {
    const nextParam = context.url.searchParams.get('next');
    return context.redirect(nextParam && nextParam.startsWith('/') ? nextParam : '/admin');
  }

  const response = await next();

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
});
