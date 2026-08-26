# “问天”探测提供商、爬虫身份与合规边界

> 状态：技术与产品评审输入，不构成法律意见。生产启用任何提供商前必须复核当时有效条款。

## 1. 总原则

1. 自动化只使用正式、获授权的API。
2. API探测结果只标记为对应API和模型，不冒充消费端产品。
3. 不由平台自动登录或无人值守抓取ChatGPT、Perplexity、Gemini等消费端网页；只允许用户主动触发且人工确认的可见内容采集。
4. 不利用个人账号批量规避速率、地域、付费或反自动化限制。
5. 只保存实现指标所必需的字段，并执行提供商条款允许的保留期。
6. 第三方引用URL不自动抓正文，不建立内容镜像。
7. 条款、能力或返回结构变化时，能力配置进入 `suspended`，运行失败关闭。
8. AI自述的信源提名不作为实际检索、引用或爬取证据。
9. 消费端观察只采集用户当前可见内容，并由用户确认后进入统计。
10. Provider条款审批、凭证和域名授权只属于具体问天实例；GEO连接器不得持有或代理Provider凭证。

## 2. MVP 提供商矩阵

| 提供商 | 自动探测 | 能力依据 | 产品标识 | 备注 |
|---|---|---|---|---|
| DeepSeek现有Adapter | 保留 | 现有模型调用 | 模型记忆测试 | 无联网来源结论 |
| OpenAI Responses Web Search | 候选 | 正式API支持Web Search与URL citation | OpenAI API搜索探测 | 上线前复核账号、模型、保留和使用条款 |
| Perplexity Sonar | 候选 | 正式API返回citations和search_results | Perplexity Sonar API探测 | 上线前复核分析、导出和保留范围 |
| Gemini Grounding with Google Search | MVP禁用 | 技术上可返回grounding metadata | 不展示 | 现行附加条款对链接收集、分析、追踪存在限制 |
| 各消费端AI网页 | 浏览器辅助/人工导入 | 页面可见回答、引用和来源面板 | 消费端观察 | 禁止自动登录和无人值守批量操作 |

OpenAI官方API参考显示Responses可启用Web Search，并在回答文本的annotations中返回`url_citation`；还可按API支持包含搜索结果或sources字段。该能力足以构建“API搜索探测”，但不能据此声称复制ChatGPT消费端体验。

Perplexity Sonar官方API返回顶层`citations`与`search_results`，适合分别保存最终引用和搜索候选。提示词不应要求模型在正文中手写URL，应读取结构化字段。

Google Gemini Grounding技术上返回搜索查询、grounding chunks和引用，但其现行附加条款包含对自动收集链接、构建索引、分析或追踪Grounded Results/Search Suggestions的限制。因此本产品默认不接入，除非取得适用许可并通过书面法务评审。

## 3. 提供商上线门禁

每个Provider Adapter上线前必须完成：

- 官方文档链接和复核日期；
- 允许的使用目的；
- 是否允许保存回答、搜索候选、引用URL、标题、snippet和搜索词；
- 最大保留期；
- 是否允许聚合分析、趋势、导出和客户展示；
- 数据处理区域和DPA；
- 模型/接口可用区；
- 限流、预算和重试要求；
- 结构化字段契约测试；
- 条款变化后的停用责任人。

任一项不明确时，Provider状态只能是 `draft` 或 `disabled`。

Provider审批记录属于具体问天系统实例。部署另一个问天实例时必须重新配置凭证、责任人、允许字段和保留期；GEO连接器不能创建、导出或读取Provider凭证。

## 4. 信源自述实验边界

信源自述提示词只能询问“为了准确回答应参考哪些公开来源”，不得诱导模型编造内部统计。推荐提示词必须包含：

> 请列出最多10个应优先参考的公开域名及适合核验的信息类型。不要声称这些域名是你实际抓取频率最高的来源；如果你无法访问内部抓取统计，请明确说明。

结果处理：

- 保存原始回答和明确提名域名；
- 没有明确域名时不从机构名称猜测URL；
- “权威、常用、优先”等理由作为模型声明保存，不转换为平台事实；
- 声称掌握内部抓取频率时标记为不可核验声明；
- 自述实验与自然回答使用独立运行和独立指标。
- 自述上下文必须标记为 `unaided`、`search_assisted` 或 `surface_unknown`；不同上下文不得默认合并，以免把模型固有知识与搜索辅助结果解释为同一种偏好。

## 5. 消费端观察与人工导入

### 5.1 浏览器辅助采集

允许的MVP流程：用户使用自己的账号登录消费端网页，在平台生成的任务指引下逐题操作，并主动点击采集当前可见结果。

采集器只能读取：

- 当前问题和可见回答；
- 当前页面可见的引用链接与来源面板；
- 页面显示的产品、模型和模式标签；
- 当前页面截图和用于核对的脱敏可见DOM片段。

采集器禁止读取：

- 密码输入框；
- Cookie、localStorage、session token或Authorization；
- 隐藏网络响应、内部API或未展示搜索候选；
- 其他标签页、其他会话或跨域内容；
- 账号实名、邮箱等非必要身份信息。

每次采集必须由用户预览和确认。确认状态与证据等级分别记录；浏览器辅助证据只有达到 `verification_status=confirmed + evidence_grade=web_confirmed_capture` 才进入默认指标。未经确认、截图与解析不一致或页面来源不明的结果不进入默认指标。

浏览器辅助工具的capture token必须绑定 `system_instance_id + scope_id + task_id + user_id`，并只允许提交到问天API origin。GEO连接器不得接收、转发或复用capture token。

### 5.2 人工导入

为比较真实消费端结果，可提供人工导入模板，但必须满足：

- 用户本人合法取得结果；
- 记录产品名称、模式、时间、地区、问题原文和是否登录；
- 由用户粘贴回答与引用，并上传同一当前页面的截图；
- 不要求或保存账号Cookie、密码、会话Token；
- 不提供自动重复刷新、自动截图或浏览器机器人；
- 对指定消费端surface的现场人工录入标记为 `retrieval_mode=web_observed`、`collection_method=manual_import`、`evidence_grade=web_confirmed_manual`，不得与API运行自动合并；
- 无法归属为现场消费端观察的历史或外部数据集才标记为 `retrieval_mode=imported`、`execution_target_type=external_dataset`、`evidence_grade=imported_declared`，默认不进入消费端指标。

### 5.3 API—消费端模型等价边界

页面显示的模型名称、产品营销名称或用户选择项不能单独证明其与某个API model ID相同。模型对照仅允许使用版本化surface映射：

- 提供商公开证据证明同一模型或快照：`exact`；
- 经审批的模型族映射：`approximate`，必须显示可能不同的警告；
- 其余情况：`query_only`，只做同题来源并列观察，不得声称模型一致或计算模型一致性。

缺少证据、页面显示模型未知或与获批映射标签不一致时默认 `query_only`，不得以推测补齐。

### 5.4 自动化边界

全自动登录、自动批量发问、自动展开来源、验证码识别或绕过、跨账号轮换不进入MVP。未来只有在对应平台明确允许、获得书面授权并完成独立ADR和安全评审后，才可为该surface启用有限自动化。

## 6. AI 爬虫身份核验

### 6.1 双重核验

默认 `verified` 必须同时满足：

1. User-Agent匹配官方公布的爬虫标识；
2. 请求源IP落在抓取时有效的官方IP范围或通过官方建议的反向/正向DNS验证。

只有UA匹配时标记 `ua_only`，因为UA可以伪造。

### 6.2 爬虫类别分开

同一厂商可能区分：

- 搜索索引爬虫；
- 用户请求触发的fetcher；
- 模型训练爬虫；
- 广告或其他专用爬虫。

必须按官方定义分别统计。例如OpenAI的搜索发现爬虫和潜在训练爬虫不能合并；Perplexity的自动索引爬虫与用户请求fetcher也不能合并。

### 6.3 规则快照

- 官方IP和UA来源URL进入白名单；
- 定期获取并保存内容哈希与获取时间；
- 网络失败时使用最近有效快照并标记陈旧；
- 官方撤销范围后，新请求不再验证为该bot；
- 历史事实保留当时使用的identity snapshot ID。

## 7. 日志与观察证据隐私

日志可能包含IP、查询参数、Cookie标识、路径中的个人信息和内部URL。导入流程必须：

- 丢弃Cookie、Authorization、Referer查询串等非必要字段；
- 原始IP仅用于身份核验，持久化前使用前缀化哈希或按策略删除；
- URL查询参数按允许清单保存，敏感参数删除；
- 仅处理用户拥有或明确授权的域名；
- 原始文件私有存储并设置到期删除；
- 导出默认不包含原始IP和完整User-Agent。

消费端截图和DOM片段可能包含账号头像、昵称或历史会话。采集前应限定页面区域并执行脱敏；采集器必须在上传前提供本地预览和丢弃重采。已上传观察包被用户拒绝时，暂存证据通过受控隐私清除流程删除，只保留拒绝原因和审计记录。已确认截图与DOM对象使用私有存储和独立保留期。

## 8. robots.txt 与站点控制

产品可以展示配置检查结果，但不得替用户自动修改站点。检查项包括：

- 目标bot在robots.txt中的allow/disallow；
- CDN/WAF是否返回403、429；
- Sitemap是否可访问；
- 页面是否noindex或限制snippet；
- 是否出现重定向、鉴权或JavaScript挑战。

检查结论只代表当时的公开配置或日志事实，不保证被收录或引用。

## 9. 安全与滥用防护

- 禁止把探测平台用于高频压测第三方服务；
- scope与提供商双重速率限制；
- 单次运行设最大题数、样本数和预算；
- 不允许用户自定义任意Provider endpoint；自定义适配器只能由平台运营审核发布；
- URL只做语法归一化，不从后端任意fetch；
- 导入文件进行病毒、压缩炸弹、公式注入和CSV注入防护；
- 导出以文本处理以`= + - @`开头的危险单元格。
- 浏览器辅助capture token必须短期、一次性并绑定任务和用户；不能作为登录消费端的代理凭证。
- 问天初始管理员凭证不得内置在镜像、示例配置或前端；首次初始化后必须失效。
- GEO连接器凭证与问天用户会话、Provider凭证分离；连接器必须通过SSO重放、项目越权、解绑和回调签名测试。

## 10. 对外披露文案

报告固定包含：

> 本报告统计指定问题集在所列API、消费端产品、模型、时间、地区和样本参数下的可观察结果。信源自述只表示模型声明应参考的来源；消费端观察只表示页面可见回答和引用。它们不披露或推断提供商内部算法权重、隐藏搜索候选或真实抓取频率。爬虫访问指标仅来自已授权站点日志，并与提名、搜索候选和最终引用分开计算。

## 11. 必须保留的官方依据

生产文档中应记录并定期复核以下官方页面：

- OpenAI Responses API Web Search及引用字段说明；
- OpenAI搜索爬虫、用户触发fetcher、训练爬虫和官方IP范围；
- Perplexity Sonar API引用与search_results字段说明；
- Perplexity爬虫和用户fetcher官方IP范围；
- Google Grounding相关技术文档与附加条款；
- 各提供商最新服务条款、DPA和数据保留说明。

文档URL和复核日期应存入Provider能力配置的审计记录，不硬编码为永远有效的产品事实。

当前设计核对依据：

- [OpenAI Responses API：创建响应与Web Search引用示例](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create)
- [OpenAI API：Web Search调用用量接口](https://developers.openai.com/api/reference/python/resources/admin/subresources/organization/subresources/usage/methods/web_search_calls)
- [OpenAI Crawlers：爬虫类型与官方IP范围](https://developers.openai.com/api/docs/bots)
- [Perplexity Sonar API参考](https://docs.perplexity.ai/api-reference/sonar-post)
- [Perplexity爬虫说明](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)
- [Gemini API：Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search)
- [Gemini API附加条款](https://ai.google.dev/gemini-api/terms)

以上链接核对日期为2026-08-21；开发和上线时必须重新核对。
