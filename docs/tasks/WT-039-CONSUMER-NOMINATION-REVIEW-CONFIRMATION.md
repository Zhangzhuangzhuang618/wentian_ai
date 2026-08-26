# WT-039 消费端自述复核确认原子事务

> 状态：已完成  
> 前置任务：[`WT-038`](./WT-038-SOURCE-NOMINATION-PARSE-REVIEW-REPOSITORY.md)  
> 前置决策：[`DEC-WT039-001`](../decisions/DEC-WT039-001-CONSUMER-NOMINATION-REVIEW-CONFIRMATION-TRANSACTION.md)  
> 对应基线：自述复核确认事务与`nominated`事件  
> 发布状态：内部应用服务与合成内存事务，无HTTP或生产数据库

## 目标

打通已确认消费端自述响应的人工解析复核确认链路，在不接受客户端归属字段和来源哈希的前提下，原子保存终态review与完整`nominated`事件集合。

## 实现

- 应用服务执行scope权限与写角色门禁；
- 通过review服务端反查不可变消费端响应和运行；
- 校验响应、运行、Surface、采集方式和样本范围绑定；
- 只接受`source_nomination`运行及非空服务端提名上下文；
- 由响应派生事件全部身份字段；
- 由投影器规范化域名、生成来源键并固定`human_confirmed`；
- 单一事务端口原子保存review与完整事件集合；
- 内存事务实现先完成所有完整性、绑定、版本和唯一性校验再写入。

## 明确不做

- 不解析真实回答或自动调用模型；
- 不实现结构化API的`schema_validated`直写流程；
- 不实现HTTP确认/拒绝接口或Idempotency-Key；
- 不实现PostgreSQL、迁移、Outbox或审计事件；
- 不启用豆包生产采集；
- 不修改批准基线。

## 测试

- 确认从服务端响应身份原子创建完整事件集合；
- scope隔离与viewer写入拒绝；
- 自然回答运行、缺失运行和响应错绑失败关闭；
- 事件ID冲突时review与新事件集合均不落档；
- 空提名确认生成零事件；
- 缺项与伪造事件身份被事务适配器拒绝。

## 完成标准

- [x] 确认应用服务完成；
- [x] 响应和运行服务端反查完成；
- [x] source_nomination运行门禁完成；
- [x] human_confirmed事件投影完成；
- [x] review与事件集合原子内存提交完成；
- [x] 事件集合完整性和绑定复核完成；
- [x] 冲突失败不污染review或事件集合；
- [x] 无HTTP、数据库、真实解析或Provider调用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用服务：`packages/application/src/confirm-source-nomination-parse-review.ts`；
- 事务端口：`packages/application/src/ports.ts`；
- 内存事务：`packages/infrastructure/src/in-memory-source-nomination-parse-review-repository.ts`；
- 测试：`packages/infrastructure/test/confirm-source-nomination-parse-review.test.ts`；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：无HTTP、数据库、生产事务、真实解析或Provider调用；
- 深度自审修复：事务提交增加不可变响应快照并复核完整身份；事件集合逐项绑定review内容；事件唯一冲突在任何写入前完成；空确认保留有效的“已验证无显式域名”语义。

## 后续

拒绝应用服务已在[`WT-040`](./WT-040-CONSUMER-NOMINATION-REVIEW-REJECTION.md)完成：只保存`rejected`终态和原因，并在事务内验证响应没有正式提名事件。
