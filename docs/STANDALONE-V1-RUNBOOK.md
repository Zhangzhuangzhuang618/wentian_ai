# 问天独立版第一版部署手册

## 1. 组成与边界

第一版包含Web界面、API、本地账号、PostgreSQL 16、S3兼容对象存储、迁移、豆包/千问/DeepSeek可见页面采集、保留期清理和项目删除。第一版运行不依赖Redis、独立Worker、GEO连接器或第三方模型API。

自动化开关默认关闭。浏览器可见页面驱动已经具备开发态实现，但豆包、千问和DeepSeek的部署默认授权依据均为`none`；即使项目Owner打开开关，未接入对应平台书面授权证据前，服务端预检仍会阻止生产自动提问。

## 2. 准备配置

将`.env.example`复制为`.env`，填写：

```text
WENTIAN_POSTGRES_PASSWORD
WENTIAN_S3_ACCESS_KEY
WENTIAN_S3_SECRET_KEY
WENTIAN_SESSION_SECRET
```

`WENTIAN_SESSION_SECRET`至少32字节。不得提交`.env`、Owner密码或初始化令牌。默认仅监听`127.0.0.1`；需要远程访问时，应由部署人员配置HTTPS反向代理，并将`WENTIAN_PUBLIC_ORIGIN`设为真实HTTPS来源、`WENTIAN_COOKIE_SECURE`设为`true`。

三个平台使用彼此独立的自动化部署变量。默认如下，开发和手动采集阶段保持不变：

```text
WENTIAN_DOUBAO_AUTOMATION_ENVIRONMENT=production
WENTIAN_DOUBAO_AUTOMATION_AUTHORIZATION_BASIS=none
WENTIAN_DOUBAO_AUTOMATION_AUTHORIZATION_EVIDENCE_ID=
WENTIAN_DOUBAO_AUTOMATION_AUTHORIZATION_REVIEWED_AT=
WENTIAN_QIANWEN_AUTOMATION_ENVIRONMENT=production
WENTIAN_QIANWEN_AUTOMATION_AUTHORIZATION_BASIS=none
WENTIAN_QIANWEN_AUTOMATION_AUTHORIZATION_EVIDENCE_ID=
WENTIAN_QIANWEN_AUTOMATION_AUTHORIZATION_REVIEWED_AT=
WENTIAN_DEEPSEEK_AUTOMATION_ENVIRONMENT=production
WENTIAN_DEEPSEEK_AUTOMATION_AUTHORIZATION_BASIS=none
WENTIAN_DEEPSEEK_AUTOMATION_AUTHORIZATION_EVIDENCE_ID=
WENTIAN_DEEPSEEK_AUTOMATION_AUTHORIZATION_REVIEWED_AT=
```

只有取得适用于可见网页自动化的书面许可，并由项目Owner和合规责任人确认后，才能把依据改为`written_permission`，填写证据编号和本次复核的ISO-8601时间。复核时间超过90天、缺失或位于未来时自动阻断。`official_interface`只适用于官方接口驱动，不能放行浏览器网页驱动。

## 3. 启动与检查

```bash
docker compose up -d --build
```

Compose会先启动PostgreSQL和对象存储，创建私有证据桶，连续执行迁移，再启动API。

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
```

readiness只有`database`和`objectStore`，没有Redis或GEO依赖。Web入口为`http://127.0.0.1:3000/`。

## 4. 初始化唯一Owner

生成一次性随机令牌及其SHA-256摘要，临时注入：

```text
WENTIAN_OWNER_INIT_TOKEN
WENTIAN_OWNER_INIT_TOKEN_SHA256
WENTIAN_OWNER_EMAIL
WENTIAN_OWNER_DISPLAY_NAME
WENTIAN_OWNER_PASSWORD
```

执行：

```bash
docker compose run --rm \
  -e WENTIAN_OWNER_INIT_TOKEN \
  -e WENTIAN_OWNER_INIT_TOKEN_SHA256 \
  -e WENTIAN_OWNER_EMAIL \
  -e WENTIAN_OWNER_DISPLAY_NAME \
  -e WENTIAN_OWNER_PASSWORD \
  api pnpm owner:init
```

成功后删除五个临时变量。第二次初始化必须返回`OWNER_ALREADY_INITIALIZED`，不存在默认密码或第二个初始Owner旁路。

## 5. 使用豆包、千问或DeepSeek可见页面采集

1. 登录问天，创建项目和问题集；
2. 创建“自然回答”运行；
3. 在任务页选择运行：单题采集时领取任务并复制一次性接入码；整批采集时点击“整批接入”并复制整批接入码；
4. 在Chrome扩展管理页打开“开发者模式”，加载`apps/browser-extension/`；
5. 打开与运行观察对象一致、且已登录的豆包、千问或DeepSeek页面，点击扩展；
6. 自动化开关和上线门禁已满足时，可粘贴单题接入码并选择“自动采集单题”；扩展会等待回答稳定后进入本地预览；
7. 小规模连续实验可粘贴整批接入码并选择“连续采集整批”；扩展会在当前 AI 页面逐题建立新对话、发送、采集并提交，失败时暂停，用户可重试或停止；
8. 门禁未满足或页面结构不匹配时，选择“手动选择当前回答”，由用户发送问题并单击回答区域；
9. 单题和手动模式需核对本地预览并确认提交；整批模式统一自动提交到待复核区；
10. 回到问天逐项完成最终确认或拒绝；
11. 如需对照，再创建与该自然回答运行配对的“信源推荐”运行并复核域名。

单题接入码只绑定一个任务、一个用户和本机问天地址，十分钟到期且只能使用一次。整批接入码绑定一个运行、一个用户和本机问天地址，两小时到期，只能领取该运行中的待采集任务；每题上传仍使用新签发的一次性凭证。扩展不读取任何平台的Cookie、密码、Token、localStorage或隐藏网络响应。

## 6. 排名与可比口径

- 排名按同一问题在该运行全部已确认回答中的正式信源条目累计；同域名在一份回答出现多条就累计多条；
- 计数降序排列，计数相同时按域名字典序稳定排序；
- 自然回答与信源推荐实验必须配置一致，且实际开始时间相隔不超过24小时；恰好24小时可比，超过1毫秒即不可比；
- AI自述推荐只表示“它声称会优先参考什么”，不能当成内部真实抓取频率。

## 7. 保留期清理

| 数据                               |   默认期限 | 到期行为                                   |
| ---------------------------------- | ---------: | ------------------------------------------ |
| 待复核暂存包                       |     24小时 | 删除截图和暂存证据，任务记为过期并重算运行 |
| 已拒绝暂存证据                     |       立即 | 删除对象和暂存记录                         |
| 已确认截图                         |       30天 | 删除对象和截图哈希，保留删除审计墓碑       |
| 已确认回答、可见引用和白名单元数据 |      180天 | 清除正文、原始标签、说明文字及内容哈希     |
| 正式信源事件与派生排名             | 至项目删除 | 仅保留域名、规范链接、位置和必要审计字段   |
| 脱敏DOM                            | 第一版关闭 | 不采集、不保存                             |

手动执行一次：

```bash
docker compose --profile maintenance run --rm retention
```

部署人员必须用主机计划任务或等价调度每天执行一次。每次结果写入`retention_cleanup_runs`，失败返回非零状态；不能只配置对象存储生命周期，因为PostgreSQL中的正文和哈希也需要同步清除。

## 8. 迁移、备份与升级

- 首个迁移固定为`0001_standalone_foundation.sql`；
- 当前连续迁移为`0001`至`0011`；
- 不得修改、改名或重排已应用迁移；
- 迁移运行器校验文件SHA-256并使用数据库锁；
- 升级前同时备份PostgreSQL和对象存储，恢复演练必须在隔离实例进行；
- 发布时先备份，再运行`docker compose run --rm migrations`，随后重建API。

## 9. 项目删除、停止与实例清除

项目Owner可以在问天中二次确认删除项目。系统先停止项目写入、撤销GEO绑定和会话，再清理该项目的对象存储路径与PostgreSQL业务数据，并保留最小删除作业审计。项目删除与“断开GEO连接”是两种不同操作。

```bash
docker compose down
```

该命令保留PostgreSQL和对象存储卷。`docker compose down --volumes`会永久删除本实例数据，只能在明确确认目标实例和备份状态后执行。
