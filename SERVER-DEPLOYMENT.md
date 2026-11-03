# 个人服务器部署

本轮运行于用户指定的 CentOS 7，应用 v0.50.0，代码发布包来自
`5ab1d09f833c03e3fbd4195c78133aaf6b6d38df`。域名为 `itsyiyi.com`，
目标服务器为 `103.149.91.75`。当前可通过 **https://103.149.91.75/** 登录访问。
该 IP 已取得受信任的 Let's Encrypt 证书，由 Caddy 自动续期。
域名入口等待根域名 A 记录生效后接入。
当前记录：原 A 记录为 `185.53.179.149`，未发现 AAAA 或 CAA 记录。

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
R stats 清单已生成并复核。模型连接等待拥有者在设置中配置。
MinerU 解析运行环境尚未部署，因此选页解析、沉浸式翻译和段落阅读暂不可用。
后续配置时必须保持 MinerU 4.1.5 / DocVortex 0.6.11 的契约；Linux venv 要用
`--copies`，解释器解析后的路径须留在运行环境根内。不要复制 Windows 运行环境。

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
