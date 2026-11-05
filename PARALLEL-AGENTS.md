# 多 Agent 并行开发与 app.js 拆分

当前选择：保留一个仓库和现有部署单元，逐步把功能状态与实现从 `frontend/app.js` 移入独立模块。目标是多个 Agent 能独立实现、独立验证，通过明确接口集成。

v0.63.0 已交付 `research-shell` 与 `notes-workspace` React 视图、原生工作区只读订阅和明确生命周期适配。实际文件归属、接口与未迁移部分见 [本轮组件边界](UI-COMPONENT-REFACTOR.md)；下表其余目录仍是目标，不能视为已全部实现。

v0.64.0 新增独立 `chart-skills` React 控制器／组件和后端版本配置模块，官方 DeepSeek 后端与 Codex 前端按冻结契约并行实现、Codex 集成验收。接口见 [自定义绘图 skill](CUSTOM-CHART-SKILLS.md)；共享 charts/app 接线仍由集成人单独修改。

## 判断依据

同一份可变状态由多个实现者同时修改，会产生覆盖、时序和合并冲突；只有文件分开、状态仍相互直接访问，也不能独立验收。当前约 9,000 行的 `app.js` 同时管理阅读、笔记、书目、上传、导航及多种工具连接，是主要共享修改点。

拆分以状态和生命周期为单位。模块持有自己的状态，通过少量公开操作、只读快照和显式用户动作回调连接。先抽取当前需求触及的边界，让产品持续可用，再迁移余下实现。

## 代码与状态归属

以下 `web/src/features/` 为目标布局，不表示整个目录已迁移完成。当前原生实现经适配器逐个迁移到 React/TypeScript；PDF.js、富文本编辑器和绘图库保留明确的 imperative adapter。

| 模块 | 自己管理的内容 | 对外接口示例 |
|---|---|---|
| `reader` | PDF 加载、页码、缩放、选区、定位、渲染生命周期 | `openDocument`、`goToSource`、`getSourceSnapshot`、`dispose` |
| `notes` | 笔记列表/编辑、星级、筛选、图片附件选择、修改冲突 | `insertFragment`、`openNote`、`refresh`、`dispose` |
| `library` | 文献搜索、导入、书目、回收站、列表状态 | `search`、`importFile`、`openItem` |
| `translation` | 翻译创建、进度、结果展示、历史读取 | `openSavedRecord`、`translatePages`、`show` |
| `analysis` | 数据选择、方案、执行结果、图表与 PPT 接口 | `openDataset`、`openResult`、`exportResult` |
| `assistant` | 对话、草稿、显式加入的资料、任务状态 | `addReference`、`appendDraft`、`openConversation` |
| `platform` | 存储适配、阅读缓存、网络边界、配置、离线资源 | `documentRepository`、`noteRepository`、`readCache` |
| `bootstrap` | 初始化、路由、模块装配、全局设置与销毁 | 连接上述公开接口，不接管模块内部状态 |

`app.js` 逐步成为 bootstrap/兼容装配层。先保留既有 URL、DOM ID、数据格式和运行入口；新业务逻辑进入所属模块。迁移完成后再移除已不用的旧函数。

## 模块怎么协作

例如“选中文字加入笔记”：reader 输出带文献 ID、来源 SHA、页码和坐标的 SourceRef；用户点击加入笔记后，装配层调用 `notes.insertFragment`。notes 通过自己的 repository 保存，使用 revision/request_id 处理冲突。notes 不查询阅读器内部 DOM，reader 不修改笔记内部 state。

多个模块共用的数据结构放在小型 contracts 中；模块只导入其他模块的公开入口。每份状态只有一个负责人；组件卸载、取消请求、对象 URL 和事件监听均由创建它的模块释放。React 持有自己的后代节点，原生适配器持有专用容器，生命周期通过接口连接。

## Agent 编队

默认同时运行 4 个角色，具体模型由 OMP 当前配置决定：

| 角色 | 当前默认客户端 | 工作范围 |
|---|---|---|
| 协调与验收 | Codex | 工程拆解、接口、文件归属、集成、验收和发布 |
| 后端实现 | DeepSeek 官方 API | 分配的 API、存储、事务和数据库迁移 |
| 前端 Agent A | Codex | 一个功能模块的 UI 与交互 |
| 前端 Agent B | Codex | 另一功能模块或存储/阅读适配器 |

`deepseek-codex` 是当前模型路由配置；并发来自协调者明确启动多个独立任务。按功能包分工，并为每包确定唯一文件写入者。只有接口稳定、文件和状态归属不重叠时，才增加并发任务。

## 工作区、契约和集成

1. 任务卡写清共同基线提交、目标、允许修改文件、API/DTO、状态转换、验收条件、禁止范围和依赖。
2. 每个实现 Agent 使用独立分支/工作区。长期采用 Git worktree；创建前核对基线、开发配置与凭据传递，使用配置好的 worktree manager。当前 v0.61 首轮采用从同一基线复制的三个隔离候选工作区，保留各自 OMP 运行证据。
3. API 和 DTO 先定契约，前端可以针对契约开发，后端独立实现。数据库 schema 与迁移仅交给一个后端任务。
4. 主工作区单写。`app.js`、主路由、版本、构建入口等共享文件由协调者集成；工作 Agent 仅提供指定区段的候选补丁，不相互覆盖整个文件。
5. 每包完成对应的有界检查。协调者核对接口与完整流程，发现问题后只退回所属任务包修正。
6. 先集成公共接口，再集成功能包，最后做跨模块验收和一次批量发布。保留原始错误、修复与清理证据，不把任务完成声明当成验收结果。

模型额度回退仍遵守全局规则：只有明确额度失败、前一写入者确认退出后，才切换一次授权备用路线；保留角色、契约和部分成果。普通网络错误和超时不触发模型切换。

## 拆分顺序与验收门槛

| 阶段 | 交付 | 验收门槛 |
|---|---|---|
| 本轮 | 独立笔记控件、PDF 缓存适配器、译文展示规则；app.js 保留薄连接 | 同一来源/权限校验、笔记版本冲突、旧记录、移动端及原文定位保持可用 |
| 随后 | 完整 notes controller 与 reader loader/controller | 可以独立挂载和销毁，不读取另一模块内部 state/DOM；切换文献和恢复草稿正确 |
| 然后 | library/navigation 与剩余全局桥接 | app.js 只做初始化、路由、依赖注入和销毁；共享模块不存在环状依赖 |
| 持续 | 逐个迁移 React/TypeScript 功能目录 | 每个 Agent 的常规功能包不需要修改其他模块的私有实现；API、来源与用户数据兼容 |

现有 analysis、charts、presentations、translation、flow-reading 已有独立实现，后续优先统一其公开接口，避免为目录整齐而重写已工作的逻辑。抽取成功的标准是状态与依赖边界清楚、能够独立验证，同时原有用户操作继续可用。

## 历史并发任务（旧基线）

基线：`b3fce27e9d52ebc3184d325348edd15998ae776c`。

- DeepSeek 后端：独立掌握星级持久化及 reader-source 缓存校验接口。
- Kimi UI：笔记图标/色点/星级、简短图片说明、译文噪声折叠与来源图标。
- Kimi 阅读缓存：独立缓存 DB、按当前来源复用 PDF、上传文件复用和缓存清理接口。
- Codex：契约、模块边界、候选补丁集成、独立验收及发布。

本节记录任务分配，完成与上线状态另见发布记录。
