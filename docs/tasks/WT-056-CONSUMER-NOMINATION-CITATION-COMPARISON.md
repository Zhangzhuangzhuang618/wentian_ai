# WT-056 消费端提名—引用运行对照服务

> 状态：已完成  
> 前置任务：[`WT-054`](./WT-054-SOURCE-ENTRY-COUNT-RANKING.md)、[`WT-055`](./WT-055-PAIRED-RUN-COMPARABILITY.md)  
> 前置决策：[`DEC-WT054-001`](../decisions/DEC-WT054-001-SOURCE-ENTRY-COUNT-RANKING.md)、[`DEC-WT055-001`](../decisions/DEC-WT055-001-PAIRED-RUN-24H-COMPARABILITY.md)  
> 发布状态：内部只读应用服务，无HTTP或外部连接

## 目标

把配对运行门禁、正式信源事件累计排名和单问题Top-K重合计算串成一次scope隔离的内部查询。

## 实现范围

- 读取明确指定的自然回答与信源自述运行；
- 不可比时立即返回原因，不读取或计算信源明细；
- 可比时按问题读取已确认回答、复核结果及正式信源事件；
- 提名侧只纳入`confirmed`复核，引用侧只纳入正式cited事件；
- 每题分别返回两侧有效样本数、条目累计排名和可用时的Top-K重合；
- 一侧没有有效样本时保留另一侧排名，但不生成重合值。

## 明确不做

- 不注册公共HTTP或OpenAPI；
- 不持久化派生报告；
- 不把待复核或拒绝提名计入排名；
- 不调用消费端网页、Provider或GEO。

## 完成标准

- [x] 用户示例排名在运行级链路中复现；
- [x] 24小时和配置门禁位于信源明细读取之前；
- [x] 空信源集合与无有效样本严格区分；
- [x] scope、运行、响应、复核和事件错绑失败关闭；
- [x] `pnpm verify`通过。

## 完成记录

- 完成日期：2026-08-23；
- 实现：`packages/application/src/consumer-nomination-citation-comparison.ts`；
- 测试：`packages/application/test/consumer-nomination-citation-comparison.test.ts`；
- 发布边界：仅内部只读应用服务，尚无公开HTTP和UI入口；
- 最终验证：`pnpm verify`通过，329项测试全部通过。
