# WT-024 已确认消费端证据记录写入服务

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、WT-009任务确认和WT-023不可变记录  
> 发布状态：内部应用服务，无HTTP路由

## 目标

把已确认任务转换为不可变消费端证据记录的过程收口到应用服务，不再由端到端测试自行拼接scope、运行、问题、样本、artifact、Surface和确认人等身份字段。

## 服务输入与派生字段

WT-025完成后，调用方只提交：

- scope和观察任务ID；

服务从已确认任务和提交阶段保存的不可变待复核artifact派生，不允许调用方覆盖：

- response、run、问题快照项和样本序号；
- capture artifact和Surface版本ID；
- 采集方式和证据等级；
- 确认人和确认时间。
- 回答原文、可见引用、页面元数据、截图/DOM引用和Adapter版本。

## 前置校验

服务失败关闭地校验：

- principal拥有scope，角色为owner、admin或analyst，且用户就是任务被分配人；
- 任务处于`confirmed`，并已有artifact、response和完整采集/确认时间；
- 运行、任务、artifact的scope、ID、采集方式和分配人一致；
- 历史Surface版本存在，Adapter、产品标签和允许的采集方式一致；
- artifact是完整待复核证据而非最小binding，且回答、capture哈希和白名单结构完整；
- Surface声明支持截图；存在引用时必须声明支持可见引用；提交脱敏DOM时必须声明支持脱敏DOM；
- 页面会话条件逐项等于运行创建时冻结的条件；
- artifact创建时间等于任务采集提交时间；页面观察时间位于任务创建和采集提交之间，确认时间不早于页面观察时间。

Surface按版本ID读取历史配置，不要求记录写入时仍为active。这样，采集后被暂停的版本仍可完成已发生事实的落档；新运行创建继续只允许active版本。

## 幂等与冲突

- 记录ID使用任务确认时已绑定的response ID；
- 首次写入返回`created: true`；
- 相同规范化内容重试返回原记录和`created: false`；
- 同一response ID对应的已提交artifact与既有正式记录不同时拒绝，不覆盖原记录；
- 并发创建冲突后只在重新读取到完全相同记录时视为幂等成功；
- 任务或运行样本槽位已被其他response占用时继续由追加式Repository拒绝。

## 内部端到端调整

WT-022合成链路不再直接调用领域工厂。确认任务后由本服务读取任务、运行、artifact和Surface，生成并追加记录；随后从Repository重新读取记录并投影指标。

## 明确不做

- 不把任务确认和记录追加描述为同一数据库事务；
- 不改变WT-009确认接口或正式HTTP草案；
- 不校验截图媒体对象是否已实际上传，对象存储端口尚未实现；
- 该任务本身不生成source events或指标批次；后续[`WT-026`](./WT-026-CONFIRMED-CONSUMER-CITED-SOURCE-EVENTS.md)已增加独立投影与追加式内存Repository，但仍未进入确认事务；
- 不创建PostgreSQL迁移；
- 不接入真实豆包数据；
- 不激活豆包Adapter或Surface；
- 不修改批准基线。

## 测试

- 已确认任务成功追加记录，所有身份和确认字段均由服务派生；
- 相同内容重试幂等；
- 相同response ID的不同内容失败关闭；
- 未确认任务被拒绝；
- 运行会话、Surface Adapter、产品标签和能力不一致被拒绝；
- artifact创建时间或页面观察时间不在任务窗口时被拒绝；
- binding-only artifact不能生成正式记录；
- 跨scope隐藏资源，viewer和非任务分配人不能写入；
- WT-022端到端链路改用服务后仍通过。

## 完成标准

- [x] 绑定字段全部从服务端已确认任务派生；
- [x] 任务、运行、artifact和历史Surface版本完整校验；
- [x] 会话、采集时序和Surface能力失败关闭；
- [x] 相同内容重试幂等，不同内容不覆盖；
- [x] scope、角色和任务分配人权限完成；
- [x] 内部端到端测试使用正式应用服务；
- [x] 无HTTP、真实数据、生产存储或Surface启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用服务：`packages/application/src/store-confirmed-consumer-observation-record.ts`；
- 历史Surface读取端口：`packages/application/src/ports.ts`；
- 内存实现：`packages/infrastructure/src/in-memory-repositories.ts`；
- 定向测试：`packages/infrastructure/test/store-confirmed-consumer-observation-record.test.ts`及WT-022端到端测试；
- 全量验证：175项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目52份Markdown中的99个相对链接有效，Git未初始化；
- 发布边界复核：服务未注册HTTP路由，输入和测试均为合成值；
- 深度自审修复：禁止非任务分配人补写证据；Surface版本按历史ID读取；页面观察时间限定在任务窗口；幂等比较不依赖对象属性顺序；并发重试只接受完全相同记录；WT-025进一步取消确认后的内容重传，改从已提交artifact派生。

## 后续

待复核完整证据artifact已在[`WT-025`](./WT-025-CONSUMER-CAPTURE-EVIDENCE-ARTIFACT.md)完成，内存确认事务和运行级批次构建已分别由[`WT-027`](./WT-027-CONSUMER-OBSERVATION-CONFIRMATION-TRANSACTION.md)与[`WT-030`](./WT-030-BUILD-CONSUMER-METRIC-SAMPLE-BATCH.md)补齐。生产数据库事务和指标物化仍未实现。
