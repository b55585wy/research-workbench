# 新增独立入口 · 2026-11-04

主入口：**https://5ai.life/**，IP入口 https://154.201.73.162/ 保留，应用 v0.55.0，发布提交 `b25039e32393`。
源码已合并远端 tFUS 来源展示。首次独立部署保留旧机；随后按用户要求，旧域名游客服务也同步到
同一版本并保留所有资料，见 [双服务器记录](DUAL-ENTRY-DEPLOYMENT.md)。原个人服务保持原状。
这不是双活或同步数据库：新入口使用全新服务器资料空间，浏览器本机资料也按来源分别保存。

## 实际部署

- 主机 Ubuntu20.04 / x86_64，8核、约8GiB内存。系统 Python3.8 未替换；独立应用环境为Python3.12.16。
- 发布目录 `/opt/research-workspace/releases/0.55.0-b25039e32393`，链接 `guest-current`。
  包与每个源码/前端资源经过清单摘要核对，未携带本机/旧机资料、凭据或模型密钥。
- 后端 `research-guests` 以独立系统用户运行，仅绑定127.0.0.1:3151；Caddy2.11.7公开80/443，
  使用公开受信IP证书与自动续期。配置先验证再reload；保留Origin/Sec-Fetch边界。
- `/var/lib/research-guests` 为独立6GiB ext4镜像，loop,nodev,nosuid,noexec，挂载项持久保存。
  注册表与游客资料位于其spaces下，最多32空间/2个加载实例，服务内存上限3GiB。
- R4.6.2 stats、SPSS pyreadstat1.3.7 和 MinerU4.1.5/DocVortex0.6.11 单独安装并记录就绪清单。
  解析器固定jieba版本只有源码包，保留首次二进制限定失败日志，改为优先二进制后完成安装。
- 文本静态资源启用zstd/gzip。当前电脑链路的PDF引擎实测约1MB/15.4s降至235KB/3.3s，
  是这次测量结果，不是大陆所有网络的性能保证。

## 核对范围

公开HTTPS页面与健康接口200/v0.55；手机尺寸本机模式打开自建PDF、IDB字节校验和206分段读取。
服务器游客上传、206范围读取通过；另一游客读取文件404，外部Origin/跨站API请求403。
翻译parser_ready=true，但新游客model_ready=false，需要自己配置模型key。未发送翻译或AI任务。
完整的本轮功能与未验收边界见 [验收记录](DEVICE-STORAGE-ACCEPTANCE.md)。

当前电脑到新IP偶有TLS连接关闭，保留为访问链路待查项；不能仅凭服务器active/200声称所有
浏览器链路稳定。浏览器第二会话遇到连接问题时，服务器游客隔离另用独立cookie会话核对。

服务端部署摘要 `/opt/research-workspace/downloads/DEPLOYMENT-STATUS.json`；安装日志在
`/opt/research-workspace/downloads/bootstrap`，均不含聊天提供的root密码。源包和发布清单保留。

## 更新边界

前端跟随不可变发布包切换、模块资源重新验证；代理配置可validate后reload。
后端仍需活动任务检查、匹配资料备份和短暂切换，不宣称数据库升级零停机。
schema26回滚须匹配备份；不让两个服务共同写同一SQLite文件。
新旧入口相互独立，不自动迁移、删除、合并或跨区复制用户资料。
