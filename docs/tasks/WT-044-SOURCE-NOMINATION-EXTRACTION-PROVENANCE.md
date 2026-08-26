# WT-044 自述复核解析溯源字段

> 状态：已完成  
> 前置任务：[`WT-043`](./WT-043-EXPLICIT-SOURCE-NOMINATION-EXTRACTION.md)  
> 前置决策：[`DEC-WT044-001`](../decisions/DEC-WT044-001-NOMINATION-EXTRACTION-PROVENANCE.md)  
> 对应基线：parse review审计增强  
> 发布状态：领域与内部DTO变更，无数据库迁移或HTTP

## 目标

在review中保存最小解析溯源，保证提取器升级和人工修订后仍能解释初始候选的生成版本、数量和截断质量。

## 实现

- review固定提取版本、初始候选数、有效/拒绝显式出现数和截断标志；
- 创建时校验初始候选与提取统计一致；
- 确认可增删当前候选但保留初始计数；
- 拒绝保留初始候选列表；
- 领域完整性重建区分初始候选与确认后候选；
- Repository把解析溯源纳入不可变身份校验；
- 严格snake_case读模型新增同名质量字段和可复算约束。

## 明确不做

- 不保存完整匹配区间、原始URI列表或解析token；
- 不修改批准基线目录；
- 不创建数据库迁移；
- 不接入真实回答或生产解析；
- 不注册HTTP路由；
- 不改变正式事件语义。

## 测试

- needs_review保存初始候选数和提取版本；
- confirmed人工修订数量变化后仍保持初始统计；
- 初始计数篡改被完整性复核拒绝；
- Repository拒绝终态写入时篡改提取版本；
- DTO校验截断与初始候选统计一致。

## 完成标准

- [x] 提取版本字段完成；
- [x] 初始候选项数字段完成；
- [x] 有效/拒绝计数与截断字段完成；
- [x] 初始统计可复算约束完成；
- [x] 人工确认修订与初始事实分离；
- [x] Repository不可变溯源校验完成；
- [x] 严格DTO质量字段完成；
- [x] 无迁移、HTTP、真实数据或生产启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 领域实现：`packages/domain/src/source-nomination-parse-review.ts`；
- Repository校验：`packages/infrastructure/src/in-memory-source-nomination-parse-review-repository.ts`；
- DTO：`packages/contracts/src/source-nomination-review.ts`；
- 测试：领域、Repository和契约现有测试集；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：无数据库迁移、HTTP、真实数据或生产启用；
- 深度自审修复：初始候选数与确认后候选数拆分；confirmed可合法修订数量；解析溯源加入Repository不可变身份；没有扩大到保存完整解析中间数据。

## 后续

“已确认消费端自述响应 → WT-043提取 → 带溯源needs_review记录”的内部应用服务已在[`WT-045`](./WT-045-CREATE-SOURCE-NOMINATION-PARSE-REVIEW.md)完成。
