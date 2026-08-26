# WT-055 配对运行24小时可比性门禁

> 状态：已完成  
> 前置任务：[`WT-054`](./WT-054-SOURCE-ENTRY-COUNT-RANKING.md)  
> 前置决策：[`DEC-WT055-001`](../decisions/DEC-WT055-001-PAIRED-RUN-24H-COMPARABILITY.md)  
> 发布状态：纯领域门禁，无仓库读取、HTTP或外部连接

## 目标

在提名—引用重合计算之前，确定自然回答运行与信源自述运行是否满足明确配对、配置一致和实际开始时间不超过24小时的条件。

## 实现范围

- 固定24小时阈值并返回实际开始时间差；
- 验证运行类型、配对引用、scope、问题集、Surface、采集和会话配置；
- 验证两侧终态和完整运行时间；
- 派生并比较有效搜索上下文；
- 以`comparable | not_comparable`和确定性原因码表达结果。

## 明确不做

- 不读取运行仓库；
- 不计算排行榜或重合度；
- 不把失败运行伪装成有可用样本；
- 不接触真实消费端网页或Provider；
- 不注册HTTP接口。

## 完成标准

- [x] 恰好24小时可比，超过1毫秒不可比；
- [x] 使用实际开始时间而非创建时间；
- [x] 非终态、错配对和配置漂移返回明确原因；
- [x] 结果不可变；
- [x] `pnpm verify`通过。

## 完成记录

- 完成日期：2026-08-23；
- 实现：`packages/domain/src/paired-consumer-run-comparability.ts`；
- 测试：`packages/domain/test/paired-consumer-run-comparability.test.ts`；
- 边界：实际开始时间差绝对值不超过24小时，配置和配对身份必须一致；
- 最终验证：`pnpm verify`通过，329项测试全部通过。
