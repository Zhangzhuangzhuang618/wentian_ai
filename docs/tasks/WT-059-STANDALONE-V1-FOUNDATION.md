# WT-059 问天独立版第一版基础设施

> 状态：已完成（基础设施）  
> 前置决策：[`DEC-WT059-001`](../decisions/DEC-WT059-001-STANDALONE-V1-FOUNDATION.md)  
> 发布状态：独立部署基础，未接Provider、豆包生产自动化或GEO

## 目标

交付可由Docker Compose启动的PostgreSQL 16、S3兼容对象存储、迁移、API readiness和一次性本地Owner初始化基础。

## 实现范围

- `0001`迁移及带校验和、顺序和锁的迁移运行器；
- 本地用户、实例角色、会话、scope、scope成员和项目自动化默认设置表；
- 内置`scrypt`密码摘要与一次性Owner初始化事务；
- PostgreSQL和对象存储真实readiness；
- Dockerfile、Compose和无秘密的环境变量示例；
- 移除第一版readiness中的Redis/queue依赖。

## 明确不做

- 不创建Redis、BullMQ或独立Worker；
- 不实现GEO连接器、GEO SSO或共享Cookie；
- 不提供公开注册或默认Owner密码；
- 不在Compose中放置真实生产秘密；
- 不激活Provider或豆包生产自动化。

## 完成标准

- [x] 空PostgreSQL 16从`0001`迁移成功；
- [x] 重复迁移幂等，文件漂移失败关闭；
- [x] Owner只能成功初始化一次；
- [x] 本地密码不以明文保存且可验证；
- [x] readiness真实区分未配置、可用和不可用；
- [x] Compose不包含Redis或GEO；
- [x] `pnpm verify`和Docker Compose配置校验通过。

## 完成记录

- 完成日期：2026-08-23；
- 数据库：PostgreSQL 16，首个迁移为`migrations/0001_standalone_foundation.sql`；
- 对象存储：MinIO启动后由一次性任务创建`wentian-evidence`桶；
- 身份基础：本地用户、会话、scope成员、一次性Owner初始化及`scrypt`密码摘要；
- 部署演练：空卷启动、迁移、重复迁移、Owner首次/二次初始化、建桶和API readiness均已实测；
- 清理：演练专用容器、网络及合成数据卷已删除；
- 最终验证：`pnpm verify`通过，329项测试全部通过。

## 当前边界

WT-059完成时仅交付独立版基础设施。其后本地登录由[`WT-060`](./WT-060-LOCAL-ACCESS-AND-SCOPE-SETTINGS.md)交付，PostgreSQL/S3证据链路由[`WT-061`](./WT-061-CONSUMER-PERSISTENCE-AND-EVIDENCE-STORE.md)交付，独立工作台和对照由[`WT-062`](./WT-062-STANDALONE-ATTENDED-CONSUMER-WORKBENCH.md)交付，生命周期清理由[`WT-063`](./WT-063-CONSUMER-EVIDENCE-RETENTION.md)交付。生产Provider、豆包生产自动提问和GEO连接器仍不在第一版范围。
