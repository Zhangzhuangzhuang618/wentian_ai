# WT-025 消费端待复核证据Artifact

> 状态：已完成  
> 批准来源：`CHG-VIS-002`中`ai_consumer_capture_artifacts`和项目所有者持续推进授权  
> 对应基线：消费端观察包提交、人工确认与拒绝清除生命周期  
> 发布状态：内部领域对象与内存Repository，无HTTP路由

## 目标

在观察包提交时保存不可变的完整待复核证据，使用户后续确认的是已经提交的回答、引用、元数据和媒体引用；确认后不得再次传入另一份内容替换已复核证据。

## Artifact白名单

完整待复核artifact保存：

- artifact、scope、观察任务和采集人ID；
- 采集方式、Adapter版本和服务端创建时间；
- 可见回答原文及SHA-256；
- 最多100条可见引用及可选跳转解析；
- 产品标签、页面显示模型、搜索模式、新会话、登录、记忆/个性化、语言、地区和观察时间；
- 截图媒体对象ID；
- 可选脱敏DOM对象键及其SHA-256；
- 版本化引用包SHA-256。

Artifact不保存截图或DOM二进制、Cookie、localStorage、Authorization、Capture Token或消费端账号标识。领域工厂只复制白名单字段，完整性复核还会拒绝Repository返回对象上的额外字段。

## 共享证据规范

待复核artifact与正式确认记录共用同一套可见引用和页面元数据规范化：

- URL只接受无凭据HTTP/HTTPS；
- 引用位置为唯一正整数，非空列表必须包含位置1；
- 页面包装URL与`known_redirect_target`成对存在；
- 会话布尔、搜索模式、语言、地区和观察时间严格校验；
- 回答原文不因哈希而修改。

这样可以避免待复核与确认阶段对同一证据使用两套不同规则。

## 哈希语义

- `answerHash`是回答原文UTF-8 SHA-256；
- `domHash`由对象上传边界提供，存在DOM对象键时必须同时存在合法小写SHA-256；
- `captureSha256`覆盖版本、身份绑定、回答哈希、规范化引用、元数据、截图对象ID、DOM对象键/哈希、Adapter和创建时间；
- `captureSha256`只证明结构化记录与媒体引用组合的完整性，不声称覆盖截图二进制内容，也不是真实性、签名或加密证明；
- 后续对象存储实现必须单独校验截图和DOM对象内容校验和。

## 生命周期

### 提交

工作流仍允许合成测试使用最小binding artifact；正式证据链使用完整artifact。完整artifact在提交和确认推进前都会复核白名单与哈希，其`createdAt`必须与服务端采集提交时间完全一致；提交校验在消费Capture Token nonce之前完成。

### 待复核

Repository按artifact ID和观察任务保持唯一，证据对象冻结且没有update方法。任务处于`needs_review`时，artifact不进入默认指标。

### 确认

WT-024记录写入服务现在只接受scope和任务ID。服务读取已提交完整artifact，执行完整性、运行、Surface、会话和任务窗口校验，再生成正式不可变确认记录。binding-only artifact不能生成正式记录。

### 拒绝

既有WT-009拒绝流程继续按scope清除artifact并把任务推进到不可逆`rejected`终态；不生成证据等级和正式确认记录。

## 明确不做

- 不把artifact创建、任务状态保存、确认记录追加和source events描述为同一数据库事务；
- 不创建对象存储上传端口或校验截图二进制；
- 不创建PostgreSQL迁移；
- 不注册正式HTTP路由或启用OpenAPI草案；
- 不接入真实豆包观察包；
- 不激活豆包Adapter或Surface；
- 不修改批准基线。

## 测试

- Artifact、引用数组、引用项和元数据不可变；
- 回答哈希与版本化capture哈希可复算，截图对象引用变化会改变capture哈希；
- DOM对象键与合法SHA-256必须成对存在；
- 页面观察时间不能晚于artifact创建时间；
- 回答哈希、capture哈希或额外敏感字段被篡改时完整性校验失败；
- 工作流在提交和确认前复核完整artifact，并拒绝与采集提交时间不同的artifact；提交失败不消费nonce；
- 拒绝流程清除完整artifact；
- 确认记录服务拒绝binding-only artifact；
- 记录内容只能来自已提交artifact；
- 内部端到端链路使用完整artifact后仍通过。

## 完成标准

- [x] 基线定义的待复核证据白名单已形成不可变领域对象；
- [x] 待复核与确认记录共用引用和元数据规范化；
- [x] answer、DOM和capture引用包哈希约束完成；
- [x] 提交时间、任务、用户和scope绑定完成；
- [x] 确认落档不再接受第二份证据内容；
- [x] binding-only artifact不能生成正式记录；
- [x] 拒绝清除和确认保留生命周期测试通过；
- [x] 无HTTP、真实数据、生产存储或Surface启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 待复核领域对象：`packages/domain/src/consumer-capture-evidence-artifact.ts`；
- 共享证据规范化：`packages/domain/src/consumer-visible-evidence.ts`；
- 工作流时间绑定：`packages/application/src/consumer-observation-workflow.ts`；
- 确认记录派生：`packages/application/src/store-confirmed-consumer-observation-record.ts`；
- 内存Repository：`packages/infrastructure/src/in-memory-repositories.ts`；
- 测试：领域artifact、工作流、确认记录服务及内部端到端测试；
- 全量验证：183项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目53份Markdown中的102个相对链接有效，Git未初始化；
- 发布边界复核：正式路径仍未注册，豆包Adapter仍为`doubao-web@0-draft`，新增数据均为合成值；
- 深度自审修复：待复核与确认共用规范化；提交、确认和正式记录派生前均复核完整性；额外字段被拒绝；时间错配在nonce消费前失败；capture哈希明确不冒充媒体二进制校验。

## 后续

已确认消费端`cited`来源事件已在[`WT-026`](./WT-026-CONFIRMED-CONSUMER-CITED-SOURCE-EVENTS.md)完成；内存确认事务、公共样本基数和运行级批次构建已分别由[`WT-027`](./WT-027-CONSUMER-OBSERVATION-CONFIRMATION-TRANSACTION.md)、[`WT-028`](./WT-028-CONSUMER-METRICS-SAMPLE-BASIS.md)和[`WT-030`](./WT-030-BUILD-CONSUMER-METRIC-SAMPLE-BATCH.md)补齐。生产事务与物化仍未实现。
