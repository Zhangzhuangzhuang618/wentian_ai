# “问天”AI信源探测系统测试与验收方案

> 目标：验证问天可以完全独立运行，GEO连接器不破坏系统边界，同时保证证据可追溯、scope隔离安全、失败不伪装、UI不误导

## 1. 测试层级

| 层级 | 范围 | 是否调用真实外部API |
|---|---|---|
| 单元 | 归一化、指标、状态、错误映射 | 否 |
| 契约 | Zod/JSON Schema、Provider fixture、事件 | 否 |
| 连接器契约 | SSO、项目绑定、问题集同步、Webhook、断连 | 否 |
| 数据库 | 迁移、约束、复合外键、append-only | 否 |
| 集成 | API、Outbox、Worker、Repository | 使用stub server |
| E2E | 问天Web完整流程与GEO连接器入口流程 | 使用确定性stub |
| 部署 | 空环境安装、升级、备份恢复、健康检查 | 否 |
| 灰度 | 真实Provider最小调用 | 是，需单独授权和预算 |
| 安全 | scope隔离、Host Token、SSRF、CSV、日志隐私 | 否 |

## 2. 黄金数据集

建立固定fixture：

- 6个问题，覆盖六类意图；
- 每题3个样本；
- 4个域名、8个URL；
- 同URL包含utm、fragment、大小写和查询参数变体；
- 部分来源只进入candidate；
- 部分来源candidate后被cited；
- 1个样本超时、1个样本无候选能力、1个样本无引用；
- 1个国际化域名；
- 1个非HTTP URL，必须拒绝；
- 1个自有域名和1个竞品域名。
- 与自然回答配对的6题×3样本信源自述结果，覆盖 `unaided`、`search_assisted`、`surface_unknown`，并包含“提名与引用均高、仅提名高、仅引用高”三种数据分布；
- 1个仅有域名、没有URL的提名事件，用于验证 `source_key_hash`；
- 6个已确认消费端观察，覆盖 `web_confirmed_capture` 和 `web_confirmed_manual`；另有1个needs_review、1个rejected和1个 `imported_declared` 观察；
- 1个有公开模型等价证据的surface版本、1个经审批的近似映射和1个unknown映射；
- 1个声称掌握内部抓取频率的自述回答，必须标记但不得计入爬虫指标。

黄金数据必须手工计算预期引用率、引用份额、首位引用率、候选曝光率、转引用率和Jaccard稳定度。

同时手工计算提名率、首位提名率、提名—引用重合度@10、Web端可见引用率，以及exact/approximate条件下的API—消费端重合度；unknown映射必须得到query_only而不是重合数值。

内容完全相同的本地问题集快照与GEO同步快照必须得到相同snapshot hash；在相同运行配置和Provider fixture下，规范化事件、指标分子分母、可用性状态和证据等级必须一致。

## 3. 单元测试

### 3.1 URL归一化

- scheme和host大小写；
-默认端口；
- fragment删除；
- `utm_*`等版本化追踪参数删除；
- 业务查询参数保留并排序；
- 中文/国际化域名；
- 编码路径；
- 非HTTP(S)拒绝；
- 无效URL返回明确原因；
- 原始URL原样保留；
- 同一算法输入输出确定性。

### 3.2 指标

- 同一样本同域名多URL：引用率只计一次，引用份额按事件计；
- 失败样本不进入分母；
- 无candidate能力返回not_available；
- 空引用不是失败但计为未引用；
- 引用顺序缺失时首位引用率不可用；
- 两个空集合不计算Jaccard为1；
- baseline配置不一致时拒绝直接变化结论；
- 分子、分母与百分比一致。

### 3.3 爬虫验证

- UA+有效IP => verified；
- UA命中/IP不命中 => ua_only；
- IP命中/UA不命中 => unknown；
- 使用事件时间对应的identity snapshot；
- 每条已分类请求事实保存实际使用的identity_snapshot_id；
- 陈旧快照产生warning；
- IPv4/IPv6范围；
- 伪造UA不能进入默认指标。

### 3.4 信源自述

- 同一样本重复域名只计一次提名；
- 没有明确域名时不猜URL；
- 无明确顺序时首位提名率不可用；
- 自述事件只写 `nominated`；
- 内部抓取频率声明标记 `unsupported_internal_claim`；
- 配对运行配置不一致时返回not_comparable；
- Top-K不足时分母和有效集合大小正确。
- `model_only/search_api` 分别派生 `unaided/search_assisted`；`web_observed` 覆盖明确关闭、明确启用和未知三种页面搜索状态；
- 不同 `nomination_context` 默认不合并分子和分母。
- natural_answer的nomination_context保持为空；对照服务从运行快照派生有效上下文，不匹配时返回not_comparable。

### 3.5 消费端观察

- `verification_status` 与 `evidence_grade` 为两个独立字段；
- 失败响应的evidence_grade为空，成功响应只接受与运行模式匹配的状态—等级组合；
- `web_confirmed_capture` 和 `web_confirmed_manual` 分开统计；
- 消费端人工录入缺少当前页面截图或关键元数据时保持needs_review，不能写web_confirmed_manual；
- needs_review/rejected/imported_declared不进入默认分母；
- 页面无来源顺序语义时首位引用率不可用；
- 记忆、搜索模式或地区未知时保留unknown；
- surface模型映射为exact时返回exact重合度；
- 经审批的模型族映射返回approximate并带警告；
- 模型未知、无映射或页面显示模型与映射标签不一致时返回query_only，不计算模型一致性。

## 4. 契约测试

### 4.0 GEO连接器契约

连接器必须覆盖：

- 连接器实例active/suspended/revoked状态；
- GEO管理员发起绑定申请后只能进入pending_wentian，不能直接指定或枚举问天scope；
- 问天管理员选择本地项目并批准后才进入active；拒绝、撤回和重新绑定流程均有审计；
- 项目绑定不能按名称自动匹配，也不能由任一端单方直接创建active binding；
- 已拒绝/断开的binding保留，重新申请生成新ID且历史快照仍指向旧binding；
- pending_wentian/rejected/suspended/disconnected均不能签发SSO票据或同步问题集；
- 同一问天实例不能激活第二个GEO租户，跨租户项目、用户和同步请求均失败；
- SSO launch code校验签名、issuer、audience、nonce、60秒有效期和单次消费；
- 票据过期、重放、换用户、换项目、换连接器均失败；
- `/connect/geo` 不把launch code写入日志、Referer或第三方请求，消费后URL不再包含code；
- requestedPath只允许绑定项目内的问天相对路由，绝对URL和编码绕过被拒绝；
- GEO角色只按白名单映射，未知角色拒绝签发；
- 同一GEO用户在两个项目具有不同角色时，项目级访问映射、access version和实际权限互不串用；
- GEO来源会话受binding状态和硬过期限制，连接器吊销/解绑立即失效；
- 问题集同步经校验、排序和哈希后形成问天不可变快照，运行期间不回读GEO；
- GEO同步快照冻结连接器契约版本；连接器升级不改变历史运行的数据质量标记；
- Webhook签名、event ID幂等、有界重试和死信告警正确；
- Webhook callback只允许HTTPS白名单目标，不跟随重定向，内网/环回/链路本地地址被拒绝；
- 回调失败不回退问天运行终态；
- 断开连接撤销SSO和同步，但不删除问天项目或历史数据；
- 不兼容契约主版本失败关闭；
- GEO无法访问问天数据库、Redis、对象存储或Provider凭证。

### 4.1 Provider fixture

每个Adapter至少覆盖：

- 正常回答+候选+引用；
- 正常回答但无候选能力；
- 引用位置；
- 429 + Retry-After；
- timeout；
- 401/403；
- malformed response；
- 空回答；
- provider request ID和usage解析；
- 未知新增字段向前兼容；
- 敏感header不进入错误对象。

### 4.2 API Schema

- sample_count只能1–5；
- provider必须为published+enabled；
- location不接受精确坐标；
- estimate未知费用返回null；
- 指标数据可用性枚举完整；
- 列表接口不返回完整原始元数据；
- `experiment_kind` 只接受natural_answer/source_nomination；
- `retrieval_mode`、`execution_target_type` 与 `collection_method` 只接受固定组合；
- 消费端人工录入必须为 `web_observed + consumer_surface + manual_import`，历史外部数据集必须为 `imported + external_dataset + manual_import`；
- web_observed必须提供consumer surface快照；
- 创建消费端运行必须指定该surface版本允许的browser_assisted或manual_import；
- nomination_context由服务端派生，客户端提交时拒绝；
- source_nomination不能写candidate事件；
- capture接口拒绝Cookie、Token和非白名单元数据字段；
- 写接口缺Idempotency-Key失败；
- 生成OpenAPI与contracts一致；
- 问天只生成一个核心OpenAPI；连接器接口位于独立Integration API分组；
- scope只能从问天principal允许集合中选择，普通业务接口提交GEO组织/工作区/项目标识时拒绝；
- 创建运行必须引用模块不可变 `query_set_snapshot_id`。

## 5. 数据库测试

- 问天空库安装迁移成功；
- 从问天上一版本升级成功；GEO历史数据不自动回填；
- 问天schema不含指向GEO业务schema的外键；
- 所有核心业务实体带 `scope_id`，GEO外部标识只存在于连接器表；
- SSO ticket只保存code hash，原子消费并阻止重放；
- binding断开不级联删除scope、run、response或source event；
- 相同问题集快照哈希在同scope幂等复用，快照不可更新；
- 响应、来源事件和观察任务只引用模块 `query_snapshot_item_id`，不引用GEO问题表；
- 每个运行至多一个模块usage record；Outbox与业务写入同事务且payload不含敏感正文；
- response和source event不可UPDATE/DELETE；
- source event不能引用其他scope的response；
- query必须属于run的问题集；
- 同一业务样本不能重复；
- owned domain跨scope不可用于日志导入；
- 日志导入文件哈希幂等；
- 消费端任务跨scope不可领取或确认；
- capture artifact不可普通更新；同一任务至多一个artifact；
- 拒绝观察时暂存artifact和对象由scope范围隐私清除服务删除，确认后的正式response/source event不受影响；
- nomination parse review与response同scope且一对一，终态不能退回needs_review；
- 历史运行回填natural_answer，不推断source_nomination；
- 历史imported运行保持external_dataset，不自动变为web_observed；
- domain-only nominated事件允许url_hash为空但source_key_hash必填，且唯一约束可防止重复；
- source_position为空时，重复来源事件仍被NULLS NOT DISTINCT唯一约束拒绝；
- 关键查询使用预期索引。

## 6. Worker集成测试

- 重复Outbox事件不重复调用已完成样本；
- 技术重试复用同一sample_index；
- 3样本中1个失败，运行终态partial；
- 全部失败，运行failed且无伪造来源；
- Provider Adapter不存在时失败关闭；
- 预算耗尽停止后续调用并保留已完成样本；
- 取消后在途响应不得继续写为成功；
- 响应、来源和问天usage记录在同一事务；GEO回调在提交后异步发送；
- URL归一化单条失败不丢整份回答；
- 日志导入重放不重复事实。
- 自述运行和自然回答运行不会共用response；
- 自述解析不确定时进入人工复核，不伪造域名；
- needs_review提名不创建nominated事件；确认事务写事件，拒绝不写事件；
- 每个nominated事件的validation method为schema_validated或human_confirmed；
- 未确认消费端capture不创建正式response/source event；
- 重复capture提交不生成新样本；
- 页面适配器签名变化暂停surface并返回明确错误；
- 问天Outbox事件重复投递时GEO连接器按event ID幂等处理；
- GEO回调不可用时进入重试/死信，问天本地用量和运行结果不受影响；

## 7. API与权限测试

角色矩阵：

| 操作 | owner/admin | analyst | strategy_editor | viewer |
|---|---:|---:|---:|---:|
| 查看报告 | 是 | 是 | 是 | 是 |
| 创建运行 | 是 | 是 | 否 | 否 |
| 导入日志 | 是 | 是 | 否 | 否 |
| 从机会创建Brief | 是 | 是/按现有权限 | 是 | 否 |
| 配置Provider | 平台角色 | 平台角色 | 否 | 否 |

本地登录和GEO SSO最终都建立问天principal与项目成员关系。跨scope资源统一404；范围内无动作权限返回403。GEO传入角色不能绕过问天服务端授权；同一外部身份在不同项目的角色必须分别测试。

## 8. Web E2E

### 8.1 探测主流程

1. 直接登录问天并进入“联网信源”；
2. 选择问题集；
3. 选择1个Provider和3样本；
4. 看到正确调用量；
5. 启动后创建1个独立运行；
6. 页面轮询进度；
7. 部分失败仍显示报告；
8. 点击域名下钻到URL、问题、样本；
9. 展开回答看到引用位置；
10. 返回后筛选仍保留在URL。

P11可选增强另测：选择2个Provider时必须创建2个独立运行，任何失败不得覆盖另一Provider的结果。

### 8.1A GEO连接器入口流程

1. GEO管理员配置问天地址和连接器凭证；
2. GEO管理员发起申请，确认状态为“待问天管理员确认”且不能进入或同步；
3. 问天管理员选择本地项目并批准，binding进入active；
4. GEO同步问题集并看到问天snapshot ID与hash；
5. GEO用户点击“进入问天”；
6. GEO后端申请一次性launch code，浏览器跳转问天；
7. 问天消费code并建立HttpOnly会话；
8. 用户落到绑定项目，权限与角色映射一致；
9. 运行完成后问天向GEO发送签名Webhook；
10. GEO停止后，用户仍可用本地账号直接登录问天查看相同运行。

### 8.2 日志主流程

1. 选择已验证域名；
2. 上传fixture CSV；
3. 显示字段映射和预检；
4. 确认后异步导入；
5. verified和ua_only分开展示；
6. 默认趋势只包含verified；
7. 403/429状态可下钻；
8. 重复导入返回原任务或幂等冲突。

### 8.3 状态与可访问性

- loading/empty/error/permission/partial；
- 键盘完成创建运行和展开证据；
- 焦点顺序、可见焦点、抽屉焦点锁定；
- 图表有表格或文本替代；
- 移动端不横向溢出关键操作；
- 色彩不是唯一状态信号。

### 8.4 信源自述主流程

1. 选择自然回答对照运行；
2. 创建source_nomination运行；
3. 查看只读提示词版本；
4. 运行完成后查看提名排行榜；
5. 下钻到原始自述回答；
6. 查看提名—引用重合及独立分母；
7. unaided、search_assisted和surface_unknown有独立标签且不能默认合并；
8. 不可核验内部统计声明有明确警告。

### 8.5 消费端观察主流程

1. 创建web_observed运行；
2. 领取一个观察任务并获得短期token；
3. 用户在自己的已登录网页完成提问；
4. 主动采集当前可见回答、引用和截图；
5. 本地预览发现误采时不上传并重采；
6. 上传后进入平台确认页，确认后任务进入confirmed；拒绝则清除暂存证据并结束该样本；
7. 运行报告出现Web端可见引用；
8. 确认状态和证据等级分别显示；
9. API对照按exact、approximate或query_only显示，模型未知时不显示一致性结论；
10. 报告固定说明不代表隐藏搜索候选。

## 9. 安全测试

- 日志文件扩展名伪装；
- 压缩炸弹和超大行；
- CSV公式注入；
- 路径中的XSS字符串；
- URL中的内网IP、localhost和凭证片段不得触发fetch；
- 回答正文中的HTML按文本安全渲染；
- 日志、错误、trace和快照无API key/Cookie/Authorization；
- 原始对象签名URL仅当前scope可获取；
- capture token过期、重放、换用户、换任务均失败；
- 采集器不得读取Cookie、localStorage、Authorization和隐藏网络响应；
- 截图误含账号个人信息时可删除并重采；
- 恶意消费端页面不能向观察包注入额外host、scope或任务ID；
- GEO Cookie不能直接用于问天，问天session也不能用于GEO；
- 不同 `connector_instance_id` 下相同外部项目引用不能发生授权串扰；
- 删除/导出覆盖新数据；
- 限流不能通过并发或多Idempotency-Key轻易绕过。

## 10. 性能测试

- 100题×5样本的运行创建同步接口P95≤800ms；
- 来源排行榜在目标数据量下P95≤800ms；
- 500 MiB上限日志使用流式处理，内存峰值受控；
- 同scope并发上限生效；
- Provider 429时队列不会形成重试风暴；
- cursor分页无重复和遗漏。

## 11. 真实Provider灰度

灰度不进入自动CI，需要书面授权。每个Provider仅运行固定3题×1样本，验证：

- 真实模型ID；
- 引用和候选字段仍符合fixture；
- 费用记账；
- 请求ID；
- 条款允许字段没有超范围持久化；
- UI明确显示API产品名称。

灰度失败时Provider保持disabled，不能用mock通过代替生产能力。

## 12. 产品验收清单

- [ ] 三层指标命名没有混用。
- [ ] 每个比例显示分子、分母和样本警告。
- [ ] 来源排行榜可下钻到原始证据。
- [ ] 多Provider产生独立运行。
- [ ] 同一问题多样本真实执行且可追踪。
- [ ] API结果不标记为消费端产品。
- [ ] 未授权域名日志无法导入。
- [ ] UA-only不进入默认爬虫指标。
- [ ] 失败和部分成功语义正确。
- [ ] 成本、审计和scope隔离闭环完成。
- [ ] 不配置GEO连接器时，问天全部核心功能可用。
- [ ] 问天空库安装、初始化、升级、备份恢复均通过。
- [ ] 问天首期保持单组织、多项目边界，没有引入公共多租户SaaS能力。
- [ ] 问天核心表不依赖GEO业务表，运行只读取问天问题集快照。
- [ ] GEO连接器通过SSO、绑定、同步、Webhook和断连契约测试。
- [ ] GEO故障不影响问天核心readiness、运行和本地登录。
- [ ] 本地与GEO同步的等价快照产生相同核心指标。
- [ ] Provider条款评审有记录。
- [ ] 自述提名、API引用、消费端可见引用和爬虫访问使用四套明确标签。
- [ ] 信源自述无法被误读为真实抓取频率。
- [ ] 自述上下文分组明确，未启用搜索、搜索辅助和模式未知的数据不默认合并。
- [ ] 消费端观察未经人工确认不进入指标。
- [ ] 人工确认状态与证据等级分别存储、筛选和展示。
- [ ] API—消费端模型无法证明等价时仅做query_only对照。
- [ ] 浏览器辅助采集不接触账号凭证和隐藏页面数据。
- [ ] 完整MVP包含已授权站点日志导入、爬虫身份双重核验和趋势报告。
- [ ] 冻结文档未被静默修改。
