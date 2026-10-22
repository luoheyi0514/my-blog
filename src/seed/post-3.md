「找出连续登录 3 天及以上的用户」，这道题几乎是大数据岗位 SQL 面试的必考题，实际工作中做留存、活跃分析也经常遇到。

它的核心技巧只有一个：**用「日期 − 行号」构造分组标识**。

## 数据准备

~~~sql
CREATE TABLE user_login (
  user_id    STRING,
  login_time TIMESTAMP
);
~~~

同一天可能登录多次，所以第一步一定是**按天去重**。

## 核心思路

对每个用户，按日期排序后编一个行号。如果日期是连续的，那么「日期 − 行号」的结果会是同一个值：

| user_id | login_date | rn | login_date − rn |
| --- | --- | --- | --- |
| u1 | 2026-10-01 | 1 | 2026-09-30 |
| u1 | 2026-10-02 | 2 | 2026-09-30 |
| u1 | 2026-10-03 | 3 | 2026-09-30 |
| u1 | 2026-10-05 | 4 | 2026-10-01 |
| u1 | 2026-10-06 | 5 | 2026-10-01 |

前 3 行的差值都是 `2026-09-30`，说明它们是一段连续登录；10-05 和 10-06 是另一段。

**按「用户 + 差值」分组，组内的行数就是这一段连续登录的天数。**

## 完整 SQL（Hive / Spark SQL）

~~~sql
WITH daily AS (
  -- 1. 按天去重
  SELECT DISTINCT user_id, TO_DATE(login_time) AS login_date
  FROM user_login
),
ranked AS (
  -- 2. 每个用户按日期编号
  SELECT
    user_id,
    login_date,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date) AS rn
  FROM daily
),
grouped AS (
  -- 3. 日期减行号，连续的日期得到相同的 grp
  SELECT user_id, login_date, DATE_SUB(login_date, rn) AS grp
  FROM ranked
)
-- 4. 统计每段连续登录的天数
SELECT
  user_id,
  MIN(login_date) AS start_date,
  MAX(login_date) AS end_date,
  COUNT(*)        AS continuous_days
FROM grouped
GROUP BY user_id, grp
HAVING COUNT(*) >= 3;
~~~

> [!WARNING]
> 第 1 步的去重不能省。如果同一天登录两次，行号会多加一，「日期 − 行号」就不再连续，结果会少算。

> [!NOTE]
> 不同引擎的日期函数写法不一样：Hive / Spark 用 `DATE_SUB(date, n)`；MySQL / StarRocks 用 `DATE_SUB(date, INTERVAL n DAY)`。

## 变形一：每个用户的最长连续登录天数

在上面结果的基础上再聚合一次即可：

~~~sql
SELECT user_id, MAX(continuous_days) AS max_continuous_days
FROM (
  SELECT user_id, grp, COUNT(*) AS continuous_days
  FROM grouped
  GROUP BY user_id, grp
) t
GROUP BY user_id;
~~~

## 变形二：允许中间断 1 天

需求改成「中间最多断 1 天也算连续」时，「日期 − 行号」就不适用了。换一个思路：**用 `LAG` 找到每次登录和上一次登录的间隔，间隔超过阈值就开启新的一段**。

~~~sql
WITH daily AS (
  SELECT DISTINCT user_id, TO_DATE(login_time) AS login_date
  FROM user_login
),
flagged AS (
  SELECT
    user_id,
    login_date,
    -- 和上一次登录间隔超过 2 天（即断了 2 天及以上），标记为新的一段
    CASE
      WHEN DATEDIFF(login_date, LAG(login_date) OVER (PARTITION BY user_id ORDER BY login_date)) > 2
        THEN 1
      ELSE 0
    END AS is_new_segment
  FROM daily
),
segmented AS (
  -- 累加标记，得到每一段的编号
  SELECT
    user_id,
    login_date,
    SUM(is_new_segment) OVER (PARTITION BY user_id ORDER BY login_date) AS segment_id
  FROM flagged
)
SELECT
  user_id,
  segment_id,
  MIN(login_date)                                    AS start_date,
  MAX(login_date)                                    AS end_date,
  DATEDIFF(MAX(login_date), MIN(login_date)) + 1     AS span_days
FROM segmented
GROUP BY user_id, segment_id;
~~~

> [!TIP]
> 「打标记 + 累加求和」是处理「会话切分」类问题的通用套路：页面访问超过 30 分钟算新会话、设备离线超过阈值算新的在线段，都是同样的写法。

## 常用窗口函数速查

| 函数 | 作用 | 示例结果（值为 10, 20, 20, 30） |
| --- | --- | --- |
| `ROW_NUMBER()` | 连续编号，不重复 | 1, 2, 3, 4 |
| `RANK()` | 并列同号，后面跳号 | 1, 2, 2, 4 |
| `DENSE_RANK()` | 并列同号，后面不跳号 | 1, 2, 2, 3 |
| `LAG(col, n)` | 取前第 n 行的值 | 上一次登录日期 |
| `LEAD(col, n)` | 取后第 n 行的值 | 下一次登录日期 |
| `SUM() OVER (ORDER BY ...)` | 累计求和 | 累计销售额、分段编号 |

## 小结

- 连续 N 天问题：**去重 → 编号 → 日期减行号 → 分组计数**
- 允许断签的问题：**LAG 求间隔 → 打标记 → 累加得到分段编号**
- 两个套路覆盖了绝大多数「连续」「会话」类 SQL 题
