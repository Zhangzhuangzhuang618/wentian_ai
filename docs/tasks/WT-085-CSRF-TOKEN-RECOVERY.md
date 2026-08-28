# WT-085 页面旧 CSRF 令牌自动恢复

> 状态：已完成  
> 日期：2026-08-28  
> 前置决策：[`DEC-WT060-001`](../decisions/DEC-WT060-001-LOCAL-SESSION-AND-SCOPE-ACCESS.md)

## 问题

页面只在首次载入时取得 CSRF 令牌。服务重启或实例会话密钥轮换后，数据库中的本地会话仍可读取，但旧页面继续携带先前令牌，首次创建实验运行等写操作会收到 `CSRF_TOKEN_INVALID`。

## 修复

- 写请求被服务端明确拒绝为 `CSRF_TOKEN_INVALID` 时，通过同源、带 HttpOnly 会话 Cookie 的会话接口重新取得 CSRF 令牌；
- 使用新令牌原样重试当前写请求一次；
- 刷新后仍失败时停止，不循环重试；
- 会话真实失效时仍返回 `LOCAL_SESSION_INVALID`，不绕过 Origin、Cookie 或 CSRF 校验。

## 验收

- [x] 旧 CSRF 写请求可以自动恢复；
- [x] 单次请求最多刷新和重试一次；
- [x] 新静态模块通过安全响应头提供；
- [x] `pnpm verify` 通过。
