# WT-037 自述解析复核状态机

> 状态：已完成  
> 前置任务：[`WT-036`](./WT-036-NOMINATED-SOURCE-EVENT.md)  
> 前置决策：[`DEC-WT037-001`](../decisions/DEC-WT037-001-NOMINATION-PARSE-REVIEW-LIFECYCLE.md)  
> 对应基线：`ai_nomination_parse_reviews`及确认/拒绝终态  
> 发布状态：纯领域状态机，无Repository、事务或HTTP路由

## 目标

为非结构化AI自述结果建立可复核、可修订、不可逆的领域状态机，确保不确定域名不会直接进入正式`nominated`事件或指标。

## 记录与状态

记录保存：

- review、scope和response身份；
- 最多10个显式域名候选；
- 提取器版本、初始候选数、有效/拒绝显式项数和截断标志；
- 可空顺序、信息类型和理由；
- 状态、审核人、审核时间与拒绝原因；
- 乐观版本、创建和更新时间。

状态转换：

```text
needs_review -> confirmed
needs_review -> rejected
```

confirmed与rejected均为不可逆终态。确认可提交人工修订后的列表；拒绝必须提交原因。

## 校验

- scope与期望版本必须匹配；
- 审核时间不能早于记录更新时间；
- 顺序全部存在或全部为空；
- 明确顺序连续且唯一；
- 无序重复域名失败关闭；
- 域名、信息类型、理由和拒绝原因使用长度白名单；
- 记录及项目数组冻结，完整性复核拒绝额外字段。
- 人工确认可修订当前列表，但WT-044新增的初始解析溯源保持不可变。

## 明确不做

- 不解析真实回答或猜测机构域名；
- 不创建`nominated`事件；
- 不实现Repository、确认事务、审计或幂等键；
- 不注册HTTP路由；
- 不接入Provider、消费端网页或真实数据；
- 不创建迁移或修改批准基线。

## 测试

- 创建needs_review记录并规范化域名；
- 人工确认可修订项目且进入不可逆终态；
- 拒绝保存原因且不能再确认；
- scope、版本、时间和空拒绝原因失败关闭；
- 混合/非连续顺序、重复无序域名和额外字段被拒绝；
- 三种状态的完整性可重建复核。

## 完成标准

- [x] needs_review创建完成；
- [x] confirmed/rejected终态完成；
- [x] scope、版本和时间门禁完成；
- [x] 人工修订候选列表受严格约束；
- [x] 拒绝原因必填且终态不可逆；
- [x] 结构不可变和完整性复核完成；
- [x] 无事件写入、Repository、真实数据或路由；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 实现：`packages/domain/src/source-nomination-parse-review.ts`；
- 测试：`packages/domain/test/source-nomination-parse-review.test.ts`；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：无Repository、事务、事件写入、HTTP或真实数据；
- 深度自审修复：确认只更新当前版本候选且保留审核身份；领域状态机不承担Repository幂等和审计历史；无序重复域名与未来唯一约束保持一致；终态重复调用不在领域层伪装为幂等成功。

## 后续

内存Repository已在[`WT-038`](./WT-038-SOURCE-NOMINATION-PARSE-REVIEW-REPOSITORY.md)完成。下一步需先建立服务端不可变自述响应身份，再实现“确认复核 + 完整nominated事件集合”原子事务；拒绝路径必须只保存终态复核，不生成事件。
