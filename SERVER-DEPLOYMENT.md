# 当前服务器入口（前端v0.74.1、核心v0.64.0、论文PPT服务v0.72.0）

当前前端 v0.74.1、核心后端 v0.64.0，另有独立论文PPT服务 v0.72.0；两站用户资料仍独立。
[首次功能引导](FIRST-USE-GUIDE.md)已以 `ui-0.74.1-df18737dfdf20b79` 独立发布，源码 `65b0efb`，1029文件，ZIP SHA-256 `cdabfe8b1d8ea4fc6d72f769316a76f2063e1bc914e6e54471be234d46890df1`。核心、论文服务、代理和原个人服务进程保持；没有Caddy重载、后端重启、资料迁移或强制刷新。v0.73聊天PPT工具仍待核心升级，当前仅工作区生成已上线。
新站公网浏览器引导和61项资源核对通过；旧站本地验收线路连接间歇关闭，已从独立外部线路核对关键资源和入口。详见 [发布记录](UPDATE-POLICY.md)。

以下保留v0.72论文PPT发布记录，当前版本以上述v0.74.1为准。
[PDF生成论文PPT](PAPER-PRESENTATIONS.md)与[助手窗口/快捷键](ASSISTANT-WINDOW.md)已上线：选全文或页码、带来源的可编辑PPTX；助手可上下移动/调整高度/收起保留，Enter发送、Ctrl/Shift+Enter换行。Agent聊天直接生成PPT尚未接入。
核心源码仍为 `0.64.0-05c8826d1173`，核心/代理/原个人进程PID保持；Caddy仅平滑重载，原静态资源保留，无资料迁移。
论文PPT服务运行于loopback3154，旧/新机PID为3270/145738，源码 `1b33570e93c3`；独立依赖目录 `runtimes/paper-pptx-072-1b33570e93c3` 使用固定python-pptx1.0.2/lxml6.1.3/XlsxWriter3.3.1 wheel，不修改旧Python环境。
只读新路径与原来源校验共存；43项公网资源及权限检查通过，详见 [发布记录](UPDATE-POLICY.md)。

此前双站升级到后端 v0.64.0、前端 `ui-0.64.0-7f38f22d001cd439`，新增自定义科研绘图 skill、版本和冻结导出快照。
任务空闲后受控重启游客后端，追加 SQLite29 两张表，原表行内容核对一致。代理及原个人服务进程保持；未改写原 PDF 或强制刷新旧页面。
原前端资源保留，当前发布与外网校验见 [UPDATE-POLICY.md](UPDATE-POLICY.md)。

此前双站为 v0.62.0 / `ui-0.62.0-5a80bd19aad5790e`，没有迁移数据库或改写原 PDF，全部原表数据核对一致。

2026-11-05 两个公开入口均已发布 v0.61.0 / `ui-0.61.0-1c7aa45e1a803d31`，SQLite 28 仅追加掌握星级表，原表数据逐行核对一致。实际切换与备份、外网资源校验见 [UPDATE-POLICY.md](UPDATE-POLICY.md)。原个人服务和两边独立资料边界保留。下文为历史记录。

2026-11-04 **https://itsyiyi.com/** 与 **https://5ai.life/** 均已发布同一 v0.55，资料各自独立。
新机 IP 入口 https://154.201.73.162/ 保留。旧机32游客空间已备份、升级并保留；原个人服务仍为v0.50。
详见 [双服务器同步记录](DUAL-ENTRY-DEPLOYMENT.md) 与 [新机运行环境](SECOND-SERVER.md)。

v0.54 接通 PDF 分段加载、进度与限量错误记录，并调整手机笔记工具和字号；继续使用 schema 25。

v0.53 更新手机阅读工具的图标与展开方式，继续使用 schema 25，不改变资料模型。

v0.52 为游客服务增加 PDF legacy 与本地浏览器兼容资源、原文件备用入口和助手清空对话。
资料库升级为 schema 25；升级前离线备份整个游客目录。代码回滚到 v0.51 时必须恢复匹配的
schema 24 备份，不能用旧代码打开新库。原个人服务及其资料未升级。

- `https://itsyiyi.com/`：独立游客服务，免注册，每位访客一份服务器资料空间，
  各自填写 DeepSeek Key。保存恢复码后可在其他浏览器找回原空间。
- `https://103.149.91.75/`：原个人服务，继续使用原访问凭据及原资料库。
  不将已有个人资料分给首位匿名访客，也不继承个人模型配置。
- 新服务 `research-guests.service` 使用 `research-guests` 系统账号，回环端口
  `3151`；代码链接为 `/opt/research-workspace/guest-current`，复用现有只读运行时。
- 游客目录 `/var/lib/research-guests` 是新建 2 GiB ext4 镜像文件系统，
  挂载 `loop,nodev,nosuid,noexec`。服务启动前必须确认已挂载，不能回退到根文件系统。
  镜像为 `/var/lib/research-guests-data-v1.img`，挂载项保存在 `/etc/fstab`。
- 游客注册表与各空间位于 `/var/lib/research-guests/spaces`；上限 32 空间，
  最多加载 2 个应用实例。进程组内存上限 768 MiB。忙碌与存储不足均明确失败。

游客边界与验收见 [GUEST-SPACES.md](GUEST-SPACES.md)，手机布局见
[MOBILE-LAYOUT.md](MOBILE-LAYOUT.md)。Caddy 仅将域名上游切到 3151，保留原 IP
站点的认证和 3150 上游。域名允许正常跨站顶层 GET 导航，其他跨站请求仍拒绝。
恢复原 Caddy 配置可回到个人模式；不得删除游客镜像或资料目录。

以下为 v0.50 初始个人部署记录；其中“域名与 IP 共用资料库”的描述已由上述入口分离替代。

# 原个人服务器部署

本轮运行于用户指定的 CentOS 7，应用 v0.50.0，代码发布包来自
`5ab1d09f833c03e3fbd4195c78133aaf6b6d38df`。域名为 `itsyiyi.com`，
目标服务器为 `103.149.91.75`。域名 `itsyiyi.com` 的 A 记录现已指向该服务器，
域名站点与 **https://103.149.91.75/** 的 IP 站点并存，使用同一份资料库。
证书由 Caddy 申请和自动续期；IP 站点使用受信任的短期证书。

## 运行边界

- 一个拥有者、一份资料库。Caddy 的 `owner` 登录保护所有页面、接口和文件；
  这不是应用内多账号管理。内部仍使用本地访客上下文，不生成已认证 actor。
- 应用维持 `127.0.0.1:3150` 和 `proxy_headers=False`。Caddy 先校验原始
  Origin、拒绝跨站请求，再移除 Origin 和转发身份头，并重写上游 Host。
- 本机 tFUS 和工作台原有资料不参与部署；服务器从空资料库开始。
- CentOS 7 已结束维护。此次按用户选择保留系统，独立安装运行环境；
  这些运行环境不会补上宿主系统缺失的安全维护。

## 目录与版本

| 路径 | 用途 |
| --- | --- |
| `/opt/research-workspace/releases/0.50.0-5ab1d09f833c` | 已校验源码和本地构建的前端资源 |
| `/opt/research-workspace/current` | 当前发布目录的链接 |
| `/opt/research-workspace/runtimes/app-0.50.0` | Python 3.12.16、Pillow 13 和应用依赖 |
| `/opt/research-workspace/runtimes/rstats-4.6.2` | R 4.6.2 |
| `/opt/research-workspace/runtimes/rstats-manifest` | 已校验的 Linux stats 库清单 |
| `/opt/research-workspace/runtimes/import-v1` | pyreadstat 1.3.7、NumPy 2.5.4、Narwhals 2.28.0 |
| `/opt/research-workspace/runtimes/mineru-flash-v415-linux` | MinerU 4.1.5、DocVortex 0.6.11、私有 glibc 2.28 |
| `/var/lib/research-workspace/data` | 唯一在线 SQLite 资料库及关联文件 |
| `/etc/research-workspace/access.env` | Caddy bcrypt 哈希，root:root 0600 |
| `/etc/research-workspace/runtime.env` | 可选运行环境路径 |

应用使用禁止登录的 `research-workspace` 账号，Caddy 使用 `research-caddy`。
代码和运行环境由 root 持有，运行账号不能修改；数据目录权限 0700。
当前服务器约 1837 MiB 内存，应用进程组限制 1280 MiB，Caddy 限制 256 MiB。
服务模板采用 systemd 219 支持的指令，不能直接换成较新版 systemd 的配置。

## 安装与发布约束

1. 在构建机从干净 Git 提交打包源码，并加入被 Git 忽略的 `frontend/vendor/`。
   React 源码在 `web/`；服务器不需要 Node。排除用户资料、凭据、Windows venv。
   包含逐文件 SHA256 清单，并从可信渠道另行取得整个归档的摘要。
2. 归档内容直接从 `research_workbench/`、`frontend/` 等开始，没有公共顶层目录。
   核对成员只有普通相对路径文件后，解压到新的发布目录，不加 `--strip-components`。
3. 不替换系统 Python。CentOS 的 glibc 2.17 无法使用 Pillow 13 的 PyPI Linux
   wheel，本轮使用官方 Miniforge 26.9.4-1 与 conda-forge Python 3.12、Pillow 13、
   cryptography 50.0.2，再安装 `requirements.lock.txt` 并核对 `requirements.txt`。
   原锁文件漏列 PDF 文字处理依赖，本次已补齐。保留实际 Conda/Pip 版本清单。
4. Caddy 2.11.7 使用官方二进制，核对官方 SHA512 清单。绑定低端口需要
   `setcap cap_net_bind_service=+ep /opt/research-workspace/bin/caddy`；systemd 219
   不支持 AmbientCapabilities，因此 Caddy 单元使用文件 capability，
   `NoNewPrivileges=no`。应用单元仍为 `NoNewPrivileges=yes`。
5. 创建专用账号及模板中所有目录后，再安装 `deploy/server/` 下两个服务单元。
   发布目录的 `.venv` 链接到对应版本的独立应用运行环境。为缓存创建可写家目录。
6. 为网页生成单独口令，使用 `caddy hash-password` 隐藏输入；只将哈希写入
   `access.env`。不得复用 root 口令，也不得将明文放进参数、Git 或日志。
7. 以 `caddy validate` 和 `systemd-analyze verify` 核对配置，再启动应用。
   确认 DNS 指向本机、80/443 可达后启用 Caddy，让它申请和续期证书。
   调整 DNS 时保留已有邮件和其他记录。

DNS 尚未就绪时，使用 `deploy/server/Caddyfile.ip` 的 IP 入口模板。
它显式选择 Let's Encrypt 的 `shortlived` 配置，Caddy 自动维护有效期约六天的
IP 证书；`default_sni` 用于没有发送 SNI 的 IP 访问。网页口令哈希继续来自
同一个受限环境文件。无需在浏览器添加自签证书信任。
域名模板已保存在服务器 `/etc/caddy/research-domain.pending.Caddyfile`。
DNS 生效后可将域名站点块加入配置，校验后 reload Caddy；保留 IP 入口便于已有
书签继续使用。两个入口分别校验自己的 Origin，使用同一拥有者口令和资料库。

只使用经核对的构建包，不把摘要校验等同于任意第三方归档安全。
新服务器安装步骤应由部署者核对，不盲目覆盖在线实例。

## 当前能力与核对范围

应用健康接口返回 v0.50.0；Python/R 引擎和 SPSS 文件读取环境就绪。
R stats 清单已生成并复核。经用户明确同意，已通过 HTTPS 将本机研究助手的
DeepSeek Flash 连接配置写入服务器，密钥文件属于服务账号、权限 0600。
模型端点是 `api.deepseek.com`；本轮没有发起模型调用，连接状态仍为未实调用验证。

MinerU 解析环境已接入，118 项固定依赖版本和离线导入检查通过，服务账号导入也通过。
应用返回 `parser_ready=true`；原文准备、段落阅读与翻译所需运行环境均已启用。
本轮没有执行 PDF 解析或翻译任务。解析保持 Flash 文本模式、每次最多五页。
私有 glibc 2.28 仅用于该解析解释器，宿主和核心应用仍为 glibc 2.17。
部署方法见 [解析环境说明](deploy/server/TRANSLATION-RUNTIME.md)。
其他 Linux venv 仍需使用 `--copies`，确保解释器解析后的路径留在运行环境根内。

本轮核对源码/资源摘要、依赖版本及导入、服务启动、资源限制和健康接口。
临时回环代理的 10 项访问检查通过：未登录拒绝页面/API/文件、正确登录放行、
只接受指定 Origin，并拒绝跨站请求。临时代理已停止并移除。
IP 入口另完成八项公网 HTTPS 检查：验证证书、登录后页面/API/资源、未登录拒绝访问，
并检查来源限制。未运行功能回归、论文解析、统计任务或模型调用。

## 之后更新与恢复

先准备新的发布目录和对应运行环境。切换前停止应用，备份整个数据目录的一致
状态及关联文件，生成摘要并保留旧代码。默认排除 `.agent-model.json`；凭据如需
备份，单独保存到受限位置。备份包本身也应限制访问，不能置于网页目录。
停止应用后再切换 `current`，启动并核对健康与登录入口。
如果升级改变了数据库结构，恢复必须同时使用配对的数据备份和旧代码；
只切回旧代码不保证能够读取已经升级的数据库。不要让两个实例同时写同一数据目录。

依据：[Miniforge 支持范围](https://github.com/conda-forge/miniforge)、
[Caddy Basic Auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth)、
[Let's Encrypt IP 证书](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)、
[CentOS 维护状态](https://www.centos.org/centos-linux/)。
