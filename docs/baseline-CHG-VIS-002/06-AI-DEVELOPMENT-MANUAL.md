# “问天”AI信源探测系统：AI友好开发手册

> 适用对象：参与本项目的AI开发代理和人工开发者  
> 状态：已批准开发基线。ADR已接受；具体实现仍须分配正式任务号

## 1. 项目任务定义

目标是实现完整独立部署的问天系统，并通过GEO薄连接器提供入口、一次性SSO、项目绑定、问题集同步和可选事件回传。问天是唯一运行、数据和指标事实源。

不得把该目标解释为：在GEO内运行问天核心、共享数据库或Cookie、复制问天页面、建设公共多租户SaaS、自动操作消费端AI网页、建立通用爬虫或修改内容发布主链路。

## 2. 每次会话必读顺序

开始任何实现前，按顺序完整读取：

1. 项目根目录的AI/开发代理指令文件（仅在实际存在时读取）；
2. `/docs/baseline-CHG-VIS-002/README.md`；
3. `/docs/baseline-CHG-VIS-002/ADR-CHG-VIS-002.md`；
4. `/docs/baseline-CHG-VIS-002/01-PRD-AND-UX.md`；
5. 与任务相关的本基线技术、数据、合规和测试文档；
6. `/docs/baseline-CHG-VIS-002/09-STANDALONE-DEPLOYMENT.md`；
7. 涉及GEO时读取 `/docs/baseline-CHG-VIS-002/10-GEO-CONNECTOR-CONTRACT.md`，以及GEO仓库的连接器说明；
8. 任务对应的后续ADR、正式任务卡、contracts、迁移、生成OpenAPI和实现文件。

如果正式任务卡尚不存在，停止编码，只能继续拆分任务或报告缺口。不得假定原GEO仓库中的 `CLAUDE.md`、`PROJECT_CONTEXT.md` 或内部代码是问天事实源。

## 3. 事实源优先级

实现期间发生冲突时，按以下顺序判断：

```text
accepted ADR and approved baseline
> approved task card
> canonical contracts
> database migrations
> generated OpenAPI
> tests and implementation
> current UI assumptions
```

本目录是批准时点的只读基线。后续ADR可以显式变更它；任务卡、contracts、迁移和OpenAPI不得静默偏离它。发现冲突时列出具体字段、文件和影响范围，停止冲突部分，禁止自行选择或反向修改基线。

## 4. 不变量

以下规则必须写入契约、实现和测试：

1. `model_only`、`search_api`、`web_observed`、`imported` 不混算。
2. 一个运行只对应一个提供商、一个模型快照、一个问题集版本和一套搜索配置。
3. 搜索候选和最终引用是不同事件角色。
4. 没有候选数据时返回不可测，不返回0。
5. 爬虫频率只从授权站点日志计算。
6. AI爬虫默认验证要求UA与官方IP双重匹配。
7. 原始响应、问题和来源事件只追加，不覆盖。
8. URL归一化保留原始URL并带算法版本。
9. API搜索结果不标记为消费端产品结果。
10. Provider API密钥不得进入数据库、前端、日志、Prompt、测试快照或文档示例。
11. 不主动fetch第三方引用URL。
12. 外部请求未知时不伪造成功，不盲目重复产生新样本。
13. 业务写入必须使用服务端 `WentianPrincipal + scope_id`；客户端不能建立scope归属。
14. 运行创建、问天用量预留记录和问天Outbox写入同一事务；GEO回调只能在事务提交后异步发送。
15. Redis不是不可恢复事实源。
16. `natural_answer` 与 `source_nomination` 使用独立运行和独立指标。
17. 自述提名只能写为 `nominated`，不能转成 `candidate` 或 `cited`。
18. `web_observed` 只表示消费端页面可见证据，不表示隐藏搜索候选。
19. 消费端观察只有人工确认后才能进入默认指标。
20. 浏览器辅助采集不得读取账号凭证、Cookie、Token、隐藏网络响应或非当前可见内容。
21. `web_observed + manual_import` 表示人工录入的消费端现场观察；`imported + manual_import` 只表示历史或外部数据集，两者不得互换。
22. `verification_status` 与 `evidence_grade` 是两个字段，禁止合并为一个状态枚举。
23. `unaided`、`search_assisted`、`surface_unknown` 三种自述上下文不得混合统计。
24. `source_key_hash` 对所有来源事件必填；有URL时基于规范URL，无URL提名时基于规范域名，客户端不得生成。
25. API—消费端模型等价缺少公开证据时必须返回 `query_only`，不得从页面名称猜API model ID。
26. 问天只有一个Web、API、Worker和数据库迁移入口，不实现GEO内嵌bootstrap。
27. 问天domain/application禁止导入GEO Repository、Router、权限Store或数据库模型。
28. 核心表只使用问天项目 `scope_id`；GEO租户/工作区/项目只出现在连接器表。
29. 运行只读取问天不可变问题集快照，不在执行中回读GEO问题集。
30. GEO连接器故障只能影响SSO、同步和回调，不能改变指标算法、证据语义或运行终态。
31. 核心响应、来源事件和观察任务只引用问天 `query_snapshot_item_id`，不得引用GEO问题表。
32. GEO侧不得复制问天runs、responses、source events、usage或Outbox表。
33. GEO解绑或项目删除不得静默删除问天项目和历史数据。
34. 问天MVP实例只能激活一个GEO租户连接；不得以多个项目代替租户隔离。
35. GEO全局身份映射不保存项目角色；角色、访问版本和撤销状态必须按project binding隔离。
36. 已拒绝或断开的binding记录不得复用或覆盖；重新绑定使用新ID，保证历史快照引用稳定。

## 5. 目录与职责

建议文件边界：

```text
apps/
  api/
  web/
  worker/

packages/
  domain/
  application/
  contracts/
  infrastructure/
  geo-connector-contracts/
  adapters/
    search-probe-openai/
    search-probe-perplexity/

GEO Content OS repository              navigation/status UI + backend client only
```

问天代码只写入问天项目目录；GEO连接器代码只写入GEO Content OS仓库。只有正式任务可以创建实际目录或package，不要提前创建空目录和占位包。

## 6. 契约优先开发顺序

每个正式任务遵循：

1. 明确输入、输出、枚举、错误码和不变量；
2. 更新 `packages/contracts` 和契约测试；
3. 编写增量迁移和迁移测试；
4. 实现Repository和Service；
5. 实现Worker与Adapter；
6. 生成并验证OpenAPI；
7. 实现Web页面；
8. 补充集成、E2E、安全和可访问性测试；
9. 更新任务状态、ADR实施说明和运行手册。

不要先写UI假数据再反向定义契约。

## 7. Provider Adapter 规则

### 7.1 必须做

- 使用官方SDK或稳定HTTP API；
- 保存真实 `provider_model_id`，不只保存逻辑别名；
- 读取结构化citation/search results字段；
- 使用明确timeout和AbortSignal；
- 解析Retry-After并执行有界重试；
- 对响应执行运行时Schema校验；
- 返回用量、请求ID和能力缺失信息；
- provider fixture做契约测试，fixture必须脱敏。

### 7.2 禁止做

- 从回答文本用正则猜全部引用，除非提供商没有结构化字段且该模式被明确标记为人工导入；
- 要求模型自行生成URL替代结构化引用；
- 记录Authorization header；
- 自动切换到另一个模型或提供商掩盖失败；
- 把没有候选列表解析为候选为空；
- 把redirect URL擅自替换为最终页面，除非提供商明确返回该信息。

## 8. URL归一化实现规则

实现为无副作用纯函数并使用固定fixture测试。输入任何值时：

- 非HTTP(S)返回结构化拒绝原因；
- 不执行DNS、HTTP请求或页面解析；
- 不吞掉未知查询参数；
- 追踪参数清单版本化；
- 保留原始URL；
- 公共后缀库版本固定；
- 不把不同业务路径合并；
- 失败事件仍保留脱敏诊断，不能导致整次运行失败。

## 9. 日志解析规则

- 流式处理；
- 文件类型和字段白名单；
- 时间必须可解析为UTC并保留源时区信息；
- 域名必须属于已验证owned_domain；
- UA不能单独作为verified依据；
- IP范围核验使用抓取时的identity snapshot；
- 导入重放不得重复写请求事实；
- 原始行不进入应用日志；
- CSV导出防公式注入；
- 超出规模限制明确失败，不尝试无限内存处理。

### 9.1 信源自述实现规则

- `experiment_kind` 必须进入运行契约和不可变快照；
- `nomination_context` 必须由retrieval mode和消费端搜索模式确定，不接受客户端任意伪造；
- 自述提示词必须版本化，并明确要求不能声称内部抓取频率；
- 结构化输出最多10个域名、明确顺序、信息类型和理由；
- 没有明确域名时不得根据机构名称猜URL；
- API结构化输出使用Schema校验；消费端文本先确定性解析，再人工确认；
- 不确定提取只写nomination parse review；确认后才创建nominated事件，拒绝不得留下正式来源事件；
- `unsupported_internal_claim` 只标记不可核验声明，不修改原始回答；
- 提名—引用比较必须验证两次运行的可比条件。
- `model_only + source_nomination` 标记为 `unaided`；`search_api + source_nomination` 标记为 `search_assisted`；`web_observed` 在页面明确关闭/启用搜索时分别标记为 `unaided/search_assisted`，无法确认时为 `surface_unknown`。

### 9.2 消费端观察实现规则

- MVP只实现 `browser_assisted` 和 `manual_import`；
- 不实现自动登录、自动批量发送、验证码处理或无人值守运行；
- capture token短期、一次性，绑定system instance、scope、user和observation task，只提交到问天API；
- 采集器使用字段白名单，禁止读取Cookie、Storage、Authorization和隐藏XHR/fetch响应；
- 页面适配器签名不匹配立即停止，不做宽泛DOM猜测；
- 观察包包含回答哈希、引用、截图哈希、适配器版本和白名单会话条件；
- 采集器必须在上传前本地预览；用户丢弃的误采内容不得上传；
- 用户确认前状态为 `needs_review`，不得创建正式response/source event；
- 确认后写不可变response和`cited`事件，并按采集方式写 `web_confirmed_capture` 或 `web_confirmed_manual`；拒绝只写原因和审计；
- 拒绝已上传观察包时必须调用scope范围隐私清除服务删除暂存artifact和对象，不能删除已确认的正式response/source event；
- 截图与DOM片段私有保存并执行脱敏和保留期。

## 10. 数据库规则

- 问天迁移使用独立序列和schema版本；
- 不修改0038或其他GEO历史迁移；
- 所有核心业务表带 `scope_id`，并引用问天项目scope；
- 不建立指向GEO业务表的外键；GEO外部引用只存在于连接器表；
- 问天迁移必须通过空库安装和逐版本升级测试；
- GEO连接器迁移只能创建GEO侧连接配置和状态表，不能复制问天核心事实；
- 不可变表使用数据库触发器阻止UPDATE/DELETE；
- 问天usage record和Outbox必须有明确关系表，不得只存在于Redis或GEO账本；
- 常用筛选建立与查询顺序一致的索引；
- JSONB只保存提供商异构元数据或版本化快照，核心可查询维度进入关系字段；
- 历史数据迁移不得从旧 `citations_json` 猜测candidate角色。
- 历史运行默认 `experiment_kind=natural_answer`，不得从回答文本推断为自述实验。
- `web_observed` 必须新增明确枚举，不能用 `imported` 掩盖浏览器辅助采集来源。
- imported历史数据不得批量回填为web_observed；只有具备明确surface、会话条件和确认记录的新观察才能使用web_observed。
- `ai_source_events.url_hash` 对domain-only提名允许为空，`source_key_hash` 必填且唯一约束使用后者。
- 来源事件唯一约束必须使用PostgreSQL `NULLS NOT DISTINCT` 或等价表达式索引，不能让空source_position绕过去重。

## 11. API规则

- Base `/api/v1`、UTC、cursor分页、Zod DTO、OpenAPI 3.1；
- 写操作CSRF + Idempotency-Key；
- 可变资源使用version乐观锁；
- 404统一隐藏跨scope资源；
- 指标响应必须返回分子、分母、方法版本和数据可用性；
- `null/not_available` 与0严格区分；
- 原始回答默认不在列表接口返回；
- URL查询参数避免在错误消息中回显。
- 消费端采集接口必须验证一次性token、任务version、用户确认和幂等键。
- 自述对照接口不满足可比条件时返回 `not_comparable`，不勉强计算。
- API—消费端比较必须返回 `comparison_tier=exact|approximate|query_only` 和映射证据版本；映射unknown、页面显示模型unknown或标签不匹配时只能使用query_only展示。
- 问天只生成一个业务OpenAPI；GEO连接器端点使用隔离的认证中间件和契约分组。

## 12. UI规则

- 页面筛选写入URL；
- 模型记忆、联网信源、爬虫日志使用独立标签和颜色语义；
- 信源自述和消费端观察使用独立标签，不能与实际API引用合成一个“真实偏好”分数；
- 不使用“权重、官方排名、全网频率”等不可验证文案；
- 样本不足警告不得被关闭后永久隐藏；
- 指标提供文本替代和分子分母；
- 所有页面实现loading/empty/error/permission/partial/mobile/keyboard；
- 不在前端计算权威指标，前端只格式化服务端结果。
- 消费端采集预览必须允许用户拒绝或重采，不能自动确认。
- 完整业务UI只存在于问天Web，不得复制到GEO或通过iframe嵌入。
- GEO只实现连接状态、项目绑定、同步状态和“进入问天”入口页。
- SSO完成后由问天第一方会话和权限控制UI；不得共享GEO Cookie或前端权限对象。

## 13. 测试优先级

最低测试集合：

```text
契约Schema测试
迁移与数据库约束测试
URL归一化表驱动测试
Provider fixture契约测试
Worker幂等和部分成功测试
scope隔离测试
问天空库安装、初始化、升级、备份和恢复测试
GEO连接器SSO、绑定、同步和Webhook契约测试
问天与GEO数据库/队列/会话边界测试
GEO断连时问天核心可用性测试
日志身份验证测试
信源自述解析与提名—引用对照测试
消费端capture token、页面签名、人工确认和隐私测试
指标黄金样本测试
API契约测试
Web交互与可访问性测试
E2E：问题集 -> 运行 -> 来源下钻
E2E：日志预检 -> 导入 -> 趋势
E2E：信源自述 -> 提名排行榜 -> 自述/引用对照
E2E：消费端任务 -> 浏览器辅助采集 -> 确认 -> 可见引用报告
```

外部Provider真实调用只用于受控灰度，不进入普通CI。

## 14. 禁止的捷径

- 空函数、恒真校验或假数据通过验收；
- 用模型二次分析替代可确定计算的指标；
- 用一个JSON大字段代替全部来源关系；
- 在Service里直接投BullMQ绕过Outbox；
- 把Provider 429重试成无限循环；
- 为未来可能接入的十几个平台先建抽象工厂；
- 顺带重构现有AI可见度页面或评分；
- 修改冻结DOCX以匹配实现。
- 用模型自述结果填充实际引用率或爬虫频率。
- 为提高完成率而读取隐藏网络请求、Cookie或Token。
- 页面签名变化后继续用模糊选择器自动点击或采集。
- 在GEO中复制问天core、migration、Worker或完整UI。
- 在问天核心包中直接导入GEO Repository、权限Store、Router或身份实现。
- 让GEO连接器直连问天数据库、Redis、对象存储或Provider凭证。
- 用GEO回调成功与否改变问天运行终态或指标。

## 15. 单任务工作模板

开始任务时输出：

```text
任务ID：
目标：
依赖：
文件范围：
契约影响：
迁移影响：
安全/条款影响：
问天独立部署影响：
GEO连接器契约影响：
验证命令：
明确不做：
```

结束任务时输出：

```text
完成内容：
修改文件：
契约/迁移/OpenAPI同步情况：
测试结果：
验收标准映射：
已知限制：
下一已解锁任务：
```

## 16. Definition of Done

一个任务只有同时满足以下条件才能完成：

- 任务范围内功能真实可运行；
- contracts、迁移、OpenAPI和实现无漂移；
- 相关单元、集成、契约和安全测试通过；
- scope隔离和幂等测试通过；
- 问天不连接GEO时核心功能完整可用；涉及连接器时，SSO、绑定、同步、签名、幂等和断连测试通过；
- 错误和部分成功有可用UI；
- 新指标与方法文档一致；
- Provider条款门禁未被绕过；
- 没有密钥、原始IP、Cookie或敏感日志进入仓库；
- 运行和用量可审计；
- 未修改冻结文档；
- 已报告未完成项，未把缺口伪装为成功。
