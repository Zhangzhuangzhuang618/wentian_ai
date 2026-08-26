# WT-049 消费端自述运行级指标严格契约

> 状态：已完成  
> 前置任务：[`WT-048`](./WT-048-ON-DEMAND-CONSUMER-SOURCE-NOMINATION-METRICS.md)  
> 前置决策：[`DEC-WT049-001`](../decisions/DEC-WT049-001-CONSUMER-NOMINATION-RUN-READ-MODEL.md)  
> 对应基线：自述指标分母、方法、证据警告和消费端运行上下文  
> 发布状态：严格内部DTO草案，无HTTP或OpenAPI

## 目标

把WT-048内部单运行报告适配为严格、可复算且带消费端审计上下文的snake_case响应。

## 实现

- 新建独立`@0-draft`运行级契约版本；
- 复用WT-035指标字段与全部顶层/组内复算规则；
- 增加run、问题集来源、GEO版本、采集方式、提名上下文和Surface身份；
- GEO来源与版本强制配对；
- 指标组上下文必须等于运行上下文；
- 额外字段、比例篡改和伪造内部抓取数据失败关闭；
- available/not_available均保留同样的运行上下文。

## 明确不做

- 不修改WT-035纯指标契约；
- 不注册路由或OpenAPI；
- 不新增计算公式；
- 不持久化报告；
- 不调用外部系统。

## 测试

- 可用报告适配为严格运行级DTO；
- 无验证样本仍保留运行上下文；
- 额外内部抓取字段和比例篡改被拒绝；
- GEO版本和组内上下文漂移被拒绝。

## 完成标准

- [x] 独立运行级契约版本完成；
- [x] WT-035校验完整复用；
- [x] 运行和消费端上下文完成；
- [x] GEO版本和提名上下文复核完成；
- [x] 严格额外字段门禁完成；
- [x] 无HTTP、OpenAPI或外部调用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-23；
- 实现：`packages/contracts/src/consumer-source-nomination-run-metrics.ts`；
- 测试：`packages/contracts/test/consumer-source-nomination-run-metrics.test.ts`；
- 当前验证：类型检查与284项完整测试通过；
- 最终全量验证：`pnpm verify`通过，299项测试全部通过；
- 深度自审修复：不覆盖WT-035原契约版本；运行Schema再次调用基础Schema复核全部领域约束；空组报告仍保留显式运行上下文。

## 后续

由[`WT-050`](./WT-050-CONSUMER-SOURCE-NOMINATION-INTERNAL-E2E.md)验证运行创建到该DTO的完整内部链路。
