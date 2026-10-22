做博客这件事，我折腾过好几轮：最早是 Hexo，后来换成纯静态的 Markdown 方案。每次写文章都要「打开编辑器 → 新建文件 → 填 frontmatter → git push → 等构建」，流程一长，写作的欲望就被消磨掉了。

这次换了个思路：**内容存数据库，写作在浏览器里完成**。

## 为什么不再用纯静态方案

静态博客的优点很明确：快、免费、可版本管理。但它的写入路径是「文件 + 构建」，这意味着：

| 场景 | 纯静态 | 数据库方案 |
| --- | --- | --- |
| 在地铁上想记一条笔记 | 需要电脑 + 编辑器 + 推送 | 手机打开网页就能写 |
| 修正一个错别字 | 提交一次 commit，等 1 分钟构建 | 修改后立即生效 |
| 上传一张截图 | 先存到仓库，再引用路径 | 直接粘贴 |
| 想给文章加阅读量 | 需要接第三方服务 | 一张表就能搞定 |

> [!NOTE]
> 纯静态方案并没有「错」，它只是更适合「一次写完整篇、长期不再修改」的文档站。而学习笔记的特点是碎片、频繁更新。

所以最终选型是：**Astro 负责渲染，SQLite 负责存储**。

## 整体结构

页面请求进来之后，先经过中间件校验登录态，再由页面组件直接查询数据库，最后把 HTML 返回给浏览器。

~~~ts
// src/middleware.ts
export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = await getSessionUser(context.cookies);

  const { pathname } = context.url;
  if (pathname.startsWith('/admin') && pathname !== '/admin/login' && !context.locals.user) {
    return context.redirect('/admin/login');
  }
  return next();
});
~~~

关键点是**渲染发生在服务端**：文章保存时就把 Markdown 转成 HTML 存进 `content_html` 字段，读取时不需要再做一次转换。

~~~ts
export async function renderMarkdown(markdown: string) {
  const html = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeStringify)
    .process(markdown);

  return { html: String(html) };
}
~~~

## 数据库设计上的几个取舍

### 1. 内容表只存一份原文

`content_md` 是编辑时的唯一数据源，`content_html` 是派生数据。这样做的好处是：修改渲染规则后，可以写一个脚本把所有文章重新渲染一遍，不用担心历史数据格式不一致。

### 2. 软删除

`deleted_at` 不为空即视为已删除，回收站因此变成了一个简单的 `WHERE deleted_at IS NOT NULL` 查询。

~~~sql
SELECT * FROM posts
WHERE deleted_at IS NOT NULL
  AND deleted_at < date('now', '-30 days');
~~~

### 3. 定时发布不依赖定时任务

把 `published_at` 设成未来时间，前台查询时加一个条件即可：

~~~sql
WHERE status = 'published'
  AND published_at <= CURRENT_TIMESTAMP
~~~

> [!TIP]
> 用「查询时过滤」代替「定时改状态」，省掉了一个定时任务，也不会因为任务失败导致文章没发出来。

## 写作体验是怎么保证的

后台编辑器做了几件小事，但很影响手感：

1. **自动保存**：内容变化 30 秒后写入数据库，同时往 localStorage 写一份兜底
2. **粘贴即上传**：截图粘贴后自动压缩、上传、插入 Markdown
3. **实时预览**：和前台使用完全相同的渲染管线，所见即所得
4. **离开前提醒**：有未保存内容时拦截页面关闭

~~~js
window.addEventListener('beforeunload', (event) => {
  if (!isSaved) {
    event.preventDefault();
    event.returnValue = '';
  }
});
~~~

## 接下来要做的事

- [x] 文章、分类、标签、专栏
- [x] 在线编辑器与图片上传
- [ ] 全文搜索
- [ ] 评论系统
- [ ] 写作热力图

> 「工具应该让记录变得更容易，而不是变成记录本身的负担。」
