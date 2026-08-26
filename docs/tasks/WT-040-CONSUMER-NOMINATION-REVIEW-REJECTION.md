# WT-040 消费端自述复核拒绝事务

> 状态：已完成  
> 前置任务：[`WT-039`](./WT-039-CONSUMER-NOMINATION-REVIEW-CONFIRMATION.md)  
> 前置决策：[`DEC-WT040-001`](../decisions/DEC-WT040-001-NOMINATION-REVIEW-REJECTION-TRANSACTION.md)  
> 对应基线：自述复核拒绝终态且不创建事件  
> 发布状态：内部应用服务与合成内存事务，无HTTP或生产数据库

## 目标

实现与确认路径对称但无事件副作用的拒绝应用服务，确保拒绝只保存终态与原因，并在事务内验证该响应不存在正式提名事件。

## 实现

- scope权限和写角色门禁；
- review、不可变响应和运行的服务端反查；
- `source_nomination`运行、提名上下文和响应归属绑定复核；
- 由领域状态机派生`rejected`终态、审核身份、时间、原因和版本；
- 单一事务端口检查响应无正式提名事件后保存review；
- 任何版本、绑定、完整性或事件存在检查失败时不更新review。

## 明确不做

- 不创建、更新或删除任何来源事件；
- 不实现HTTP拒绝接口或Idempotency-Key；
- 不实现生产数据库、迁移、行锁、Outbox或审计；
- 不接入真实回答解析或Provider；
- 不启用生产采集；
- 不修改批准基线。

## 测试

- 拒绝只保存终态、审核人和原因且事件集合为空；
- scope、viewer、旧版本和自然回答运行失败关闭；
- 响应已有正式事件时事务拒绝且review保持待复核；
- 拒绝原因和时间继续由WT-037状态机严格校验。

## 完成标准

- [x] 拒绝应用服务完成；
- [x] 服务端响应与运行反查完成；
- [x] source_nomination运行门禁完成；
- [x] 无事件原子检查完成；
- [x] review终态版本保存完成；
- [x] 失败不污染既有review；
- [x] 无事件写删、HTTP、数据库或真实数据；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用服务：`packages/application/src/reject-source-nomination-parse-review.ts`；
- 事务端口：`packages/application/src/ports.ts`；
- 内存事务：`packages/infrastructure/src/in-memory-source-nomination-parse-review-repository.ts`；
- 测试：`packages/infrastructure/test/confirm-source-nomination-parse-review.test.ts`；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：无事件写删、HTTP、数据库、生产事务或真实数据；
- 深度自审修复：把“无正式事件”从应用层先查后写收敛到事务端口；异常既有事件不会被拒绝动作删除；review、响应和运行继续由服务端绑定；拒绝路径不复用确认事件投影。

## 后续

复核列表、确认和拒绝的严格内部DTO草案已在[`WT-041`](./WT-041-SOURCE-NOMINATION-REVIEW-CONTRACT.md)完成，客户端不能提交响应归属、事件角色、URL或来源哈希；仍未注册生产HTTP路由。
