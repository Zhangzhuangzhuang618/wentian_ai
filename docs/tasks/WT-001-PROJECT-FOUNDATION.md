# WT-001 问天独立项目基础

> 状态：已完成  
> 批准来源：项目所有者于2026-08-21指示“如无问题开始开发”  
> 对应基线：`CHG-VIS-002`、`VIS-M01`

## 目标

建立可安装、可类型检查、可测试的问天独立工程基础，并用真实健康检查和边界测试证明它不依赖GEO。

## 文件范围

- 根目录开发约束、workspace、TypeScript和格式配置；
- `packages/domain`：批准运行模式组合的纯领域约束；
- `packages/contracts`：健康检查的运行时Schema；
- `apps/api`：liveness/readiness最小HTTP入口；
- `scripts/check-boundaries.mjs`：核心包依赖边界校验。

## 契约影响

- 新增内部开发契约 `wentian-core@0`；
- 不发布业务OpenAPI，不冻结外部API；
- 不改变 `wentian-geo-connector@1`。

## 迁移影响

无。不得创建数据库迁移或占用迁移序号。

## 安全与边界

- 不读取或写入任何GEO基础设施；
- 不接入Provider，不创建密钥或 `.env`；
- readiness在数据库、队列和对象存储未配置时必须返回503；
- 边界检查禁止核心源码导入GEO相关包。

## 验证命令

```bash
pnpm install
pnpm verify
```

## 明确不做

- Web页面、Worker、数据库、登录和项目管理；
- Provider Adapter；
- GEO连接器实现；
- 生产部署。

## 完成标准

- [x] 依赖安装成功；
- [x] TypeScript检查通过；
- [x] 领域、契约和API测试通过；
- [x] 边界检查通过；
- [x] 格式检查通过；
- [x] Git未初始化。

## 完成记录

- 完成日期：2026-08-21；
- `pnpm verify`通过；
- 9项测试通过，0失败；
- readiness在依赖未配置时返回503，未伪造生产可用状态；
- 批准基线被开发格式器排除，13份SHA-256保持不变。
