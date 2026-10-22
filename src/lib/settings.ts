import { all, run } from './db';
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  site_name: '不知名XL 的技术笔记',
  site_subtitle: '数据 · 建模 · 计算',
  site_description: '一名大数据开发工程师的学习记录：数仓建模、Spark / Flink、OLAP 与数据治理，从离线到实时的成长路线。',
  author_name: '不知名XL',
  author_avatar: '',
  author_bio: '大数据开发工程师，做离线 / 实时数仓与数据治理。把踩过的坑和学到的原理写下来，让它真正变成自己的东西。',
  tech_stack: ['SQL', 'Hive', 'Spark', 'Flink', 'Kafka', 'StarRocks', 'Python', 'Java'],
  socials: [
    { label: 'GitHub', url: 'https://github.com/luoheyi0514' },
  ],
  about_md: `## 关于我

你好，我是 不知名XL，一名大数据开发工程师。

日常工作是数据仓库建设：从业务库同步数据、分层建模、开发 ETL 任务，到配置数据质量规则、排查任务失败和性能问题。

这个博客是我的学习记录本，按照大数据开发的成长路线来组织内容。

## 我在学什么

| 阶段 | 内容 |
| --- | --- |
| 编程与基础 | SQL 进阶、Linux、Python、Java / Scala |
| Hadoop 生态 | HDFS、YARN、Hive |
| 离线计算 | Spark 原理与调优 |
| 数据仓库 | 分层设计、维度建模、指标体系、数据治理 |
| 实时计算 | Kafka、Flink、实时数仓 |
| OLAP 与数据湖 | StarRocks、ClickHouse、Iceberg / Paimon |
| 调度与工程化 | DolphinScheduler、CI/CD、Docker / K8s |

每一项的进度都在 [学习路线](/roadmap) 页面实时更新。

## 内容怎么组织

- **专栏**：系统性的主题，比如《数仓建模实战》《Spark 从原理到调优》
- **文章**：单篇的原理分析和问题排查记录
- **TIL**：工作中随手记下的小知识点

## 关于本站

- 技术栈：Astro + TypeScript + Tailwind CSS + libSQL(SQLite)
- 内容全部通过后台 \`/admin\` 在线编写，发布即生效

## 联系我

欢迎通过 GitHub 交流。`,
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
