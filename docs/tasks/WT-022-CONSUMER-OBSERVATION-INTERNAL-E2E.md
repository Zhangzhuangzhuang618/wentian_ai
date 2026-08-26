# WT-022 消费端观察内部端到端合成验收

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、消费端观察优先链路  
> 发布状态：测试组合，无正式HTTP路由

## 目标

用一个完全合成、无外部调用的样本验证现有模块能否从运行创建贯通到严格指标响应，并识别仍需开发的真实断点。

## 已贯通链路

```text
active scope + immutable snapshot + synthetic active Surface
  → WT-020 创建运行和完整任务
  → WT-009 领取、提交 + WT-027 原子确认
  → WT-021 重算运行至 succeeded
  → WT-030 构建运行级指标批次
  → WT-031 按需调用 WT-013 计算
  → WT-016 适配严格 snake_case DTO
```

合成样本验证：

- 一个问题、一个浏览器辅助样本；
- Capture Token绑定实例、scope、任务、用户和origin；
- 任务按`waiting_user → capturing → needs_review → confirmed`推进；
- 运行重算为`succeeded`且成功样本数为1；
- 带追踪参数的可见URL归一化为`example.com`；
- Web可见引用率和首位引用率均返回可复算的`1/1=1`；
- WT-016严格DTO校验通过。

## 验收边界

测试中的active Surface是内存构造的合成对象，仅用于证明领域链路。它没有修改或激活当前`doubao-web@0-draft` Adapter，也没有形成任何生产Surface配置。

测试文件位于API应用测试目录，是因为该层允许组合application、contracts、domain和infrastructure。测试没有注册路由，也没有启动正式业务API。

## 确认断点

### 1. 生产确认事务尚未实现

不可变确认记录和追加式内存Repository已在[`WT-023`](./WT-023-CONFIRMED-CONSUMER-OBSERVATION-RECORD.md)完成，`cited`来源事件投影与Repository已在[`WT-026`](./WT-026-CONFIRMED-CONSUMER-CITED-SOURCE-EVENTS.md)完成，WT-027也已提供内存原子确认事务。但PostgreSQL生产事务、Outbox和HTTP幂等仍未实现。

### 2. 指标批次没有生产物化

验收测试现通过[`WT-030`](./WT-030-BUILD-CONSUMER-METRIC-SAMPLE-BATCH.md)从终态运行、完整任务集和确认记录构建运行级批次。系统仍未自动持久化批次，也没有生产缓存、并发更新或重算版本。

### 3. 正式接口和外部能力仍关闭

- WT-012 OpenAPI仍不可执行且无servers；
- 正式消费端观察路由未注册；
- 当前豆包Adapter仍为draft；
- 没有真实账号、网页操作、对象存储、数据库或GEO连接。

## 明确不能宣称

- 不能宣称消费端观察已经生产可用；
- 不能宣称浏览器扩展已经自动写入问天；
- 不能宣称已确认证据和来源事件已由生产确认事务持久化；
- 不能宣称指标批次会自动更新；
- 不能宣称当前豆包Surface已经通过生产条款或稳定性门禁；
- 不能把Web端可见引用描述为隐藏搜索、内部抓取或模型权重。

## 完成标准

- [x] 运行创建到严格指标DTO的合成链路通过；
- [x] scope、Token、任务、运行和证据绑定沿链路保持；
- [x] WT-014、WT-013和WT-016真实复用；
- [x] 当前Surface没有被激活；
- [x] 不可变证据确认事务断点明确；
- [x] 指标生产物化断点明确；
- [x] 无正式HTTP、真实数据或生产启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 验收测试：`apps/api/test/consumer-observation-internal-e2e.test.ts`；
- 全量验证：159项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目50份Markdown中的92个相对链接有效，Git未初始化；
- 发布边界复核：测试没有注册路由，OpenAPI不可执行标记、无servers和生产禁用标记保持；
- 深度自审：把“代码可组合贯通”与“生产自动闭环”明确分开，记录完整证据持久化和指标物化两个断点，未用合成active对象改变豆包draft状态。

## 后续

最小不可变确认记录、待复核artifact、`cited`来源事件和确认事务契约均已完成，WT-022现使用[`WT-027`](./WT-027-CONSUMER-OBSERVATION-CONFIRMATION-TRANSACTION.md)内存原子实现，并通过WT-030自动构建单运行指标批次。PostgreSQL生产事务和指标生产物化仍未实现。
