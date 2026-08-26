# WT-036 Domain-only nominated来源事件

> 状态：已完成  
> 前置任务：[`WT-015`](./WT-015-SOURCE-KEY-HASH.md)、[`WT-034`](./WT-034-SOURCE-NOMINATION-METRICS.md)  
> 前置决策：[`DEC-WT036-001`](../decisions/DEC-WT036-001-DOMAIN-ONLY-NOMINATED-SOURCE-EVENT.md)  
> 对应基线：`ai_source_events.role=nominated`与domain-only来源键  
> 发布状态：不可变领域事件与服务端投影，无Repository或HTTP路由

## 目标

把已经通过结构化校验或人工确认的域名提名投影为不可变`nominated`来源事件，保证域名规范化和来源键由服务端完成，并明确不伪造URL。

## 事件字段

- scope、运行、响应、问题快照项和样本身份；
- `role=nominated`和可空提名位置；
- 规范化可注册域名，`host`与其相同；
- 基于域名的版本化`source_key_hash`；
- 可选信息类型和理由；
- `schema_validated | human_confirmed`验证方式；
- 归一化版本和创建时间；
- URL、标题、摘要、Provider来源ID和文本区间固定为空。

## 服务端投影

- 使用WT-015公开的同一域名规范化和来源键算法；
- 最多接受10个提名；
- 顺序全部存在或全部为空；明确顺序连续且唯一；
- 允许同一域名出现在不同明确位置；
- 拒绝无顺序的重复域名和重复事件身份；
- 每个事件创建后再次复核结构、域名、版本和来源键。

## 明确不做

- 不解析真实回答；
- 不处理`needs_review`或`rejected`结果；
- 不创建parse review状态机或确认事务；
- 不建立Repository、数据库迁移或HTTP路由；
- 不调用Provider、消费端网页或外部URL；
- 不修改批准基线。

## 测试

- domain-only事件的URL字段保持为空；
- 域名大小写和尾点规范化；
- 两种验证方式与未知顺序保留；
- 来源键按域名和版本由服务端派生；
- 非可注册域名、混合/非法顺序、重复无序域名和事件ID冲突失败关闭；
- 结构篡改由领域完整性拒绝，来源键篡改由投影完整性拒绝。

## 完成标准

- [x] 不可变nominated事件完成；
- [x] URL字段不被伪造；
- [x] 域名规范化和来源键只由服务端生成；
- [x] 验证方式保持独立；
- [x] 顺序与唯一身份失败关闭；
- [x] 结构与派生完整性责任分层；
- [x] 无真实数据、外部调用、Repository或路由；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 领域事件：`packages/domain/src/ai-visibility-nominated-source-event.ts`；
- 服务端投影：`packages/infrastructure/src/source-nomination-event-projection.ts`；
- 共用域名规范化：`packages/infrastructure/src/source-key-hash.ts`；
- 测试：领域事件与基础设施投影测试；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：无Repository、HTTP、真实回答或外部调用，Provider与Surface门禁状态未改变；
- 深度自审修复：不把域名拼接为URL；无序重复域名失败关闭以匹配未来`NULLS NOT DISTINCT`唯一约束；领域结构完整性与基础设施哈希派生完整性分开，避免夸大领域校验能力。

## 后续

自述解析复核记录及其确认/拒绝状态机已在[`WT-037`](./WT-037-SOURCE-NOMINATION-PARSE-REVIEW.md)完成；人工确认与完整nominated事件集合的原子写入仍未实现。
