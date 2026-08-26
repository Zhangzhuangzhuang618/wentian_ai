# WT-026 已确认消费端Cited来源事件

> 状态：已完成  
> 批准来源：`CHG-VIS-002`中`ai_source_events`和项目所有者持续推进授权  
> 对应基线：已确认消费端response的追加式`cited`来源事实  
> 发布状态：内部领域对象、投影与内存Repository，无HTTP路由

## 目标

把已确认消费端记录中的可注册HTTP/HTTPS引用投影为不可变`cited`来源事件，为后续确认事务和聚合刷新提供正式来源事实，不再只依赖response中的兼容引用快照。

## 事件字段

每条事件保存：

- event、scope、run、response、问题快照项和样本序号；
- 固定`cited`角色和可见来源位置；
- 原始URL、规范化URL和服务端派生URL SHA-256；
- 服务端派生来源键SHA-256；
- host、可注册域名和可选来源标签；
- 固定`answer`映射粒度；
- 归一化版本和事件创建时间。

消费端可见引用没有Provider内部source ID、snippet、候选信息或自述提名语义，因此这些字段固定为空，不从页面文本猜测。

## 投影规则

- 输入必须是通过完整性复核的不可变确认记录；
- 事件创建时间必须等于记录确认时间，为后续同事务写入保留明确约束；
- URL使用WT-014纯函数规范化，继续保留业务路径和未知查询参数，仅移除版本化追踪参数和fragment；
- URL哈希为规范化URL原文的UTF-8 SHA-256；
- 来源键使用WT-015的类型与归一化版本隔离哈希；
- title只取用户确认的可见引用标签；
- 无法得到可注册域名的可见链接继续保留在确认记录中，但不生成伪造域名或来源事件；
- ID只为实际可投影事件生成。

## 完整性与追加约束

领域工厂固定事件角色、映射粒度和所有不适用字段，并校验：

- 样本序号和来源位置为正整数；
- 原始与规范化URL为无凭据HTTP/HTTPS；
- host等于规范化URL host；
- 可注册域名等于host或为其标签边界后缀；
- URL哈希由服务端重新计算；
- 来源键为小写SHA-256。

基础设施完整性复核会从`originalUrl`重新运行WT-014，并重新运行WT-015，拒绝伪造的规范化URL、host、可注册域名、归一化版本或来源键。

内存Repository批量追加前先校验全部事件，任何ID或建议唯一键冲突都会使整批不落档。建议唯一键为：

`scope + response + role + sourceKeyHash + sourcePosition`

读取按scope和response隔离，按来源位置确定性排序；Repository没有update或delete。

## 内部端到端调整

合成端到端链路现为：完整待复核artifact → 任务确认 → 不可变确认记录 → `cited`来源事件批量追加 → 指标样本投影 → 严格只读DTO。

## 明确不做

- 不把任务确认、response和source events描述为同一数据库事务；
- 不生成`candidate`或`nominated`事件；
- 不为不可注册URL伪造域名；
- 不保存隐藏搜索候选、页面外来源或Provider内部权重；
- 不创建PostgreSQL迁移；
- 不注册正式HTTP路由或启用OpenAPI草案；
- 不接入真实豆包观察包；
- 不激活豆包Adapter或Surface；
- 不修改批准基线。

## 测试

- 事件固定为`cited + answer`且不可变；
- 来源位置、URL、host、可注册域名和SHA-256严格校验；
- 追踪参数和fragment被确定性规范化；
- URL哈希和来源键由服务端派生；
- 不可注册URL不生成事件且不消费事件ID；
- 事件时间与确认时间不一致被拒绝；
- 确认记录哈希或额外字段被篡改时投影失败；
- Repository批量写入原子、scope隔离并拒绝ID和建议唯一键冲突；
- Repository拒绝伪造规范化结果、来源键和额外字段；
- 内部端到端链路追加并重新读取来源事件后仍通过。

## 完成标准

- [x] 基线`cited`来源事件最小字段完成；
- [x] URL哈希、来源键和规范化版本服务端派生；
- [x] 不可注册链接不伪造事件；
- [x] 确认记录与来源事件完整性失败关闭；
- [x] 批量追加原子且按scope隔离；
- [x] 内部端到端验收包含来源事件；
- [x] 无HTTP、真实数据、生产存储或Surface启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 领域事件：`packages/domain/src/ai-visibility-source-event.ts`；
- 确认记录完整性：`packages/domain/src/confirmed-consumer-observation-record.ts`；
- 事件投影：`packages/infrastructure/src/confirmed-consumer-observation-source-event-projection.ts`；
- 仓储端口：`packages/application/src/ports.ts`；
- 内存Repository：`packages/infrastructure/src/in-memory-repositories.ts`；
- 测试：领域事件、确认记录、事件投影/Repository、指标投影和内部端到端测试；
- 全量验证：192项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目54份Markdown中的106个相对链接有效，Git未初始化；
- 发布边界复核：来源事件未注册HTTP或生产存储，豆包Adapter保持`doubao-web@0-draft`，全部测试数据为合成值；
- 深度自审修复：URL哈希改为领域工厂派生；Repository写入前重跑URL规范化和来源键派生；可注册域名增加host边界校验；确认记录增加完整性复核并接入指标和事件投影。

## 后续

确认事务协调端口和内存原子演练已在[`WT-027`](./WT-027-CONSUMER-OBSERVATION-CONFIRMATION-TRANSACTION.md)完成；PostgreSQL事务仍未实现，不能宣称生产持久化事务已经完成。
