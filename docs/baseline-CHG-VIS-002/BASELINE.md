# CHG-VIS-002批准基线

## 基线信息

| 项目 | 内容 |
|---|---|
| 产品 | “问天”AI信源探测系统 |
| 变更号 | `CHG-VIS-002` |
| 状态 | 已批准 |
| 批准日期 | 2026-08-21 |
| 系统边界 | 问天完整独立部署；GEO通过薄连接器接入 |
| 连接器契约 | `wentian-geo-connector@1` |
| Git状态 | 尚未初始化 |

## 基线规则

1. 本目录文档作为开发、测试和验收的批准输入，不直接原地修改。
2. 指标、证据语义、项目隔离、部署边界或连接器主版本发生变化时，必须建立新ADR并形成新基线。
3. Provider、消费端surface、数据保留和生产网络配置仍需分别审批；提案批准不自动代表这些外部事项已批准。
4. 问天可以先开发独立系统基础；GEO连接器按实施计划阶段G单独交付。
5. Git仓库由项目所有者后续创建，本次落档不执行 `git init`。

## 文件完整性

以下SHA-256清单在批准文档完成格式和链接校验后生成。`BASELINE.md`自身不纳入清单，避免自引用哈希。

```text
08351bdeb7108ce2bc4455895a42d8b9e26cbb8e679a6d75ce8ab320c9b698df  01-PRD-AND-UX.md
2b96d53076295562cf87cb813e8f00387d7427f115792c6caaaa68b0118fd837  02-METRICS-METHODOLOGY.md
15e019719f552afb4880c789f24de788e2b87409c1afda5ed3e11514634c8824  03-TECHNICAL-DESIGN.md
19617e10608fc42f3cdcdd9a1dfb955cb951a8044fcfde49239119acffebb54a  04-DATA-AND-API.md
10ed0a3cb8fb87676a56e15b009e02f6d4513b6bf94e38b266b60b6221ff91d0  05-PROVIDER-AND-COMPLIANCE.md
63b79da84ea0c3d6aeed22ff622c27b6bfa307debbbcdca9a188ff3523096cc0  06-AI-DEVELOPMENT-MANUAL.md
a56e2e82b24a6509993d3f266024fca2fc4f21bf6eca5dd41cb81909633a8cb6  07-TEST-AND-ACCEPTANCE.md
b5627bf634b870d30c7305ae2ca539a5f1bffa727457ec6c45deec3a64fd7c5d  08-IMPLEMENTATION-PLAN.md
5a8c28d6f141a995aaf2f00d5516864796a66ac6a2532812bbfa2da2ad6090a9  09-STANDALONE-DEPLOYMENT.md
6f57cd2d8e7dc4ef5ec3aa07684c5591a2a8e7d565aec070d52dea2a9f913ce3  10-GEO-CONNECTOR-CONTRACT.md
4cf8f856e60ac254851ceaf0e911a9191d1bb188c5d56c036333fdce090dd94d  ADR-CHG-VIS-002.md
cd22b91be2436770e4ecd3e755673341dbf95dc20ff091f0a1a398f79afbc32d  README.md
bb70ee71ce425473aca67bc810803d95574d9eefec12f4b966555f1ddfa86e9c  SELF-REVIEW.md
```
