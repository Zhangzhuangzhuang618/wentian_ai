# WT-003 消费端观察领域与契约基础

> 状态：已完成  
> 批准来源：项目所有者于2026-08-21指示“优先消费端观察实验开发”  
> 对应基线：`CHG-VIS-002`、`VIS-W01`的无外部调用子集  
> 顺序变更：`CHG-SEQ-001`

## 目标

在不连接真实消费端网页、不创建数据库迁移的前提下，先冻结消费端Surface、观察任务、证据包、人工确认和安全白名单契约。

## 实现范围

- `web_observed`允许的浏览器辅助和现场人工录入方式；
- 不可覆盖的Surface能力版本及 `draft | active | suspended` 门禁；
- `exact | approximate | unknown` 模型等价语义和 `query_only`失败关闭；
- 观察任务状态机；
- `verification_status`与`evidence_grade`独立语义；
- capture token的实例、scope、任务、用户、有效期和一次性声明；
- 创建观察、提交观察包、确认和拒绝的snake_case Zod契约；
- 可见元数据白名单，拒绝Cookie、Token、账号标识和非HTTP(S)引用。

## 明确不做

- 不创建或启用任何具体消费端Surface配置；
- 不自动登录、自动发问、自动刷新、绕过验证或读取隐藏网络响应；
- 不实现截图上传、DOM存储、对象存储或浏览器扩展；
- 不创建运行、响应、来源事件或数据库迁移；
- 不把未经人工确认的观察纳入指标；
- 不实现API—消费端对照数值计算。

## 依赖拆分

本任务只实现原 `VIS-W01` 中不依赖外部Provider和持久化的领域/DTO基础。W01的数据库迁移、安全评审出口以及W02/W03仍需依赖共享信源契约、迁移基础和明确的消费端产品门禁。

## 验证

```bash
pnpm verify
```

## 完成标准

- [x] Surface未完成条款复核时不能active；
- [x] unknown模型映射不能携带API model ID；
- [x] exact映射必须有公开证据；
- [x] 模型未知或不匹配时强制query_only；
- [x] 观察任务不能绕过needs_review直接确认；
- [x] 只有confirmed的消费端证据进入默认指标；
- [x] capture token换实例、scope、任务、用户、origin、过期或重放均失败；
- [x] DTO拒绝敏感字段和非HTTP(S)引用；
- [x] 全量验证、批准基线哈希和文档链接通过；
- [x] Git未初始化。

## 完成记录

- 完成日期：2026-08-21；
- `pnpm verify`通过，40项测试通过，0失败；
- 增加Surface版本、等价映射、观察状态、证据资格和capture token纯领域约束；
- 增加Surface发布、创建观察、提交观察包、确认和拒绝的严格snake_case DTO；
- 深度自审补充了问天API origin绑定和Surface发布运行时Schema；
- 13份批准基线SHA-256保持不变，25份Markdown的30个相对链接有效；
- 未启用具体Surface，未连接外部网页，未创建迁移或Git仓库。
