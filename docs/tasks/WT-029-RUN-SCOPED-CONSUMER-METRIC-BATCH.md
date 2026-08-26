# WT-029 运行级消费端指标批次

> 状态：已完成  
> 决策记录：[`DEC-WT029-001`](../decisions/DEC-WT029-001-RUN-SCOPED-METRIC-BATCH.md)  
> 对应基线：指标配置隔离、聚合可重算和筛选哈希演进方向  
> 发布状态：内部端口、查询服务与内存Repository，无HTTP路由

## 目标

消除`scope + query_set_snapshot_hash`批次键对重复运行造成的冲突风险。在完整跨运行筛选契约形成前，把内部消费端指标报告限定为单次运行。

## 改造内容

- 指标样本批次增加必需`runId`；
- Repository读取身份改为`scopeId + runId`；
- 内部查询命令改为`scopeId + runId`；
- 服务读取后再次核对批次scope和run身份；
- 问题集哈希和归一化版本继续由批次提供给领域计算；
- 内部端到端验收通过已完成运行ID读取报告。

## 隔离语义

- 相同run ID可在不同scope中隔离保存和读取；
- 相同scope、相同问题集哈希的不同运行可以并存；
- 相同scope和run ID的第二个批次被拒绝，即使它声称属于另一问题集；
- 无scope权限和批次不存在继续统一返回`RESOURCE_NOT_FOUND`；
- Repository返回错误run身份时失败关闭。

## 明确不做

- 不聚合多个运行；
- 不定义日期窗口、运行选择、配置兼容或筛选哈希公共契约；
- 不新增公共响应字段、HTTP接口或OpenAPI路径；
- 不实现生产缓存、数据库视图或物化表；
- 不接入真实观察数据；
- 不激活豆包Adapter、Surface、Worker或GEO连接器；
- 不修改批准基线。

## 测试

- 有权限时按scope和run读取并计算；
- 无权限与不存在运行批次统一隐藏；
- 相同run ID跨scope隔离；
- 同一问题集的不同运行并存；
- 待审核证据仍返回`not_available`；
- 错误批次身份失败关闭；
- 重复scope和run批次被拒绝；
- 内部端到端链路使用run ID读取。

## 完成标准

- [x] 批次携带run ID；
- [x] 查询和Repository使用scope与run复合身份；
- [x] 同问题集多运行不再冲突；
- [x] 重复运行批次失败关闭；
- [x] scope权限和资源隐藏语义不变；
- [x] 形成决策记录并明确临时内部边界；
- [x] 无跨运行聚合、HTTP、真实数据或生产启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 决策：`docs/decisions/DEC-WT029-001-RUN-SCOPED-METRIC-BATCH.md`；
- 应用端口：`packages/application/src/ports.ts`；
- 查询服务：`packages/application/src/consumer-observation-metrics-query.ts`；
- 内存Repository：`packages/infrastructure/src/in-memory-repositories.ts`；
- 测试：`packages/infrastructure/test/consumer-observation-metrics-query.test.ts`和内部端到端验收；
- 全量验证：199项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目58份Markdown中的120个相对链接有效，Git未初始化；
- 发布边界复核：正式指标路由未注册，豆包Adapter仍为`doubao-web@0-draft`，未实现跨运行聚合或生产Repository；
- 深度自审修复：批次唯一键不再错误使用问题集哈希；查询后仍复核run身份；相同scope和问题集的多运行新增并存测试；同run不同问题集新增冲突测试。

## 后续

只读的单运行批次构建已在[`WT-030`](./WT-030-BUILD-CONSUMER-METRIC-SAMPLE-BATCH.md)完成：从运行、完整任务集、确认记录和历史Surface版本派生样本基数与指标样本，仍不自动持久化或跨运行合并。
