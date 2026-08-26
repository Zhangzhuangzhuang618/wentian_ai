# WT-015 版本化来源键哈希

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、`ai_source_events.source_key_hash`  
> 哈希版本：`source-key-hash@1`

## 目标

实现服务端来源键纯函数：存在规范URL时优先基于URL生成`source_key_hash`；没有URL的domain-only提名基于规范可注册域名生成。哈希输入必须隔离键类型和归一化版本。

## 固定输入

SHA-256的UTF-8输入固定为以下JSON数组：

```text
[hash_version, key_type, normalization_version, normalized_value]
```

其中：

- `hash_version=source-key-hash@1`；
- `key_type=normalized_url | registrable_domain`；
- `normalization_version`来自归一化结果或domain-only事件；
- `normalized_value`为规范URL或规范可注册域名。

数组结构防止字段边界歧义。键类型和归一化版本进入哈希输入，避免URL键、域名键以及不同算法版本之间发生语义碰撞。

## URL优先规则

有URL时只接受WT-014的成功归一化结果。函数会重新执行无网络归一化并核对：

- 规范URL没有追踪参数或fragment回流；
- 可注册域名一致；
- 归一化版本一致。

调用方伪造的原始URL或被修改过的归一化对象失败关闭。

## Domain-only规则

没有完整URL时：

- 接受Unicode或ASCII域名并统一转为小写ASCII；
- 去除一个末尾根点；
- 必须正好是ICANN或PRIVATE规则下的可注册域名；
- 子域、未知后缀、IP和localhost不能作为domain-only来源键。

系统不会为补齐URL字段而伪造地址。

## 黄金测试

固定样本包括：

```text
normalized_url:
https://www.example.com/path?a=1&b=2
e21dca1862e47649d864fd2b85b3ae6c638d149664cb1fa0c6ee1c0f204439c7

registrable_domain:
example.com
b47c6be1b6914211da5a378825972b8117e367bdbba482986c74191023c963ed
```

另外覆盖：

- Unicode和ASCII域名生成相同键；
- 相同输入确定性；
- 归一化版本变化导致不同键；
- URL键与域名键不同；
- 未归一化URL、子域和未知后缀失败关闭。

## 明确不做

- 不允许客户端提交或覆盖`source_key_hash`；
- 不生成数据库ID或唯一约束；
- 不实现`url_hash`的未定义具体口径；
- 不抓取或验证来源URL；
- 不把SHA-256描述成加密、匿名化或真实性证明；
- 不接收真实观察包；
- 不修改批准基线。

## 完成标准

- [x] 有规范URL时优先使用URL键；
- [x] 无URL时允许规范domain-only键；
- [x] 键类型和归一化版本进入哈希输入；
- [x] SHA-256黄金值固定；
- [x] Unicode域名确定性覆盖；
- [x] 伪造规范URL和非可注册域名失败关闭；
- [x] 不新增domain第三方依赖；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 实现：`packages/infrastructure/src/source-key-hash.ts`；
- 测试：`packages/infrastructure/test/source-key-hash.test.ts`；
- 全量验证：125项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目43份Markdown中的71个相对链接有效，Git未初始化；
- 深度自审：规范URL会由WT-014重新校验，domain-only值必须正好是ICANN/PRIVATE可注册域名；哈希代码只存在于服务端infrastructure，没有进入客户端或正式HTTP路由；
- 语义复核：本任务没有定义`url_hash`，没有把哈希描述为匿名化、加密、来源真实性或抓取证明。

## 后续

消费端指标只读响应契约已转入[`WT-016`](./WT-016-CONSUMER-METRICS-READ-MODEL-CONTRACT.md)，把分子、分母、方法版本、证据警告和不可用原因固定为Zod Schema，且没有注册HTTP路由。
