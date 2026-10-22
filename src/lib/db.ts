import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { env } from './env';
import { nowIso, slugifyTag } from './utils';
import { hashPassword } from './password';
import { renderMarkdown } from './markdown';
import seedPost1 from '../seed/post-1.md?raw';
import seedPost2 from '../seed/post-2.md?raw';
import seedPost3 from '../seed/post-3.md?raw';

let client: Client | null = null;
let readyPromise: Promise<void> | null = null;

export function getDb(): Client {
  if (!client) {
    const url = env('DATABASE_URL', 'file:./data/blog.db');
    if (url.startsWith('file:')) {
      const filePath = path.resolve(process.cwd(), url.slice('file:'.length));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      client = createClient({ url: `file:${filePath}` });
    } else {
      client = createClient({
        url,
        authToken: env('DATABASE_AUTH_TOKEN') || undefined,
      });
    }
  }
  return client;
}

export async function all<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> {
  const result = await getDb().execute({ sql, args: args as never[] });
  return result.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: unknown[] = []) {
  return getDb().execute({ sql, args: args as never[] });
}

export async function scalar<T = number>(sql: string, args: unknown[] = []): Promise<T | null> {
  const row = await one<Record<string, unknown>>(sql, args);
  if (!row) return null;
  const values = Object.values(row);
  return (values[0] as T) ?? null;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    cover_url TEXT,
    status TEXT NOT NULL DEFAULT 'ongoing',
    featured INTEGER NOT NULL DEFAULT 0,
    planned_chapters TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    content_md TEXT NOT NULL DEFAULT '',
    content_html TEXT NOT NULL DEFAULT '',
    toc_json TEXT,
    cover_url TEXT,
    category_id INTEGER,
    series_id INTEGER,
    series_order INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    published_at TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    allow_comments INTEGER NOT NULL DEFAULT 1,
    word_count INTEGER NOT NULL DEFAULT 0,
    reading_time INTEGER NOT NULL DEFAULT 1,
    view_count INTEGER NOT NULL DEFAULT 0,
    like_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS post_tags (
    post_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (post_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS tils (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content_md TEXT NOT NULL DEFAULT '',
    content_html TEXT NOT NULL DEFAULT '',
    published_at TEXT,
    status TEXT NOT NULL DEFAULT 'published',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS til_tags (
    til_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (til_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS roadmap_areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS roadmap_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    progress INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    note TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS roadmap_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    label TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    tech_stack TEXT,
    repo_url TEXT,
    demo_url TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    featured INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS post_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    visitor_hash TEXT NOT NULL,
    day TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS post_likes (
    post_id INTEGER NOT NULL,
    visitor_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, visitor_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status, published_at)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_series ON posts (series_id, series_order)`,
  `CREATE INDEX IF NOT EXISTS idx_tils_published ON tils (status, published_at)`,
  `CREATE INDEX IF NOT EXISTS idx_views_post ON post_views (post_id, day)`,
];

export function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      for (const statement of SCHEMA) {
        await run(statement);
      }
      await seed();
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

async function setMeta(key: string, value: string) {
  await run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}

async function getMeta(key: string): Promise<string | null> {
  const row = await one<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

/* ------------------------------------------------------------------ */
/* 首次启动：创建管理员 + 演示内容                                       */
/* ------------------------------------------------------------------ */
async function seed() {
  const seeded = await getMeta('seeded');
  const now = nowIso();

  // 管理员账号（已存在则跳过）
  const adminEmail = env('ADMIN_EMAIL', 'admin@local.dev').trim().toLowerCase();
  const existing = await one<{ id: number }>('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (!existing) {
    await run('INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)', [
      adminEmail,
      hashPassword(env('ADMIN_PASSWORD', 'admin123456')),
      '博主',
      now,
    ]);
  }

  if (seeded) return;

  // 分类
  const categories: [string, string, string, string][] = [
    ['前端', 'frontend', '🎨', 'JavaScript、TypeScript、框架与工程化'],
    ['后端', 'backend', '⚙️', '服务端语言、框架、接口与架构'],
    ['算法与数据结构', 'algorithm', '🧮', '刷题笔记与解题思路'],
    ['数据库', 'database', '🗄️', 'SQL、索引、事务与存储'],
    ['DevOps / 工具链', 'devops', '🛠️', '部署、CI/CD、Linux 与效率工具'],
    ['计算机基础', 'fundamentals', '📚', '操作系统、网络、编译原理'],
    ['随笔', 'essay', '✍️', '学习方法、思考与记录'],
  ];
  let order = 0;
  for (const [name, slug, icon, description] of categories) {
    await run(
      'INSERT OR IGNORE INTO categories (name, slug, icon, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [name, slug, icon, description, order++, now],
    );
  }

  // 标签
  const tagNames = ['Astro', 'TypeScript', 'Node.js', 'SQLite', 'PostgreSQL', '性能优化', '工程化', '学习方法'];
  for (const name of tagNames) {
    await run('INSERT OR IGNORE INTO tags (name, slug, created_at) VALUES (?, ?, ?)', [
      name,
      slugifyTag(name),
      now,
    ]);
  }

  // 专栏
  await run(
    `INSERT INTO series (name, slug, description, status, featured, planned_chapters, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      '从零搭建个人技术博客',
      'build-your-blog',
      '从技术选型到上线运维，一步步搭建一个可以长期维护的个人博客。',
      'ongoing',
      1,
      JSON.stringify(['接入全文搜索', '评论系统集成', '图片 CDN 与性能优化']),
      0,
      now,
      now,
    ],
  );
  const seriesRow = await one<{ id: number }>('SELECT id FROM series WHERE slug = ?', ['build-your-blog']);

  const editorRow = await one<{ id: number }>('SELECT id FROM users LIMIT 1');
  const authorName = '博主';

  const postSeeds = [
    {
      slug: 'build-online-blog-with-astro',
      title: '用 Astro + SQLite 搭建一个可以在线写作的博客',
      description: '不写 Markdown 文件、不用 Git 推送，打开浏览器就能写文章并立即发布。',
      categorySlug: 'frontend',
      pinned: 1,
      tags: ['Astro', 'TypeScript', 'SQLite'],
      seriesId: seriesRow?.id ?? null,
      seriesOrder: 1,
      content: seedPost1,
      daysAgo: 0,
    },
    {
      slug: 'typescript-type-challenges',
      title: 'TypeScript 类型体操：从 Partial 到条件类型',
      description: '把常用工具类型的实现拆开看一遍，理解类型系统到底在做什么。',
      categorySlug: 'frontend',
      pinned: 0,
      tags: ['TypeScript'],
      seriesId: null,
      seriesOrder: null,
      content: seedPost2,
      daysAgo: 3,
    },
    {
      slug: 'why-postgres-index-not-used',
      title: '为什么加了索引，查询还是全表扫描？',
      description: '一次 PostgreSQL 慢查询排查记录：隐式类型转换、函数包裹与统计信息。',
      categorySlug: 'database',
      pinned: 0,
      tags: ['PostgreSQL', '性能优化'],
      seriesId: null,
      seriesOrder: null,
      content: seedPost3,
      daysAgo: 7,
    },
  ];

  for (const seedPost of postSeeds) {
    const rendered = await renderMarkdown(seedPost.content);
    const publishedAt = new Date(Date.now() - seedPost.daysAgo * 86400000).toISOString();
    const category = await one<{ id: number }>('SELECT id FROM categories WHERE slug = ?', [seedPost.categorySlug]);
    const result = await run(
      `INSERT INTO posts (slug, title, description, content_md, content_html, toc_json, category_id, series_id, series_order,
        status, published_at, pinned, allow_comments, word_count, reading_time, view_count, like_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [
        seedPost.slug,
        seedPost.title,
        seedPost.description,
        seedPost.content,
        rendered.html,
        rendered.tocJson,
        category?.id ?? null,
        seedPost.seriesId,
        seedPost.seriesOrder,
        publishedAt,
        seedPost.pinned,
        rendered.wordCount,
        rendered.readingTime,
        128,
        12,
        publishedAt,
        publishedAt,
      ],
    );
    const postId = Number(result.lastInsertRowid);
    for (const tagName of seedPost.tags) {
      const tag = await one<{ id: number }>('SELECT id FROM tags WHERE name = ?', [tagName]);
      if (tag) await run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, tag.id]);
    }
  }

  // TIL
  const tils = [
    {
      title: 'git commit --fixup 配合 rebase 自动合并',
      content:
        '改一个小 bug 时，直接 `git commit --fixup=<commit>`，然后 `git rebase -i --autosquash main`，提交会自动排到目标提交后面并标记为 fixup，省掉手动合并的步骤。',
      tags: ['工程化'],
      daysAgo: 1,
    },
    {
      title: 'CSS :has() 可以替代一层父选择器',
      content:
        '以前只能靠 JS 给父元素加 class，现在可以直接写 `form:has(input:invalid) { ... }`。注意 Safari 15.4 以下不支持。',
      tags: ['前端'],
      daysAgo: 5,
    },
  ];
  for (const til of tils) {
    const rendered = await renderMarkdown(til.content);
    const publishedAt = new Date(Date.now() - til.daysAgo * 86400000).toISOString();
    const result = await run(
      `INSERT INTO tils (title, content_md, content_html, published_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', ?, ?)`,
      [til.title, til.content, rendered.html, publishedAt, publishedAt, publishedAt],
    );
    const tilId = Number(result.lastInsertRowid);
    for (const tagName of til.tags) {
      const tag = await one<{ id: number }>('SELECT id FROM tags WHERE name = ?', [tagName]);
      if (tag) await run('INSERT OR IGNORE INTO til_tags (til_id, tag_id) VALUES (?, ?)', [tilId, tag.id]);
    }
  }

  // 学习路线
  const areas: { name: string; items: [string, string, string, number, string, string][] }[] = [
    {
      name: '前端',
      items: [
        ['React', '⚛️', 'mastered', 90, '2024-03', '2025-06'],
        ['TypeScript', '🔷', 'mastered', 85, '2024-06', '2025-03'],
        ['构建工具原理', '📦', 'learning', 60, '2026-07', ''],
        ['WebGL / 图形学', '🎮', 'planned', 0, '', ''],
      ],
    },
    {
      name: '后端',
      items: [
        ['Node.js', '🟩', 'mastered', 80, '2024-09', '2025-08'],
        ['PostgreSQL', '🐘', 'learning', 55, '2026-05', ''],
        ['Redis 与缓存设计', '⚡', 'planned', 15, '2026-11', ''],
      ],
    },
    {
      name: '计算机基础',
      items: [
        ['数据结构与算法', '🧮', 'learning', 65, '2026-01', ''],
        ['操作系统', '🖥️', 'learning', 40, '2026-08', ''],
        ['计算机网络', '🌐', 'mastered', 75, '2025-10', '2026-04'],
      ],
    },
  ];
  let areaOrder = 0;
  for (const area of areas) {
    const areaResult = await run('INSERT INTO roadmap_areas (name, sort_order) VALUES (?, ?)', [area.name, areaOrder++]);
    const areaId = Number(areaResult.lastInsertRowid);
    let itemOrder = 0;
    for (const [name, icon, status, progress, start, end] of area.items) {
      await run(
        `INSERT INTO roadmap_items (area_id, name, icon, status, progress, start_date, end_date, note, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [areaId, name, icon, status, progress, start || null, end || null, null, itemOrder++],
      );
    }
  }

  // 项目
  const projects = [
    {
      name: '个人技术博客',
      description: '基于 Astro + libSQL 的博客系统，支持在线写作、代码高亮与学习路线记录。',
      tech: 'Astro,TypeScript,Tailwind,SQLite',
      repo: 'https://github.com/luoheyi0514/my-blog',
      demo: '',
      featured: 1,
    },
    {
      name: '数据看板组件库',
      description: '一套面向运营场景的图表组件，封装了加载态、空状态与响应式布局。',
      tech: 'React,ECharts,TypeScript',
      repo: '',
      demo: '',
      featured: 0,
    },
  ];
  let projectOrder = 0;
  for (const project of projects) {
    await run(
      `INSERT INTO projects (name, description, cover_url, tech_stack, repo_url, demo_url, status, featured, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      [
        project.name,
        project.description,
        null,
        project.tech,
        project.repo || null,
        project.demo || null,
        project.featured,
        projectOrder++,
        now,
      ],
    );
  }

  await setMeta('seeded', 'v1');
  if (editorRow) await setMeta('author', authorName);
}
