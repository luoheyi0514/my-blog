const CN_MONTH = (m: number) => `${m + 1} 月`;

export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  // SQLite 存的是 ISO 字符串，兼容 "2026-10-22 10:00:00"
  const normalized = typeof value === 'string' ? value.replace(' ', 'T') : value;
  const d = normalized instanceof Date ? normalized : new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 2026-10-22 */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 2026 年 10 月 22 日 */
export function formatDateLong(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 10-22 */
export function formatDateShort(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 3 天前 / 2 个月前 */
export function formatRelative(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))} 个月前`;
  return `${Math.floor(diff / (365 * day))} 年前`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 用于 <input type="datetime-local"> */
export function toLocalInput(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 中英文混排字数统计：中文按字，英文按词 */
export function countWords(text: string): number {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ');
  const cn = plain.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const en = plain.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
  return cn + en;
}

export function readingTime(words: number): number {
  return Math.max(1, Math.round(words / 300));
}

export function excerpt(md: string, max = 120): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? plain.slice(0, max) + '…' : plain;
}

/** 生成 URL 友好的 slug（中文标题会退化为时间戳形式） */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/[\u4e00-\u9fa5]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length >= 2) return base.slice(0, 60);
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `post-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 标签 slug：保留中文，便于直接阅读 */
export function slugifyTag(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5.#+-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `tag-${Date.now().toString(36)}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function groupByYearMonth<T extends { published_at: string | null }>(items: T[]) {
  const years = new Map<string, Map<string, T[]>>();
  for (const item of items) {
    const d = toDate(item.published_at);
    if (!d) continue;
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1);
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y)!;
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(item);
  }
  return [...years.entries()].map(([year, months]) => ({
    year,
    count: [...months.values()].reduce((a, b) => a + b.length, 0),
    months: [...months.entries()].map(([month, items]) => ({
      month: Number(month),
      label: CN_MONTH(Number(month) - 1),
      items,
    })),
  }));
}
