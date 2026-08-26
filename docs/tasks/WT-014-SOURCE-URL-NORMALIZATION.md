# WT-014 版本化来源URL归一化

> 状态：已完成  
> 批准来源：项目所有者授权持续推进当前可执行工作  
> 对应基线：`CHG-VIS-002`、`VIS-P04`URL归一化子集  
> 归一化版本：`url-normalization@1`  
> 追踪参数策略：`url-tracking-parameters@1`

## 目标

实现无网络、无副作用的来源URL归一化服务，为消费端观察指标及后续来源事件提供确定性的`normalizedUrl`、`host`和`registrableDomain`。

## 实现范围

- 只接受HTTP和HTTPS；
- scheme和host标准化为小写；
- 国际化域名转换为ASCII；
- 删除默认端口和fragment；
- 删除`utm_*`、`gclid`和`fbclid`；
- 未知查询参数、重复参数值和业务参数全部保留，只按键排序；
- 不主动删除尾斜杠，不合并不同业务路径；
- 使用固定版本公共后缀库计算可注册域名；
- 返回归一化版本、公共后缀库版本和追踪参数策略版本；
- 对所有输入返回成功结果或结构化拒绝原因。

## 依赖位置

公共后缀库位于`packages/infrastructure`，不放入零第三方依赖的`packages/domain`。领域指标仍只消费已归一化的可注册域名，现有依赖方向没有放宽。

依赖固定为：

```text
tldts@7.4.10
```

根据[`DEC-WT014-001`](../decisions/DEC-WT014-001-PUBLIC-SUFFIX-SCOPE.md)，解析同时使用PSL的ICANN和PRIVATE区，避免合并不同托管平台租户。

## 成功结果

成功结果包含：

- 原始URL原样副本；
- 归一化URL；
- 小写ASCII host；
- 可注册域名；
- 三个版本标识；
- 本次删除的追踪参数名称。

原始URL不会被归一化值覆盖。

## 失败结果

拒绝原因包括：

- 非字符串或空输入；
- 无效URL；
- 非HTTP(S)协议；
- URL内含用户名或密码；
- 缺少host；
- IP、localhost、未知后缀或仅公共后缀等无法从ICANN/PRIVATE规则得到可注册域名的地址。

失败结果不回显原始字符串，避免无效输入或URL凭据进入日志和诊断对象。该服务不执行DNS、HTTP请求、redirect解析、canonical抓取或页面访问。

## 固定测试

- scheme和host大小写；
- 默认端口；
- fragment删除；
- 追踪参数删除；
- 未知业务参数、重复值保留和按键排序；
- 中文域名和编码路径；
- PRIVATE公共后缀租户隔离；
- 业务路径和尾斜杠不合并；
- 非HTTP、无效URL、凭据、IP和localhost拒绝；
- 相同输入输出确定性；
- 包清单版本与代码报告版本一致。

## 明确不做

- 不抓取URL或跟随重定向；
- 不验证网页真实性、canonical或内容；
- 不删除未知查询参数；
- 不把IP或localhost伪装成可注册域名；
- 不生成来源事件或哈希；
- 不接收真实观察包；
- 不修改批准基线。

## 完成标准

- [x] 八条基线实现规则全部覆盖；
- [x] 公共后缀依赖和追踪参数策略版本固定；
- [x] PRIVATE后缀范围形成明确决策；
- [x] 成功结果保留原始URL；
- [x] 失败结果不泄露原始凭据；
- [x] 未知业务参数和路径不会误删或合并；
- [x] 国际化域名和多级公共后缀测试通过；
- [x] 归一化不进入domain依赖边界；
- [x] 全量验证、基线哈希、文档链接和Git状态复核通过。

## 完成记录

- 完成日期：2026-08-22；
- 实现：`packages/infrastructure/src/source-url-normalization.ts`；
- 测试：`packages/infrastructure/test/source-url-normalization.test.ts`；
- 全量验证：121项测试通过，类型、架构边界、OpenAPI一致性和格式检查通过；
- 依赖复核：`tldts@7.4.10`只存在于infrastructure，domain保持零第三方依赖；安装版本与包清单一致，许可证为MIT；
- 完整性复核：批准基线13个受保护文件哈希未变化，项目42份Markdown中的68个相对链接有效，Git未初始化；
- 深度自审修复：公共后缀结果必须明确属于ICANN或PRIVATE区，未知后缀不再被误判为可注册域名；失败结果继续不回显潜在敏感原始输入。

## 后续

来源键哈希纯函数已转入[`WT-015`](./WT-015-SOURCE-KEY-HASH.md)，把键类型、归一化版本和规范值一同纳入哈希输入，避免URL键与仅域名键碰撞。
