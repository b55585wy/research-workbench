# research workspace：总任务表

更新于 2026-11-03。先说明任务思路与完成标准，再执行当前一轮。总表区分已交付、缺陷修复、产品方案和后续能力，避免将候选项目或 README 声明当作已接入功能。

## 当前状态

已部署 v0.42.0，私有仓库提交 bf3ea8e。侧栏整栏及内部分组折叠、紧凑论文列表、数据区主次整理、项目论文关联的具体错误反馈已合入。静态审阅及服务启动日志已核对；依用户要求未运行测试，实际视觉和交互尚未验收。旧页面为何显示个人工作区的项目控件仍未证实，不能宣称所有通用失败来源都已定位。

## 排序与完成标准

| 编号 | 任务 | 状态 / 顺序 | 完成标准 |
| --- | --- | --- | --- |
| M0 | 侧栏及其内部折叠、论文标题瘦身、数据区整理 | 已部署 v0.42 | 搜索和组标题可见，内容可独立收起；草稿保留；笔记跳转/插入/错误展开目标组；整栏收起时正文扩宽 |
| M1 | Markdown 与聊天排布；界面名称 research workspace | 当前唯一代码迭代 | 标题、加粗、嵌套列表、表格、代码块与公式可读；成熟本地解析组件；保留引用回跳、复制/CSV、草稿、权限与历史；回答为主，工具/来源详情按需展开；所有界面品牌统一 |
| M2 | 产品层级与实验空间组织 | 方案阶段，在 M1 后 | 文献阅读 / 实验空间 / 我的资源 / 可选项目职责明确；参考用户截图，以资料树、按需分类和内容区组织；直接阅读/分析不要求建项目 |
| M3 | 文献检索到已有导入链的闭环 | M2 明确入口后 | 先核查 PubMed 实现与源协议；返回真实候选，用户选择可获取 PDF 后沿现有导入链入库；摘要不伪装为全文；保存出处与版本 |
| M4 | 跨文献证据整理与研究任务 | M3 后分步 | 先支持所选论文的有出处对照表，列可调整、缺项明确；再评估分阶段检索/阅读/核对/写作；任务有限额、可停/恢复，沿用唯一助手入口 |
| M5 | 沉浸式双语阅读 | 后续规划 | 阅读器内按段落对照原文与译文，保留页码、公式和来源位置；先选区/可见段落，再评估整篇；原 PDF 不改写 |
| M6 | 可编辑 PPTX 生成 | M4 有可靠成果后 | 从选中论文、笔记和实际图表/结果生成；先核对大纲、用途和页数；交付可下载可编辑 .pptx，每页保留来源，不能只给大纲文本 |

实验空间已有原始数据保存、分析表、固定 Python/R 统计和图表能力。M2 是入口和成果关系的整理，不重新创建另一套计算引擎，也不宣称支持任意代码或全部 SPSS 方法。

## 开源来源与产品关系

| 来源 | 本次核对与用途 | 接入边界 |
| --- | --- | --- |
| khoj-ai/openpaper | 阅读、批注、引用回跳、自定义提取表、可折叠菜单有相关实现；AGPL-3.0 | 优先参考交互；源码抽取逐文件核对许可/依赖；其 Next.js、存储、账号和任务栈不直接替换本平台 |
| QiZishi/PaperAgent | Apache-2.0；AgentScope 研究流程与 MinerU API 客户端候选 | 本地 parse_pdf_file 明确为占位；已读技能工具文件未见独立 PubMed 实现，不能仅凭 README 勾选能力；先核查再决定可复用模块 |
| Tswoen/Paper-Agent | 检索连接器、聚合去重和分阶段综述流程候选 | 已单列 PAPER-AGENT-PLAN.md；当前读取的根目录和配置未见明确许可证，复制源码前确认授权；AgentScope/LangGraph 不同时引入 |
| MinerU | 复杂 PDF、公式、图表的解析能力候选 | 适配回原文件、页码和位置；解析在独立任务中进行；选择本地/外部服务前明确数据与资源约束 |
| alphaXiv | 官方 MCP 提供外部检索、论文内容与按问题读取相关页 | 工作台后端的可选只读工具，首期只评估公开资料；区分 AI 报告与原文，不默认同步外部文库或上传私有数据 |

引用：
[OpenPaper](https://github.com/khoj-ai/openpaper)、
[OpenPaper PDF 组件](https://github.com/khoj-ai/openpaper/blob/master/client/src/components/PdfHighlighterViewer.tsx)、
[提取字段](https://github.com/khoj-ai/openpaper/blob/master/client/src/components/DataTableSchemaModal.tsx)、
[QiZishi MinerU 客户端](https://github.com/QiZishi/PaperAgent/blob/main/core/mineru_client.py)、
[技能工具](https://github.com/QiZishi/PaperAgent/blob/main/agents/skills/_tools.py)、
[Tswoen 检索模块](https://github.com/Tswoen/Paper-Agent/tree/main/src/paper_retrieval)、
[alphaXiv MCP](https://www.alphaxiv.org/docs/mcp)。本轮只读源码和文档，未部署或运行这些候选工程。

## 当前 M1 工程分工

- Codex：核对需求、文件边界、数据/引用兼容、资源许可，集成、备份、静态验收与发布。
- Kimi：回答渲染器、聊天布局和界面命名；保留来源、提案、重试、跨资料权限及浮窗控制。
- DeepSeek 官方：固定版本本地 Markdown/公式静态资源准备脚本与锁定清单，不改业务后端。
- 每个候选目录只有一个写入者；仅显式额度失败按既有规则回退，瞬时连接失败同路重试一次。GLM 和历史免费路由保持禁用。

每轮结束更新总表：实际改动、交付状态、验证范围与未解决项。新需求先归档到对应项，当前迭代有明确收口后再切换。
