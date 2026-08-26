# WT-016 消费端指标只读模型契约

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、`VIS-W03`只读指标基础  
> 契约版本：`wentian-consumer-observation-metrics@0-draft`  
> 发布状态：内部DTO草案，无HTTP路由

## 目标

把WT-013领域报告适配为严格、可复算的snake_case只读DTO，固定Web端可见引用率、首位引用率、稳定度、样本提示、排除计数和证据边界警告。

本任务不定义公共指标API路径。初始DTO缺少运行筛选、实验类型和最终采集方式查询上下文；这些字段后来由WT-032补齐，但契约仍是未发布草案，不能视为公共指标API。

## 响应内容

- 契约、方法和归一化版本；
- scope、问题集快照哈希和计算时间；
- 计划、成功和失败样本基数；
- 可用性与明确不可用原因；
- 已确认样本数及needs_review、rejected、not_required排除计数；
- 按完整消费端会话条件拆分的指标组；
- 浏览器采集和人工录入证据的独立样本计数；
- 每个域名的分子、分母和比例；
- 来源稳定度、问题明细、有效样本对和空来源样本对；
- 固定的Web端证据边界警告。

## 契约自校验

Zod契约除字段类型外，还会复算和校验：

- `value = numerator / denominator`；
- 分子不得大于分母；
- 域名可见引用率分母必须等于组内确认样本数；
- 两类证据样本计数之和必须等于组内确认样本数；
- 样本数与`individual_observation | descriptive_trend_insufficient_sample | descriptive_only`一致；
- 稳定度问题数、有效样本对数和问题平均值一致；
- 总空来源样本对数不得小于已计算问题明细之和；
- 顶层确认样本数等于所有组之和；
- 成功、失败和待完成基数足以覆盖各证据状态；
- available必须有指标组，not_available必须是零确认样本和明确原因；
- 同一指标组不得重复返回相同域名。

## 适配边界

`adaptConsumerObservationMetricReportToResponse()`只做：

- camelCase到snake_case转换；
- 加入草案契约版本；
- 通过Zod重新验证输出。

它不重新计算指标、不访问数据库，也不把不可用值改成0。

## 测试

- WT-013领域报告成功适配；
- 无确认样本保持not_available；
- 一个问题只有空—空来源样本对、另一个问题可计算时，稳定度仍可用并保留总空来源计数；
- 顶层额外内部字段被拒绝；
- 不能复算的伪造比例被拒绝。

## 明确不做

- 不新增GET接口或OpenAPI路径；
- 不声明公共指标响应已经稳定；
- 不包含API—消费端数值重合度；
- 不合并或改写领域指标；
- 不读取真实数据；
- 不激活Surface、Adapter或正式HTTP路由；
- 不修改批准基线。

## 完成标准

- [x] 严格Zod只读Schema完成；
- [x] 领域报告到DTO适配完成；
- [x] 分子、分母和比例可复算；
- [x] 可用与不可用状态互斥；
- [x] 空来源样本对语义保持；
- [x] 固定证据边界警告存在；
- [x] 额外字段和伪造比例测试通过；
- [x] 无正式HTTP路由或OpenAPI发布；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 实现：`packages/contracts/src/consumer-observation-metrics.ts`；
- 测试：`packages/contracts/test/consumer-observation-metrics.test.ts`；
- 全量验证：129项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目44份Markdown中的74个相对链接有效，Git未初始化；
- 发布边界复核：指标只读模型未注册到API或OpenAPI，契约保持`@0-draft`；
- 深度自审修复：问题快照项改为UUID；样本提示和域名唯一性增加复算校验；有效稳定度允许总空来源样本对包含未进入可计算问题明细的样本对，避免误拒绝合法报告。

## 后续

内部指标读取应用服务已转入[`WT-017`](./WT-017-CONSUMER-METRICS-QUERY-SERVICE.md)；公共样本基数由[`WT-028`](./WT-028-CONSUMER-METRICS-SAMPLE-BASIS.md)补齐；单运行实验、问题集来源、采集方式和Surface质量上下文由[`WT-032`](./WT-032-CONSUMER-RUN-METRIC-QUALITY-CONTEXT.md)补齐。当前仍未注册HTTP路由。
