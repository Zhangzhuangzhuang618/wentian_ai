# WT-021 消费端观察运行进度重算

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、消费端运行状态与样本进度  
> 发布状态：内部协调服务，无HTTP路由

## 目标

在任务状态变化后，从仓储重新读取运行、不可变问题集和完整任务集，使用WT-019纯函数重算运行的成功数、失败数和状态，并通过版本检查保存。

## 重算流程

1. 按`scopeId + runId`读取运行；
2. 复核运行返回身份与查询一致；
3. 并行读取运行绑定的问题集快照和完整任务集；
4. 缺失运行或快照统一返回`RESOURCE_NOT_FOUND`；
5. 使用WT-019校验任务全集并派生状态；
6. 结果未变化时直接返回原运行，不增加version；
7. 结果变化时使用`expectedVersion`乐观锁保存。

该服务是任务工作流成功提交后的内部协调步骤，不是用户可直接调用的API，因此不接受Principal。未来接入队列或事务协调器时，调用方必须从已授权任务上下文传入scope和run。

## 仓储语义

运行仓储增加：

- `listTasksForRun(scopeId, runId)`；
- `saveRun(run, expectedVersion)`。

内存实现按问题项和样本序号确定性排序任务。保存时同时校验当前版本和新版本必须为`expectedVersion + 1`，并发旧写入失败关闭。

任务与运行更新目前不是一个生产数据库事务。并发场景中先保存的重算结果占用新版本，其他旧版本写入失败，协调调用方未来必须重读后重试。本任务不伪装已经解决生产事务或消息投递。

## 测试

- 全等待任务重算幂等且保持queued；
- 任务开始后进入running；
- 一个确认、一个拒绝后进入partial且计数正确；
- 没有任务变化时不增加运行version；
- 缺失运行和缺失快照统一未找到；
- 仓储返回错误运行身份失败关闭；
- 不完整任务集被WT-019拒绝；
- 并发旧版本运行写入被拒绝。

## 明确不做

- 不把重算自动挂到当前WT-009每个动作；
- 不实现数据库事务、Outbox、队列消费或自动重试；
- 不注册HTTP路由或修改OpenAPI；
- 不签发Token或读取证据正文；
- 不激活Surface或Adapter；
- 不使用真实数据；
- 不修改批准基线。

## 完成标准

- [x] 运行、快照和完整任务集重新读取；
- [x] 仓储运行身份失败关闭；
- [x] 无变化重算幂等；
- [x] 运行状态和计数由WT-019统一派生；
- [x] 运行保存使用乐观锁；
- [x] 不完整任务集不能更新运行；
- [x] 生产事务缺口明确保留；
- [x] 无HTTP、真实数据或生产启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用服务：`packages/application/src/reconcile-consumer-observation-run.ts`；
- 仓储端口：`packages/application/src/ports.ts`；
- 内存实现：`packages/infrastructure/src/in-memory-repositories.ts`；
- 测试：`packages/infrastructure/test/reconcile-consumer-observation-run.test.ts`；
- 全量验证：158项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目49份Markdown中的89个相对链接有效，Git未初始化；
- 发布边界复核：重算服务没有注册到API、OpenAPI或Worker；
- 深度自审：错误仓储身份、缺失快照、不完整任务集和并发旧版本全部失败关闭；文档明确当前任务与运行不是生产原子事务，避免把内存协调描述成已完成生产闭环。

## 后续

运行创建至指标读取的内部组合验收已转入[`WT-022`](./WT-022-CONSUMER-OBSERVATION-INTERNAL-E2E.md)。当时识别的确认原子性和指标批次构建断点已分别由[`WT-027`](./WT-027-CONSUMER-OBSERVATION-CONFIRMATION-TRANSACTION.md)与[`WT-030`](./WT-030-BUILD-CONSUMER-METRIC-SAMPLE-BATCH.md)在内存边界内补齐；生产事务和物化仍未实现。
