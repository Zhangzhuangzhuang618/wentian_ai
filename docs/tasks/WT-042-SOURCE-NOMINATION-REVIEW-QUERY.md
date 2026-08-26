# WT-042 自述复核列表内部查询

> 状态：已完成  
> 前置任务：[`WT-041`](./WT-041-SOURCE-NOMINATION-REVIEW-CONTRACT.md)  
> 前置决策：[`DEC-WT038-001`](../decisions/DEC-WT038-001-NOMINATION-REVIEW-REPOSITORY-BOUNDARY.md)  
> 对应基线：按状态读取复核队列  
> 发布状态：内部只读应用服务，无HTTP或生产Repository

## 目标

实现按scope和状态读取复核队列的内部应用服务，并在服务边界复核Repository返回结果，防止跨scope、错状态或重复记录进入DTO层。

## 实现

- 从Principal冻结的scope集合判定读取权限；
- viewer及以上角色均可读取已授权scope；
- 未授权scope不调用Repository并统一返回资源不存在；
- 运行时复核状态只接受三种批准值；
- 每条返回记录重跑领域完整性校验；
- 返回结果必须与请求scope和状态一致；
- 同一结果不得出现重复review ID或response ID；
- 返回数组冻结，内存Repository保持确定性排序。

## 明确不做

- 不返回回答正文、截图或来源哈希；
- 不实现分页、搜索或复杂筛选；
- 不注册HTTP GET路由；
- 不实现生产数据库查询或缓存；
- 不接入真实数据；
- 不修改批准基线。

## 测试

- viewer按scope和状态读取确定性队列；
- 未授权scope不调用Repository；
- 非法运行时状态失败关闭；
- Repository错scope、错状态和重复响应失败关闭；
- 返回数组不可变。

## 完成标准

- [x] scope权限门禁完成；
- [x] viewer只读支持完成；
- [x] 状态白名单完成；
- [x] Repository结果完整性复核完成；
- [x] scope、状态和唯一性复核完成；
- [x] 不可变结果完成；
- [x] 无回答正文、HTTP、数据库或真实数据；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 应用服务：`packages/application/src/list-source-nomination-parse-reviews.ts`；
- 测试：`packages/infrastructure/test/list-source-nomination-parse-reviews.test.ts`；
- DTO适配：`packages/contracts/src/source-nomination-review.ts`；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：内部只读服务，无HTTP、生产Repository或真实数据；
- 深度自审修复：未授权时不触发Repository侧信道；服务不盲信Repository隔离；重复response会失败而不是生成两条复核待办；未增加基线未要求的分页与搜索。

## 后续

完全离线、确定性的显式URL/域名提取器已在[`WT-043`](./WT-043-EXPLICIT-SOURCE-NOMINATION-EXTRACTION.md)完成：只输出待复核候选，不直接创建正式事件，名称到域名映射和模型推断继续排除。
