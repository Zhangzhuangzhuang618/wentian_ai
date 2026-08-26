# WT-033 消费端人工录入提交契约

> 状态：已完成  
> 前置任务：[`WT-011`](./WT-011-FORMAL-CONSUMER-OBSERVATION-CONTRACTS.md)  
> 前置决策：[`DEC-WT033-001`](../decisions/DEC-WT033-001-MANUAL-IMPORT-EVIDENCE-BOUNDARY.md)  
> 对应基线：`VIS-W02`现场人工录入兜底与人工确认  
> 发布状态：内部严格Schema和纯函数适配器，无HTTP路由

## 目标

为`web_observed + manual_import`建立独立输入边界，使人工录入可以安全转换为既有观察包提交DTO，同时不能由调用方控制采集方式、Adapter版本或确认结果。

## 输入与转换

人工录入输入只接受：

- 任务版本；
- 页面可见回答原文；
- 最多100条可见HTTP(S)引用；
- 产品、模型显示、搜索模式、会话条件、语言、地区和观察时间；
- 已由服务端分配的截图媒体资产ID。

适配器固定输出：

- `collection_method = manual_import`；
- `adapter_version = wentian-manual-import@1`。

人工录入输入不包含DOM对象键，也不包含确认状态。转换结果进入既有提交、复核和确认链路，只有确认事务完成后才会产生`web_confirmed_manual`。

## 明确不做

- 不实现人工录入页面或截图上传；
- 不注册正式HTTP路由；
- 不跳过Capture Token、任务版本和后续确认；
- 不接收真实豆包数据；
- 不激活Surface或Adapter；
- 不创建数据库迁移；
- 不修改批准基线。

## 测试

- 合法人工录入转换为通用提交DTO；
- 采集方式和Adapter版本由服务端固定；
- 客户端覆盖采集方式、版本、DOM键或Cookie时被拒绝；
- 缺少截图、观察时间非法或引用不是HTTP(S)时被拒绝；
- 输出继续通过通用提交Schema复核。

## 完成标准

- [x] 人工录入严格输入Schema完成；
- [x] 采集方式和Adapter版本不可由调用方覆盖；
- [x] 截图和可见页面元数据保持必填；
- [x] DOM与敏感额外字段失败关闭；
- [x] 输出兼容既有通用提交契约；
- [x] 无HTTP、真实数据、生产启用或基线修改；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 实现：`packages/contracts/src/manual-consumer-observation-submission.ts`；
- 测试：`packages/contracts/test/manual-consumer-observation-submission.test.ts`；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：无HTTP路由、无真实数据、无DOM上传，豆包Adapter仍为`doubao-web@0-draft`；
- 深度自审修复：人工录入不能直接构造`collection_method`和`adapter_version`；不能借人工入口提交DOM；截图要求没有因兜底路径而放宽；适配器不输出确认状态，避免跳过人工复核。

## 后续

后续可用全合成数据验证人工录入从运行创建到指标DTO的完整链路；正式页面、上传、持久化和路由继续受现有门禁约束。
