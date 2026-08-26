# WT-045 已确认自述响应创建复核记录

> 状态：已完成  
> 前置任务：[`WT-044`](./WT-044-SOURCE-NOMINATION-EXTRACTION-PROVENANCE.md)  
> 前置决策：[`DEC-WT043-001`](../decisions/DEC-WT043-001-EXPLICIT-SOURCE-EXTRACTION-BOUNDARY.md)、[`DEC-WT044-001`](../decisions/DEC-WT044-001-NOMINATION-EXTRACTION-PROVENANCE.md)  
> 对应基线：非结构化自述响应确定性提取后进入人工复核  
> 发布状态：内部应用服务与内存Repository，无HTTP或真实调用

## 目标

从服务端已确认的消费端`source_nomination`响应读取回答文本，执行固定版本显式提取，并幂等创建带解析溯源的`needs_review`记录。

## 实现

- scope权限和写角色门禁；
- 响应和运行由服务端Repository反查；
- 校验`source_nomination`、提名上下文、Surface、采集方式、样本范围和完整会话条件；
- 通过应用端口调用WT-043确定性提取器；
- 校验提取状态、边界警告和候选证据枚举；
- 提取结果映射为带版本、初始计数、拒绝数和截断标志的review；
- review创建时间不得早于响应确认时间；
- 无显式候选仍创建空列表`needs_review`，等待人工确认或拒绝；
- 同一scope和response幂等复用既有review，并处理并发已落档后冲突回读。

## 明确不做

- 不接受客户端提交回答正文、run、query、sample或候选域名；
- 不自动确认空候选；
- 不创建正式`nominated`事件；
- 不调用模型或读取真实网页；
- 不实现HTTP、生产数据库或任务调度；
- 不修改批准基线。

## 测试

- 已确认自述响应生成带溯源待复核记录；
- 空显式候选仍保持needs_review；
- 重复调用不重新运行新版本提取器；
- 并发已落档后冲突回读同一review；
- scope、viewer、自然回答和会话错绑失败关闭；
- 提取器状态伪造和创建时间倒退失败关闭。

## 完成标准

- [x] 响应驱动创建应用服务完成；
- [x] source_nomination与会话绑定门禁完成；
- [x] 提取器应用端口与基础设施适配器完成；
- [x] 解析溯源映射完成；
- [x] 空候选人工复核语义完成；
- [x] 幂等与并发回读完成；
- [x] 时间和提取器运行时校验完成；
- [x] 无客户端回答、事件写入、HTTP或真实调用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用服务：`packages/application/src/create-source-nomination-parse-review.ts`；
- 提取端口：`packages/application/src/ports.ts`；
- 基础设施适配器：`packages/infrastructure/src/explicit-source-nomination-extraction.ts`；
- 测试：`packages/infrastructure/test/create-source-nomination-parse-review.test.ts`；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：内部合成链路，无HTTP、生产Repository、真实调用或正式事件；
- 深度自审修复：补充会话全量绑定；不盲信提取器状态和警告；review时间不能早于响应确认；空候选不自动进入指标；并发回读仍重跑完整性校验。

## 后续

confirmed/rejected review和不可变响应/事件到指标样本的严格投影已由[`WT-046`](./WT-046-CONSUMER-SOURCE-NOMINATION-METRIC-PROJECTION.md)完成。
