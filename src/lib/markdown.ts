import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import GithubSlugger from 'github-slugger';
import { toString as hastToString } from 'hast-util-to-string';
import { createHighlighter } from 'shiki';
import type { TocItem } from './types';
import { countWords, readingTime } from './utils';

const LANGS = [
  'javascript', 'js', 'jsx', 'typescript', 'ts', 'tsx', 'json', 'jsonc',
  'bash', 'shell', 'sh', 'zsh', 'powershell', 'html', 'css', 'scss', 'less',
  'vue', 'svelte', 'astro', 'python', 'go', 'java', 'kotlin', 'rust', 'c',
  'cpp', 'csharp', 'php', 'ruby', 'swift', 'dart', 'sql', 'yaml', 'toml',
  'ini', 'dockerfile', 'nginx', 'http', 'xml', 'graphql', 'prisma', 'diff',
  'markdown', 'md', 'makefile', 'lua', 'r', 'perl', 'scala', 'text', 'plaintext',
];

const LANG_LABEL: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  bash: 'Bash',
  shell: 'Shell',
  sh: 'Shell',
  md: 'Markdown',
  markdown: 'Markdown',
  plaintext: 'Text',
  text: 'Text',
  cpp: 'C++',
  csharp: 'C#',
  py: 'Python',
};

const CALLOUT_TITLES: Record<string, string> = {
  tip: '技巧',
  note: '说明',
  info: '说明',
  warning: '注意',
  danger: '危险',
};

let highlighterPromise: Promise<Awaited<ReturnType<typeof createHighlighter>>> | null = null;

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: LANGS,
    });
  }
  return highlighterPromise;
}

/* ------------------------------------------------------------------ */
/* remark: GitHub 风格提示块  > [!TIP] 内容                            */
/* ------------------------------------------------------------------ */
function remarkCallouts() {
  return (tree: any) => {
    visit(tree, 'blockquote', (node: any) => {
      const first = node.children?.[0];
      if (!first || first.type !== 'paragraph') return;
      const textNode = first.children?.[0];
      if (!textNode || textNode.type !== 'text') return;
      const match = /^\[!(TIP|NOTE|INFO|WARNING|DANGER)\][ \t]*\n?/i.exec(textNode.value);
      if (!match) return;

      const type = match[1].toLowerCase();
      textNode.value = textNode.value.slice(match[0].length);
      if (!textNode.value.trim()) first.children.shift();
      if (!first.children.length) node.children.shift();

      node.data = node.data || {};
      node.data.hName = 'div';
      node.data.hProperties = {
        className: ['callout', `callout-${type}`],
        'data-callout': type,
      };
      node.children.unshift({
        type: 'paragraph',
        data: {
          hName: 'p',
          hProperties: { className: ['callout-title'] },
        },
        children: [{ type: 'text', value: CALLOUT_TITLES[type] ?? '说明' }],
      });
    });
  };
}

/* ------------------------------------------------------------------ */
/* rehype: 代码高亮                                                    */
/* ------------------------------------------------------------------ */
function rehypeShiki(highlighter: any) {
  return (tree: any) => {
    const targets: { node: any; parent: any; index: number }[] = [];
    visit(tree, 'element', (node: any, index: any, parent: any) => {
      if (node.tagName === 'pre' && parent && typeof index === 'number') {
        targets.push({ node, parent, index });
      }
    });

    for (const target of targets) {
      const pre = target.node;
      const codeEl = pre.children?.find((c: any) => c.tagName === 'code');
      if (!codeEl) continue;

      const classes = Array.isArray(codeEl.properties?.className) ? codeEl.properties.className : [];
      const langClass = classes.find((c: string) => String(c).startsWith('language-'));
      const rawLang = langClass ? String(langClass).slice('language-'.length) : 'text';
      const lang = LANGS.includes(rawLang) ? rawLang : 'text';
      const code = hastToString(codeEl).replace(/\n$/, '');

      let hast: any;
      try {
        hast = highlighter.codeToHast(code, {
          lang,
          themes: { light: 'github-light', dark: 'github-dark' },
        });
      } catch {
        continue;
      }

      const highlightedPre = hast.children?.[0];
      if (!highlightedPre) continue;
      highlightedPre.properties = {
        ...(highlightedPre.properties ?? {}),
        'data-lang': lang,
      };

      const label = LANG_LABEL[rawLang] ?? rawLang.toUpperCase();

      target.parent.children[target.index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['code-block'], 'data-lang': lang },
        children: [
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['code-block-head'] },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['code-lang'] },
                children: [{ type: 'text', value: label }],
              },
            ],
          },
          highlightedPre,
        ],
      };
    }
  };
}

/* ------------------------------------------------------------------ */
/* rehype: 外链 / 图片处理                                             */
/* ------------------------------------------------------------------ */
function rehypeLinkAndImage() {
  return (tree: any) => {
    visit(tree, 'element', (node: any) => {
      if (node.tagName === 'a') {
        const href = String(node.properties?.href ?? '');
        if (/^https?:\/\//i.test(href)) {
          node.properties = {
            ...node.properties,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: [...(node.properties.className ?? []), 'external-link'],
          };
        }
      }
      if (node.tagName === 'img') {
        node.properties = {
          ...node.properties,
          loading: 'lazy',
          decoding: 'async',
        };
      }
      if (node.tagName === 'table') {
        node.properties = { ...node.properties, className: ['table-wrap'] };
      }
    });
  };
}

/* ------------------------------------------------------------------ */
/* 目录提取                                                            */
/* ------------------------------------------------------------------ */
function collectToc(tree: any): TocItem[] {
  const slugger = new GithubSlugger();
  const toc: TocItem[] = [];
  visit(tree, 'heading', (node: any) => {
    const text = flattenText(node);
    const slug = slugger.slug(text);
    if (node.depth === 2 || node.depth === 3) toc.push({ depth: node.depth, text, slug });
  });
  return toc;
}

function flattenText(node: any): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) return node.children.map(flattenText).join('');
  return '';
}

export interface RenderResult {
  html: string;
  toc: TocItem[];
  tocJson: string;
  wordCount: number;
  readingTime: number;
}

export async function renderMarkdown(markdown: string): Promise<RenderResult> {
  const source = markdown || '';
  const parser = unified().use(remarkParse).use(remarkGfm);
  const mdast = parser.parse(source);
  const toc = collectToc(mdast);
  const words = countWords(source);

  const highlighter = await getHighlighter();

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCallouts)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: 'append',
      properties: {
        className: ['heading-anchor'],
        ariaLabel: '锚点链接',
      },
      content: { type: 'text', value: '#' },
    })
    .use(rehypeLinkAndImage)
    .use(rehypeShiki, highlighter)
    .use(rehypeStringify)
    .process(source);

  return {
    html: String(file),
    toc,
    tocJson: JSON.stringify(toc),
    wordCount: words,
    readingTime: readingTime(words),
  };
}

/** 只渲染 HTML，用于编辑器实时预览（快速路径） */
export async function renderHtml(markdown: string): Promise<string> {
  const result = await renderMarkdown(markdown);
  return result.html;
}
