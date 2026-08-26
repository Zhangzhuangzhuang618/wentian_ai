# WT-011 正式消费端观察API契约与合成适配

> 状态：已完成  
> 批准来源：项目所有者要求开始下一步  
> 对应基线：`CHG-VIS-002`、`VIS-W02`的正式API契约子集  
> 契约状态：`wentian-consumer-observation-http@0-draft`  
> Surface状态：`draft`

## 目标

把批准基线中的消费端观察正式路径定义为不可执行的版本化契约，并实现纯函数适配器，验证已本地确认的浏览器草稿在补齐人工复核会话元数据和合成截图资产ID后，可以转换为正式观察提交DTO。

## 实现范围

- 固定创建、领取、提交、确认和拒绝的正式路径常量；
- 领取响应包含标准问题、Surface、采集方式、会话条件和短期Capture Token；
- Capture Token与观察包DTO分离，确认/拒绝幂等键独立校验；
- 提交、确认和拒绝响应分别显示任务状态、确认状态和证据等级；
- `needs_review`和`rejected`响应的证据等级固定为空；
- 可见引用保留目标URL、页面实际包装地址和确定性解析类型；
- 已确认浏览器草稿到`submitConsumerCaptureInputSchema`的纯函数适配器；
- 人工复核补充模型标签、是否新会话、登录状态、记忆/个性化、语言和地区；
- 合成UUID、合成回答和合成截图资产ID的适配测试。

## 正式路径常量

```text
POST /ai-visibility/consumer-observations
POST /ai-visibility/consumer-observations/tasks/{id}/claim
POST /ai-visibility/consumer-observations/tasks/{id}/captures
POST /ai-visibility/consumer-observations/tasks/{id}/confirm
POST /ai-visibility/consumer-observations/tasks/{id}/reject
```

这些路径当前只存在于契约常量，没有注册到`createWentianApiServer()`，不能通过HTTP访问。

## 证据转换规则

- 只有`confirmed_local_export`草稿可以转换；
- `visible_citations`只接收页面实际可见HTTP(S)链接；
- 豆包跳转链接保留`observed_url`，确定性目标保存在`url`，解析类型为`known_redirect_target`；
- `source_mention_hints`不进入正式引用字段，也不升级为来源事件；
- 回答正文仍保留页面原文，正文中出现的信源名称不因此成为引用；
- PNG Data URL不进入正式DTO，只保留服务端已分配的`screenshot_media_asset_id`；
- 页面标题和页面origin不进入正式可见元数据；
- 适配过程只转换数据，不访问引用URL或截图对象。

## 明确不做

- 不注册或实现正式HTTP路由；
- 不接收真实观察包，不上传截图；
- 不签发或验证生产Capture Token；
- 不信任人工补充元数据作为服务端事实，未来处理器仍须按任务和Surface复核；
- 不创建数据库、对象存储、事务、Outbox、审计或正式response/source event；
- 不解析`source_mention_hints`为引用；
- 不访问URL，不验证第三方网页真实性；
- 不激活豆包Surface或Adapter；
- 不修改批准基线。

## 验证

```bash
pnpm verify
```

## 完成标准

- [x] 正式路径与批准基线一致；
- [x] 契约明确标记为`@0-draft`而非已发布`@1`；
- [x] 领取响应包含问题、条件和短期token；
- [x] Capture Token、观察DTO和幂等键相互分离；
- [x] 确认状态与证据等级不混用；
- [x] 页面包装地址和解析目标同时保留；
- [x] 文本信源提示不能进入正式引用字段；
- [x] 截图Data URL不能进入正式提交DTO；
- [x] 未经本地确认的草稿不能适配；
- [x] 人工补充元数据严格拒绝Cookie等额外字段；
- [x] 正式路由没有注册到API Server；
- [x] 全量验证、边界、格式、基线哈希和文档链接复核通过；
- [x] Git未初始化。

## 完成记录

- 完成日期：2026-08-22；
- 正式HTTP契约：`packages/contracts/src/consumer-observation-http.ts`；
- 草稿适配器：`packages/contracts/src/browser-capture-submission-adapter.ts`；
- 引用溯源扩展：`visibleCitationInputSchema`新增成对的`observed_url/resolution`；
- 全量验证：102项测试通过，类型、架构边界和格式检查通过；
- 自审修复：契约版本从稳定含义调整为`@0-draft`，避免在合规与生产基础设施完成前暗示已经发布。
- 完整性复核：正式路径只存在于契约与测试，批准基线13个文件哈希未变化，37份Markdown中的54个相对链接有效，Git未初始化。

## 后续门禁

不可执行的OpenAPI草案和契约一致性测试已在[`WT-012`](./WT-012-CONSUMER-OBSERVATION-OPENAPI-DRAFT.md)完成；人工录入兜底的严格输入适配器已在[`WT-033`](./WT-033-MANUAL-CONSUMER-OBSERVATION-SUBMISSION.md)完成。正式路由实现、浏览器上传和真实数据持久化仍必须等待WT-005条款、保留期、责任人和允许地区审批，并补齐身份、CSRF、限流、签名token、事务、审计和隐私清除基础设施。
