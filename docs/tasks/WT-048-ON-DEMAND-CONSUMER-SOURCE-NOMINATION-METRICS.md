# WT-048 消费端自述单运行指标按需查询

> 状态：已完成  
> 前置任务：[`WT-047`](./WT-047-RUN-SCOPED-SOURCE-NOMINATION-METRIC-BATCH.md)  
> 前置决策：[`DEC-WT048-001`](../decisions/DEC-WT048-001-CONSUMER-NOMINATION-RUN-METRIC-CONTEXT.md)  
> 对应基线：自述指标按上下文隔离并返回方法、分母和证据警告  
> 发布状态：内部按需查询，无HTTP、持久化或真实调用

## 目标

在scope门禁下按需构建单个消费端自述运行的完整样本批次，调用WT-034纯函数计算报告，并附带运行级审计上下文。

## 实现

- scope读取门禁早于批次构建；
- 构建结果必须与请求scope和run一致；
- 校验本地/GEO问题集来源和GEO契约版本配对；
- 固定source_nomination实验、消费端采集方式和非空提名上下文；
- 所有样本必须与运行上下文一致；
- 复用WT-034公式和固定证据警告；
- 返回运行、Surface和采集上下文，不修改纯领域报告语义。

## 明确不做

- 不缓存或物化指标；
- 不发布HTTP或扩展OpenAPI；
- 不修改WT-035纯指标DTO；
- 不计算提名—引用重合；
- 不调用真实网页、Provider或GEO。

## 测试

- 按需构建并计算带运行上下文的报告；
- 无scope权限时不调用构建器；
- 构建器返回其他运行时失败关闭；
- GEO版本、实验类型和样本上下文漂移失败关闭。

## 完成标准

- [x] 按需查询服务完成；
- [x] 运行级上下文完成；
- [x] scope与返回身份双重校验；
- [x] 提名上下文禁止混合；
- [x] 复用纯指标函数；
- [x] 无HTTP、持久化或外部调用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-23；
- 实现：`packages/application/src/consumer-source-nomination-metrics-query.ts`；
- 测试：`packages/application/test/consumer-source-nomination-metrics-query.test.ts`；
- 当前验证：类型检查与279项完整测试通过；
- 最终全量验证：`pnpm verify`通过，299项测试全部通过；
- 深度自审修复：批次身份二次校验；GEO来源和契约版本强制成对；批次内样本上下文不得漂移。

## 后续

带运行上下文的严格snake_case内部DTO已由[`WT-049`](./WT-049-CONSUMER-SOURCE-NOMINATION-RUN-METRICS-CONTRACT.md)完成。
