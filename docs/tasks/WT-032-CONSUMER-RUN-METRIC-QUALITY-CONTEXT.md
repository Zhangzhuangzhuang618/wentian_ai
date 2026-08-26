# WT-032 单运行消费端指标质量上下文

> 状态：已完成  
> 前置任务：[`WT-031`](./WT-031-ON-DEMAND-CONSUMER-RUN-METRICS.md)  
> 前置决策：[`DEC-WT032-001`](../decisions/DEC-WT032-001-CONSUMER-RUN-METRIC-QUALITY-CONTEXT.md)  
> 对应基线：所有信源指标结果携带可追溯的数据质量标记  
> 发布状态：内部运行级报告与严格DTO草案，无HTTP路由

## 目标

让单运行消费端指标在构建、计算和DTO适配过程中持续携带服务端冻结的运行质量上下文，避免正确的指标数值脱离实验、问题集来源和Surface身份。

## 实现

- 运行级批次增加问题集来源、GEO契约版本、实验类型、采集方式、提名上下文、Surface版本和Surface代码；
- WT-030只从运行绑定的问题集快照与历史Surface版本派生这些字段；
- 共用计算入口校验GEO版本耦合、自然回答语义、单一采集方式以及样本Surface绑定；
- WT-017物化读取与WT-031按需读取均返回带上下文的运行级报告；
- 严格DTO增加运行身份和批准基线要求的消费端质量字段；
- Provider专属字段、对照等级和日志验证等级在当前消费端响应中显式为`null`；
- 可用报告只接受`confirmed`和与采集方式匹配的单一证据等级，不可用报告保持空状态与空证据等级集合。

## 明确不做

- 不计算`source_nomination`提名指标；
- 不定义跨运行筛选、窗口或聚合；
- 不自动物化批次或缓存报告；
- 不新增HTTP或OpenAPI指标路径；
- 不接入真实数据、激活豆包Surface或启用GEO写入；
- 不修改批准基线。

## 测试

- 本地问题集运行完整输出质量上下文；
- GEO问题集契约版本从冻结快照进入批次；
- GEO来源与契约版本不匹配时失败关闭；
- 自述实验或样本Surface混入自然回答批次时失败关闭；
- 浏览器辅助与人工录入分别映射唯一合法证据等级；
- 不可用报告不伪造确认状态或证据等级；
- DTO拒绝Surface不一致、额外字段和不可复算比例；
- 合成内部端到端链路验证运行身份、采集方式和Surface上下文。

## 完成标准

- [x] 批次保留冻结的运行质量上下文；
- [x] GEO契约版本只取自快照；
- [x] 单运行采集方式和Surface绑定失败关闭；
- [x] 物化与按需读取共用上下文校验；
- [x] 严格DTO输出消费端质量字段；
- [x] 可用性、确认状态和证据等级保持一致；
- [x] 无HTTP、真实数据、生产启用或基线修改；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 批次与共用计算：`packages/application/src/ports.ts`、`packages/application/src/consumer-observation-metrics-query.ts`；
- 服务端派生：`packages/application/src/build-consumer-observation-metric-sample-batch.ts`；
- DTO：`packages/contracts/src/consumer-observation-metrics.ts`；
- 测试：应用、基础设施、契约和内部端到端测试；
- 全量验证：209项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目62份Markdown中的148个相对链接有效，Git未初始化；
- 发布边界复核：指标路由未注册，OpenAPI未增加指标路径，豆包Adapter保持`doubao-web@0-draft`；
- 深度自审修复：区分“进入指标分母的确认状态”和“运行全部任务状态”；GEO版本不从当前连接器反查；响应按采集方式复核组内证据计数，避免顶层上下文与指标组漂移。

## 后续

下一步只评估不需要生产数据库、真实Surface或公共路由授权的内部闭环；跨运行聚合、指标物化和正式发布继续保持门禁。
