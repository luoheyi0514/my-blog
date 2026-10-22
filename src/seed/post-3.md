线上一个列表接口突然变慢，`EXPLAIN` 一看，明明建了索引，走的却是全表扫描。这篇文章记录排查过程，以及三类最常见的原因。

## 一个能复现的表

~~~sql
CREATE TABLE orders (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL,
  status       varchar(32) NOT NULL,
  amount_cents integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_id ON orders (user_id);
~~~

数据量 300 万行，`user_id` 上的索引看起来没问题。但下面这条查询走了全表扫描：

~~~sql
EXPLAIN ANALYZE
SELECT * FROM orders WHERE user_id = '123456';
~~~

## 原因一：隐式类型转换

`user_id` 是 `bigint`，而参数是字符串 `'123456'`。PostgreSQL 会把字符串转成数字吗？

并不会。这里的规则是：**列的类型优先级低于传入的类型时，会发生列级别的转换**。`bigint` 和 `varchar` 比较时，`bigint` 会被转成 `varchar`，索引自然失效。

~~~sql
-- 等价于
SELECT * FROM orders WHERE user_id::text = '123456';
~~~

> [!DANGER]
> 在列上套函数或类型转换，索引一定失效。正确做法是让参数去适配列类型，而不是让列去适配参数。

修复方式很简单，传入数字即可：

~~~ts
// before
db.query('SELECT * FROM orders WHERE user_id = $1', [userId.toString()]);
// after
db.query('SELECT * FROM orders WHERE user_id = $1', [Number(userId)]);
~~~

## 原因二：函数包裹

另一个常见写法是按日期查询：

~~~sql
SELECT * FROM orders
WHERE date(created_at) = '2026-10-01';
~~~

`created_at` 上有索引也没用，因为索引存的是 `created_at` 本身，不是 `date(created_at)`。

改成范围查询：

~~~sql
SELECT * FROM orders
WHERE created_at >= '2026-10-01'
  AND created_at <  '2026-10-02';
~~~

> [!TIP]
> 如果确实需要频繁按日期过滤，可以建表达式索引：
> `CREATE INDEX idx_orders_date ON orders (date(created_at));`

## 原因三：统计信息过期

有时候 SQL 没毛病，索引也没毛病，但优化器就是选错了。可以先看一眼它估算的行数：

~~~sql
EXPLAIN SELECT * FROM orders WHERE status = 'paid';
~~~

如果 `rows` 估算值和实际值差了几个数量级，多半是统计信息过期：

~~~sql
ANALYZE orders;
~~~

还有一种情况：`status` 只有三四个取值，优化器认为「回表」的成本高于直接顺序扫描，于是主动放弃索引。这不是 bug，而是成本模型的选择。

## 用覆盖索引减少回表

原查询是 `SELECT *`，需要回表取整行。如果业务只用到少数字段，可以把它们放进索引：

~~~sql
CREATE INDEX idx_orders_user_created
  ON orders (user_id, created_at DESC)
  INCLUDE (status, amount_cents);
~~~

这样查询可以直接走 index-only scan。

## 排查清单

遇到「有索引但没走」，我会按这个顺序检查：

1. `EXPLAIN (ANALYZE, BUFFERS)` 看实际执行计划，确认是 Seq Scan 还是 Index Scan
2. 检查 WHERE 条件里列上是否有函数、类型转换、`LIKE '%x'`
3. 检查统计信息是否过期（`ANALYZE`）
4. 检查列的选择性：区分度太低的列单独建索引意义不大
5. 检查是否 `ORDER BY` 与索引顺序不匹配导致额外排序

## 一点体会

索引不是「加上就快」。它是一份额外的、有序的数据结构，只有查询条件和它的顺序、类型完全匹配时才会被使用。

> [!NOTE]
> 优化器是基于成本的，不是基于「有没有索引」。理解成本模型，比记住各种索引失效的口诀更有用。
