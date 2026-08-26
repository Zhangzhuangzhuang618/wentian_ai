# WT-019 消费端观察运行领域基础

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、`ai_visibility_runs`、消费端观察任务  
> 发布状态：内部领域模型，无HTTP路由

## 目标

建立消费端观察运行的不可变配置、计划样本全集和状态汇总，为后续从完整运行装配指标批次提供可信边界。

本任务源于批次装配预审：仅收集已确认样本无法证明运行绑定的问题集、任务是否齐全，也会把待处理或失败样本错误显示为0。运行聚合必须先于批次装配。

## 运行配置

创建时固定：

- scope、问题集快照ID和快照哈希；
- `retrievalMode=web_observed`；
- `executionTargetType=consumer_surface`；
- Surface版本和采集方式；
- `natural_answer | source_nomination`实验类型；
- 每题1至5个样本、问题数和计划样本总数；
- 搜索、新会话、登录、记忆、个性化、语言和地区条件；
- 可选paired run ID；
- 创建人和时间。

只有`active` Surface可以创建运行，且采集方式必须在该不可变Surface版本允许清单内。该规则不激活当前豆包草稿配置，只为未来正式运行失败关闭。

## 自述上下文

`nominationContext`由服务端派生，调用方不能提交：

- `natural_answer -> null`；
- `source_nomination + disabled -> unaided`；
- `source_nomination + enabled -> search_assisted`；
- `source_nomination + unknown -> surface_unknown`。

## 任务全集与状态

计划样本总数固定为：

```text
queryCount × requestedSampleCount
```

汇总时必须提供问题集内每个`querySnapshotItemId × sampleIndex`槽位且只能出现一次。每个任务还必须与运行的scope、run、Surface版本和采集方式一致。

任务结果映射：

- `confirmed`计为成功；
- `rejected | expired | cancelled`计为失败；
- `waiting_user | capturing | needs_review`计为待处理。

运行状态派生：

- 全部任务仍为`waiting_user`：`queued`；
- 存在活动任务：`running`；
- 全部确认：`succeeded`；
- 成功和失败并存：`partial`；
- 全部失败：`failed`；
- 有待处理任务时可显式进入`cancelled`。

终态不能被不同任务结果覆盖；相同终态汇总允许幂等读取。

## WT-018回补

运行模型完成后，WT-018投影增加两项门禁：

- 只允许`natural_answer`运行进入可见引用率指标；
- artifact可见会话条件必须逐项等于运行冻结条件。

这防止信源自述样本误入自然回答引用率，也防止同一运行混入不同搜索、登录、记忆或地区配置。

## 测试

- 运行配置、计划样本数和三类自述上下文冻结；
- 未启用Surface、未允许方式和非法样本数被拒绝；
- 完整等待任务保持queued，活动任务进入running；
- 全成功、部分成功和全失败派生正确终态；
- 缺失任务、重复槽位、跨scope任务和快照漂移被拒绝；
- 取消、终态幂等和终态不可覆盖；
- WT-018拒绝自述运行和会话条件漂移。

## 明确不做

- 不新增运行HTTP字段或修改WT-012 OpenAPI草案；
- 不创建运行Repository、数据库表或迁移；
- 不注册Worker或正式任务调度；
- 不装配指标批次；
- 不激活豆包Adapter或Surface；
- 不接真实数据、账号或外部网络；
- 不修改批准基线。

WT-012曾因创建响应没有明确规定运行状态字段而不在HTTP草案中臆造该字段。WT-019只实现批准技术基线已有的内部状态机，不改变对外契约。

## 完成标准

- [x] 运行快照配置不可变；
- [x] active Surface和采集方式门禁完成；
- [x] 自述上下文服务端派生；
- [x] 计划样本全集按问题和样本序号校验；
- [x] scope、快照、Surface和采集方式绑定完整；
- [x] queued、running和四种终态可确定性派生；
- [x] 终态不可覆盖；
- [x] WT-018运行类型和会话条件门禁回补；
- [x] 无HTTP、数据库、真实数据或生产启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 实现：`packages/domain/src/consumer-observation-run.ts`；
- 运行测试：`packages/domain/test/consumer-observation-run.test.ts`；
- 投影回补：`packages/infrastructure/src/confirmed-consumer-observation-metric-projection.ts`；
- 全量验证：147项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目47份Markdown中的83个相对链接有效，Git未初始化；
- 发布边界复核：运行状态没有加入HTTP或OpenAPI，当前豆包Adapter和Surface仍为draft；
- 深度自审修复：批次装配被延后，避免不完整运行产生错误排除计数；WT-018新增运行实验类型和会话条件一致性门禁；运行创建增加采集方式运行时白名单。

## 后续

合成运行创建应用服务已转入[`WT-020`](./WT-020-CONSUMER-OBSERVATION-RUN-CREATION.md)：按scope权限读取不可变问题集和active Surface，一次性原子生成完整任务槽位与运行；仍未注册HTTP路由或生产Repository。
