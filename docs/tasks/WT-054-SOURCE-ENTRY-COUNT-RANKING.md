# WT-054 同题信源条目累计排名

> 状态：已完成  
> 前置任务：[`WT-053`](./WT-053-NOMINATION-CITATION-OVERLAP-CONTRACT.md)  
> 前置决策：[`DEC-WT054-001`](../decisions/DEC-WT054-001-SOURCE-ENTRY-COUNT-RANKING.md)  
> 发布状态：纯领域函数，无运行读取、HTTP或生产连接

## 目标

把同一问题的多次回答中每个正式信源条目按域名累计，并生成可复算的确定性排名。

## 实现范围

- 输入同题、同角色的正式信源条目；
- 每个条目计数一次，不按域名或回答去重；
- 按累计次数降序、域名字典序升序排名；
- 返回总条目数和域名累计次数；
- 对跨题、跨角色、重复条目ID和非法域名失败关闭。

## 明确不做

- 不读取运行仓库；
- 不判断两次实验是否可比；
- 不计算回答覆盖率或抓取频率；
- 不接触真实Provider、消费端网页或GEO；
- 不注册HTTP接口和持久化结果。

## 完成标准

- [x] 用户给出的A、D、C、B示例通过黄金测试；
- [x] 重复域名条目逐条累计；
- [x] 并列、空输入和规范化行为确定；
- [x] 非法输入失败关闭；
- [x] 结果不可变；
- [x] `pnpm verify`通过。

## 完成记录

- 完成日期：2026-08-23；
- 实现：`packages/domain/src/source-entry-count-ranking.ts`；
- 测试：`packages/domain/test/source-entry-count-ranking.test.ts`；
- 用户示例结果：`A=7、D=6、C=4、B=3`；
- 最终验证：`pnpm verify`通过，329项测试全部通过。
