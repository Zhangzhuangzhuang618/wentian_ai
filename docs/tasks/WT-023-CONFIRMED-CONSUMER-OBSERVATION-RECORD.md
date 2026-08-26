# WT-023 不可变已确认消费端证据记录

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、`ai_visibility_responses`与已确认消费端证据  
> 发布状态：内部领域记录与合成内存Repository，无HTTP路由

## 目标

为已确认消费端回答建立最小、追加式的内部事实记录，使指标投影不再依赖测试函数同时持有任务、artifact和response三个临时对象。

## 记录白名单

记录保存：

- response、scope、run、问题快照项、样本序号和观察任务ID；
- capture artifact与Surface版本ID；
- 采集方式、固定`confirmed`状态和服务端派生证据等级；
- 可见回答原文和SHA-256回答哈希；
- 最多100条可见引用：URL、可选标签、位置、可选页面包装URL及解析类型；
- 产品标签、页面显示模型和完整会话条件；
- 页面观察时间；
- 截图媒体对象ID和可选脱敏DOM对象键；
- Adapter版本、确认人和确认时间。

记录不保存：

- 截图Data URL或截图二进制；
- Cookie、Authorization、localStorage；
- 账号邮箱、手机号或消费端账号标识；
- Capture Token；
- 隐藏网络响应或内部抓取信息。

工厂函数只构造白名单字段。即使内部调用对象携带额外字段，输出也不会复制这些字段。该机制不是公共请求Schema替代品；公开输入仍必须经过严格Zod契约。

## 不可变与哈希

- 顶层记录、可见元数据、引用数组和每条引用均冻结；
- `answerHash = SHA-256(UTF-8 answerText)`；
- 回答原文不因计算哈希而修改或覆盖；
- SHA-256只用于完整性和幂等辅助，不描述为加密、匿名化或真实性证明；
- Repository只有`create`、`findById`和`listByRun`，没有update或delete。

## 引用与时间约束

- 引用只接受无凭据的HTTP/HTTPS URL；
- 位置必须为唯一正整数，非空引用列表必须包含位置1；
- `observedUrl`和`known_redirect_target`必须成对存在；
- 运行时伪造的解析类型被拒绝；
- 确认时间不能早于页面观察时间；
- 引用按位置确定性保存。

## 追加式Repository

内存Repository拒绝：

- 重复response ID；
- 同一观察任务的第二条确认记录；
- 同一`scope + run + querySnapshotItemId + sampleIndex`槽位的第二条记录。

读取按scope隔离；运行列表按问题项和样本序号排序。Repository不提供清除接口，因为这里保存的是用户确认后的正式事实，不是拒绝流程中的暂存artifact。

## 指标投影

WT-018新增从不可变确认记录直接投影指标样本的入口，并再次校验：

- 运行必须为`natural_answer`；
- record、run和Surface的scope、ID、版本及采集方式一致；
- 证据等级等于采集方式的服务端派生结果；
- Adapter版本和产品标签与Surface一致；
- 会话条件与运行冻结条件逐项一致；
- URL继续由WT-014归一化后才进入指标。

WT-022合成端到端测试已改为：创建确认记录 → 写入追加式Repository → 重新读取 → 投影指标样本。

## 测试

- 回答原文保持且SHA-256可复算；
- 浏览器辅助与人工录入证据等级正确派生；
- 输出不含截图正文、Cookie和账号字段；
- 非HTTP、带凭据URL、重复位置、缺少首位和解析对不完整被拒绝；
- 伪造解析类型和倒序确认时间被拒绝；
- Repository按scope隔离、确定性排序并拒绝三类重复；
- 正式记录可投影指标；
- 运行、会话或Surface不一致时投影失败关闭；
- WT-022端到端链路使用Repository记录后仍通过。

## 明确不做

- 不自动挂接到WT-009确认事务；
- 不生成正式source events；
- 不实现对象存储上传或截图保留策略；
- 不创建PostgreSQL迁移；
- 不注册HTTP或修改OpenAPI；
- 不读取真实回答、截图或账号信息；
- 不激活豆包Adapter或Surface；
- 不修改批准基线。

## 完成标准

- [x] 最小确认记录白名单完成；
- [x] 回答哈希可复算且不覆盖原文；
- [x] 引用、跳转解析和时间约束完成；
- [x] 敏感字段和截图正文不进入记录；
- [x] Repository只追加、按scope读取；
- [x] response、任务和运行样本槽位唯一；
- [x] 记录可直接投影指标样本；
- [x] 无HTTP、生产存储、真实数据或Surface启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 领域记录：`packages/domain/src/confirmed-consumer-observation-record.ts`；
- 仓储端口：`packages/application/src/ports.ts`；
- 内存实现：`packages/infrastructure/src/in-memory-repositories.ts`；
- 指标投影：`packages/infrastructure/src/confirmed-consumer-observation-metric-projection.ts`；
- 测试：`packages/domain/test/confirmed-consumer-observation-record.test.ts`、`packages/infrastructure/test/confirmed-consumer-observation-record.test.ts`及WT-022端到端测试；
- 全量验证：168项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目51份Markdown中的96个相对链接有效，Git未初始化；
- 发布边界复核：记录Repository未注册到API或生产存储，全部新增证据均为合成值；
- 深度自审修复：增加解析类型运行时校验；增加运行样本槽位唯一键；URL保存前去除外围空白；端到端验收改为从Repository重新读取记录后再投影。

## 后续

确认记录写入应用服务已在[`WT-024`](./WT-024-CONFIRMED-CONSUMER-OBSERVATION-RECORD-SERVICE.md)完成；服务从已确认任务派生绑定并校验运行、artifact、历史Surface和会话条件，仍不与当前WT-009更新做伪事务绑定。
