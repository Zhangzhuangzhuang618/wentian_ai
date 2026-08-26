# WT-041 自述复核严格内部契约草案

> 状态：已完成  
> 前置任务：[`WT-040`](./WT-040-CONSUMER-NOMINATION-REVIEW-REJECTION.md)  
> 前置决策：[`DEC-WT041-001`](../decisions/DEC-WT041-001-NOMINATION-REVIEW-CONTRACT-BOUNDARY.md)  
> 对应基线：复核列表、确认与拒绝API字段边界  
> 发布状态：`@0-draft`严格DTO，无OpenAPI或HTTP路由

## 目标

把复核列表、确认和拒绝固定为严格snake_case内部契约草案，防止未来传输层接受客户端伪造的响应归属、URL、事件身份或来源哈希。

## 实现

- 固定三条批准路径和draft契约版本；
- list输入只含scope与状态；
- confirm输入只含scope、版本和最多10项显式域名；
- reject输入只含scope、版本和拒绝原因；
- Idempotency-Key独立于业务体；
- 域名、顺序、重复项和字段长度严格校验；
- 严格读模型校验状态、审核字段、版本和时间一致性；
- 领域review适配为snake_case DTO；
- 确认事件数量可由review复算，拒绝固定零事件。

## 明确不做

- 不接受或返回来源URL、URL哈希或来源键；
- 不接受客户端提交response/run/query/sample或事件角色；
- 不创建OpenAPI文档；
- 不注册HTTP路由或把草案标记为可执行；
- 不实现生产认证、持久化或幂等存储；
- 不修改批准基线。

## 测试

- 路径和最小输入字段固定；
- 归属、URL、来源键和额外敏感字段被拒绝；
- 最多10项、顺序和重复域名约束；
- 拒绝原因白名单；
- 领域对象到严格读模型适配；
- 确认事件计数与拒绝零事件可复算；
- 终态版本和审核时间不一致被拒绝。

## 完成标准

- [x] draft契约版本与路径完成；
- [x] list/confirm/reject严格输入完成；
- [x] 独立幂等键契约完成；
- [x] review严格读模型完成；
- [x] 状态、版本和时间一致性完成；
- [x] 事件计数响应约束完成；
- [x] 禁止客户端归属、URL和哈希字段；
- [x] 无OpenAPI、路由、数据库或真实数据；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 实现：`packages/contracts/src/source-nomination-review.ts`；
- 测试：`packages/contracts/test/source-nomination-review.test.ts`；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：draft DTO，无OpenAPI、路由、数据库或真实数据；
- 深度自审修复：域名字段明确拒绝完整URL和路径；终态固定版本2并要求更新时间等于审核时间；确认计数由复核项复算；拒绝响应结构上固定零事件。

## 后续

scope隔离的复核列表查询服务已在[`WT-042`](./WT-042-SOURCE-NOMINATION-REVIEW-QUERY.md)完成；真实路由仍需等待持久化、审计和生产启用批准。
