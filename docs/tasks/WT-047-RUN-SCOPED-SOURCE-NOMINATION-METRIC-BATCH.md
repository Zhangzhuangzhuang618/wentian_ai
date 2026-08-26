# WT-047 运行级自述指标批次构建

> 状态：已完成  
> 前置任务：[`WT-046`](./WT-046-CONSUMER-SOURCE-NOMINATION-METRIC-PROJECTION.md)  
> 前置决策：[`DEC-WT047-001`](../decisions/DEC-WT047-001-RUN-SCOPED-NOMINATION-METRIC-BATCH.md)  
> 对应基线：成功响应全覆盖、上下文隔离和可复算样本基数  
> 发布状态：内部应用服务与内存Repository组合，无HTTP或物化

## 目标

从单个已终结消费端自述运行的快照、任务、响应、复核、正式事件和历史Surface版本构建不可裁剪的指标样本批次。

## 实现

- scope读取权限和运行身份门禁；
- 只接受终结`source_nomination`运行；
- 用完整任务槽位复算运行状态及计划/成功/失败数量；
- confirmed任务逐一绑定响应、review和正式事件；
- 复核三种终态全部进入成功样本覆盖；
- rejected采集任务只进入failed基数且禁止响应；
- 校验历史Surface、Adapter、产品标签及采集方式；
- 固定本地/GEO问题集来源、GEO契约版本和提名上下文；
- 样本按问题和样本序确定性排列并拒绝重复身份。

## 明确不做

- 不为缺失review合成needs_review；
- 不接收客户端样本或运行元数据；
- 不物化生产批次；
- 不注册HTTP或OpenAPI；
- 不调用真实消费端、Provider或GEO。

## 测试

- 终结partial运行生成human_confirmed/needs_review/rejected三类成功样本及失败基数；
- 非终结和跨scope失败关闭；
- 缺响应、缺review、失败任务带响应失败关闭；
- 错误投影身份和Surface证据错绑失败关闭；
- GEO问题集契约版本进入批次。

## 完成标准

- [x] 运行级批次端口与构建服务完成；
- [x] 运行计数和任务全集复算完成；
- [x] 成功响应和复核状态完整覆盖；
- [x] 历史Surface证据绑定完成；
- [x] 本地/GEO问题集来源保留；
- [x] 无HTTP、外部调用或生产物化；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-23；
- 实现：`packages/application/src/build-consumer-source-nomination-metric-sample-batch.ts`；
- 批次端口：`packages/application/src/ports.ts`；
- 测试：`packages/infrastructure/test/build-consumer-source-nomination-metric-sample-batch.test.ts`；
- 当前验证：类型检查与279项完整测试通过；
- 最终全量验证：`pnpm verify`通过，299项测试全部通过；
- 深度自审修复：成功响应缺review明确失败；采集失败不伪装解析拒绝；历史Adapter和产品标签与Surface版本绑定。

## 后续

由[`WT-048`](./WT-048-ON-DEMAND-CONSUMER-SOURCE-NOMINATION-METRICS.md)按需计算单运行报告。
