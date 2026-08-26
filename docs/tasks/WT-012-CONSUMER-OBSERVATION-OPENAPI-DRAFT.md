# WT-012 消费端观察OpenAPI草案与持续一致性检查

> 状态：已完成  
> 批准来源：项目所有者要求开始下一步  
> 对应基线：`CHG-VIS-002`、消费端观察API 5.11—5.14  
> 契约版本：`wentian-consumer-observation-http@0-draft`  
> 执行状态：不可执行、未注册、未启用生产

## 目标

把WT-011的正式路径和Zod DTO整理成机器可读的OpenAPI 3.1草案，并建立持续检查，防止文档路径、字段必填性或“不可执行”门禁在后续修改中静默漂移。

本任务不实现正式HTTP处理器，也不改变消费端Surface的审批状态。

## 交付物

- OpenAPI草案：[`../openapi/wentian-consumer-observation.openapi.json`](../openapi/wentian-consumer-observation.openapi.json)；
- 一致性检查：`scripts/check-consumer-observation-openapi.mjs`；
- 正式契约补充：`packages/contracts/src/consumer-observation-http.ts`；
- 正负向测试：`packages/contracts/test/consumer-observation-openapi.test.ts`。

## 覆盖接口

```text
POST /ai-visibility/consumer-observations
POST /ai-visibility/consumer-observations/tasks/{id}/claim
POST /ai-visibility/consumer-observations/tasks/{id}/captures
POST /ai-visibility/consumer-observations/tasks/{id}/confirm
POST /ai-visibility/consumer-observations/tasks/{id}/reject
```

## 创建响应边界

批准基线要求创建接口返回一个`web_observed`运行和逐题任务，但没有定义运行状态枚举。草案因此只返回：

- 运行ID、scope、问题集快照、固定`retrieval_mode=web_observed`；
- 采集方式、实验类型和请求样本数；
- 任务ID、任务version、固定初始状态`waiting_user`、问题快照项和样本序号。

草案没有臆造运行状态，也没有把消费端页面模型标签伪造成API model ID。

## Multipart传输边界

提交观察包使用`multipart/form-data`：

- `metadata`：JSON格式的白名单回答、可见引用、可见元数据、任务version和Adapter版本；
- `screenshot`：必填PNG二进制；
- `sanitized_dom`：可选的已脱敏可见DOM文本。

`screenshot_media_asset_id`和`sanitized_dom_object_key`是服务端存储后的内部引用，不属于客户端multipart元数据。Capture Token使用草案头`X-Wentian-Capture-Token`；确认和拒绝使用`Idempotency-Key`。这些传输名称仍属于`@0-draft`，正式发布前可经契约变更调整。

## 不可执行标记

OpenAPI根节点固定包含：

```text
x-wentian-executable: false
x-wentian-production-enabled: false
```

同时不允许出现`servers`。所有操作再次标记`x-wentian-executable: false`。OpenAPI未声明生产身份方案不表示允许匿名访问，而是身份、CSRF、限流、签名Token、事务、审计和隐私清除仍在未决门禁中。

## 持续一致性检查

`pnpm verify`现在固定执行`pnpm openapi:check`。检查内容包括：

- OpenAPI 3.1版本、草案契约版本和不可执行标记；
- 不存在部署服务器；
- 五条路径与`CONSUMER_OBSERVATION_API_ROUTES`完全一致；
- 每条路径只允许文档中的POST动作，operationId和响应状态固定；
- Task ID、Capture Token和Idempotency-Key参数位置与约束固定；
- multipart必须包含JSON metadata和PNG截图；
- 14个OpenAPI对象的字段名、必填字段和`additionalProperties=false`与Zod对象契约一致。

## 负向测试

一致性测试会主动篡改临时副本并确认检查失败：

- 把根草案误标成可执行；
- 添加生产服务器；
- 删除正式确认路径；
- 删除Zod契约中仍必需的OpenAPI字段。

测试只操作系统临时目录中的副本，不修改签入草案。

## 明确不做

- 不把正式路径注册到API Server；
- 不启动或发布OpenAPI服务；
- 不声明生产服务器、认证方案或稳定错误结构；
- 不接收真实回答、截图、DOM或账号信息；
- 不签发生产Capture Token；
- 不创建数据库、对象存储、事务、Outbox或审计记录；
- 不激活豆包Surface或Adapter；
- 不修改批准基线。

## 完成标准

- [x] OpenAPI为3.1草案且版本与Zod契约一致；
- [x] 正式路径、方法、operationId和主要响应保持一致；
- [x] 创建响应不臆造未定义运行状态；
- [x] multipart传输与服务端存储引用分离；
- [x] 根文档和所有操作都明确不可执行；
- [x] 草案不含`servers`；
- [x] 一致性检查接入`pnpm verify`；
- [x] 正向及四类负向漂移测试通过；
- [x] 正式路由仍未注册；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 全量验证：109项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 契约复核：五条正式路径未注册到`apps/api/src`，OpenAPI无`servers`，根节点和五个操作均为不可执行；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目38份Markdown中的58个相对链接有效，Git未初始化；
- 深度自审修复：未定义的运行状态没有写入创建响应；multipart客户端字段与服务端存储引用已拆分；未发布的身份方案没有被伪装成匿名可用或已完成认证；
- 剩余门禁：正式错误响应、生产身份与CSRF、限流、Capture Token签名、事务持久化、审计和隐私清除仍未定义或实现，草案因此保持`@0-draft`。

## 后续门禁

后续已转入[`WT-013`](./WT-013-CONSUMER-OBSERVATION-METRICS.md)，先实现不接触真实数据的消费端描述性指标核心。正式上传、持久化和Surface启用仍须先完成WT-005中的条款、地区、保留期和责任人审批，并补齐身份、CSRF、限流、签名Token、事务、审计和受控隐私清除。
