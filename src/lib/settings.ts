import { all, run } from './db';
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  site_name: '不知名XL 的技术笔记',
  site_subtitle: '记录 · 整理 · 复盘',
  site_description: '一个前端 / 全栈开发者的学习记录：技术笔记、专栏文章、碎片灵感与学习路线。',
  author_name: '不知名XL',
  author_avatar: '',
  author_bio: '前端 / 全栈开发者，把学过的、踩过的坑写下来，让它变成自己的东西。',
  tech_stack: ['TypeScript', 'React', 'Node.js', 'Go', 'PostgreSQL', 'Docker'],
  socials: [
    { label: 'GitHub', url: 'https://github.com/luoheyi0514' },
  ],
  about_md: `## 关于我

你好，我是 不知名XL，一名前端 / 全栈开发者。

平时喜欢把一个东西拆开看清楚再动手，这个博客就是我的学习记录本。

## 关于本站

- 技术栈：Astro + TypeScript + Tailwind CSS + libSQL(SQLite)
- 内容全部通过后台 \`/admin\` 在线编写，发布即生效
- 代码高亮使用 Shiki，支持深浅色双主题

## 联系我

可以通过左侧的社交链接找到我，欢迎交流。`,
  posts_per_page: 10,
  homepage: {
    show_latest_posts: true,
    show_series: true,
    show_til: true,
    show_roadmap: true,
  },
  giscus: {
    enabled: false,
    repo: '',
    repo_id: '',
    category: 'Announcements',
    category_id: '',
  },
};

export async function getSettings(): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>('SELECT key, value FROM site_settings');
  const merged: Settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      (merged as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    } catch {
      (merged as Record<string, unknown>)[row.key] = row.value;
    }
  }
  return merged;
}

export async function saveSetting(key: string, value: unknown) {
  await run('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
}
