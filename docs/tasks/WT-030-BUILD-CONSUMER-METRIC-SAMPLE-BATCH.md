# WT-030 构建单运行消费端指标批次

> 状态：已完成  
> 前置决策：[`DEC-WT029-001`](../decisions/DEC-WT029-001-RUN-SCOPED-METRIC-BATCH.md)  
> 对应基线：终态运行可重算、失败样本保留和已确认证据进入默认指标  
> 发布状态：内部只读应用服务和默认投影器，无自动持久化

## 目标

从一个已终结的自然回答消费端运行、完整任务集、已确认记录和历史Surface版本，确定性构建WT-029运行级指标样本批次，替代内部端到端测试中的手工拼装。

## 输入与读取

命令只包含`scopeId + runId`。服务在scope权限通过后读取：

- 冻结的消费端运行；
- 运行绑定的问题集快照；
- 该运行的完整任务集；
- 该运行的全部不可变确认记录；
- 运行引用的历史Surface版本。

Repository返回的运行身份、快照、任务、记录和Surface任一不一致时失败关闭。

## 构建规则

- 只接受`succeeded | partial | failed`且有完成时间的`natural_answer`运行；
- 重新汇总完整任务集，结果必须与运行状态、成功数和失败数一致；
- `sample_basis`直接取运行的计划、成功和失败样本数；
- 每个confirmed任务必须恰好有一条绑定一致的正式记录；
- 确认记录通过默认投影器完成完整性、Surface、会话条件、证据等级和URL归一化校验；
- rejected任务生成无证据等级、无引用的排除样本；
- expired和cancelled任务不伪造成rejected条目，只保留在失败样本基数；
- 最终样本ID必须非空且唯一。

默认投影器公开自身归一化版本，批次不能由调用方指定或覆盖该版本。

## 明确不做

- 不构建running、queued或已取消运行的指标批次；
- 不处理`source_nomination`提名指标；
- 不自动写入、替换或刷新指标Repository；
- 不聚合多个运行或定义筛选哈希；
- 不实现数据库物化视图、缓存、Worker或并发重算版本；
- 不新增HTTP或OpenAPI路径；
- 不接入真实数据或激活豆包Surface；
- 不修改批准基线。

## 测试

- partial运行的一条confirmed与一条rejected任务构建为正确批次；
- 样本基数从运行派生为`2 / 1 / 1`；
- 非终态运行被拒绝；
- 跨scope请求隐藏为`RESOURCE_NOT_FOUND`；
- confirmed任务缺记录被拒绝；
- 未确认任务出现正式记录被拒绝；
- 投影器返回错误样本身份被拒绝；
- 内部端到端验收改用本服务构建批次后继续得到`1/1=1`。

## 完成标准

- [x] 单运行批次构建应用服务完成；
- [x] 样本基数从终态运行派生；
- [x] 完整任务集和运行汇总重新校验；
- [x] confirmed记录一一对应；
- [x] rejected与其他失败状态不混淆；
- [x] 默认投影器携带固定归一化版本；
- [x] 投影身份、证据等级和样本唯一性失败关闭；
- [x] 内部端到端不再手工拼装指标样本；
- [x] 无持久化、HTTP、真实数据或生产启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用服务：`packages/application/src/build-consumer-observation-metric-sample-batch.ts`；
- 投影端口：`packages/application/src/ports.ts`；
- 默认投影器：`packages/infrastructure/src/confirmed-consumer-observation-metric-projection.ts`；
- 定向测试：`packages/infrastructure/test/build-consumer-observation-metric-sample-batch.test.ts`；
- 端到端：`apps/api/test/consumer-observation-internal-e2e.test.ts`；
- 全量验证：203项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目59份Markdown中的137个相对链接有效，Git未初始化；
- 发布边界复核：构建结果未自动持久化，正式指标路由未注册，豆包Adapter仍为`doubao-web@0-draft`；
- 深度自审修复：新增运行Repository身份复核；确认人必须等于任务分配人；投影证据等级、来源顺序能力和完整会话配置必须与记录及运行一致；构建完成前再次拒绝重复样本ID。

## 后续

“构建后计算”的单运行只读查询编排已在[`WT-031`](./WT-031-ON-DEMAND-CONSUMER-RUN-METRICS.md)完成，调用方不再需要先安装临时内存批次；仍不做自动持久化和跨运行聚合。
