# WT-020 消费端观察运行内部创建服务

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、消费端观察运行创建  
> 发布状态：内部应用服务与合成内存仓储，无HTTP路由

## 目标

把WT-019运行领域模型接入scope权限、不可变问题集和active Surface查询，一次性创建完整消费端观察运行及全部任务槽位。

## 创建流程

内部服务按以下顺序执行：

1. 从服务端Principal验证scope访问权限；
2. 只允许`owner | admin | analyst`创建；
3. 验证scope存在且为active；
4. 在该scope内读取不可变问题集快照；
5. 按`surfaceCode`读取唯一active Surface版本；
6. 校验可选配对运行；
7. 使用WT-019创建冻结运行；
8. 按每个`querySnapshotItemId × 1..sampleCount`生成任务；
9. 通过原子仓储端口一次写入运行与全部任务。

无权限和不存在资源统一返回`RESOURCE_NOT_FOUND`。归档scope返回`SCOPE_INACTIVE`，viewer返回`ACTION_FORBIDDEN`。

## 配对运行

本任务只实现批准基线明确的自述—自然回答配对：

- 只有`source_nomination`可以提交`pairedRunId`；
- 配对运行必须在同一scope存在且为`natural_answer`；
- 问题集快照哈希、Surface版本、采集方式、每题样本数和全部会话条件必须一致；
- 不同来源但内容等价的问题集快照允许按相同hash比较；
- 配对运行不存在时不泄漏其他scope资源状态。

## 原子内存仓储

合成仓储在写入前验证：

- 运行ID未占用；
- 所有任务ID在本次及已有数据中唯一；
- 运行、快照和任务全集通过WT-019汇总校验。

任一校验失败时不写运行，也不写任何任务。该实现仅供开发测试，不是生产事务方案。

同一内存对象同时实现运行创建端口和任务Repository，因此后续WT-009工作流可以读取并推进本次创建的任务，不需要复制任务数据。

## 测试

- 两个问题、每题两个样本生成四个确定任务槽位；
- 创建后可按scope读取运行和任务；
- 无scope权限、viewer、归档scope、缺失快照和缺失Surface失败关闭；
- Surface未允许的采集方式被拒绝；
- 自述配对拒绝会话漂移和自然回答反向配对；
- 完全一致的自然回答运行可被自述运行配对；
- 任务ID冲突时运行与任务均不落入内存仓储。

## 明确不做

- 不注册`POST /ai-visibility/consumer-observations`；
- 不修改WT-012 OpenAPI草案；
- 不实现HTTP Idempotency-Key、CSRF、审计或限流；
- 不创建PostgreSQL迁移或生产事务；
- 不签发Capture Token；
- 不激活当前豆包draft Adapter或Surface；
- 不读取真实观察数据或外部网页；
- 不修改批准基线。

## 完成标准

- [x] scope权限和角色门禁完成；
- [x] active scope、快照和active Surface读取完成；
- [x] 运行配置由服务端对象冻结；
- [x] 全部问题与样本任务槽位一次生成；
- [x] 自述—自然回答配对可比条件完整；
- [x] 合成仓储原子失败语义完成；
- [x] 创建后的任务可供现有工作流读取；
- [x] 无HTTP、生产存储、真实数据或Surface启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用服务：`packages/application/src/create-consumer-observation-run.ts`；
- 仓储端口：`packages/application/src/ports.ts`；
- 内存实现：`packages/infrastructure/src/in-memory-repositories.ts`；
- 测试：`packages/infrastructure/test/create-consumer-observation-run.test.ts`；
- 全量验证：153项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目48份Markdown中的86个相对链接有效，Git未初始化；
- 发布边界复核：创建服务未注册API或OpenAPI，豆包Adapter仍为draft，内存Surface仅使用合成active测试对象；
- 深度自审：配对使用快照hash而非来源元数据，全部会话条件逐项比较；原子仓储先完成ID和任务全集校验再写入；未实现缺少HTTP幂等上下文的伪幂等逻辑。

## 后续

运行进度内部重算已转入[`WT-021`](./WT-021-CONSUMER-OBSERVATION-RUN-RECONCILIATION.md)：从完整任务集和不可变快照重算运行状态，并使用乐观锁保存；仍未注册HTTP路由或生产事务。
