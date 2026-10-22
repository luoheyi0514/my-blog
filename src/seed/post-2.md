一个每天跑 20 分钟的 Spark 任务，某天突然跑了 2 个小时。打开 Spark UI 一看：199 个 task 几十秒就结束了，剩下 1 个 task 跑了一个半小时。

这就是典型的**数据倾斜**。

## 怎么判断是不是倾斜

数据倾斜的本质是：**Shuffle 后某个分区分到的数据远多于其他分区**。在 Spark UI 里看这几个指标：

| 位置 | 正常 | 倾斜 |
| --- | --- | --- |
| Stage → Summary Metrics → Duration | Max 和 Median 差不多 | Max 是 Median 的几十倍 |
| Shuffle Read Size | 各 task 大小接近 | 个别 task 读了几 GB，其他只有几 MB |
| 现象 | 进度条匀速推进 | 卡在 199/200 很久不动 |

> [!NOTE]
> 如果是**所有 task 都慢**，那通常不是倾斜，而是并行度不够或者资源不足，应该调整分区数和 executor 配置。

## 找到倾斜的 key

确认倾斜后，下一步是找出是哪些 key 导致的。直接对 join / group by 的字段做分布统计：

~~~sql
SELECT user_id, COUNT(*) AS cnt
FROM dwd_trade_order_di
WHERE dt = '2026-10-21'
GROUP BY user_id
ORDER BY cnt DESC
LIMIT 20;
~~~

我那次排查的结果是：`user_id` 为 `NULL` 的记录有 3000 多万行，占了总量的 40%。这些数据在 join 时全部被分到同一个分区。

## 解法一：过滤或打散无意义的 key

最常见的倾斜来源是 `NULL`、空字符串、默认值（如 `0`、`-1`）。先问一句：**这些数据真的需要参与关联吗？**

~~~sql
-- 方式 1：不需要参与关联，直接过滤
SELECT ...
FROM orders o
JOIN dim_user u ON o.user_id = u.user_id
WHERE o.user_id IS NOT NULL;

-- 方式 2：需要保留这些行，把 NULL 替换成随机值，让它们分散到不同分区
SELECT ...
FROM orders o
LEFT JOIN dim_user u
  ON COALESCE(o.user_id, CONCAT('null_', CAST(RAND() AS STRING))) = u.user_id;
~~~

> [!TIP]
> 方式 2 中随机值不会匹配到任何维度记录，LEFT JOIN 的结果和原来一致，但这些行不再集中在一个分区。

## 解法二：小表广播

如果关联的一侧是小表（维度表通常是），可以把它广播到每个 executor，**直接避免 Shuffle**：

~~~sql
SELECT /*+ BROADCAST(u) */ o.*, u.city_name
FROM dwd_trade_order_di o
JOIN dim_user_df u ON o.user_id = u.user_id;
~~~

PySpark 写法：

~~~python
from pyspark.sql.functions import broadcast

result = orders.join(broadcast(dim_user), on="user_id", how="left")
~~~

Spark 会自动广播小于 `spark.sql.autoBroadcastJoinThreshold`（默认 10MB）的表。维度表稍大一点时，可以手动用 hint 指定。

> [!WARNING]
> 广播表会被复制到每个 executor 的内存里。几百 MB 以上的表强行广播，可能导致 driver 或 executor OOM。

## 解法三：加盐两阶段聚合

`GROUP BY` 产生的倾斜，可以先给 key 加随机前缀做局部聚合，再去掉前缀做全局聚合：

~~~sql
WITH salted AS (
  SELECT
    CONCAT(CAST(FLOOR(RAND() * 10) AS STRING), '_', user_id) AS salted_key,
    amount
  FROM dwd_trade_order_di
  WHERE dt = '2026-10-21'
),
partial_agg AS (
  -- 第一阶段：同一个 user_id 被分散到 10 个分区分别聚合
  SELECT salted_key, SUM(amount) AS amount
  FROM salted
  GROUP BY salted_key
)
-- 第二阶段：去掉前缀，合并 10 份局部结果
SELECT
  SUBSTR(salted_key, INSTR(salted_key, '_') + 1) AS user_id,
  SUM(amount) AS amount
FROM partial_agg
GROUP BY SUBSTR(salted_key, INSTR(salted_key, '_') + 1);
~~~

这个方法只适用于**可以分步计算的聚合**，比如 `SUM`、`COUNT`、`MAX`。`COUNT(DISTINCT)` 不能简单地两阶段相加。

## 解法四：倾斜 key 单独处理

如果倾斜集中在少数几个已知的 key 上，可以把它们拆出来单独 join，再和其余数据 `UNION ALL`：

```
大表 ──┬── 倾斜 key 的数据 ──► 和维表中对应的几行做广播 join ──┐
       │                                                       ├──► UNION ALL
       └── 其余数据 ────────► 正常 join ───────────────────────┘
```

这种方式改造成本比较高，适合倾斜 key 固定、任务又非常核心的场景。

## 解法五：开启 AQE（Spark 3.0+）

Spark 3 的自适应查询执行（AQE）可以在运行时检测倾斜分区，并自动把它拆成多个小分区：

~~~properties
spark.sql.adaptive.enabled=true
spark.sql.adaptive.skewJoin.enabled=true
# 分区大小超过「中位数 × 该倍数」且超过下面的阈值时，判定为倾斜
spark.sql.adaptive.skewJoin.skewedPartitionFactor=5
spark.sql.adaptive.skewJoin.skewedPartitionThresholdInBytes=256MB
~~~

> [!NOTE]
> AQE 的倾斜处理只对 **Sort Merge Join** 生效，对 `GROUP BY` 的倾斜无效。它是最省事的第一步，但不能替代对数据本身的分析。

## 选哪种方法

| 场景 | 优先尝试 |
| --- | --- |
| NULL / 默认值导致的倾斜 | 解法一：过滤或打散 |
| 大表 join 小维表 | 解法二：广播 |
| GROUP BY 倾斜 | 解法三：加盐两阶段聚合 |
| 少数固定热点 key | 解法四：拆分处理 |
| Spark 3 的 join 倾斜 | 解法五：先开 AQE 看效果 |

我那次的问题，用解法一过滤掉 `NULL` 之后，任务从 2 小时回到了 15 分钟。**大部分倾斜都来自脏数据**，先看数据分布，再决定用什么方法。
