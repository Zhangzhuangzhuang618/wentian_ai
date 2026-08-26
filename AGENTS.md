# 问天开发约束

- 开始任务前读取 `docs/baseline-CHG-VIS-002/README.md`、已接受ADR和当前任务卡。
- 批准基线只读；变更产品、指标、证据语义、隔离边界或连接器主版本必须新增ADR。
- 问天核心不得依赖GEO Content OS的数据库、Cookie、Repository、Router、队列或对象存储。
- Provider、消费端surface和GEO生产连接未获专项批准前，保持禁用且不得使用真实凭证。
- 使用 `pnpm verify` 作为任务最低验证入口。
- 不初始化Git；仓库由项目所有者后续创建。
