# “问天”AI信源探测系统文档索引

> 状态：已批准开发基线  
> 变更代号：`CHG-VIS-002`  
> 编制日期：2026-08-21  
> 批准日期：2026-08-21  
> 适用项目：问天独立项目；GEO Content OS v2.1仅实现连接器

## 1. 文档目的

本目录定义“针对一组问题，持续测量 AI 回答采用哪些网页信源、AI 自述会优先推荐哪些信源、消费端网页实际展示哪些可见来源，以及各信源出现频率、引用位置和变化趋势，并结合自有站点日志测量 AI 爬虫访问”的产品与技术方案。产品正式命名为“问天”AI信源探测系统。

问天只有一种运行形态：完整独立部署。GEO Content OS通过薄连接器接入问天，提供导航、一次性SSO、项目绑定、问题集同步和可选事件回传；GEO不运行问天API/Worker，不安装问天数据库迁移，也不共享问天数据库。

本方案是现有 `ADR-0022` AI 可见度实验的增量设计，不修改现有冻结文档，不把模型记忆测试、联网检索和爬虫访问混为同一指标。

## 2. 阅读顺序

| 顺序 | 文档 | 读者 | 解决的问题 |
|---:|---|---|---|
| 1 | [01-PRD-AND-UX.md](./01-PRD-AND-UX.md) | 产品、设计、业务 | 为什么做、做什么、页面和交互是什么 |
| 2 | [02-METRICS-METHODOLOGY.md](./02-METRICS-METHODOLOGY.md) | 产品、分析、研发 | 指标如何计算，哪些结论可以或不可以得出 |
| 3 | [03-TECHNICAL-DESIGN.md](./03-TECHNICAL-DESIGN.md) | 架构、后端、前端 | 如何接入现有系统，运行链路和边界是什么 |
| 4 | [04-DATA-AND-API.md](./04-DATA-AND-API.md) | 后端、数据、前端 | 数据实体、状态、接口和事件契约是什么 |
| 5 | [05-PROVIDER-AND-COMPLIANCE.md](./05-PROVIDER-AND-COMPLIANCE.md) | 产品、法务、安全、研发 | 各提供商如何接入，哪些方式禁止使用 |
| 6 | [06-AI-DEVELOPMENT-MANUAL.md](./06-AI-DEVELOPMENT-MANUAL.md) | AI 开发代理、研发 | 开发顺序、事实源、禁区、任务模板和 DoD |
| 7 | [07-TEST-AND-ACCEPTANCE.md](./07-TEST-AND-ACCEPTANCE.md) | QA、产品、研发 | 如何验证功能、指标和安全边界 |
| 8 | [08-IMPLEMENTATION-PLAN.md](./08-IMPLEMENTATION-PLAN.md) | 项目负责人、研发 | 如何拆任务和分阶段交付 |
| 9 | [09-STANDALONE-DEPLOYMENT.md](./09-STANDALONE-DEPLOYMENT.md) | 运维、架构、研发 | 问天如何独立安装、升级、备份和恢复 |
| 10 | [10-GEO-CONNECTOR-CONTRACT.md](./10-GEO-CONNECTOR-CONTRACT.md) | 架构、后端、前端 | GEO如何通过SSO、项目绑定、同步和事件接入问天 |
| 11 | [ADR-CHG-VIS-002.md](./ADR-CHG-VIS-002.md) | 架构、研发、产品 | 已接受的架构与产品边界是什么 |
| 12 | [SELF-REVIEW.md](./SELF-REVIEW.md) | 产品、架构、研发、QA | 本轮内容自审发现、修复和剩余审批项 |

## 3. 一句话定义

问天对固定问题集进行可重复的自然回答探测、信源自述实验和消费端观察，保存原始回答、搜索候选、信源提名和引用证据；按域名、URL、问题、意图、提供商、消费端产品和时间统计不同证据等级的信源倾向；同时允许导入自有站点访问日志，单独统计已验证 AI 爬虫的真实访问频率。

## 4. MVP 决策摘要

- 保留现有 `model_only` 模型记忆测试。
- 问天是唯一数据与运行事实源，独立拥有Web、API、Worker、PostgreSQL、Redis和对象存储。
- 问天MVP支持一个本地组织、多个项目及owner/admin/analyst/viewer角色，不建设公共多租户SaaS。
- 一个问天MVP实例最多激活一个GEO租户连接，可绑定该租户下多个项目。
- GEO连接器是独立集成层，只调用问天公开集成API；不得读取问天数据库、队列或对象存储。
- GEO入口首期采用同页跳转加一次性SSO票据，不把问天完整页面复制进GEO，也不使用共享Cookie。
- GEO项目与问天项目显式一对一绑定：GEO管理员发起、问天管理员选择本地项目并批准；问题集同步后生成问天不可变快照，运行期间不回读GEO。
- 问天独立版MVP先行发布；GEO连接器作为后续集成里程碑，不阻塞独立版上线。
- 新增 `search_api` 联网信源探测和 `web_observed` 消费端观察；明确现有 `imported` 只保留为历史/外部数据集模式，MVP不新增通用外部数据集导入UI。
- 新增 `source_nomination` 信源自述实验，结果称为“提名率/声明偏好”，不称为真实引用倾向。
- 信源自述按 `unaided | search_assisted | surface_unknown` 分组，默认不合并。
- 消费端观察首期采用浏览器辅助采集和人工导入；不自动登录、不绕过验证码、不无人值守批量操作。
- 消费端确认状态与证据等级分开；API—消费端无法证明模型等价时只做 `query_only` 对照。
- 自动接入只使用正式 API，不自动登录 ChatGPT、Perplexity、Gemini 等消费端网页。
- 完整MVP至少接入一个获批准的搜索Provider，首选候选为OpenAI Responses Web Search；Perplexity Sonar作为第二Provider增强。任何Provider上线仍须完成账号能力和条款复核。
- Google Grounding with Google Search 暂不进入自动监测 MVP，其现行附加条款对链接收集、分析和追踪存在明确限制，除非获得书面许可并通过法务评审。
- 爬虫频率只从用户拥有或获授权的服务器/CDN日志计算。
- 完整MVP必须包含日志导入、爬虫身份双重核验和趋势报告；没有日志模块的交付只能标记为联网信源预览版。
- 不抓取引用网页正文，不建立第三方网页内容库；MVP只保存提供商返回的必要引用元数据。
- 同一问题默认 3 个样本，可配置 1–5；样本不足时只展示描述性统计，不宣称统计显著。

## 5. 与GEO Content OS v2.1基线的关系

GEO Content OS v2.1现有实现已经具备：

- 版本化问题集与六类意图；
- 异步运行、逐题原始回答、竞品和URL保存；
- `model_only | search_api | imported` 数据库枚举预留；
- `sample_index` 1–10 数据库约束；
- AI 可见度页面、分析权限、Outbox 和成本账本基础设施。

GEO Content OS v2.1现有实现尚不具备：

- 搜索型提供商 Adapter；
- 搜索候选与最终引用的分层保存；
- 多样本运行编排；
- URL/域名统一归一化；
- 信源倾向指标及可信度提示；
- AI 爬虫日志导入与官方身份核验；
- 针对信源的趋势、问题矩阵和证据下钻。
- 信源自述实验及提名—引用重合指标；
- 消费端观察会话、可见证据采集和人工确认闭环。

新增后的运行模式定义：

- `model_only`：非联网模型回答；
- `search_api`：正式搜索API；
- `web_observed`：消费端网页可见结果；
- `imported`：无法归属为消费端现场观察的历史或外部数据集。

消费端人工录入仍属于 `web_observed + manual_import`，不得为省事写成 `imported`。

## 6. 变更控制

本目录中的内容构成 `CHG-VIS-002` 批准基线。实施时必须：

1. 以已接受的 `ADR-CHG-VIS-002.md` 为架构依据；
2. 为具体实现分配正式任务号；
3. 按契约优先顺序同步contracts、迁移、OpenAPI、任务卡和验收；
4. 在相关功能启用前明确首批提供商、预算和数据保留政策；
5. 不直接修改GEO Content OS仓库 `docs/freeze-v2.1/` 中的五份冻结DOCX；
6. 变更本基线必须创建后续ADR并重新执行跨文档自审。
