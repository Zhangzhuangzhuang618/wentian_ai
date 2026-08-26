# WT-027 消费端观察确认事务契约

> 状态：已完成  
> 批准来源：`CHG-VIS-002`消费端确认事务和项目所有者持续推进授权  
> 对应基线：任务确认、不可变response与`cited` source events原子提交  
> 发布状态：内部应用服务、事务端口与内存原子实现，无HTTP路由

## 目标

建立单一确认入口和持久化事务端口，使任务从`needs_review`进入`confirmed`时，正式确认记录和完整`cited`来源事件集合必须一起成功或一起失败。

## 应用服务

确认命令只包含：

- scope和任务ID；
- 调用方看到的任务版本；
- 服务端确认时间。

服务按顺序执行只读校验和领域构造：

1. 校验scope、写角色和任务分配人；
2. 读取`needs_review`任务及其不可变完整artifact；
3. 读取运行和历史Surface版本；
4. 由服务端生成response ID；
5. 通过任务领域状态机生成确认后任务和证据等级；
6. 从artifact派生正式确认记录；
7. 规范化确认引用并由服务端生成`cited`事件ID；
8. 把任务、记录和完整事件集合一次提交给事务Repository。

调用方不能提交response ID、来源事件、来源键、证据等级、scope归属或确认人。

## 事务端口

`ConsumerObservationConfirmationTransactionRepository`一次接收：

- 确认后任务和旧任务版本；
- 不可变正式确认记录；
- 该记录应产生的全部`cited`来源事件。

端口实现必须在一个持久化事务中完成三类写入。任何版本、绑定、完整性、事件集合或唯一键冲突都不得留下部分结果。

## 内存原子实现

合成实现把任务、记录和来源事件保存在同一内存Repository中。提交前完成所有检查，全部通过后才修改三个Map：

- 当前任务必须仍为`needs_review`且版本匹配；
- 运行、任务、Surface版本和采集方式一致；
- 正式记录与任务的response、scope、run、问题、样本、artifact、确认人和时间一致；
- 记录完整性可重建；
- 每个可规范化引用恰好对应一个事件；
- 事件位置、原始URL、标签、身份和确认时间与记录一致；
- 事件规范化、URL哈希和来源键可重算；
- 记录ID、任务、运行样本槽位、事件ID和事件建议唯一键均无冲突。

该实现验证事务契约和失败语义，不等于PostgreSQL事务已经交付。

## 内部端到端调整

WT-022不再先调用旧确认工作流、再分别追加记录和事件。现在由本服务一次提交确认后任务、正式记录和来源事件，随后重新读取三类事实，再继续运行重算和指标投影。

旧`ConsumerObservationWorkflowService.confirm()`暂时保留给默认关闭的合成HTTP路由和既有测试，不是正式消费端确认路径的生产实现。

## 明确不做

- 不创建PostgreSQL表、迁移或真实数据库事务；
- 不实现HTTP层Idempotency-Key缓存或重放响应；
- 不实现Outbox和`wentian.consumer_observation_confirmed.v1`发布；
- 不在同一事务中重算运行或物化指标批次；
- 不注册正式HTTP路由或启用OpenAPI草案；
- 不接入真实豆包观察包；
- 不激活豆包Adapter或Surface；
- 不修改批准基线。

## 测试

- 成功时任务、正式记录和来源事件同时可读；
- 来源事件集合缺失时三类写入均不发生；
- 事件ID冲突时任务仍为`needs_review`、正式记录不存在、既有事件不受影响；
- 旧任务版本被拒绝；
- 非任务分配人不能确认；
- 合成端到端链路改用事务服务后仍通过；
- 全部既有工作流、记录服务、来源事件和指标测试无回归。

## 完成标准

- [x] 单一确认应用服务完成；
- [x] response和事件ID由服务端生成；
- [x] 任务、记录和完整事件集合形成一个事务端口；
- [x] 版本、运行、记录和事件绑定失败关闭；
- [x] 内存实现验证全有或全无；
- [x] 内部端到端验收使用事务服务；
- [x] 明确区分事务契约与生产数据库事务；
- [x] 无HTTP、真实数据、数据库迁移或Surface启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 确认事务服务：`packages/application/src/confirm-consumer-observation-transaction.ts`；
- 记录构造复用：`packages/application/src/store-confirmed-consumer-observation-record.ts`；
- 事务和投影端口：`packages/application/src/ports.ts`；
- 内存原子实现：`packages/infrastructure/src/in-memory-repositories.ts`；
- 来源事件Projector：`packages/infrastructure/src/confirmed-consumer-observation-source-event-projection.ts`；
- 测试：确认事务定向测试及内部端到端测试；
- 全量验证：196项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目55份Markdown中的110个相对链接有效，Git未初始化；
- 发布边界复核：正式确认路由未注册，PostgreSQL和Outbox未实现，豆包Adapter仍为`doubao-web@0-draft`；
- 深度自审修复：事务提交增加当前`needs_review`状态和运行快照复核；完整事件集合按确认记录逐位置校验；事件冲突在任何Map修改前失败；独立记录Repository也增加完整性复核。

## 后续

公共样本基数、运行级批次身份和单运行构建已分别由[`WT-028`](./WT-028-CONSUMER-METRICS-SAMPLE-BASIS.md)、[`WT-029`](./WT-029-RUN-SCOPED-CONSUMER-METRIC-BATCH.md)和[`WT-030`](./WT-030-BUILD-CONSUMER-METRIC-SAMPLE-BATCH.md)完成。跨运行聚合与生产物化继续保持未实现。
