刚开始写数仓任务时，我最常犯的错误是「一张大宽表从业务库直接算到报表」。需求一变，整条 SQL 推倒重来；口径对不上，没人说得清数据是从哪一步开始错的。

分层解决的就是这个问题：**把一次复杂的加工拆成几个职责单一的步骤，每一层只做一件事**。

## 为什么要分层

| 不分层的问题 | 分层后的效果 |
| --- | --- |
| 同一份清洗逻辑在多个报表里重复写 | 清洗只在 DWD 做一次，下游直接复用 |
| 业务库字段一改，几十个任务一起挂 | 只需要改 ODS → DWD 这一段 |
| 指标口径不一致，各算各的 | 公共指标沉淀在 DWS，统一口径 |
| 出了问题不知道哪一步错 | 每层都可以单独核对数据 |

> [!NOTE]
> 分层不是为了「看起来规范」，而是为了**复用**和**隔离变化**。如果一个项目只有两三张报表，硬套四层反而是负担。

## 各层的职责

```
业务库 / 日志
     │  同步（全量 / 增量）
     ▼
ODS  贴源层     ── 和源系统保持一致，不做业务加工
     │  清洗、标准化、维度退化
     ▼
DWD  明细层     ── 一行一个业务事件，口径统一的明细数据
     │  按主题、按粒度轻度汇总
     ▼
DWS  汇总层     ── 公共指标，例如「用户 × 天」的下单金额
     │  面向具体需求组装
     ▼
ADS  应用层     ── 直接给报表 / 接口使用

DIM  维度层     ── 用户、商品、组织等维度表，被 DWD / DWS 关联
```

### ODS：只搬运，不加工

ODS 的原则是**和源表保持一致**：字段名、类型、取值都尽量不动，最多加一个分区字段和同步时间。

这样做的好处是：下游发现数据有问题时，可以直接拿 ODS 和业务库对比，快速判断是「同步出了问题」还是「加工出了问题」。

### DWD：数仓里最重要的一层

DWD 要做的事情最多：

- **清洗**：去重、过滤测试数据、处理空值和异常值
- **标准化**：统一枚举值（例如把 `1/2/3` 翻译成有含义的状态）、统一时间格式
- **维度退化**：把常用的维度字段（如城市、渠道）直接冗余到明细表里，减少下游关联

~~~sql
INSERT OVERWRITE TABLE dwd_trade_order_di PARTITION (dt = '${bizdate}')
SELECT
  o.order_id,
  o.user_id,
  o.shop_id,
  CASE o.status
    WHEN 1 THEN 'created'
    WHEN 2 THEN 'paid'
    WHEN 3 THEN 'cancelled'
    ELSE 'unknown'
  END                                   AS order_status,
  CAST(o.amount AS DECIMAL(18, 2)) / 100 AS order_amount,  -- 分 → 元
  u.city_name,                                              -- 维度退化
  o.create_time
FROM ods_trade_order_di o
LEFT JOIN dim_user_df u
  ON o.user_id = u.user_id AND u.dt = '${bizdate}'
WHERE o.dt = '${bizdate}'
  AND o.is_test = 0;                                        -- 过滤测试单
~~~

> [!TIP]
> 金额单位、时区、枚举翻译这类「所有下游都要做的处理」，一定要在 DWD 一次做完。否则每张报表各写一遍，迟早会出现口径不一致。

### DWS：沉淀公共指标

DWS 按**主题 + 粒度**组织，比如「用户粒度的每日交易汇总」：

~~~sql
INSERT OVERWRITE TABLE dws_trade_user_1d PARTITION (dt = '${bizdate}')
SELECT
  user_id,
  COUNT(DISTINCT order_id)                                       AS order_cnt,
  SUM(order_amount)                                              AS order_amount,
  SUM(CASE WHEN order_status = 'paid' THEN order_amount ELSE 0 END) AS paid_amount
FROM dwd_trade_order_di
WHERE dt = '${bizdate}'
GROUP BY user_id;
~~~

有了这张表，「近 7 天下单用户数」「人均下单金额」这类需求，都不需要再去扫明细。

### ADS：面向需求，可以随时重建

ADS 直接对应报表或接口，结构由需求决定。它的特点是**变化快、可以随时删了重建**，所以不要把复用的逻辑放在这一层。

## 表命名规范

团队内统一命名，能省掉大量沟通成本。我习惯的格式是：

```
{层级}_{主题域}_{业务含义}_{更新方式}

ods_trade_order_di      交易域订单，每日增量
dwd_trade_order_di      交易域订单明细，每日增量
dim_user_df             用户维度，每日全量快照
dws_trade_user_1d       用户粒度的交易汇总，统计周期 1 天
ads_trade_gmv_daily     每日 GMV 报表
```

| 后缀 | 含义 |
| --- | --- |
| `di` | daily incremental，每天只放当天新增 / 变化的数据 |
| `df` | daily full，每天一份全量快照 |
| `1d` / `7d` / `30d` | 汇总表的统计周期 |

## 几个常见的坑

> [!WARNING]
> **跨层引用**：ADS 直接读 ODS，跳过了 DWD 的清洗逻辑，结果和其他报表对不上。原则上只允许「上层读下层」，并且尽量只读相邻层。

> [!WARNING]
> **DWS 粒度混乱**：一张汇总表里既有「用户 × 天」的行，又有「用户 × 月」的行。一张表只放一种粒度，否则下游聚合时很容易重复计算。

> [!DANGER]
> **ODS 里做业务加工**：在 ODS 就把测试数据过滤掉了，后来需要排查测试数据时才发现源数据已经没了。ODS 要保留原貌。

## 小结

- ODS 保留原貌，DWD 统一口径，DWS 沉淀复用，ADS 服务需求
- 分层的核心目的：**复用**与**隔离变化**
- 命名规范让表名本身就能说明「是什么、在哪层、怎么更新」

下一篇写维度建模：事实表有哪几种类型，分别适合什么场景。
