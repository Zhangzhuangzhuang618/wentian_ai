# WT-057 消费端提名—引用对照严格契约

> 状态：已完成  
> 前置任务：[`WT-056`](./WT-056-CONSUMER-NOMINATION-CITATION-COMPARISON.md)  
> 发布状态：严格内部DTO草案，无HTTP或OpenAPI

## 目标

把运行级对照结果适配为前端可直接使用、服务端可复算且拒绝额外结论的严格snake_case响应。

## 实现范围

- 固化配对运行24小时门禁及原因码；
- 固化每题两侧有效样本数、累计条目排名和可用性；
- 复用Top-K重合严格契约；
- 复核排名总数、连续名次、排序规则、问题身份和重合输入一致性；
- 不可比时禁止携带问题结果，不可用时禁止伪造重合值。

## 明确不做

- 不新增HTTP路由或OpenAPI；
- 不加入抓取频率、因果、权重或官方排名字段；
- 不持久化DTO。

## 完成标准

- [x] 可比和不可比报告均通过严格适配；
- [x] 排名、样本数和Top-K输入可复算；
- [x] 额外字段和矛盾状态失败关闭；
- [x] `pnpm verify`通过。

## 完成记录

- 完成日期：2026-08-23；
- 实现：`packages/contracts/src/consumer-nomination-citation-comparison.ts`；
- 测试：`packages/contracts/test/consumer-nomination-citation-comparison.test.ts`；
- 契约版本：严格内部DTO草案，拒绝“抓取频率”等不可核验结论；
- 最终验证：`pnpm verify`通过，329项测试全部通过。
