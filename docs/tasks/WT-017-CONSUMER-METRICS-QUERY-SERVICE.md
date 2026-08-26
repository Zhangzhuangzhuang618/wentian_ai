# WT-017 消费端指标内部读取服务

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、`VIS-W03`只读指标基础  
> 发布状态：内部应用服务，无HTTP路由

## 目标

把已保存的消费端指标样本批次交给WT-013纯函数计算，并按scope权限返回领域报告。该任务只建立应用层读取链路和合成内存仓储，不发布公共接口。WT-029后，批次限定为单次运行。

## 查询输入

读取服务只接收：

- `scopeId`；
- `runId`。

问题集快照哈希、`normalizationVersion`和`sampleBasis`来自已保存批次，`computedAt`来自服务端注入时钟，调用方不能覆盖。

## 数据与错误语义

- 无scope权限时返回`RESOURCE_NOT_FOUND`；
- 有权限但批次不存在时同样返回`RESOURCE_NOT_FOUND`；
- 批次存在但没有已确认Web证据时返回指标报告`not_available`；
- 仓储返回的scope或run ID与查询不一致时失败关闭；
- 同一scope和run ID的重复内存批次被拒绝；
- 相同run ID在不同scope中分别存储和读取；
- 相同scope和问题集哈希的不同运行可以并存。

这一区分避免把“尚未形成指标批次”错误解释为“已经计算但没有有效证据”。

## 实现边界

- application定义样本批次端口和只读服务；
- infrastructure提供仅供开发与测试的内存仓储；
- domain继续独占指标计算和证据资格判断；
- contracts继续独占WT-016的snake_case响应适配；
- 服务不依赖HTTP、数据库、对象存储、GEO或真实Surface。

## 测试

- viewer在授权scope内读取并计算可用报告；
- 无权scope和缺失批次统一隐藏为`RESOURCE_NOT_FOUND`；
- 相同run ID跨scope隔离；
- 相同问题集哈希的不同运行可以并存；
- 已有批次但仅含待审核样本时明确返回`not_available`；
- 仓储返回身份不一致批次时失败关闭；
- 重复批次键被拒绝。

## 明确不做

- 不新增GET接口或OpenAPI路径；
- 不把WT-016草案声明为公共稳定契约；
- 不实现数据库表、迁移或生产Repository；
- 不读取真实观察内容；
- 不激活Surface、Adapter、Worker或GEO连接器；
- 不实现尚无批准公式的API—消费端数值重合度；
- 不修改批准基线。

## 完成标准

- [x] 指标样本批次仓储端口完成；
- [x] scope权限先于仓储查询；
- [x] 缺失批次和零有效样本语义分离；
- [x] scope与run ID双重隔离；
- [x] 归一化版本由批次提供；
- [x] 计算时间由服务端时钟提供；
- [x] 仓储身份不一致失败关闭；
- [x] 内存仓储重复键测试通过；
- [x] 无HTTP路由、真实数据或生产启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用服务：`packages/application/src/consumer-observation-metrics-query.ts`；
- 仓储端口：`packages/application/src/ports.ts`；
- 内存实现：`packages/infrastructure/src/in-memory-repositories.ts`；
- 测试：`packages/infrastructure/test/consumer-observation-metrics-query.test.ts`；
- 全量验证：135项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目45份Markdown中的77个相对链接有效，Git未初始化；
- 发布边界复核：指标读取服务未注册到API或OpenAPI，没有数据库或真实数据源；
- 深度自审修复：服务增加仓储批次身份复核；缺失批次不伪装为零有效样本；scope权限在仓储读取前执行。

## 后续

确认后消费端观察到指标样本的内部映射已转入[`WT-018`](./WT-018-CONFIRMED-OBSERVATION-METRIC-PROJECTION.md)，会复核任务、artifact、response和Surface绑定并归一化可见引用；公共样本基数由[`WT-028`](./WT-028-CONSUMER-METRICS-SAMPLE-BASIS.md)补齐；[`WT-029`](./WT-029-RUN-SCOPED-CONSUMER-METRIC-BATCH.md)进一步把内部批次改为运行级身份。仍未注册HTTP路由或生产仓储。
