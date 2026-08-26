# WT-010 合成消费端观察HTTP API

> 状态：已完成  
> 批准来源：项目所有者要求开始下一步  
> 对应基线：`CHG-VIS-002`、`VIS-W02`的API交互验证子集  
> Surface状态：`draft`

## 目标

使用合成任务和纯内存数据把WT-009工作流接入HTTP层，验证请求契约、权限、版本冲突、一次性Capture Token和确认/拒绝幂等语义，同时确保当前接口不能接收真实观察内容。

## 实现范围

- 默认关闭的`/dev/synthetic/consumer-observation/tasks/{id}`路由组；
- `claim`、`captures`、`confirm`和`reject`四个POST动作；
- 固定响应标识`wentian-synthetic-consumer-api@0`和`synthetic=true`；
- 严格JSON请求契约和64KiB请求体上限；
- Capture Token验证、origin绑定和nonce一次性消费；
- scope隔离和owner/admin/analyst写权限；
- 任务version乐观冲突返回409；
- confirm/reject强制`Idempotency-Key`，同键同请求复用结果、同键不同请求返回409；
- 公开错误映射不返回堆栈，令牌失效或绑定不匹配统一为`CAPTURE_TOKEN_INVALID`；
- 合成领取、采集、确认、拒绝、重放、越权和失败恢复HTTP集成测试。

## 路由

```text
POST /dev/synthetic/consumer-observation/tasks/{id}/claim
POST /dev/synthetic/consumer-observation/tasks/{id}/captures
POST /dev/synthetic/consumer-observation/tasks/{id}/confirm
POST /dev/synthetic/consumer-observation/tasks/{id}/reject
```

`captures`请求只允许`scope_id`、`task_version`和`capture_token`。回答正文、截图、可见引用、Cookie或其他额外字段均被严格拒绝。

## 默认关闭

`createWentianApiServer()`只有显式注入`syntheticConsumerObservationApi`测试配置时才注册上述路由。`apps/api/src/main.ts`没有该配置，因此普通`pnpm dev:api`和未来默认部署不会开放合成路由。

## 明确不做

- 不实现批准基线中的正式`/ai-visibility/...`生产路由；
- 不接收浏览器草稿、回答、引用、截图或DOM；
- 不接入真实身份会话、CSRF、限流或生产Capture Token签名；
- 不创建数据库迁移、对象存储、事务、Outbox或审计记录；
- 不创建正式response和source event；
- 不提供批量、后台或无人值守采集；
- 不上传WT-007真实导出文件；
- 不激活豆包Surface或Adapter；
- 不修改批准基线。

## 验证

```bash
pnpm verify
```

## 完成标准

- [x] 合成路由默认返回404；
- [x] 仅接受POST和`application/json`；
- [x] 请求体超过64KiB返回413；
- [x] 真实回答、截图和引用字段不能进入合成采集接口；
- [x] 伪造、过期或绑定不匹配token统一拒绝；
- [x] 失败的请求不消费合法token；
- [x] 跨scope返回404，scope内viewer返回403；
- [x] 旧任务version返回409；
- [x] confirm/reject缺少幂等键不能执行；
- [x] 幂等重放返回原结果，键冲突返回409；
- [x] 拒绝结果不产生证据等级；
- [x] 全量验证、边界、格式、基线哈希和文档链接复核通过；
- [x] Git未初始化。

## 完成记录

- 完成日期：2026-08-22；
- HTTP实现：`apps/api/src/synthetic-consumer-observation-api.ts`；
- 契约实现：`packages/contracts/src/synthetic-consumer-observation-api.ts`；
- 集成测试：`apps/api/test/synthetic-consumer-observation.test.ts`；
- 全量验证：93项测试通过，类型、架构边界和格式检查通过；
- 合成路由没有连接主进程配置、真实文件、浏览器扩展、数据库或外部网络。
- 完整性复核：批准基线13个文件哈希未变化，36份Markdown中的51个相对链接有效，Git未初始化。

## 后续门禁

正式API设计契约和合成适配测试已在 [WT-011](./WT-011-FORMAL-CONSUMER-OBSERVATION-CONTRACTS.md) 完成，但不能直接把`/dev/synthetic`改名为生产路由。真实上传前仍必须完成WT-005条款、数据保留期、责任人和允许地区审批，并实现身份、CSRF、限流、签名token、事务、审计和隐私清除基础设施。
