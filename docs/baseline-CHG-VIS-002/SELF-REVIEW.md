# “问天”AI信源探测系统内容自审报告

> 自审日期：2026-08-21  
> 自审结论：通过内容一致性自审，提案已于2026-08-21批准  
> 适用范围：`wentian/docs/baseline-CHG-VIS-002/` 批准基线文档  
> 边界：提案批准不等于具体Provider、法务、安全或生产上线审批通过

## 1. 自审方法

本轮采用两类检查：

1. 横向追踪：需求目标 → 产品模块 → 指标口径 → 技术组件 → 数据/API → 测试验收 → 实施任务。
2. 纵向约束：独立运行边界、GEO连接器边界、运行模式、实验类型、采集方式、证据等级、确认状态、来源角色、比较等级和MVP范围在各文档中使用同一含义。

未修改GEO Content OS仓库的 `docs/freeze-v2.1/` 冻结文档；本目录已转为 `CHG-VIS-002` 批准开发基线。

## 2. 已发现并修复的问题

| 编号 | 自审发现 | 修复决策 | 主要修复文档 | 状态 |
|---|---|---|---|---|
| SR-01 | 运行模式在不同文档中出现三种和四种两套说法 | 统一为 `model_only | search_api | web_observed | imported`，并固定执行目标和采集方式矩阵 | README、PRD、技术设计、数据/API、ADR、开发手册、测试 | 已修复 |
| SR-02 | 消费端人工确认状态与证据等级混用 | 拆成 `verification_status` 和 `evidence_grade` 两个字段；定义合法组合、默认统计规则和失败响应规则 | PRD、指标方法、技术设计、数据/API、合规、开发手册、测试 | 已修复 |
| SR-03 | PRD把爬虫日志列为P0，但实施计划的MVP不含日志 | 完整MVP统一包含P01–P09、N01、W01–W03、P12–P16；不含日志的版本只能称“联网信源预览版” | README、实施计划、测试验收 | 已修复 |
| SR-04 | `web_observed` 与 `imported` 都可使用人工录入，边界不清 | `web_observed` 表示可归属到明确surface和会话条件的现场观察；`imported` 只表示历史或外部数据集 | README、PRD、技术设计、数据/API、合规、ADR、开发手册、测试 | 已修复 |
| SR-05 | API—消费端比较缺少模型等价判定 | 增加版本化surface映射与 `exact | approximate | query_only` 比较等级；无法证明时默认 `query_only` | PRD、指标方法、技术设计、数据/API、合规、ADR、开发手册、测试、实施计划 | 已修复 |
| SR-06 | 信源自述没有区分未启用搜索与搜索辅助 | 增加 `nomination_context = unaided | search_assisted | surface_unknown`，由服务端派生并分开统计 | README、PRD、指标方法、技术设计、数据/API、合规、ADR、开发手册、测试、实施计划 | 已修复 |
| SR-07 | 只有域名、没有URL的提名无法稳定使用 `url_hash` 做唯一约束 | `url_hash` 对domain-only提名允许为空；新增必填 `source_key_hash`，按规范URL或规范域名计算 | 数据/API、ADR、开发手册、测试、实施计划 | 已修复 |
| SR-08 | 失败样本可能被误写证据等级 | `evidence_grade` 对失败响应必须为空；成功响应才校验状态—等级组合 | 数据/API、测试验收 | 已修复 |
| SR-09 | 核心E2E要求两个Provider，且“人工导入”同时指消费端录入和通用外部数据集UI | 完整MVP只要求一个获批Provider；第二Provider为增强。消费端现场人工录入属于MVP，通用外部数据集导入UI不属于MVP | README、PRD、技术设计、测试、实施计划、ADR | 已修复 |
| SR-10 | surface存在模型映射，但未要求运行时页面显示模型与映射匹配 | 增加 `comparison_surface_model_label`；页面模型未知或不匹配时强制降级为 `query_only` | 指标方法、技术设计、数据/API、测试 | 已修复 |
| SR-11 | 消费端人工录入是否必须有可复核截图表述不一致 | `web_confirmed_manual` 必须包含同一当前页面截图和完整元数据；缺失时保持 `needs_review` | 指标方法、合规、测试 | 已修复 |
| SR-12 | Provider未获批时的降级说明遗漏 `web_observed`，且可能误称完整MVP | 搜索Provider保持disabled；经独立surface批准的消费端能力只能作为预览，历史imported只兼容读取 | 实施计划 | 已修复 |
| SR-13 | 测试要求按事件时间使用爬虫身份快照，但请求事实表未保存快照外键 | 为 `crawler_request_facts` 增加 `identity_snapshot_id`，并补充对应测试 | 数据/API、测试 | 已修复 |
| SR-14 | 运行表引用surface版本，但ER图只画了surface到观察任务的关系 | 补充surface版本到运行的关系 | 数据/API | 已修复 |
| SR-15 | PRD写“预览确认后上传即入报告”，API写“上传后needs_review再确认”，且误采证据的删除与artifact不可删除约束冲突 | 固定为本地预览丢弃 → 上传暂存包 → 平台最终确认/拒绝；拒绝通过受控隐私清除服务删除暂存证据，正式响应仍append-only | PRD、技术设计、数据/API、合规、测试 | 已修复 |
| SR-16 | 自述—自然回答对照要求上下文一致，但natural_answer明确不保存 `nomination_context` | natural_answer字段保持为空；对照服务从其运行快照派生有效搜索上下文再比较 | 指标方法、数据/API、测试 | 已修复 |
| SR-17 | 来源事件唯一约束含可空 `source_position`，普通UNIQUE会允许重复NULL行 | PostgreSQL 16使用 `UNIQUE NULLS NOT DISTINCT`，并增加数据库测试 | 数据/API、开发手册、测试 | 已修复 |
| SR-18 | 消费端运行需要冻结采集方式，但创建接口未要求传入 | 创建接口增加 `collection_method` 并校验surface版本允许范围 | 数据/API、测试 | 已修复 |
| SR-19 | PRD要求保存提名信息类型、理由和解析确认状态，但来源事件与API缺少相应落点 | 来源事件增加信息类型、理由和validation method；新增parse review暂存表及确认/拒绝接口，确认后才写正式nominated事件 | 技术设计、数据/API、开发手册、测试 | 已修复 |
| SR-20 | 原方案把能力直接定义为GEO分析域增量，无法完全独立运行 | 问天改为唯一完整运行系统；GEO只保留远程薄连接器 | 全部文档 | 已修复 |
| SR-21 | 核心数据若使用GEO租户/工作区/项目外键，会导致问天依赖GEO数据库 | 问天按本地项目scope隔离；GEO外部引用只存在于连接器表，无跨库外键 | PRD、技术设计、数据/API、ADR、开发手册、测试 | 已修复 |
| SR-22 | 运行时读取GEO问题集会使结果受GEO修改和故障影响 | 本地创建或GEO同步后都形成问天不可变snapshot及items；运行只读问天快照 | PRD、技术设计、数据/API、连接器契约、测试 | 已修复 |
| SR-23 | 在GEO与独立系统分别承载完整UI会产生复制和漂移 | 完整业务UI只存在于问天；GEO只提供状态、绑定、同步和SSO跳转页 | PRD、技术设计、连接器契约、开发手册、测试 | 已修复 |
| SR-24 | 双运行环境要求两套bootstrap、迁移和基础设施验收，超过“接入GEO”的真实需要 | 删除GEO内嵌运行形态；问天独立发布，连接器单独发布并按契约兼容 | README、技术设计、部署、实施计划、ADR | 已修复 |
| SR-25 | 独立系统边界可能被误解为公共多租户SaaS | 问天MVP固定单组织、多项目，不包含公开注册、自助计费或跨组织管理 | PRD、技术设计、部署、开发手册、测试、实施计划、ADR | 已修复 |
| SR-26 | 问天若依赖GEO成本账本，会形成跨系统运行门禁 | 问天本地usage与预算是唯一门禁；GEO只接收可选摘要事件 | 技术设计、数据/API、开发手册、测试、实施计划 | 已修复 |
| SR-27 | 外部回调状态可能被混入运行状态 | GEO Webhook投递状态只属于Outbox；失败不回退运行或重复Provider调用 | 技术设计、数据/API、连接器契约、测试 | 已修复 |
| SR-28 | response/source/observation若使用GEO `query_id` 会形成隐藏依赖 | 新增不可变 `ai_probe_query_snapshot_items`；核心事实统一引用 `query_snapshot_item_id` | 技术设计、数据/API、测试、实施计划 | 已修复 |
| SR-29 | 问天迁移与GEO连接器迁移边界不清 | 问天迁移只在问天数据库执行；GEO迁移只能保存连接配置和状态，禁止复制核心事实 | 数据/API、部署、开发手册、测试 | 已修复 |
| SR-30 | GEO角色若直接成为问天权限会绕过最终授权 | GEO角色只按白名单映射；问天项目成员关系和服务端principal是最终授权事实 | PRD、连接器契约、开发手册、测试 | 已修复 |
| SR-31 | 用量和Outbox只有技术描述、没有数据落点 | 保留 `ai_probe_usage_records` 与 `ai_probe_outbox_events`，均由问天拥有 | 数据/API、开发手册、测试、实施计划 | 已修复 |
| SR-32 | 产品名称在各文档中仍为泛称“AI信源探测平台” | 正式产品名统一为“问天”AI信源探测系统；技术内部方法版本可保持稳定标识 | 全部文档 | 已修复 |
| SR-33 | 通用Host Contract包含大量当前不需要的抽象 | 删除Host Adapter/Capability/UI Context，改为仅面向GEO的 `wentian-geo-connector@1` | README、技术设计、数据/API、连接器契约、开发手册、测试、实施计划、ADR | 已修复 |
| SR-34 | GEO SSO若采用共享Cookie或长期URL Token会破坏安全边界 | 使用GEO后端签发请求、60秒一次性launch code、原子消费和问天第一方HttpOnly会话 | PRD、数据/API、连接器契约、部署、测试 | 已修复 |
| SR-35 | SSO票据只有流程、没有防重放数据落点 | 新增 `geo_sso_tickets`，只保存code hash、nonce、过期和原子消费状态 | 数据/API、测试 | 已修复 |
| SR-36 | GEO项目与问天项目若按名称自动匹配可能串项目 | 禁止名称匹配；同一GEO项目同时只能有一个待确认或有效binding | PRD、数据/API、连接器契约、测试 | 已修复 |
| SR-37 | GEO项目删除或解绑可能被误解为删除问天数据 | 解绑只撤销SSO、同步和会话映射；问天项目删除必须在问天显式执行 | PRD、技术设计、数据/API、连接器契约、测试、ADR | 已修复 |
| SR-38 | GEO回调若进入问天核心事务会造成分布式事务 | 核心事务只写问天Outbox；签名Webhook异步投递、有界重试和死信告警 | 技术设计、数据/API、连接器契约、测试 | 已修复 |
| SR-39 | 独立版MVP与GEO连接器同时作为发布门禁，会拖慢核心上线 | 问天独立版MVP先行；G01–G03作为后续集成里程碑 | README、PRD、实施计划、ADR | 已修复 |
| SR-40 | 未明确GEO故障对问天readiness和运行的影响 | GEO与连接器状态从核心readiness剥离；断连时本地登录和核心运行继续可用 | 技术设计、部署、连接器契约、测试 | 已修复 |
| SR-41 | 指标要求返回GEO连接器契约版本，但快照未冻结该版本，历史结果会受连接器升级影响 | GEO同步快照新增 `source_contract_version`；指标从快照读取，不反查当前连接实例 | 数据/API、测试 | 已修复 |
| SR-42 | 一次性launch code放在URL中仍可能进入日志、Referer或第三方脚本 | connect页面禁用第三方资源，设置no-referrer，日志脱敏并在消费后立即移除code | 连接器契约、测试 | 已修复 |
| SR-43 | 单组织问天实例若连接多个GEO租户，会产生跨租户管理和数据暴露风险 | MVP限制一个问天实例只激活一个GEO租户连接，可绑定该租户下多个项目 | PRD、数据/API、连接器契约、测试、实施计划 | 已修复 |
| SR-44 | 管理员可配置Webhook callback，若缺少目标约束可能形成SSRF | callback仅允许HTTPS白名单，校验DNS/IP和端口且禁止跟随重定向 | 连接器契约、测试 | 已修复 |
| SR-45 | SSO请求的requestedPath若接受外部URL可能形成开放重定向 | 只允许绑定项目内的问天相对路由白名单，最终URL由问天生成 | 连接器契约、测试 | 已修复 |
| SR-46 | GEO权限撤销后，既有问天会话可能长期保留旧权限 | GEO来源会话绑定binding/access version并设硬过期；解绑/吊销立即失效，角色变化不超过约定窗口 | 连接器契约、测试、实施待决项 | 已修复 |
| SR-47 | 文档声明“两端管理员确认”，但没有可执行的握手流程，可能被实现为单方直接激活 | 固定为GEO管理员发起pending申请、问天管理员选择本地项目并批准；非active状态禁止SSO与同步 | PRD、数据/API、连接器契约、测试、实施计划 | 已修复 |
| SR-48 | 全局身份映射保存最后角色时，同一GEO用户在多个项目的角色会互相覆盖 | 拆分全局身份映射与项目级访问映射；角色和access version按project binding隔离 | PRD、技术设计、数据/API、连接器契约、开发手册、测试、实施计划 | 已修复 |
| SR-49 | 断开后的binding若被重新激活或覆盖，历史快照引用可能被改指向新项目 | 活跃状态使用部分唯一约束；拒绝/断开记录保留，重新申请创建新binding ID | 数据/API、连接器契约、开发手册、测试 | 已修复 |
| SR-50 | 断开单个项目binding若同时吊销连接器凭证，会误伤同一GEO租户下其他项目 | 单项目断开只撤销该binding的访问映射与会话；连接器实例凭证仅由实例级吊销动作处理 | 数据/API、连接器契约 | 已修复 |

## 3. 统一后的核心口径

### 3.1 运行与采集

| 运行模式 | 执行目标 | 采集方式 | 默认证据 |
|---|---|---|---|
| `model_only` | `provider` | `provider_api` | `api_structured` |
| `search_api` | `provider` | `provider_api` | `api_structured` |
| `web_observed` | `consumer_surface` | `browser_assisted` 或 `manual_import` | 人工确认后为 `web_confirmed_capture` 或 `web_confirmed_manual` |
| `imported` | `external_dataset` | `manual_import` | `imported_declared`，默认排除 |

### 3.2 声明、可见行为与真实访问

| 要回答的问题 | 可用证据 | 可用结论 | 禁止结论 |
|---|---|---|---|
| AI声明应参考什么 | `nominated` 自述提名 | 指定上下文中的提名率和稳定度 | 内部抓取频率、真实权重 |
| API实际返回什么 | `candidate/cited + api_structured` | 候选曝光率、引用率和来源稳定度 | 消费端产品表现 |
| 消费端页面显示什么 | `cited + web_confirmed_*` | Web端可见引用率和页面来源集合 | 隐藏候选、内部检索过程 |
| 自有站点被哪些bot访问 | 已授权日志中的双重核验请求 | 已验证请求次数、页面覆盖和状态码 | 第三方全网爬取频率 |

## 4. 需求追踪结果

| 需求模块 | 产品与交互 | 指标 | 数据/API | 测试 | 实施任务 | 结论 |
|---|---|---|---|---|---|---|
| 搜索候选与最终引用 | PRD 7.2–7.4、9.2–9.4 | 指标文档 4 | `ai_source_events`、运行来源接口 | 3.2、4–8章 | P02–P09 | 闭环 |
| AI自述信源偏好 | PRD 7.7、9.7 | 指标文档 5 | `experiment_kind`、`nomination_context`、对照接口 | 3.4、8.4 | N01 | 闭环 |
| 消费端观察实验 | PRD 7.8、9.8 | 指标文档 6 | surface、任务、capture、确认和比较接口 | 3.5、8.5、9章 | W01–W03 | 闭环 |
| AI爬虫真实访问 | PRD 7.5、9.5–9.6 | 指标文档 7 | 日志任务、请求事实、身份快照 | 3.3、8.2、9–10章 | P12–P15 | 闭环 |
| 导出、删除和运维 | PRD 7.6 | 数据保留与质量标记 | 导出/删除覆盖新增实体 | 安全与产品验收 | P16 | 闭环 |
| 问天独立部署 | PRD 6、7.1A、9章 | 问天单一指标事实源 | scope、snapshot、usage、Outbox | 空库、升级、备份、断连 | M01–M04 | 闭环 |
| GEO连接器 | PRD 6、8.5、9.9 | GEO不重复计算指标 | connector、binding、ticket、sync API | SSO、同步、Webhook、故障隔离 | G01–G03 | 闭环 |

## 5. 自审后仍需外部决策的事项

以下不是内容冲突，不能由文档自审代替审批：

- 正式ADR是否接受，以及任务号和迁移序号；
- 首个Provider的账号能力、当期条款、允许保存字段、保留期、预算和地区；
- 首批消费端surface是否允许浏览器辅助采集，以及页面适配器维护责任人；
- 截图、脱敏DOM、回答和日志对象的最终保留期；
- 任何 `exact` 或 `approximate` 模型映射的证据与审批记录；
- 自有域名验证方式和首批日志模板；
- 问天首发部署编排、备份介质、域名和初始化秘密交付方式；
- GEO连接器首发范围、网络连通方式、签名算法和密钥轮换周期；
- GEO角色映射和问天会话失效时限。

不依赖上述决策的独立系统基础开发可以开始；涉及对应Provider、消费端surface、保留策略或GEO生产连接的功能，在决策完成前不得启用，也不得把候选Provider标为已批准。

## 6. 校验记录

- Markdown格式：问天项目16份Markdown通过Prettier检查。
- 基线完整性：13份核心批准文档的SHA-256与 `BASELINE.md` 清单一致；`BASELINE.md`自身按规则不参与自引用哈希。
- 冲突标记未发现；问天目录尚未初始化Git，因此未虚构 `git diff` 校验结果。
- 相对文档链接：问天项目16份Markdown通过本地链接存在性检查。
- 核心口径断言：运行模式、证据语义、问天独立运行、单一数据事实源、项目scope、不可变快照、一次性SSO、显式绑定、角色映射、异步Webhook、解绑保留、GEO故障隔离和分阶段发布等20类断言通过。
- 术语反查：未发现当前方案继续要求 `geo_embedded`、双Host Adapter、共享数据库、GEO内问天bootstrap、`usage_reconciliation_status` 或“消费端人工录入等于imported”的残留。
- 当前官方依据抽查：OpenAI Responses Web Search引用/来源字段、OpenAI爬虫分类与IP入口、Perplexity Sonar的citations/search_results及爬虫分类、Gemini Grounding技术能力与附加条款限制均于2026-08-21重新核对；生产启用时仍须再次复核。
- 冻结基线：未修改GEO Content OS仓库的 `docs/freeze-v2.1/`。

若后续任一核心枚举、MVP范围或证据规则变化，必须同时更新本目录全部受影响文档，并重新执行本报告第1节的横向追踪。
