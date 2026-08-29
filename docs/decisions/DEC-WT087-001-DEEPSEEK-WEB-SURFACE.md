# DEC-WT087-001 DeepSeek Web 消费端观察 Surface

> 状态：已接受
> 日期：2026-08-29
> 适用范围：消费端观察运行、浏览器扩展、自动化预检、证据复核与信源统计

## 背景

问天已经分别注册豆包和千问 Web Surface。DeepSeek 的正式网页入口、页面路径、产品标签和自动化授权配置均与现有平台不同，不能把 DeepSeek 回答复用为豆包或千问证据，否则会造成观察对象和证据归属错误。

## 决策

- 新增独立 Surface `deepseek_web`，产品标签为“DeepSeek 网页版”，允许`browser_assisted`和`manual_import`；
- 页面只允许`https://chat.deepseek.com`根路径及`/a/chat`会话路径；`/sign_in`和其他路径失败关闭；
- 任务、预检、当前浏览器页面和上传草稿的 Surface 必须一致，不能跨平台提交；
- 扩展只处理用户当前可见页面中的回答正文、真实 HTTP(S) 链接和当前视口截图；不读取 Cookie、Web Storage、账号凭证、隐藏接口或网络响应；
- 首版不声明支持 DeepSeek 独立信源面板。回答正文没有真实链接时，正式信源条目为零，不根据媒体名或纯文本域名推断链接；
- 单题和整批流程复用现有可见页面驱动，使用独立页面签名`deepseek-web-signature@1-visible-page`；
- 自动登录、验证码和滑块处理不在范围内；
- 自动化开关默认关闭。生产环境只有在存在覆盖可见页面驱动的书面许可、证据编号和90天内复核时间时才可通过服务端预检；合成环境仅用于开发测试；
- 自动提交结果继续进入`needs_review`，人工确认后才进入正式统计；
- 既有豆包和千问运行、证据及排名不迁移、不改写。

## 取舍

当前实现优先保证平台归属和证据可核验性。DeepSeek 页面若改版导致编辑器、发送按钮、新对话入口或回答稳定状态无法识别，整批任务应暂停，不以猜测选择器继续提交。

## 验收

- 可创建并识别`deepseek_web`运行；
- 预检返回 DeepSeek 官方 Origin 和独立页面签名；
- 扩展只在允许的 DeepSeek 聊天路径启动，登录页和第三方页面被拒绝；
- DeepSeek 草稿的 Surface、产品标签和 Origin 通过严格契约，跨平台组合失败关闭；
- 单题和整批任务保持同一平台，结果进入人工复核；
- 生产授权缺失时自动化失败关闭，手动采集仍可使用；
- `pnpm verify`、`0011`迁移和服务健康检查通过；
- 已登录真实页面的发送和采集烟测另行记录，不由合成测试代替。

## 依据

- DeepSeek 官方网页入口：<https://chat.deepseek.com/>，2026-08-29核验；
- DeepSeek 服务条款：<https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html>，仅作为边界复核材料，不据此推定获得生产自动化许可；
- 自动化治理继续遵循[`DEC-WT058-001`](./DEC-WT058-001-DOUBAO-AUTOMATION-GOVERNANCE.md)和[`DEC-WT067-001`](./DEC-WT067-001-DOUBAO-AUTOMATION-EXECUTOR.md)的失败关闭边界。
