# WT-031 单运行消费端指标按需查询

> 状态：已完成  
> 前置任务：[`WT-030`](./WT-030-BUILD-CONSUMER-METRIC-SAMPLE-BATCH.md)  
> 对应基线：聚合可重算、scope隔离和不可用状态明确  
> 发布状态：内部只读应用服务，无HTTP路由

## 目标

把“读取事实并构建单运行批次”与“调用领域纯函数计算报告”编排成一次只读应用调用，使未物化的终态消费端运行可以按需得到指标报告。

## 查询流程

查询输入保持`scopeId + runId`：

1. 查询服务先校验Principal的scope权限；
2. 调用WT-030批次构建器读取运行事实并构建内存批次；
3. 再次核对批次scope与run身份；
4. 使用服务端时钟作为`computedAt`；
5. 调用与WT-017共用的批次计算函数返回领域报告。

调用过程中不把批次写入Repository、缓存或数据库。

## 与物化读取的关系

- WT-017继续保留，用于读取已经存在的运行级批次；
- WT-031用于没有物化批次时的按需重算；
- 两条路径共用同一个`computeConsumerObservationMetricSampleBatch()`入口；
- 两条路径均不发布HTTP接口，也不决定未来采用按需计算还是生产物化。

## 明确不做

- 不自动保存构建结果；
- 不实现缓存命中、刷新、并发重算或版本比较；
- 不聚合多个运行；
- 不返回尚未定义完整公共上下文的稳定API响应；
- 不新增HTTP或OpenAPI路径；
- 不接入真实数据或激活豆包Surface；
- 不修改批准基线。

## 测试

- 按需构建后立即计算可用报告；
- 服务端时间进入报告；
- 无scope权限时不调用批次构建器；
- 构建器返回其他运行身份时失败关闭；
- 内部端到端链路移除临时指标Repository后仍得到严格DTO和`1/1=1`。

## 完成标准

- [x] 按需查询应用服务完成；
- [x] 与物化读取共用批次计算入口；
- [x] scope权限在构建前校验；
- [x] 构建后再次复核批次身份；
- [x] 计算时间由服务端提供；
- [x] 端到端不再安装临时指标批次；
- [x] 无持久化、HTTP、真实数据或生产启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 按需服务：`packages/application/src/consumer-observation-run-metrics-query.ts`；
- 共用计算入口：`packages/application/src/consumer-observation-metrics-query.ts`；
- 定向测试：`packages/application/test/consumer-observation-run-metrics-query.test.ts`；
- 端到端：`apps/api/test/consumer-observation-internal-e2e.test.ts`；
- 全量验证：206项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目60份Markdown中的141个相对链接有效，Git未初始化；
- 发布边界复核：物化Repository路径保留，按需路径不保存批次，正式指标路由未注册，豆包Adapter仍为`doubao-web@0-draft`；
- 深度自审修复：scope权限在调用构建器前重复校验；对结构化构建器仍复核返回批次身份；共用计算函数避免按需路径与WT-017公式漂移。

## 后续

单运行指标质量上下文已在[`WT-032`](./WT-032-CONSUMER-RUN-METRIC-QUALITY-CONTEXT.md)补齐，并保持内部DTO草案和无HTTP路由状态。
