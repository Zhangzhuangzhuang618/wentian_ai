# “问天”AI信源探测指标与实验方法

> 方法版本建议：`ai-source-observatory@1`  
> 适用范围：搜索型API探测、信源自述、消费端观察、自有站点日志和人工导入结果

所有指标只在问天中计算。问题集来自本地创建还是GEO连接器同步，不得改变算法、证据语义或分子分母；GEO只接收问天返回的结果摘要或跳转链接，不重复计算指标。

## 1. 测量对象

本项目只测量可观察事件和模型明确声明，不推断提供商未公开的内部权重。

```text
爬虫访问（自有日志） → 搜索候选（提供商明确返回） → 最终引用（提供商明确归因）
                                  ↘ 信源自述提名（模型声明，应单独统计）
消费端网页 → 可见回答/可见引用（人工确认，不代表隐藏候选）
```

三个环节必须分别保存、分别统计：

- 爬虫访问不能证明网页进入某次回答的候选集合；
- 搜索候选不能证明网页被回答采用；
- 最终引用不能反推出爬虫访问次数；
- 回答内容相似但没有结构化引用，不能自动认定读取了某个网页。
- 信源自述提名只能说明模型声明“应该参考”，不能证明本次实际检索、引用或长期抓取。
- 消费端观察只覆盖页面可见结果，不能推断未展示的检索候选。

## 2. 统计单位

| 单位 | 主键含义 |
|---|---|
| 问题 | 不可变问题集版本中的一个问题 |
| 样本 | provider + model + run + query + sample_index |
| 来源事件 | 一个样本中的一个候选或引用URL |
| 提名事件 | 自述样本中被模型推荐的一个域名及其顺序 |
| 消费端观察样本 | 特定产品界面、问题、会话条件和采集时间下的一次人工确认结果 |
| 域名 | URL归一化后的可注册域名或配置的站点域名 |
| 运行 | 一个提供商、模型、问题集版本和配置快照 |
| 日志请求 | 自有站点的一次HTTP请求 |

所有比例默认以“成功样本”为分母。失败、取消或没有结构化来源字段的样本不得静默计入未引用。

## 3. URL 与域名归一化

### 3.1 保留字段

每个来源同时保存：

- `original_url`：提供商返回的原始URL；
- `normalized_url`：用于聚合的URL；
- `host`：小写主机名；
- `registrable_domain`：公共后缀规则下的可注册域名；
- `normalization_version`：归一化算法版本。

报告以 `registrable_domain` 作为跨 `www` 和子域名的稳定聚合键，但不得只展示该聚合键。自然回答排名同时展示从 `original_url` 提取的实际观测来源 Origin（例如 `https://www.zgswcn.com`），并保留到具体原始 URL 的下钻能力；不得根据可注册域名臆造 `www`、协议或子域名。

### 3.2 MVP 规则

1. 仅接受 `http` 和 `https`。
2. 主机名转小写并转换国际化域名为ASCII规范形式。
3. 删除URL fragment。
4. 删除默认端口。
5. 删除已版本化清单中的追踪参数，如 `utm_*`、`gclid`、`fbclid`。
6. 其余查询参数按键排序并保留，禁止随意删除业务参数。
7. 路径不主动去除尾斜杠，除非来源明确给出 canonical URL；MVP不主动抓网页验证 canonical。
8. 原始URL永不覆盖，算法升级只生成新版本聚合结果。

## 4. 联网信源指标

以下定义中的 `N` 为筛选范围内成功样本数。

### 4.1 样本引用率 Citation Rate

```text
CitationRate(d) = 引用了域名 d 的成功样本数 / N
```

同一样本多次引用同一域名只计一次。该指标回答“这个域名在多少次回答中出现”。

### 4.2 引用份额 Citation Share

```text
CitationShare(d) = 域名 d 的引用事件数 / 全部域名引用事件数
```

同一样本的多个不同URL分别计事件。必须与引用率同时展示，避免长引用列表放大某域名。

### 4.3 首位引用率 First Citation Rate

```text
FirstCitationRate(d) = 域名 d 位于第一引用位置的样本数 / 有引用的成功样本数
```

只有提供商返回稳定顺序时计算；无顺序字段时标记不可用。

### 4.4 平均引用位置 Mean Citation Position

```text
MeanPosition(d) = 域名 d 所有引用事件位置的算术平均
```

位置越小表示越靠前，但不能解释为提供商内部权重。

### 4.5 候选曝光率 Candidate Exposure Rate

```text
CandidateExposureRate(d) = 候选中包含域名 d 的成功样本数 / 返回候选列表的成功样本数
```

只有提供商明确返回候选搜索结果时计算。没有候选列表的提供商显示“不可测”，不得当作0。

### 4.6 候选转引用率 Candidate-to-Citation Rate

```text
CandidateToCitationRate(d) = 同时候选且被引用的样本数 / 候选中包含域名 d 的样本数
```

该指标可描述“进入候选后被采用的观察比例”，不能证明生成模型执行了固定筛选规则。

### 4.7 问题覆盖率 Query Coverage

```text
QueryCoverage(d) = 至少一次引用域名 d 的问题数 / 有效问题数
```

与样本引用率分开：前者衡量问题广度，后者衡量重复稳定性。

### 4.8 自有域名引用率

使用当前scope配置并验证的 `owned_domains` 集合聚合。子域是否合并由域名规则明确配置，默认按可注册域名合并并允许例外覆盖。

### 4.9 来源稳定度

对同一问题的两个样本引用域名集合 `A`、`B`：

```text
Jaccard(A,B) = |A ∩ B| / |A ∪ B|
```

问题稳定度为全部样本对的平均Jaccard；运行稳定度为问题稳定度平均值。两个集合都为空时标记“无来源”，不设为1。

## 5. 信源自述指标

信源自述实验的 `N` 为成功且通过解析确认的自述样本数。自述回答中的域名进入 `nominated` 角色，不进入 `candidate` 或 `cited`。

每个自述运行必须固定 `nomination_context`：

- `unaided`：未启用搜索或联网能力；
- `search_assisted`：明确启用了搜索或联网能力；
- `surface_unknown`：消费端页面无法确认搜索模式。

三类上下文分别计算分子和分母，默认不得汇总。只有用户显式选择跨上下文探索时才能并列展示，且不生成合并提名率。

### 5.1 提名率 Nomination Rate

```text
NominationRate(d) = 提名域名 d 的自述样本数 / N
```

同一样本重复提名同一域名只计一次。

### 5.2 首位提名率 First Nomination Rate

```text
FirstNominationRate(d) = 域名 d 位于第一提名位置的样本数 / 有有效提名顺序的样本数
```

没有明确顺序时不可用，不根据正文出现位置猜测。

### 5.3 提名份额 Nomination Share

```text
NominationShare(d) = 域名 d 的提名事件数 / 全部提名事件数
```

该指标描述声明偏好，不表示实际使用概率。

### 5.4 提名稳定度

使用同一问题不同自述样本 Top-K 域名集合的平均 Jaccard。K默认为10，少于10个时使用实际有效提名数并返回分母。

### 5.5 提名—引用重合度@K

对同一问题、同一Provider或消费端产品、相近时间、匹配配置且 `nomination_context` 可比的自述运行 `N_q` 与自然回答运行 `C_q`：

`natural_answer` 的 `nomination_context` 字段保持为空；对照服务按同一派生规则从其retrieval mode和surface搜索状态计算“有效搜索上下文”。有效上下文与自述运行不一致时返回 `not_comparable`。

```text
NominationCitationOverlap@K(q) = |TopK(N_q) ∩ TopK(C_q)| / K
```

当任一集合不足K时，除固定K口径外同时返回有效集合大小。该指标只表示两个可观察集合的重合，不表示自述导致引用。

### 5.6 声明—行为分类

域名可分为：

- `aligned`：经常提名且经常实际引用；
- `declared_only`：经常提名但很少引用；
- `behavior_only`：很少提名但经常引用；
- `insufficient_data`：样本不足。

“经常”的阈值必须由方法版本固定，不允许前端临时改变后仍沿用原标签。MVP只展示提名率—引用率二维散点，不自动分类。

## 6. 消费端观察指标

消费端指标只使用 `verification_status=confirmed` 的观察样本。

### 6.1 Web端可见引用率

```text
WebVisibleCitationRate(d) = 可见引用包含域名 d 的确认样本数 / 消费端确认样本数
```

### 6.2 Web端首位可见引用率

只有页面明确展示引用顺序时计算。来源面板无顺序语义时返回不可用。

### 6.3 Web端来源稳定度

按相同产品、页面显示模型、搜索模式、登录/记忆状态和地区分组后，对同一问题重复样本计算Jaccard。配置不一致时不得直接合并。

### 6.4 API—消费端重合度@K

名称必须是“重合度”，不得写成“一致率”或把API视为真值。服务端必须返回比较等级：

| 比较等级 | 判定条件 | 允许结论 |
|---|---|---|
| `exact` | 提供商公开资料能够证明消费端与API使用同一模型或模型快照，且问题、时间窗、搜索模式、地区和样本规则匹配 | 可计算模型对照重合度 |
| `approximate` | 使用经审批、版本化的模型族映射，其他配置匹配 | 可计算近似重合度，并显示模型可能不同的警告 |
| `query_only` | 无法证明模型等价，或消费端模型未知 | 只按同题并列描述来源集合；不得计算或展示模型一致性结论 |

未配置等价证据、消费端页面显示模型未知，或其标签与版本化映射不匹配时默认 `query_only`，不得从消费端营销名称或页面标签自行推断API model ID。

### 6.5 人工确认状态

| 状态 | 条件 | 默认统计 |
|---|---|---|
| `needs_review` | 解析与截图不一致或关键元数据缺失 | 否 |
| `confirmed` | 用户确认可见回答、引用和关键元数据正确 | 是，仍须同时满足证据等级规则 |
| `rejected` | 误采、重复、来源不明 | 否 |
| `not_required` | 结构化API响应或外部数据集不进入消费端人工确认流程 | 不适用于消费端人工确认分母 |

### 6.6 证据等级

| 等级 | 条件 | 默认统计 |
|---|---|---|
| `api_structured` | Provider API结构化响应，`verification_status=not_required` | 进入对应API指标 |
| `web_confirmed_capture` | 浏览器辅助采集，含截图、可见链接且 `verification_status=confirmed` | 进入消费端默认指标 |
| `web_confirmed_manual` | 人工粘贴/录入，具备当前页面截图、完整元数据且 `verification_status=confirmed` | 进入消费端默认指标，可单独筛选 |
| `imported_declared` | 历史或外部数据集按其声明导入，`verification_status=not_required` | 默认排除；仅在显式选择导入数据集时单独统计 |

确认状态描述“是否经过人工确认”，证据等级描述“证据如何产生”。两者必须分别过滤，不能用 `confirmed_capture` 等复合值替代确认状态。

## 7. 爬虫日志指标

仅对 `verified` 请求计算默认指标。

### 7.1 请求频率

```text
RequestsPerDay(bot) = 某日已验证请求数
```

如用户提供站点可抓取URL总量，可额外计算：

```text
RequestsPer1000EligiblePages = 请求数 / 可抓取URL数 × 1000
```

未提供可抓取URL总量时不计算标准化频率。

### 7.2 页面覆盖率

```text
CrawlCoverage = 被已验证爬虫请求过的唯一URL数 / 用户提供的可抓取URL数
```

分母可来自经确认的Sitemap快照或上传清单，必须保存快照时间和哈希。

### 7.3 抓取成功率

```text
FetchSuccessRate = 2xx与允许的3xx请求数 / 已验证请求数
```

2xx和3xx仍需分开显示；403、404、429、5xx单独列出。

### 7.4 首次发现延迟

```text
DiscoveryLatency = 首次已验证请求时间 - 页面发布时间
```

只有页面发布时间来自可信CMS事件或用户确认数据时计算。

### 7.5 更新后重访延迟

```text
RefreshLatency = 更新后的首次已验证请求时间 - 页面更新时间
```

更新事件必须与URL、版本和时间绑定，不从 `Last-Modified` 单独推断。

## 8. 运行设计

### 8.1 默认参数

| 参数 | MVP默认 | 允许范围 |
|---|---:|---:|
| 问题数 | 30 | 1–100 |
| 每题样本数 | 3 | 1–5 |
| 提供商数 | 用户选择 | 1–已启用数量 |
| 温度 | 提供商支持时固定低值 | 不允许同一运行内变化 |
| 语言/市场 | 来自问题集 | 创建运行时冻结 |
| 并发 | 服务端配置 | 受预算和限流约束 |

### 8.2 样本独立性

- 每个样本使用独立请求，不续接前一回答上下文。
- 请求文本、系统指令、搜索参数和位置参数在同一运行内保持一致。
- 不在提示词中点名期望来源，除非该运行被明确标记为受控来源实验。
- 提供商重试导致的技术重复不得生成新的 `sample_index`；只有一次完整业务请求才算一个样本。
- `natural_answer` 与 `source_nomination` 使用不同运行；自述实验必须使用版本化提示词且明确禁止声称访问内部抓取统计。
- 自述运行必须保存 `nomination_context`；不同上下文不合并计算。
- 消费端样本必须使用新会话或明确记录非新会话；记忆、个性化和搜索模式未知时不得填默认值。

### 8.3 基线比较

仅当以下字段一致时允许显示直接变化百分比：

- query_set series/revision；
- provider和model snapshot；
- retrieval_mode；
- locale/market/location；
- sample_count；
- prompt/methodology/normalization version。
- experiment_kind、collection_method和consumer surface配置。
- nomination_context、evidence_grade；API—消费端直接对照还要求相同的模型等价映射版本。
- 问题集来源为local或geo_sync不改变算法；直接比较仍要求等价的snapshot hash。

否则显示“配置不一致，仅并列展示”。

## 9. 不确定性与结论等级

### 9.1 样本提示

| 有效样本数 | UI结论 |
|---:|---|
| 1–4 | 个案观察 |
| 5–19 | 描述性趋势，样本不足 |
| 20–49 | 可展示95% Wilson区间，但不自动宣称显著 |
| ≥50 | 可进行预注册的比例差异检验 |

MVP只实现描述性统计；置信区间和显著性判断属于P1。

### 9.2 可说与不可说

可说：

- “在本次90个成功样本中，example.com出现在24个样本的最终引用中，引用率26.7%。”
- “该域名在进入候选的18个样本中，有9个样本被最终引用。”
- “OAI-SearchBot在自有站点日志中产生152次已验证请求。”
- “在30个自述样本中，example.com被提名18次，提名率60%。”
- “在20个已确认消费端样本中，example.com可见引用率为25%。”

不可说：

- “example.com在AI内部权重为26.7%。”
- “AI爬取example.com的频率为26.7%。”
- “内容修改导致引用率提升”，除非完成受控实验并排除主要混杂因素。
- “模型把example.com列为抓取频率最高域名”，除非平台提供可核验内部统计。
- “消费端没有检索example.com”，因为页面没有展示不代表未进入隐藏候选。

## 10. 受控实验建议（P1）

实验必须一次只改变一个主要变量，例如摘要结构、发布时间、Schema或可访问性。采用随机分组或交错发布时间，预先固定：

- 假设；
- 主要指标；
- 问题集；
- 提供商和模型快照；
- 样本量；
- 运行周期；
- 排除条件。

不得发布虚假事实、误导性页面或仅为诱导模型而设计的内容。唯一识别标记只能用于无害的归因，不得包含个人信息、秘密或错误事实。

## 11. 数据质量标记

每个指标结果附带：

- `methodology_version`；
- `scope_id`；
- `query_set_snapshot_hash`；
- `query_set_source_type`；
- `geo_connector_contract_version`，仅geo_sync快照存在；
- `normalization_version`；
- `successful_sample_count`；
- `failed_sample_count`；
- `provider_source_granularity`；
- `candidate_data_available`；
- `experiment_kind`；
- `collection_method`；
- `nomination_context`；
- `consumer_surface_code`；
- `observation_verification_status`；
- `evidence_grade`；
- `comparison_tier` 和 `model_equivalence_version`（仅对照指标）；
- `log_verification_level`；
- `computed_at`。

缺少任一必要字段时，指标返回 `not_available` 和明确原因，不返回0。
