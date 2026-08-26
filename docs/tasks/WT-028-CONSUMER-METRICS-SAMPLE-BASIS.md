# WT-028 消费端指标样本基数

> 状态：已完成  
> 批准来源：`CHG-VIS-002`指标公共结构和项目所有者持续推进授权  
> 对应基线：所有指标响应公开`sample_basis`，失败样本不得静默进入比例分母  
> 契约版本：`wentian-consumer-observation-metrics@0-draft`  
> 发布状态：领域报告、内部批次端口和DTO草案，无HTTP路由

## 目标

把`planned / successful / failed`样本基数纳入消费端指标领域报告、内部读取批次和严格DTO，使部分成功、失败和待完成样本可以被准确表达，不能只从已确认引用证据反推总样本数。

## 语义

- `planned`：筛选范围内计划执行的样本数；
- `successful`：已成功形成响应的样本数；
- `failed`：已失败、拒绝、过期或取消的样本数；
- 待完成数：`planned - successful - failed`，不新增重复字段；
- 引用率等比例仍只使用符合证据资格的成功样本作为分母；
- 失败和待完成样本只进入样本基数，不伪装成“未引用”。

当前内部Repository负责提供已保存的样本基数。本任务不从单次运行自动物化跨运行批次；后续[`WT-029`](./WT-029-RUN-SCOPED-CONSUMER-METRIC-BATCH.md)已将内部读取身份收紧为`scope + run ID`。

## 一致性校验

领域函数和DTO契约同时拒绝：

- 任一基数不是非负整数；
- `successful + failed > planned`；
- 已表示的样本总数超过`planned`；
- `confirmed + not_required`超过`successful`；
- `rejected`超过`failed`；
- `needs_review`超过尚未完成样本数；
- 归一化后重复的指标样本ID。

允许`planned`大于当前样本条目数，因为过期或取消样本可能没有可投影的证据条目；它们仍必须通过`failed`保留在报告基数中。

## 实现范围

- domain输入和报告增加不可变`sampleBasis`；
- application样本批次端口增加`sampleBasis`并传给纯计算函数；
- contracts响应增加严格`sample_basis`并复核顶层覆盖关系；
- 合成内存批次和内部端到端验收补齐显式基数；
- 不改变方法版本、归一化版本和指标公式。

## 明确不做

- 不自动聚合多个运行或物化指标批次；
- 不决定跨运行聚合窗口、重复运行选择或批次替换规则；
- 不新增GET接口、OpenAPI路径或生产Repository；
- 不接入真实观察数据；
- 不激活豆包Adapter、Surface、Worker或GEO连接器；
- 不修改批准基线。

## 测试

- 领域报告原样保留不可变样本基数；
- 超计划基数失败关闭；
- rejected与成功/失败基数矛盾时失败关闭；
- 空白归一化后重复的样本ID被拒绝；
- DTO输出包含snake_case `sample_basis`；
- DTO拒绝超计划和成功覆盖不足的基数；
- 指标查询、投影和内部端到端链路全部补齐显式基数。

## 完成标准

- [x] 领域输入和报告包含样本基数；
- [x] 内部批次端口显式保存样本基数；
- [x] 严格DTO公开`sample_basis`；
- [x] 成功、失败、待完成和证据状态覆盖关系可校验；
- [x] 失败样本不进入指标分母；
- [x] 重复样本ID失败关闭；
- [x] 不改变既有指标公式和读取身份；
- [x] 无HTTP、真实数据、生产仓储或Surface启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 领域实现：`packages/domain/src/consumer-observation-metrics.ts`；
- 应用端口和查询：`packages/application/src/ports.ts`、`packages/application/src/consumer-observation-metrics-query.ts`；
- DTO契约：`packages/contracts/src/consumer-observation-metrics.ts`；
- 合成批次：`packages/infrastructure/test/consumer-observation-metrics-query.test.ts`和`apps/api/test/consumer-observation-internal-e2e.test.ts`；
- 全量验证：198项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目56份Markdown中的114个相对链接有效，Git未初始化；
- 发布边界复核：正式指标路由未注册，契约保持`@0-draft`，豆包Adapter仍为`doubao-web@0-draft`；
- 深度自审修复：基数允许显式待完成差值；状态覆盖分别约束成功、失败和待复核样本；指标样本ID按规范化值去重；测试中的合法一成功状态不再误判为矛盾状态。

## 后续

运行级批次身份与单运行构建已由[`WT-029`](./WT-029-RUN-SCOPED-CONSUMER-METRIC-BATCH.md)和[`WT-030`](./WT-030-BUILD-CONSUMER-METRIC-SAMPLE-BATCH.md)完成。跨运行筛选哈希、聚合窗口和生产物化继续保持未实现。
