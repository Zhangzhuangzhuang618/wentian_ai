# WT-046 消费端自述指标样本投影

> 状态：已完成  
> 前置任务：[`WT-045`](./WT-045-CREATE-SOURCE-NOMINATION-PARSE-REVIEW.md)  
> 前置决策：[`DEC-WT046-001`](../decisions/DEC-WT046-001-CONSUMER-NOMINATION-METRIC-SAMPLE-EVIDENCE.md)  
> 对应基线：自述成功响应、复核终态和`nominated`事件进入独立提名指标  
> 发布状态：内部纯投影，无HTTP、真实调用或生产持久化

## 目标

把不可变消费端自述响应、运行、解析复核终态和正式`nominated`事件投影为WT-034可直接计算的单样本输入。

## 实现

- 完整复核、响应和运行会话绑定校验；
- confirmed复核要求正式事件集合数量和逐项内容完整一致；
- 正式事件再次校验来源键、可注册域、归一化版本和固定domain-only字段；
- confirmed映射为`human_confirmed`，只从事件读取域名和顺序；
- needs_review/rejected映射为空提名，任何正式事件均失败关闭；
- 固定使用response ID和query身份，结果及数组冻结；
- Repository返回顺序不影响最终有序投影。

## 明确不做

- 不直接从review生成已确认提名；
- 不重新解析回答或猜测名称到域名；
- 不创建或保存事件；
- 不调用网页、模型或外部URL；
- 不注册HTTP、迁移或生产任务。

## 测试

- confirmed review与完整事件投影为human_confirmed样本；
- needs_review/rejected保留成功样本但提名为空；
- 缺失、重复、错绑、错误验证方式和篡改来源键失败关闭；
- 自然回答、会话错绑和其他响应review失败关闭。

## 完成标准

- [x] 单样本严格投影完成；
- [x] 正式事件作为人工确认指标事实；
- [x] 未验证样本不携带提名；
- [x] 运行、响应、复核和事件全链绑定；
- [x] 归一化与来源键再次复核；
- [x] 无外部调用、HTTP或生产写入；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-23；
- 端口：`packages/application/src/ports.ts`；
- 实现：`packages/infrastructure/src/consumer-source-nomination-metric-projection.ts`；
- 测试：`packages/infrastructure/test/consumer-source-nomination-metric-projection.test.ts`；
- 当前验证：类型检查与279项完整测试通过；
- 最终全量验证：`pnpm verify`通过，299项测试全部通过；
- 深度自审修复：不把子域名当作registrable domain；正式事件集合按规范域名和位置配对；未验证样本禁止携带事件。

## 后续

由[`WT-047`](./WT-047-RUN-SCOPED-SOURCE-NOMINATION-METRIC-BATCH.md)从完整终结运行构建全部成功样本的运行级批次。
