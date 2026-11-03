# research workspace：总任务表

更新于 2026-11-03。先说明任务思路与完成标准，再执行当前一轮。总表区分已交付、缺陷修复、产品方案和后续能力，避免将候选项目或 README 声明当作已接入功能。

## 当前状态

v0.43.0 代码与本地资源已集成部署。完成 Markdown/公式渲染、回答优先聊天、research workspace 命名、等高论文列表/悬浮全文标题、核对说明清理和图片右键临时虚线框。保留 v0.42 的侧栏整栏/内部分组折叠及数据区整理。

依用户要求未运行测试、构建或浏览器/HTTP/模型探测；仅源码静态审阅、资源完整性核对、备份和服务启动日志检查，实际交互与视觉尚未验收。旧的通用未保存提示仍待核对页面地址/资源来源，不宣称已证实其原因。

## 排序与完成标准

里程碑是用户能看到的一项完整成果；代码交付与运行效果验收分开记录。按新优先级重排编号，替代此前总表中 M2—M5 的顺序。

| 编号 | 成果 | 当前状态 | 完成标准 |
| --- | --- | --- | --- |
| M0 | 侧栏可折叠、数据区主次清晰 | v0.42 已部署 | 整栏/内部分组独立收起；草稿保留；正文随整栏显隐扩宽 |
| M1 | 基础阅读与助手体验可用 | v0.43 代码已部署，交互未验收 | Markdown/表格/代码/公式有结构；来源与记录按需展开；等高标题、悬浮全文、清楚的核对状态；右键显示与复制相同的区域虚线框 |
| M2 | 一篇论文可沉浸式双语阅读 | 下一轮最高优先级，方案阶段 | 原文/双栏/覆盖切换，译文保留原页定位；先当前页/选页，再扩整篇；失败可退回原文；同步评估手机段落重排。见 TRANSLATION-AND-MOBILE.md |
| M3 | 文献阅读 / 实验空间 / 我的资源 / 可选项目职责清楚 | 产品方案 | 参考用户层级图，资料树与按需分类不挤占正文；阅读/分析不要求建项目；实验空间复用已有原始数据保存、固定 Python/R 统计、图表与结果 |
| M4 | 检索到选中 PDF 的导入闭环 | M3 明确入口后 | 核查真实 PubMed 实现；返回候选，选择可获取 PDF 后沿现有导入链入库；摘要不当全文，保留出处与版本 |
| M5 | 多篇论文产出可追溯证据与研究成果 | 分步实现 | 可调整列的证据对照表，缺项明确、单元可回出处；后续有限额、可停/恢复的分阶段研究沿用同一助手入口 |
| M6 | 可编辑 PPTX | M5 有可靠成果后 | 选中论文/笔记/实际图表结果，核对大纲后交付可编辑 .pptx，每页保留来源 |

实验空间不重新创建计算引擎，不宣称支持任意代码或全部 SPSS。各开源项目只接具体部件，不为每个仓库新增菜单、账号、资料库或任务编排器。

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
- Kimi：回答渲染器、聊天布局、界面命名、列表/核对文案和右键虚线框；保留来源、提案、重试、跨资料权限及浮窗控制。
- DeepSeek 官方：固定版本本地 Markdown/公式静态资源准备脚本与锁定清单，不改业务后端。
- 每个候选目录只有一个写入者；仅显式额度失败按既有规则回退，瞬时连接失败同路重试一次。GLM 和历史免费路由保持禁用。

每轮结束更新总表：实际改动、交付状态、验证范围与未解决项。新需求先归档到对应项，当前迭代有明确收口后再切换。

解析层当前以 MinerU 为主候选、Marker 为替代，尚未安装或确认实际效果；BabelDOC 为保留版式翻译候选，Docling 为段落重排替代候选。不同时引入两套解析栈。依据和许可见 [翻译与手机阅读](TRANSLATION-AND-MOBILE.md)。

K-Dense 的后续贡献按数据质检 → 统计诊断 → 成果生成 → 研究任务组件排序，详见 [部件复用方案](K-DENSE-REUSE-PLAN.md)。这是候选规划，尚未接入；沉浸式翻译仍是下一轮最高优先级。
