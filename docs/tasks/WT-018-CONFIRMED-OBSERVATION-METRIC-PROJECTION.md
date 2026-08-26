# WT-018 已确认消费端观察指标投影

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、消费端确认工作流与`VIS-W03`指标基础  
> 发布状态：内部纯投影，无HTTP路由

## 目标

把自然回答消费端运行、已确认任务、采集证据、确认响应和Surface版本投影为WT-013可计算的指标样本。投影只读取指标所需白名单字段，不携带回答正文、截图、DOM或账号数据。

## 资格与绑定

只有同时满足以下条件的记录才能投影：

- 任务处于`confirmed`终态，且采集、确认ID和时间完整；
- 运行必须为`natural_answer`，且与任务的scope、run、Surface版本和采集方式一致；
- artifact可见会话条件必须与运行冻结条件逐项一致；
- artifact与任务的scope、任务ID、采集人和采集方式一致；
- response与任务的确认响应ID、scope、run、问题、样本序号和artifact一致；
- Surface版本ID与任务一致；
- artifact的Adapter版本与Surface版本一致；
- 任务采集方式在该Surface版本允许清单内。

证据等级不接受调用方输入，而是由任务采集方式确定性派生：

- `browser_assisted -> web_confirmed_capture`；
- `manual_import -> web_confirmed_manual`。

## 引用投影

- 每个可见URL使用WT-014无网络归一化；
- 归一化失败时整条投影失败关闭，不跳过坏引用；
- 指标样本只保留可注册域名和可见位置；
- 同一可注册域名有多个URL时只保留最早位置；
- 非正整数位置、重复位置和非空列表缺少首位`1`均被拒绝；
- 输出按位置、域名确定性排序；
- `sourceOrderAvailable`固定为`true`，因为该投影只接受带明确位置的正式可见引用记录。

`source_key_hash`不属于WT-013指标样本字段，本任务不计算没有下游用途的哈希。

## 会话配置

指标分组配置来自不可变Surface版本和已确认的可见元数据：

- `surfaceCode`来自Surface版本；
- 页面显示模型、搜索模式、新会话、登录、记忆、个性化、语言和地区来自artifact可见元数据；
- 不从缺失值推断默认值。

## 测试

- 已确认浏览器采集投影后可直接进入WT-013计算；
- 同域名多URL按最早位置去重；
- 人工导入证据等级正确派生；
- 未确认任务被拒绝；
- 自述运行和会话条件漂移被拒绝；
- run、artifact、response或Surface绑定不一致时失败关闭；
- 不可归一化URL、非法位置、重复位置和缺少首位被拒绝。

## 明确不做

- 不保存或读取真实观察数据；
- 不实现数据库投影表或生产Repository；
- 不校验样本所属的问题集快照，批次装配阶段另行处理；
- 不计算`source_key_hash`或`url_hash`；
- 不新增API、OpenAPI路径或Worker；
- 不激活豆包Adapter或任何Surface；
- 不修改批准基线。

## 完成标准

- [x] 仅确认终态可投影；
- [x] 四类记录绑定完整复核；
- [x] 证据等级服务端派生；
- [x] WT-014 URL归一化复用；
- [x] 域名按最早位置去重；
- [x] 引用位置歧义失败关闭；
- [x] 会话配置不填默认值；
- [x] 输出可直接进入WT-013计算；
- [x] 无真实数据、正式路由或生产启用；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 实现：`packages/infrastructure/src/confirmed-consumer-observation-metric-projection.ts`；
- 测试：`packages/infrastructure/test/confirmed-consumer-observation-metric-projection.test.ts`；
- 全量验证：141项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目46份Markdown中的80个相对链接有效，Git未初始化；
- 发布边界复核：投影未注册到API、OpenAPI或Worker，未接真实Repository；
- 深度自审修复：增加引用位置唯一性和首位完整性校验，防止含糊的首位引用进入指标；增加运行类型和冻结会话条件复核，防止自述样本误入自然回答引用率或同一运行混入不同配置；所有跨记录身份字段在投影前复核。

## 后续

批次装配预审发现必须先建立完整运行与任务全集，已转入[`WT-019`](./WT-019-CONSUMER-OBSERVATION-RUN.md)。WT-018也已增加运行实验类型和冻结会话条件门禁；指标批次将在运行应用服务完成后装配。
