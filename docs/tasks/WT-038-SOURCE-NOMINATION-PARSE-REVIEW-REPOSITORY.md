# WT-038 自述解析复核内存Repository

> 状态：已完成  
> 前置任务：[`WT-037`](./WT-037-SOURCE-NOMINATION-PARSE-REVIEW.md)  
> 前置决策：[`DEC-WT038-001`](../decisions/DEC-WT038-001-NOMINATION-REVIEW-REPOSITORY-BOUNDARY.md)  
> 对应基线：`ai_nomination_parse_reviews`一对一、scope隔离与终态约束  
> 发布状态：内部端口与合成内存实现，无数据库或HTTP路由

## 目标

为WT-037复核状态机增加最小Repository端口和确定性内存实现，使后续应用服务能够按scope安全读取待办、按响应反查并用乐观锁保存终态。

## 实现

- 应用端口支持创建、按ID读取、按响应读取、按状态列出和版本化保存；
- `scope + response`保持一对一，ID冲突同样失败关闭；
- 跨scope读取统一返回不存在；
- 状态队列按创建时间和ID排序；
- 创建与保存前复核领域对象完整性；
- 保存校验期望版本、下一版本、不可变身份和合法终态转换；
- 任一校验失败时不改变既有内存记录。

## 明确不做

- 不实现PostgreSQL、迁移、锁表或审计历史；
- 不创建`nominated`事件；
- 不把review保存和事件写入伪装成原子事务；
- 不注册复核HTTP接口；
- 不读取真实AI回答或接入Provider/消费端网页；
- 不修改批准基线。

## 测试

- scope隔离、响应反查和状态队列排序；
- ID及同scope响应唯一约束；
- 不同scope允许相同响应ID；
- 确认与拒绝按乐观锁保存并迁移队列；
- 陈旧版本、身份篡改和非法状态更新失败且不污染原记录。

## 完成标准

- [x] Repository应用端口完成；
- [x] 内存适配器完成；
- [x] scope与响应一对一约束完成；
- [x] 状态队列与确定性排序完成；
- [x] 乐观锁和身份不可变校验完成；
- [x] 失败写入不污染原记录；
- [x] 无数据库、事件事务、路由或真实数据；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用端口：`packages/application/src/ports.ts`；
- 内存实现：`packages/infrastructure/src/in-memory-source-nomination-parse-review-repository.ts`；
- 测试：`packages/infrastructure/test/in-memory-source-nomination-parse-review-repository.test.ts`；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：无数据库、迁移、生产事务、HTTP或真实数据；
- 深度自审修复：唯一约束使用`scope + response`而非裸response以保持多租户隔离；保存重新校验完整对象；版本和身份校验在写入前全部完成；内存实现不冒充生产事务。

## 后续

消费端自述确认事务已在[`WT-039`](./WT-039-CONSUMER-NOMINATION-REVIEW-CONFIRMATION.md)复用现有不可变响应身份完成，客户端不补交run、问题项、样本槽位或来源哈希。后续拒绝路径必须只保存终态review和原因，不生成事件。
