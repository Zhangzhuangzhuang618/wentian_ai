# WT-002 Scope与不可变问题集快照

> 状态：已完成  
> 批准来源：项目所有者要求按批准文档逐步落地WT-002及后续任务  
> 对应基线：`CHG-VIS-002`、`VIS-M02`

## 目标

建立问天本地项目Scope、服务端Principal授权、不可变问题集快照、稳定哈希和幂等Repository，为后续数据库迁移与运行创建提供唯一输入。

## 实现范围

- 固定六类问题意图和三级商业价值；
- Scope、项目角色与Principal可访问scope集合；
- 本地、GEO同步和外部导入三种快照来源元数据边界；
- 内容哈希、问题项哈希、自动external key和运行时冻结；
- 本地创建、列表与查询应用服务；
- 内存Repository验证 `scope_id + snapshot_hash` 幂等语义；
- snake_case Zod输入契约与跨scope统一未找到错误。

## 哈希口径

快照哈希包含标题、locale、market以及按顺序排列的问题正文、意图和商业价值；不包含数据库ID、external key、来源引用、来源修订和GEO binding。相同内容从本地或GEO同步时必须得到相同哈希。

## 迁移影响

无。本任务只冻结领域与Repository语义；PostgreSQL迁移在后续正式迁移任务中实现。

## 明确不做

- 不实现HTTP业务接口和OpenAPI；
- 不创建数据库表；
- 不接Provider或GEO网络；
- 不实现用户登录、UI或Worker。

## 验证

```bash
pnpm verify
```

## 完成标准

- [x] Scope列表只来自Principal授权集合；
- [x] 未授权scope统一返回未找到；
- [x] 归档scope不能创建新快照；
- [x] 相同scope和内容幂等复用；
- [x] 同内容本地/GEO来源哈希一致；
- [x] 快照和问题项不可修改；
- [x] 契约、类型、测试、格式和边界检查通过；
- [x] 批准基线哈希不变；
- [x] Git未初始化。

## 完成记录

- 完成日期：2026-08-21；
- `pnpm verify`通过，26项测试通过，0失败；
- 覆盖同scope幂等、跨scope隔离、不同scope同内容分离、归档scope拒绝写入和授权读取；
- 深度自审修复了Node轻量TypeScript执行兼容和外部DTO字段命名漂移；
- 13份批准基线SHA-256保持不变，20份Markdown的22个相对链接有效；
- 未创建数据库迁移、Provider连接、GEO连接或Git仓库。
