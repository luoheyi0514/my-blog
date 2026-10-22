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

  // 分类：按大数据开发的技术方向划分
  const categories: [string, string, string, string][] = [
    ['数据仓库', 'data-warehouse', '🏛️', '分层设计、维度建模、数据治理与指标体系'],
    ['计算引擎', 'compute-engine', '⚡', 'Spark、MapReduce、Presto / Trino 原理与调优'],
    ['实时计算', 'streaming', '🌊', 'Flink、Kafka、实时数仓与 CDC'],
    ['存储与 OLAP', 'olap-storage', '🗄️', 'HDFS、HBase、StarRocks、ClickHouse、数据湖'],
    ['SQL 与编程', 'programming', '⌨️', 'SQL 进阶、Java / Scala / Python 与数据结构'],
    ['调度与运维', 'devops', '🛠️', 'DolphinScheduler、Airflow、Linux、Docker / K8s'],
    ['计算机基础', 'fundamentals', '📚', '操作系统、网络、分布式系统理论'],
    ['随笔', 'essay', '✍️', '学习方法、面试复盘与思考'],
  ];
  let order = 0;
  for (const [name, slug, icon, description] of categories) {
    await run(
      'INSERT OR IGNORE INTO categories (name, slug, icon, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [name, slug, icon, description, order++, now],
    );
  }

  // 标签
  const tagNames = [
    'Hive', 'Spark', 'Flink', 'Kafka', 'StarRocks', 'Hadoop', 'SQL', '窗口函数',
    '数据建模', '数仓分层', '数据倾斜', '性能调优', '数据质量', '面试', 'Linux',
  ];
  for (const name of tagNames) {
    await run('INSERT OR IGNORE INTO tags (name, slug, created_at) VALUES (?, ?, ?)', [name, slugifyTag(name), now]);
  }

  // 专栏
  const seriesSeeds = [
    {
      name: '数仓建模实战',
      slug: 'data-warehouse-modeling',
      description: '从分层设计到维度建模、从指标体系到数据治理，系统梳理离线数仓的建设方法。',
      featured: 1,
      planned: ['维度建模：事实表的三种类型', '缓慢变化维与拉链表', '指标体系：原子指标与派生指标', '数据质量监控怎么做'],
    },
    {
      name: 'Spark 从原理到调优',
      slug: 'spark-in-depth',
      description: '理解 RDD、Shuffle、内存模型与执行计划，解决生产中的性能问题。',
      featured: 1,
      planned: ['Spark 任务是怎么跑起来的：Job / Stage / Task', 'Shuffle 机制演进', '内存管理与 OOM 排查', 'Spark SQL 执行计划解读'],
    },
    {
      name: 'Flink 实时计算入门',
      slug: 'flink-getting-started',
      description: '从时间语义、窗口、状态到 Exactly-Once，搭建第一条实时数据链路。',
      featured: 0,
      planned: ['流处理与批处理的本质区别', '事件时间与 Watermark', '窗口：滚动、滑动与会话', '状态与 Checkpoint', 'Flink SQL 实时数仓实践'],
    },
  ];
  const seriesIds: Record<string, number> = {};
  let seriesOrder = 0;
  for (const series of seriesSeeds) {
    const result = await run(
      `INSERT INTO series (name, slug, description, status, featured, planned_chapters, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'ongoing', ?, ?, ?, ?, ?)`,
      [series.name, series.slug, series.description, series.featured, JSON.stringify(series.planned), seriesOrder++, now, now],
    );
    seriesIds[series.slug] = Number(result.lastInsertRowid);
  }

  // 文章
  const postSeeds: {
    slug: string;
    title: string;
    description: string;
    categorySlug: string;
    pinned: number;
    tags: string[];
    seriesSlug: string | null;
    seriesOrder: number | null;
    content: string;
    daysAgo: number;
  }[] = [
    {
      slug: 'data-warehouse-layering',
      title: '数仓分层设计：ODS / DWD / DWS / ADS 到底怎么分',
      description: '分层的目的是复用和隔离变化。讲清每一层的职责、命名规范和常见的坑。',
      categorySlug: 'data-warehouse',
      pinned: 1,
      tags: ['数仓分层', '数据建模', 'Hive', 'SQL'],
      seriesSlug: 'data-warehouse-modeling',
      seriesOrder: 1,
      content: seedPost1,
      daysAgo: 0,
    },
    {
      slug: 'spark-data-skew',
      title: 'Spark 数据倾斜：从定位到解决的五种方法',
      description: '199 个 task 秒完，1 个 task 跑一个半小时。怎么判断倾斜、找到热点 key，并选择合适的解法。',
      categorySlug: 'compute-engine',
      pinned: 0,
      tags: ['Spark', '数据倾斜', '性能调优'],
      seriesSlug: 'spark-in-depth',
      seriesOrder: 1,
      content: seedPost2,
      daysAgo: 3,
    },
    {
      slug: 'sql-continuous-login',
      title: 'SQL 经典题：连续登录 N 天的用户怎么找',
      description: '「日期减行号」与「打标记 + 累加」两个套路，覆盖绝大多数连续、会话类 SQL 问题。',
      categorySlug: 'programming',
      pinned: 0,
      tags: ['SQL', '窗口函数', '面试'],
      seriesSlug: null,
      seriesOrder: null,
      content: seedPost3,
      daysAgo: 6,
    },
  ];

  const postIds: Record<string, number> = {};
  for (const seedPost of postSeeds) {
    const rendered = await renderMarkdown(seedPost.content);
    const publishedAt = new Date(Date.now() - seedPost.daysAgo * 86400000).toISOString();
    const category = await one<{ id: number }>('SELECT id FROM categories WHERE slug = ?', [seedPost.categorySlug]);
    const result = await run(
      `INSERT INTO posts (slug, title, description, content_md, content_html, toc_json, category_id, series_id, series_order,
        status, published_at, pinned, allow_comments, word_count, reading_time, view_count, like_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, 1, ?, ?, 0, 0, ?, ?)`,
      [
        seedPost.slug,
        seedPost.title,
        seedPost.description,
        seedPost.content,
        rendered.html,
        rendered.tocJson,
        category?.id ?? null,
        seedPost.seriesSlug ? (seriesIds[seedPost.seriesSlug] ?? null) : null,
        seedPost.seriesOrder,
        publishedAt,
        seedPost.pinned,
        rendered.wordCount,
        rendered.readingTime,
        publishedAt,
        publishedAt,
      ],
    );
    const postId = Number(result.lastInsertRowid);
    postIds[seedPost.slug] = postId;
    for (const tagName of seedPost.tags) {
      const tag = await one<{ id: number }>('SELECT id FROM tags WHERE name = ?', [tagName]);
      if (tag) await run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, tag.id]);
    }
  }

  // TIL
  const tils = [
    {
      title: 'COUNT(col) 不统计 NULL，但会统计空字符串',
      content:
        "`COUNT(*)` 统计所有行，`COUNT(col)` 会跳过 `NULL`，但空字符串 `''` 照样计数。\n\n统计「有效手机号数」这类指标时，要写成 `COUNT(CASE WHEN phone <> '' THEN phone END)`，否则空字符串会被算进去。",
      tags: ['SQL', '数据质量'],
      daysAgo: 1,
    },
    {
      title: 'Kafka 只保证分区内有序',
      content:
        'Kafka 的顺序性是**分区级别**的，跨分区不保证顺序。\n\n需要保证同一个订单的事件有序，就要用订单 ID 作为消息 key，让同一个订单的消息落到同一个分区。',
      tags: ['Kafka'],
      daysAgo: 2,
    },
    {
      title: '分区字段套函数会导致分区裁剪失效',
      content:
        "`WHERE substr(dt, 1, 7) = '2026-10'` 在很多引擎里无法裁剪分区，会扫描全部分区。\n\n改成范围写法：`WHERE dt >= '2026-10-01' AND dt <= '2026-10-31'`，让分区字段直接参与比较。",
      tags: ['Hive', 'StarRocks', '性能调优'],
      daysAgo: 4,
    },
    {
      title: 'Spark 3 的 AQE 可以自动合并小分区',
      content:
        '开启 `spark.sql.adaptive.enabled=true` 后，AQE 会在 Shuffle 之后根据实际数据量合并过小的分区（`spark.sql.adaptive.coalescePartitions.enabled` 默认开启），不再需要手动反复调整 `spark.sql.shuffle.partitions`。',
      tags: ['Spark', '性能调优'],
      daysAgo: 8,
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

  // 学习路线：按大数据开发工程师的成长阶段组织
  type ItemSeed = {
    name: string;
    icon: string;
    status: 'planned' | 'learning' | 'mastered';
    progress: number;
    start?: string;
    end?: string;
    note?: string;
    links?: { type: 'post' | 'series'; slug: string; label: string }[];
  };
  const areas: { name: string; items: ItemSeed[] }[] = [
    {
      name: '阶段 1 · 编程与基础',
      items: [
        {
          name: 'SQL 进阶（窗口函数 / 复杂查询）', icon: '🧾', status: 'mastered', progress: 90,
          start: '2024-03', end: '2025-01', note: '数据开发的第一语言，面试必考',
          links: [{ type: 'post', slug: 'sql-continuous-login', label: '连续登录问题' }],
        },
        { name: 'Linux 与 Shell', icon: '🐧', status: 'mastered', progress: 80, start: '2024-03', end: '2024-10', note: '日志排查、脚本调度、常用命令' },
        { name: 'Python', icon: '🐍', status: 'mastered', progress: 75, start: '2024-05', end: '2025-03', note: '数据处理脚本、PySpark、自动化工具' },
        { name: 'Java / Scala', icon: '☕', status: 'learning', progress: 55, start: '2025-06', note: '读懂大数据组件源码的基础，写 UDF 与 Flink 作业' },
        { name: '数据结构与算法', icon: '🧮', status: 'learning', progress: 45, start: '2026-01', note: '刷题，并理解 LSM Tree、跳表、布隆过滤器' },
      ],
    },
    {
      name: '阶段 2 · Hadoop 生态',
      items: [
        { name: 'HDFS', icon: '📂', status: 'mastered', progress: 75, start: '2024-09', end: '2025-02', note: '块存储、副本机制、NameNode 高可用' },
        { name: 'YARN', icon: '🧶', status: 'learning', progress: 60, start: '2024-10', note: '资源调度、队列配置、任务排队排查' },
        { name: 'Hive', icon: '🐝', status: 'mastered', progress: 85, start: '2024-09', end: '2025-06', note: 'HQL、分区分桶、ORC / Parquet 存储格式' },
        { name: 'MapReduce 原理', icon: '🔁', status: 'mastered', progress: 70, start: '2024-10', end: '2025-01', note: '理解 Shuffle 的起点' },
        { name: 'ZooKeeper / HBase', icon: '🗃️', status: 'planned', progress: 15, note: '分布式协调与 KV 存储' },
      ],
    },
    {
      name: '阶段 3 · 离线计算引擎',
      items: [
        {
          name: 'Spark Core / SQL', icon: '⚡', status: 'learning', progress: 65, start: '2025-03', note: 'RDD、DAG、Shuffle、执行计划',
          links: [
            { type: 'series', slug: 'spark-in-depth', label: 'Spark 专栏' },
            { type: 'post', slug: 'spark-data-skew', label: '数据倾斜' },
          ],
        },
        { name: 'Spark 性能调优', icon: '🚀', status: 'learning', progress: 50, start: '2025-09', note: '倾斜、小文件、内存、AQE' },
        { name: 'Presto / Trino', icon: '🔎', status: 'planned', progress: 10, note: '交互式查询与联邦查询' },
      ],
    },
    {
      name: '阶段 4 · 数据仓库',
      items: [
        {
          name: '数仓分层设计', icon: '🏛️', status: 'mastered', progress: 85, start: '2025-01', end: '2025-09',
          note: 'ODS / DWD / DWS / ADS 职责与规范',
          links: [{ type: 'post', slug: 'data-warehouse-layering', label: '分层设计' }],
        },
        {
          name: '维度建模', icon: '⭐', status: 'learning', progress: 65, start: '2025-04', note: '星型模型、事实表类型、缓慢变化维',
          links: [{ type: 'series', slug: 'data-warehouse-modeling', label: '数仓建模专栏' }],
        },
        { name: '指标体系', icon: '📊', status: 'learning', progress: 50, start: '2025-10', note: '原子指标、派生指标、口径管理' },
        { name: '数据质量与治理', icon: '🛡️', status: 'learning', progress: 55, start: '2025-08', note: 'DQC 规则、血缘、元数据管理' },
      ],
    },
    {
      name: '阶段 5 · 实时计算',
      items: [
        { name: 'Kafka', icon: '📨', status: 'learning', progress: 45, start: '2026-03', note: '分区、副本、消费者组、Exactly-Once' },
        {
          name: 'Flink', icon: '🌊', status: 'learning', progress: 30, start: '2026-06', note: '时间语义、窗口、状态、Checkpoint',
          links: [{ type: 'series', slug: 'flink-getting-started', label: 'Flink 专栏' }],
        },
        { name: 'Flink CDC / 实时数仓', icon: '🔄', status: 'planned', progress: 5, note: '业务库变更实时入仓' },
      ],
    },
    {
      name: '阶段 6 · OLAP 与数据湖',
      items: [
        { name: 'StarRocks / Doris', icon: '✨', status: 'mastered', progress: 75, start: '2025-05', end: '2026-04', note: '表模型、分区分桶、物化视图、执行计划' },
        { name: 'ClickHouse', icon: '🟨', status: 'planned', progress: 15, note: 'MergeTree 家族与列存原理' },
        { name: 'Iceberg / Paimon', icon: '🧊', status: 'planned', progress: 5, note: '湖仓一体、ACID 与时间旅行' },
      ],
    },
    {
      name: '阶段 7 · 调度与工程化',
      items: [
        { name: '任务调度（DolphinScheduler / Airflow）', icon: '⏱️', status: 'mastered', progress: 80, start: '2024-11', end: '2025-08', note: '依赖编排、补数、告警' },
        { name: 'Git 与 CI/CD', icon: '🔀', status: 'mastered', progress: 75, start: '2024-03', end: '2024-12', note: 'SQL 代码评审与自动发布' },
        { name: 'Docker / Kubernetes', icon: '🐳', status: 'planned', progress: 20, note: '本地搭建大数据环境、Spark on K8s' },
      ],
    },
  ];

  let areaOrder = 0;
  for (const area of areas) {
    const areaResult = await run('INSERT INTO roadmap_areas (name, sort_order) VALUES (?, ?)', [area.name, areaOrder++]);
    const areaId = Number(areaResult.lastInsertRowid);
    let itemOrder = 0;
    for (const item of area.items) {
      const itemResult = await run(
        `INSERT INTO roadmap_items (area_id, name, icon, status, progress, start_date, end_date, note, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [areaId, item.name, item.icon, item.status, item.progress, item.start ?? null, item.end ?? null, item.note ?? null, itemOrder++],
      );
      const itemId = Number(itemResult.lastInsertRowid);
      for (const link of item.links ?? []) {
        const targetId = link.type === 'post' ? postIds[link.slug] : seriesIds[link.slug];
        if (targetId) {
          await run('INSERT INTO roadmap_links (item_id, type, target_id, label) VALUES (?, ?, ?, ?)', [
            itemId,
            link.type,
            targetId,
            link.label,
          ]);
        }
      }
    }
  }

  // 项目
  const projects = [
    {
      name: '电商离线数仓实践',
      description: '基于模拟电商数据，从业务库同步到 ODS，按分层规范建设交易、用户、商品主题域，产出 GMV、留存、转化漏斗等报表。',
      tech: ['Hive', 'Spark SQL', 'DolphinScheduler', 'MySQL'],
      status: 'developing',
      repo: '',
      featured: 1,
    },
    {
      name: '实时 GMV 大屏',
      description: 'Flink 消费 Kafka 订单流，按分钟聚合写入 StarRocks，看板秒级刷新。',
      tech: ['Flink', 'Kafka', 'StarRocks'],
      status: 'developing',
      repo: '',
      featured: 0,
    },
    {
      name: '数据质量巡检工具',
      description: '配置化定义主键唯一、非空、波动阈值等规则，定时巡检并推送告警。',
      tech: ['Python', 'SQL', 'StarRocks'],
      status: 'completed',
      repo: '',
      featured: 0,
    },
    {
      name: '个人技术博客',
      description: '就是你正在看的这个站点：Astro + libSQL，支持在线写作与学习路线记录。',
      tech: ['Astro', 'TypeScript', 'Tailwind', 'SQLite'],
      status: 'completed',
      repo: 'https://github.com/luoheyi0514/my-blog',
      featured: 0,
    },
  ];
  let projectOrder = 0;
  for (const project of projects) {
    await run(
      `INSERT INTO projects (name, description, cover_url, tech_stack, repo_url, demo_url, status, featured, sort_order, created_at)
       VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        project.name,
        project.description,
        JSON.stringify(project.tech),
        project.repo || null,
        project.status,
        project.featured,
        projectOrder++,
        now,
      ],
    );
  }

  await setMeta('seeded', 'v2-bigdata');
}
