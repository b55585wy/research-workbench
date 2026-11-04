# tFUS 报告资料接入（首版）

2026-11-04：tFUS v0.34.0 提供工作台入口及旧 RMS 评分报告的本地 CSV 交接。此分支只补文档，ResearchWorkbench v0.53.0 应用、资料、游客和个人服务不改动。

## 用户流程

网页也可在 tFUS 已完成的 RMS 评分结果中直接点击“导出评测数据（CSV）”，将 CSV 加入下述工作台资料入口；完整 JSON 报告另行保留。

1. 在 tFUS 用本人 PAT 执行 `python scripts/tfus_client.py reports export-research JOB_ID --output-dir ../tfus-handoff-run-001`，父目录存在、目标目录不存在。
2. 在本工作台已有“我的数据”或选定研究课题的数据入口上传 `research-summary.csv`，需要时再关联课题。原 `report.json` 和 README 保留本机。
3. 核对任务/原项目/参考工件 ID、原协议、指标、参考/预测/报告 SHA。普通资料机制保存原 CSV 字节、独立资料编号和哈希，不自动分析或向模型发送。

CSV 为一行宽表，`handoff_version=tfus-research-csv-v1`，`source_verification=file_import_unverified`。仅支持 `rms-fullgrid-v0.1/p_rms/Pa/zyx/full_grid`：relative_l2 与 peak_relative_error 无量纲，focus_distance_voxel 为索引空间距离，未定义保持空；三个计时是评分而非推理时间。原值不重算，校验不提升科研/训练资格。潜在公式字符串做安全转义，原文在原报告保留。

## 身份与维护边界

tFUS 只提供新标签页链接，不附带项目、用户、令牌或模型 Key。本工作台继续使用本站现有资料空间；tFUS 切换账号不会自动切换或认领游客空间。访客各自持有空间和恢复码；Key 按本站现有个人设置管理。文件导入是用户提供的来源声明，不是已认证发行者或 tFUS 来源访问授权。已导出/导入的副本不随 tFUS 后续撤权自动撤回。

仿真工程、tFUS 课题/数据集与本工作台课题保留独立 ID；导入后使用现有资料关联，不自动映射、合并数据库或赋予新资料归属。未来认证适配和显式空间绑定继续按[账号约定](ACCOUNT-INTEGRATION.md)，不得把游客凭据或客户端 actor JSON 当作外部成员认证。

代码无需为此增加上传接口或表类型；使用现有 CSV 限额与逐空间存储。适配若扩展到原生峰值、复声压、更多评分协议、在线引用或账号绑定，须另行定义字段与验收。

## 本轮证据

本轮核对工作台 main `5de5aaf8bfe29c4b8600d7bfc0df00880185afbb` / v0.53.0；与原 v0.52.0 验收基线相比，后端只改版本号，原 CSV 入库接口和存储代码相同，沿用其保留冒烟证据。网页版另通过39项有界检查和4份原始报告的 CLI/网页字段、数值及原字节哈希对照。临时只读 PAT 读取合成评分→本地导出→当前代码已有 CSV API 保存/重开，原字节、SHA、指标一致；另一独立临时上下文读取拒绝。没有论文上传、统计执行、模型调用、真实资料、线上游客创建或公网服务更新。tFUS 本机预览已备份/兼容验证后更新；完整接入约定在其私有仓库 `docs/RESEARCH-WORKBENCH-INTEGRATION.md`。
