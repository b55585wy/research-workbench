2026-11-03 新增 React 迁移切片与明确的 Agent 编排、RAG 文献问答、Python/R 扩展方向，见 [架构决定](ARCHITECTURE.md) 和 [总任务表](TASK-PLAN.md)。近期按 React 阅读入口、双栏翻译、覆盖/手机重排推进，多账号服务端数据隔离列为上线条件，详见 [近期任务计划](NEAR-TERM-PLAN.md)。这是目标决定；线上仍为 v0.43，尚未开始 React 迁移。

2026-11-03 当前总排序以 [TASK-PLAN.md](TASK-PLAN.md) 为准。v0.43 完成阅读/聊天
基础体验代码更新；下一轮优先 [沉浸式翻译与手机阅读](TRANSLATION-AND-MOBILE.md)，
再推进整体产品层级、检索/证据和可编辑 PPT。历史版本与候选能力不等同于已接入。

# 研究工作台：轻量路线图

2026-11-03 产品定位已确认：阅读、数据分析可独立使用；项目是按需关联论文、数据、
结果和笔记的整理功能。v0.38 已接入独立入口和“我的数据”；v0.40 补齐已有数据、成功分析和图表的项目关联。
定义与现状边界见 [产品规划](PRODUCT-PLAN.md#已确认的产品定位独立使用按需组织)。

本页记录版本交付与需求背景。整体产品画像、近期优先级与每轮完成标准见
[PRODUCT-PLAN.md](PRODUCT-PLAN.md)；后续按实际任务验收，不按功能清单一次性铺开。

当前版本 v0.42.0：[数据区与列表整理](DATA-WORKSPACE-CLARITY.md)，收敛手动参数与项目资料，减少论文列表圆角/厚重装饰，补齐关联论文错误反馈。接口与 schema22 保持原状，按用户要求未运行测试。

v0.41.0：[参考数据分析](REFERENCE-ANALYSIS.md)在明确授权与逐项确认后，调用已有 Python/R 描述统计，结果保存在原数据位置，当前聊天可读取实际结果。修正富文本编辑器打开即阻止工作区切换的误判，保留真实未保存修改与活动写入保护。按用户要求未运行测试。

v0.40.0：[项目资料整理](PROJECT-RESOURCES.md)提供非迁移式关联、来源跳转与失效关联移除。

v0.39.0：当前助手对话可引用跨项目论文与数据，见 [AGENT-REFERENCES.md](AGENT-REFERENCES.md)。
v0.38 入口改版见 [WORKSPACE-ENTRIES.md](WORKSPACE-ENTRIES.md)；阅读体验历史见 [EXPERIENCE-PLAN.md](EXPERIENCE-PLAN.md)。
下方版本条目保留历史背景，不能将历史待办重新当作当前缺口。近期优先用已上传论文
和明确问题形成一份有出处的阅读成果，再据实际缺口安排下一轮开发。

v0.12：复用 pyreadstat/ReadStat 读取 .sav/.zsav，保留原文件和字段字典；核对编码、
标签与缺失规则后，确认生成独立分析表，接入已有 Python/R、图表和 Agent 路径。
转换记录随分析导出；不自动推断研究角色或共享数据。品牌改为仅显示 Synrise Neuro 文字。

v0.11 主题完善：可切换的蓝白主题和圆润控件覆盖现有工具与弹窗，保留默认主题及研究内容。
按用户反馈移除标题及空状态的口袋弧线和 Logo 铃铛；随后在 v0.12 移除品牌图标。
以独立本地 Git 仓库保存源码。

v0.1–v0.3 已交付：本地 PDF 阅读、出处笔记、图片摘录、修改与恢复、手动复核、离线导出。

v0.4 已交付：PDF 上传与重复提示；论文及有效笔记搜索；手动校正文献标题、作者、年份、DOI；“哆啦A梦蓝”主题。

v0.5 已交付：上传图片、图片笔记、理解当前页/笔记/所选图片的阅读 Agent；多步受控工具调用、来源记录、逐项确认后保存、会话恢复。

v0.6 已交付：CSV/TSV 上传、预览、选择数值列、真实 Python/base R 描述统计、独立工作进程、取消/中断记录、输入/代码/环境/日志/产物追溯及离线导出；Agent 在明确共享数据后提出分析方案，确认后执行并读取校验结果。模型连接可只读复用；账号与执行面保持独立。固定统计代码不是任意用户脚本运行能力。

v0.7：直接复用 JupyterKit 原组件，显示已保存 Python/R 分析的只读 Notebook，提供标准 `.ipynb` 下载并加入原分析 ZIP。Agent 可在明确共享数据后绑定当前分析并读取保存代码/输出。沿 RSpace 依赖链确认了这个独立部件，未抽取 RSpace 自有业务模块；没有引入编辑器、kernel、任意脚本、Notebook 上传或新数据库对象。来源和后续候选取舍见 [SOURCE-REUSE-PLAN.md](SOURCE-REUSE-PLAN.md)。

v0.9：原版 OpenSeadragon + Annotorious 嵌入本产品，上传图/已保存 PDF PNG 的查看、矩形说明、修订、删除恢复，Agent 读取/提案/明确确认，以及静态离线导出。标注绑定确切来源与预览版本；独立于 PDF 笔记坐标。原始图片与论文均不改写。组件复用不包含 RSpace 自有模型。下一项为科研结果交互可视化，先用已保存分析产物验证一条流程。

v0.10：首版实验图表，用原版 Plotly strict 组件显示成功分析的有效/缺失数、原始单列分布与双列散点，保存精确数据、参数和版本；支持生命周期、笔记引用、离线交互导出，以及 Agent 发现能力、预览、提案和确认。以合成数据完成软件验收，尚不构成真实实验结果验证。

账号状态：尚未实现分账号、登录或多用户授权 API；跨服务已认证 actor 仍是设计要求。
工作台首版方案于 2026-11-03 调整为单机默认本地游客，资料存在用户本机后端，
无需注册登录，多账号管理延后；不等待 tFUS 的 W10-A。以后明确迁移游客资料归属，
再通过可信外部身份适配和账号映射接入 tFUS。游客不表示已认证或多人隔离；当前
多人授权未实施，不抽取主工程未完成的共享包。

v0.13：默认关闭的三步接续任务已交付。一个明确目标可在逐项确认下推进分析、
图表和来源笔记；实际成功后才进入下一步，支持停止、来源复核后继续及重启暂停。
已用公开表2和实际模型验证一次目标闭环；真实实验表验证仍待选定材料。
接口、迁移及恢复约束见 [AGENT-TASKS.md](AGENT-TASKS.md)。

以下为 v0.13 时记录的后续候选，不承诺按编号全部开发。第1项的助手跨论文读取与表格
已在 v0.26 交付；第2项的在线元数据发现与引用已在 v0.28 交付，文件下载仍未实现：

1. 围绕研究问题整理、比较两三篇论文的证据；每个判断可回到原文。
2. 在线资料与引用：逐项接入公开数据库、文献接口或用户指定链接，记录来源 URL/标识、获取时间、版本、原始文件及校验值；引用能对应实际取得的资料。
3. 在已交付的 Python/R 固定统计流程上选择真实数据和明确分析任务，再验证用户自定义代码、已有本地产物导入及所需执行隔离；扩展输入、代码、参数、环境、日志与输出记录。
4. 扩展已有阅读 Agent：只在真实数据与分析任务验证后增加在线资料、引用及分析工具；操作及产物可追溯。Python/R 在独立分析进程中执行，用户分析代码与 tFUS 的受控 Agent 执行面保持独立，不占用声场评分队列。
5. 关联获准导出的 tFUS 结果；有明确协作者后再验证共享范围、成员权限、个人草稿和撤销。

继续采用可嵌入的成熟开源库或经依赖/许可核对的源码部件，不以整套科研平台部署为产品目标。先完成一条真实流程，再确定对象模型与共享代码。

在线数据发现与空间控制（元数据发现/引用已交付，下载与配额管理尚未实现）：从数据可用性声明、DOI 关联元数据、数据库登录号或用户链接寻找候选数据；区分直接可下载、需申请与仅描述性引用。候选需确认，识别到引用不等于拥有数据。默认仅保存来源与引用信息，不自动镜像整库。下载前显示可获得的文件大小与存储位置，提供下载到本机和按需保存到独立分析存储两条路径；后者设置配额、内容去重、可见保留策略与明确清理入口。引用保留版本、获取时间、许可信息与校验值，不把临时缓存当成永久研究资料。

数据关联接口可参考 [DataCite 关联标识说明](https://support.datacite.org/docs/connecting-to-works)；关联信息不保证对应数据公开可下载。

## v0.8 格式笔记与后续顺序

复用独立 Quill 编辑器，增加与出处笔记共用保存、修订、确认流程的格式编辑。
支持有限文字格式、纯文本转换、HTML/JSON 导出和助手格式建议；现有笔记不自动转换。
详见 [RICH-NOTES.md](RICH-NOTES.md)。

用户确认依次推进：格式笔记 → 图片查看/标注与附件交互 → 科研结果交互可视化 →
任务明确后的自定义 Python/R 分析 → 身份与共享空间。每项先核对上游独立部件、
依赖、许可和一条真实流程，再扩大范围。坚果云等作为文件/备份候选，活跃数据库
仍单点写入；未配置云账户或自动上传，见 [STORAGE-AND-BACKUP.md](STORAGE-AND-BACKUP.md)。

v0.11：首个独立样本 t 检验，直接复用 jmv 的实际计算层 R stats::t.test，
支持明确参数/完整案例预览、确认运行、结果保存/Notebook/引用/导出及 Agent 工具。
jmv 隔离安装后发生退出崩溃，未部署；不声称移植了 jmv 或拥有 SPSS 引擎。
下一步再验证 haven 的文件标签/缺失语义，以及有真实需求的后续统计方法。
依据见 [STATISTICAL-TESTS.md](STATISTICAL-TESTS.md) 和 [STATISTICS-SOURCES.md](STATISTICS-SOURCES.md)。

## v0.12 交互改进：任务工作区

将阅读、数据分析作为两个主任务，分析设置和结果进入中央；图表与所选数据关联，
笔记按需展开。统一数据导入并保留 SPSS 核对、失败原请求重试和全部运行确认。
接口、运行环境、数据库及 tFUS 边界保持现有约束。见 [WORKSPACE-WORKFLOW.md](WORKSPACE-WORKFLOW.md)。

## 真实材料与实际模型：首轮闭环验证

使用现有论文表2的已发表CPU/GPU平均耗时完成实际模型7轮调用、固定Python分析、
交互散点图、来源笔记和三类导出。确认前无对应写入，保存的五个点与原表一致；
26个导出文件哈希核对，停止验收服务后图表可离线交互。正式资料未写入。
没有新统计方法或执行权限。原始数据需向作者申请，后续原始实验任务尚待材料。
说明与CSV见[REAL-DATA-PILOT.md](REAL-DATA-PILOT.md)。


## v0.14 两组观测点与公开实验流程

在现有图表入口增加分类组别与每条观测值的表达，保留源行号和缺失原因。
复用现有原版Plotly、确认、来源笔记与离线导出，原图型指纹和schema11保持兼容。
用R公开ToothGrowth固定剂量数据完成实际R检验→分组图→来源笔记的逐项确认验收，
与独立数值参考比对。它不替代用户真实数据及设计确认。
详见 [GROUPED-OBSERVATIONS.md](GROUPED-OBSERVATIONS.md)。


## v0.15 可追溯数据筛选

当前表内选择一列和一个原始值，预览数量后确认生成独立分析表，保留原表、
源行顺序、逐行来源和固定代码。分析/绘图导出携带完整来源链；Agent新表重新
授权，连续任务固定源。schema12仅新增一表，旧流程与tFUS边界保持原约束。
验收说明见[DATASET-SELECTION.md](DATASET-SELECTION.md)。


## v0.16 统一研究记录

从当前数据选择已有分析、图表和本篇有效阅读材料，预览后下载带离线入口的
完整记录；来源、代码、参数、SPSS字典和筛选行号保持可追溯。Agent准备范围，
用户核对并下载；不改变研究状态。复用原三类导出器，schema12不变。
参见[RESEARCH-RECORD.md](RESEARCH-RECORD.md)。

## v0.17 数据起步的研究

无论文创建研究并完成数据→分析→图表→来源笔记→统一导出；可关联既有真实论文。
复用现有计算和组件，明确空页码与来源指纹；schema13三表及条件空值迁移保留旧值。
修正嵌套存储连接与后台写入互锁，最外层事务统一提交/回滚。
产品与接口边界见[说明](DATA-FIRST-STUDY.md)。

## v0.18 统一资料搜索

一个搜索框查研究名称/问题、论文元数据和当前有效笔记，按真实来源回到工作区。
保留旧搜索默认响应、草稿与显式共享规则；无数据库迁移或新依赖。见 [说明](UNIFIED-SEARCH.md)。

## v0.19 配对 t 检验

现有数据入口内增加唯一对象ID、两列顺序、完整对预览与声明，确认后调用固定
R stats::t.test(paired=TRUE)。保留行/ID映射、准备代码、结果与环境，接入 Agent
提案、连续任务、Notebook、笔记与导出。旧配方/请求兼容，schema13不变。
见 [配对方法](PAIRED-T-TEST.md) 与 [公开样例](examples/sleep/README.md)。


## v0.20 结果与助手入口

结果先显示核心摘要，完整精度和来源可展开；当前数据旁提供分析助手草稿入口，
继续要求明确共享和发送。低频论文关联/来源标识折叠，沿用现有保存与审核。
无API、schema或统计计算变更。见[说明](RESULT-WORKFLOW.md)。


## v0.21 阅读与资料管理

补齐文字选择、可见图片选区草稿、永久删除笔记和论文重命名/回收/恢复。
阅读流程参照Zotero，文字层直接复用已有PDF.js，不修改原始PDF或统计配方。
schema14仅增加两个生命周期表，旧数据原样保留。见[说明](READER-LIBRARY.md)。


## v0.22 文字批注和助手引用

当前页逐行高亮/下划线、四种标色、修改样式/说明、同一笔记删除恢复，
明确加入Agent待发送引用。来源和版本由服务端解析，原始PDF与旧接口保留。
见[说明](TEXT-ANNOTATIONS.md)。


## v0.23 查找、整理与上下连续阅读

现有阅读区增加本地文内查找、临时命中定位、笔记/原始引文筛选和多选加入助手。
连续阅读按需渲染最多五页，页码、选区和助手上下文绑定实际页；保留单页模式。
复用已有note_refs和PDF.js，无新依赖/API/schema。见[使用说明](READING-TOOLS.md)。


## v0.24 · 接续阅读

普通重开论文恢复当前浏览器保存的页码与页内位置，笔记、图片、有效页码及分析出处优先。沿用单页/连续模式；记录按论文 ID 和原文件 SHA256 隔离。存储失败不阻塞阅读；不增加服务器对象或共享空间接口。详见 [READING-PROGRESS.md](READING-PROGRESS.md)。


## v0.25 · 阅读成果带出工作台

现有导出区域新增带原生高亮/下划线、区域/整页说明的 PDF 副本，按服务端已保存有效状态生成。使用已安装 pypdf/PDFium，在固定受限子进程中处理；原文、旧 ZIP、数据库与模型授权不变。完整附件、富文本及独立图片批注继续使用阅读记录。见 [说明](ANNOTATED-PDF.md)。


## v0.26 · 2026-11-02 · generic Agent reading and table replies

Use the existing research/Agent conversation to read associated PDF pages, compare with real source refs, ask follow-up columns and display/copy/download ordinary tables. No dedicated comparison page/configuration/data model. Historical evidence stays version/association-bound; old messages remain chat history. Scope and limits: [AGENT-READING.md](AGENT-READING.md). Verification is scoped smoke only.


## v0.27 · 2026-11-02 · correlation through existing Agent/analysis UI

Pearson/Spearman via the existing verified R stats library, explicit two-column complete observations and design declaration, preview→confirmation→independent execution→results/Notebook/export. Existing Agent continuous tasks can confirm correlation, scatter and source-note stages. No new page/dependency/schema or arbitrary-script surface. Scope and statistical limits: [CORRELATION.md](CORRELATION.md); validation is scoped smoke only.


## v0.28 · 2026-11-02 · online data-source references through the existing Agent

Bounded public DataCite/Zenodo metadata lookup/search, exact returned identifier/relationship checks,
access/unknown-state disclosure and safe new-tab source links. Server-generated reference notes use
the existing concrete create_note approval, lifecycle and export; removed paper associations and
source drift block stale proposals. No file downloads, new panel, dependency, database migration,
authentication or tFUS surface. See [scope and use](ONLINE-DATA.md). Verification is scoped smoke.


## v0.28.1 · 2026-11-02 · bibliography draft and reader layout

User-authorized automatic bibliography lookup enters the existing unsaved editor with explicit
source, preserving missing/manual fields and existing save/revision/cancel. Reading-mode notes
visibility now releases/restores actual space; fit-width adapts while custom zoom stays fixed.
Opaque backing canvases initialize fully white before render. No left-navigation redesign;
that question remains discussion only. See [delivery](BIBLIOGRAPHY-AND-LAYOUT.md) and
[remaining experience requirements](EXPERIENCE-PLAN.md).


## v0.30 · 文献生命周期补齐

交付 L1：文献回收站的预览、确认、彻底删除、失败重试与重启清理。保留原恢复入口，
不拆出新面板。schema16只新增删除凭据表。下一批体验需求仍见 EXPERIENCE-PLAN.md；
reader-actions-v1 仍是未交付候选，未混入本轮。


## v0.31 · 用户指定的五组体验目标

N1/N2/N3/A1/A2/A3/A4 统一接回当前产品，逐项合成冒烟后部署；不把旧隔离候选
当成已完成。阅读/分析分栏与导航仍只讨论。实际验收与使用见 READING-EXPERIENCE.md。
reader-actions-v1 仅保留历史，不得覆盖本版本。
