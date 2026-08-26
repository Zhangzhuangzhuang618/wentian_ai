# WT-058 豆包自动化开关与治理策略

> 状态：已完成（控制平面）  
> 前置决策：[`DEC-WT058-001`](../decisions/DEC-WT058-001-DOUBAO-AUTOMATION-GOVERNANCE.md)  
> 发布状态：控制平面和合成策略，无真实豆包自动操作

## 目标

实现默认关闭的项目自动化选择和独立的生产授权门禁，并把已批准的保留期、地区和责任角色固化为可测试策略。

## 实现范围

- 未提供开关时默认`attended`；
- 合成环境允许验证`automated`路径；
- 生产自动化要求Surface、适配器、地区和外部授权全部通过；
- 豆包当前`draft + authorization=none`必须阻断生产自动化；
- 固化24小时、30天、180天、DOM关闭、scope删除30天及90天复核规则；
- 不接触账号凭证和隐藏网络数据。

## 明确不做

- 不在真实豆包页面自动提交问题；
- 不激活豆包Surface；
- 不伪造书面许可或官方接口；
- 不实现对象存储生命周期任务，本任务只提供策略事实源。

## 完成标准

- [x] 开关默认关闭；
- [x] 合成自动化与生产自动化门禁分离；
- [x] 豆包当前生产自动化失败关闭；
- [x] 保留期、地区和责任策略可复算且不可变；
- [x] `pnpm verify`通过。

## 完成记录

- 完成日期：2026-08-23；
- 实现：`packages/domain/src/consumer-automation-policy.ts`、`packages/domain/src/consumer-observation-governance.ts`；
- 豆包适配器：`packages/adapters/consumer-doubao-web/src/index.ts`；
- 当前结论：合成环境可验证自动化分支；豆包生产自动化因`draft + authorization=none`继续失败关闭；
- 未完成项：真实页面自动提交/采集、保留期清理作业和外部授权证据接入；
- 最终验证：`pnpm verify`通过，329项测试全部通过。
