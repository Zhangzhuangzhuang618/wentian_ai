# DEC-WT014-001 公共后缀解析范围

> 状态：已接受  
> 日期：2026-08-22  
> 适用任务：WT-014

## 决策

`url-normalization@1`使用锁定的`tldts@7.4.10`公共后缀数据，并同时启用PSL的ICANN和PRIVATE区。

## 原因

只使用ICANN区会把多个托管平台租户错误聚合到平台域名。例如：

```text
first.github.io  -> github.io
second.github.io -> github.io
```

启用PRIVATE区后，两者的可注册域名分别为`first.github.io`和`second.github.io`。这能避免把互不相关的网站错误统计成同一信源。

## 边界

- 解析库只在本地执行，不访问DNS、HTTP或远程公共后缀服务；
- 包版本和归一化版本同时记录；
- 更新公共后缀库或改变PRIVATE区策略时，必须评估是否发布新的归一化版本；
- 本决策不修改批准基线，只把“按公共后缀规则计算可注册域名”的实现范围明确化。
