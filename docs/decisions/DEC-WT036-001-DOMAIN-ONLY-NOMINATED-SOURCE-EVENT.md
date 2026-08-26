# DEC-WT036-001 Domain-only nominated来源事件

> 状态：已接受  
> 日期：2026-08-22  
> 适用范围：AI信源自述的正式`nominated`来源事件与服务端投影  
> 批准依据：`CHG-VIS-002`的domain-only提名、来源键和验证方式要求

## 背景

信源自述提示词要求模型列出公开域名，而不是要求其提供具体URL。为了复用通用来源事实，一种错误实现是把域名拼成猜测URL；另一种错误实现是让客户端提交来源键哈希。两者都会制造不存在的证据或破坏来源身份一致性。

## 决策

- domain-only提名创建`role=nominated`的不可变来源事件；
- `original_url`、`normalized_url`和`url_hash`固定为空，不把域名补成URL；
- `registrable_domain`先用锁定的公共后缀规则规范化；`host`等于规范化可注册域名；
- `source_key_hash`只由服务端按`registrable_domain + normalization_version`派生；
- `nomination_validation_method`只接受`schema_validated | human_confirmed`；
- 信息类型与理由是可选白名单文本，不保存回答正文、Cookie或凭证；
- 明确顺序必须为从1开始的连续唯一序列；顺序未知时全部位置为空；
- 同一域名可在明确不同位置重复出现；无顺序时同一域名重复会造成不可区分事件，因此失败关闭；
- 领域完整性只验证事件结构，来源键派生一致性由基础设施投影层复核。

## 影响

- 自述域名可以进入统一来源事实，但不会伪装成可访问URL；
- 来源键与WT-015使用同一版本化算法；
- 解析待复核或被拒绝的结果不能创建正式事件；
- 后续Repository可使用基线建议的`scope + response + role + source_key + position`唯一身份；
- 当前任务不建立parse review确认事务或生产持久化。

## 排除方案

- 自动拼接`https://<domain>`：模型没有提名该URL；
- 客户端提交哈希：无法证明使用当前规范化和键版本；
- 把自述域名写成`cited`：会混淆声明偏好与实际引用；
- 用领域结构校验宣称哈希已正确派生：领域层不依赖公共后缀和来源键基础设施。
