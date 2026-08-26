# WT-043 显式URL/域名确定性提取器

> 状态：已完成  
> 前置任务：[`WT-042`](./WT-042-SOURCE-NOMINATION-REVIEW-QUERY.md)  
> 前置决策：[`DEC-WT043-001`](../decisions/DEC-WT043-001-EXPLICIT-SOURCE-EXTRACTION-BOUNDARY.md)  
> 对应基线：消费端非结构化回答的确定性显式信源提取  
> 发布状态：离线纯函数，无真实调用、Repository或事件写入

## 目标

从已提供的自述回答文本中确定性识别显式HTTP(S) URL和域名，输出最多10项待复核候选，同时避免任何机构名称到域名的推断。

## 实现

- 版本化、无网络纯函数；
- 先识别所有带scheme URI区间，避免非HTTP host被裸域名规则误收；
- HTTP(S) URL复用版本化URL归一化和公共后缀策略；
- 裸域名通过合成HTTP URL复用相同可注册域校验；
- 排除邮箱、不可注册host、非HTTP URI和URL内部的重复host匹配；
- 按原文顺序编号并保留独立重复提及；
- 输出有效数、拒绝数、截断标志和固定边界警告；
- 输出对象、数组和候选项全部冻结。

## 明确不做

- 不读取网页、剪贴板或真实Provider；
- 不从机构名称、标题或上下文猜测域名；
- 不抽取信息类型或理由；
- 不支持裸Unicode域名；
- 不创建review或正式来源事件；
- 不接入HTTP或数据库；
- 不修改批准基线。

## 测试

- HTTP URL与裸域名按原文顺序提取；
- URL内部host不被重复匹配；
- 独立重复域名保留不同顺序；
- 机构名称、邮箱、非HTTP URI和localhost不进入候选；
- 私有公共后缀和中文URL域名规范化；
- 超过10项返回截断信号；
- 空白、超长输入和不可变输出。

## 完成标准

- [x] 版本化离线提取器完成；
- [x] HTTP(S) URL和显式域名提取完成；
- [x] 非HTTP URI区间隔离完成；
- [x] 邮箱和不可注册host排除完成；
- [x] 原文顺序与重复提及保留完成；
- [x] 最多10项和截断披露完成；
- [x] 固定警告与不可变输出完成；
- [x] 无名称推断、review写入、事件写入或真实数据；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 实现：`packages/infrastructure/src/explicit-source-nomination-extraction.ts`；
- 测试：`packages/infrastructure/test/explicit-source-nomination-extraction.test.ts`；
- 全量验证：`pnpm verify`通过，299项测试全部通过；
- 完整性复核：100份Markdown无断链，批准基线哈希无漂移，Git仍按批准基线未初始化；
- 发布边界复核：离线纯函数，无真实调用、Repository、事件或HTTP；
- 深度自审修复：所有scheme URI先占位，修复FTP URL内部host被裸域名规则误收；邮箱由上下文边界排除；超量不静默；信息类型和理由保持空值。

## 后续

review的解析版本、初始候选数、拒绝数和截断溯源已在[`WT-044`](./WT-044-SOURCE-NOMINATION-EXTRACTION-PROVENANCE.md)补齐。下一步实现“已确认消费端自述响应 → 确定性提取 → needs_review记录”的内部应用服务。
