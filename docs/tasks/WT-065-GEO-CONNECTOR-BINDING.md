# WT-065 GEO连接器实例与项目绑定

> 状态：已完成  
> 前置基线：[`wentian-geo-connector@1`](../baseline-CHG-VIS-002/10-GEO-CONNECTOR-CONTRACT.md)  
> 前置任务：[`WT-064`](./WT-064-SCOPE-DELETION.md)

## 目标

实现问天侧单GEO租户连接器实例，以及“GEO管理员申请、问天管理员审批”的项目绑定状态机。

## 实现范围

- 连接器实例、加密凭证与双密钥轮换；
- 签名请求、时间窗、nonce和幂等校验；
- 项目绑定申请、查询、批准、拒绝、撤回和断开；
- 问天本地管理接口与最小管理界面；
- 项目删除前显式撤销binding；
- 契约、迁移、接口和隔离测试。

## 完成标准

- [x] 一个问天实例最多一个active GEO租户连接；
- [x] 非active binding不能签发SSO或同步问题集；
- [x] 绑定不能按项目名称自动匹配；
- [x] 重放、错签名、错租户、错版本和重复项目失败关闭；
- [x] 解绑不删除问天项目或历史运行；
- [x] `pnpm verify`通过。

## 完成记录

- 完成日期：2026-08-23；
- 实现：连接器密钥加密与轮换、HMAC签名、时间窗、nonce、幂等、显式binding审批和断开；
- 真实演练：申请`pending_wentian`、问天批准`active`、GEO刷新和断开`disconnected`闭环通过，binding版本从1推进到3；
- 回归修复：签名Integration API不再拦截问天本地连接器管理路由；
- 验证：问天`pnpm verify`通过，373项测试全部通过。
