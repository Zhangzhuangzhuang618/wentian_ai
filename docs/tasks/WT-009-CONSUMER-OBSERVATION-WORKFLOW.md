# WT-009 消费端观察任务绑定与确认工作流

> 状态：已完成  
> 批准来源：项目所有者要求继续调试和开发  
> 对应基线：`CHG-VIS-002`、`VIS-W02`的任务与人工确认子集  
> Surface状态：`draft`

## 目标

实现不接触外部服务和真实观察数据的消费端任务闭环，证明任务只能按`waiting_user → capturing → needs_review → confirmed/rejected`推进，且采集记录、确认结果、用户、scope和一次性令牌不能串用。

## 实现范围

- 不可变观察任务聚合和递增版本号；
- 任务与运行、快照问题项、样本序号、Surface版本、预期采集方式和操作人绑定；
- 采集记录与任务、scope、操作人和预期采集方式绑定；
- 确认结果与同一运行、问题、样本和采集记录绑定；
- 证据等级只从服务端保存的采集方式派生；
- 拒绝后任务进入终态，返回并清除待删除采集记录；
- Capture Token验证器边界、实例/scope/任务/用户/origin/有效期校验和nonce一次性消费；
- 非法绑定失败时不消费token；
- scope隔离、owner/admin/analyst写权限和viewer禁止写；
- 纯内存Repository与端到端应用服务测试。

## 明确不做

- 不接收或保存回答正文、引用、截图和真实浏览器草稿；
- 不开放HTTP API，不修改浏览器扩展；
- 不签发、签名或持久化生产Capture Token；
- 不创建数据库迁移、对象存储、正式response或source event；
- 不实现生产事务、Outbox或审计写入；
- 不上传WT-007真实导出文件；
- 不激活豆包Surface或Adapter；
- 不修改批准基线。

## 与WT-008的关系

WT-008负责判断浏览器JSON是否是合法本地草稿；WT-009只接收由服务端边界生成的采集记录绑定信息。`confirmed_local_export`不能直接调用确认状态转换，也不能等同于服务端`confirmed`。

生产接入时，API必须依次完成草稿契约校验、Surface/任务策略校验、截图对象落盘、采集记录创建和任务版本更新。采集记录、nonce消费和任务更新必须置于可恢复的事务边界；本任务的纯内存实现不构成生产事务方案。

## 验证

```bash
pnpm verify
```

## 完成标准

- [x] 状态不能跳级或从终态恢复；
- [x] 每次成功写操作递增任务版本，旧版本不能覆盖；
- [x] scope、任务、操作人或采集方式不匹配时失败关闭；
- [x] 确认结果不能跨运行、问题、样本或采集记录；
- [x] 证据等级不能由确认请求指定；
- [x] 未通过绑定校验不消费Capture Token；
- [x] 已消费nonce和未验证token不能提交；
- [x] 跨scope统一返回资源不存在，scope内viewer返回禁止操作；
- [x] 拒绝任务不产生证据等级并清除纯内存采集记录；
- [x] 全量验证、边界、格式、基线哈希和文档链接复核通过；
- [x] Git未初始化。

## 完成记录

- 完成日期：2026-08-22；
- 领域实现：`packages/domain/src/consumer-observation-task.ts`；
- 应用实现：`packages/application/src/consumer-observation-workflow.ts`；
- 测试基础设施：纯内存任务、采集记录、token验证器和nonce Repository；
- 全量验证：83项测试通过，类型、架构边界和格式检查通过；
- 自审修复：移除确认请求中的采集方式，改由已保存采集记录派生证据等级；令牌声明改由验证器产生；补viewer写权限限制；绑定失败不消费nonce。
- 完整性复核：批准基线13个文件哈希未变化，35份Markdown中的48个相对链接有效，Git未初始化。

## 后续门禁

合成数据HTTP接口已在 [WT-010](./WT-010-SYNTHETIC-CONSUMER-OBSERVATION-API.md) 完成，但不得实现真实观察包上传。进入真实上传、对象存储和数据库事务前，必须先完成WT-005中的条款、数据保留期、责任人和允许地区审批。
