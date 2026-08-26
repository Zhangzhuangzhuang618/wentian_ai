# WT-051 不可核验内部统计声明标记

> 状态：已完成  
> 前置任务：[`WT-050`](./WT-050-CONSUMER-SOURCE-NOMINATION-INTERNAL-E2E.md)  
> 前置决策：[`DEC-WT051-001`](../decisions/DEC-WT051-001-UNSUPPORTED-INTERNAL-CLAIM-ASSESSMENT.md)  
> 对应基线：消费端自述的`unsupported_internal_claim`证据警告  
> 发布状态：内部确定性判定和严格报告字段，无HTTP、外部模型或生产连接

## 目标

在不把AI自述当作内部行为事实的前提下，标记回答中的不可核验内部抓取统计声明，并把证据限制传递到单运行报告。

## 实现

- 新增`unsupported-internal-claim@1`中英文保守词法判定；
- 区分“无法访问内部统计”等免责声明与肯定性内部统计声明；
- 已确认回答记录保存服务端派生的布尔标记和判定版本；
- 记录完整性重建会拒绝调用方篡改标记或版本；
- 运行级批次汇总被标记成功样本数和实际判定版本集合；
- 严格DTO只返回数量、版本和固定警告码；
- 提名指标公式和样本分母保持不变。

## 明确不做

- 不证明模型真实抓取、检索或引用了哪些域名；
- 不保存回答自报的频率、次数、百分比或排名为结构化指标；
- 不使用外部模型、网络搜索或不可复现分类器；
- 不因标记结果自动接受、拒绝或排序提名信源；
- 不注册HTTP路由或写入生产数据库。

## 测试与自审

- 肯定性中英文声明会被标记；
- 明确免责声明不被误标记，免责声明后另行肯定声明仍会被标记；
- 普通公开信源推荐不被解释为内部统计声明；
- 布尔标记和版本无法由调用方覆盖，记录篡改会失败关闭；
- 运行批次只汇总样本数和版本；
- 严格DTO只在数量大于零时返回固定警告；
- 额外内部抓取数值字段被严格契约拒绝；
- 深度自审确认该规则是可能误报或漏报的证据警告器，不是真伪分类器；
- 深度自审确认规则升级需要新版本和历史兼容策略，当前未存在生产历史数据迁移问题。

## 完成标准

- [x] 版本化确定性判定完成；
- [x] 已确认记录服务端派生和完整性校验完成；
- [x] 运行级数量和版本汇总完成；
- [x] 严格DTO固定警告完成；
- [x] 不传播自报内部抓取数值；
- [x] 无外部模型、HTTP或生产连接；
- [x] 最终全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-23；
- 领域实现：`packages/domain/src/unsupported-internal-claim.ts`、`packages/domain/src/confirmed-consumer-observation-record.ts`；
- 应用实现：`packages/application/src/build-consumer-source-nomination-metric-sample-batch.ts`、`packages/application/src/consumer-source-nomination-metrics-query.ts`；
- 契约实现：`packages/contracts/src/consumer-source-nomination-run-metrics.ts`；
- 当前验证：类型检查与291项完整测试通过；
- 最终全量验证：`pnpm verify`通过，299项测试全部通过；
- 发布边界复核：仅增加内部记录派生字段和只读警告摘要，不启用真实采集或生产接口。

## 后续

在不选择未批准提示词的前提下，实现提名—引用重合度的纯计算核心和可比性门禁；生产HTTP与持久化仍受门禁约束。
