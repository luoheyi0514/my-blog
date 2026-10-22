/**
 * 同时兼容 Node 运行时（process.env，Vercel）与 Astro 构建时（import.meta.env，.env 文件）
 */
export function env(key: string, fallback = ''): string {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  const fromImport = (import.meta.env as Record<string, unknown>)[key];
  if (typeof fromImport === 'string' && fromImport !== '') return fromImport;
  return fallback;
}

export const isProd = import.meta.env.PROD;
