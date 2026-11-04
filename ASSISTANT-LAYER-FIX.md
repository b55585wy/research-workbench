# 研究助手入口被笔记栏遮挡 · 2026-11-04

821–1100px 宽度使用固定笔记抽屉，层级为35；助手入口原为30，实际点击命中图片库等笔记内容。
助手窗体本身为40。此次仅把入口也调整为40，保留抽屉、浮窗、对话和笔记行为。

两个线上后端仍为 v0.55.1。使用独立 CSS 文件和精确 `/assistant.css` 代理规则发布，
规则位于既有来源拒绝之后；原发布目录、API、资料、owner 服务和会话配置未改。
itsyiyi.com、5ai.life 及新服务器IP站点已安装该样式。默认与哆啦A梦蓝主题实际点击可打开助手。

后端 PID 保持：旧机15828、新机3919；Caddy PID 保持：旧机13133、新机2710。
两台主机切换期间的 CSS 传输均返回200，完整内容仍匹配更新前哈希，未被切断。
旧域名与新域名浏览器实际取得新样式；部分非浏览器客户端的新机 TLS 探测失败，不据此宣称所有网络稳定。

原 CSS SHA256：`fb6851ceb7c585d586320c8a66747f84a3efdda92cd527b6cde232fd945e6756`。
热修 SHA256：`de4e730ab25bad4772c68cc5804afbabcf385e466ac324ba4d3e59f500ac3506`。
各机 `/opt/research-workspace/downloads/assistant-layer-v1/DEPLOYMENT-STATUS.json` 记录配置备份与进程状态。
代理配置先适配/校验，再 reload；使用 [Caddy reload](https://caddyserver.com/docs/command-line#caddy-reload)，没有 stop/start 应用。

这次是旧入口的单文件热修，不等于已启用 v0.55.3 的完整前端发布机制。后续启用带版本资源时，
须核对并整理这条旧路径覆盖，避免它遮住未来未固定版本的助手样式。
