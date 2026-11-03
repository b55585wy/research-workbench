# 源码复用纠偏与首轮评估

日期：2026-10-31。v0.7 已接入独立上游 JupyterKit 3.0.0 原组件。
未抽取 RSpace 自有业务模块；沿其依赖链复用成熟部件，页面、记录与执行进程仍由本工作台负责。

## 推进顺序

先把已确认的阅读、笔记、附件、分析产物需求映射到具体上游实现，再决定开发。
每个候选必须记录原仓库、固定版本/提交、源文件、依赖、许可、输入输出与替换收益。
选一个完整能力做隔离验证，通过后以薄适配层接入我们的页面与接口，再替换对应自研部分。
移植重写、设计参考、独立依赖复用、RSpace 自有业务源码抽取分别记录，不互相冒充。

未验证的假设：RSpace 所有模块都能独立运行；复制部分源码不带依赖/许可约束；
候选功能一定符合我们的产品需求。这些都不能作为实施依据。
已验证事实：当前产品使用原生 JavaScript/FastAPI；RSpace 所查服务依赖自己的
用户、记录、权限、持久化与会话；部分界面能力来自独立上游组件。
因此先验证组件边界和收益，再做接口适配，保留现有资料格式与 tFUS 边界。
按功能名称直接复制目录会把隐含依赖一并带入；本轮以实际依赖和运行证据作取舍。

## 固定源码

官方仓库：https://github.com/rspace-os/rspace-web

审查提交：`a0d333ea0652bbeee0bcd90f92684554bd69ce03`，共 9,118 个文件路径。
这是用于审查的固定 main 提交，尚未选定产品发布依赖版本。
仓库 LICENSE 为 AGPL-3.0；拟复用文件与其第三方依赖的许可须逐项核对、保留声明。
本轮没有把 RSpace 业务源码复制进产品，也没有改变产品许可。

## 首轮取舍

| 能力与源码 | 已查到的依赖 | 当前结论 |
|---|---|---|
| `service/impl/RecordManagerImpl.java`、`model/record/Notebook.java` | DAO、User、权限、会话、事件、Hibernate 实体/审计 | 不作为直接复制目标；需要先界定独立能力，不能把整个记录服务当可插拔库 |
| `Inventory/components/Fields/Attachments/Attachments.tsx` | React、MUI、MobX、useStores、AttachmentModel、InventoryRecord | 不直接搬入当前原生 JS 页面；尚无独立运行验证 |
| `webapp/integrations/datacite/DataCiteConnectorImpl.java` | RSpace 系统属性和 Spring；另调用独立 DataCiteClient | 继续审查下层独立客户端；未验证接入，也不代表能找到或下载论文原始数据 |
| `eln/jupyter-notebooks/index.tsx` | JupyterKit、React/MUI、RSpace axios、`/Streamfile/{id}`、附件/字段 DOM | 不复制整页；其下层独立渲染核心是已验证候选 |

上述路径分别相对于 `src/main/java/com/researchspace/` 和
`src/main/webapp/ui/src/`。完整代码、文件校验值与依赖证据见任务审查目录。

## 已完成的隔离验证：Notebook 渲染

RSpace 的 Notebook 页面实际使用 `@jupyter-kit/*`。其核心提供原生 DOM API：
https://github.com/walkframe/jupyter-kit

本轮固定 `@jupyter-kit/core@3.0.0` 与 `@jupyter-kit/theme-default@3.0.0`
（包内许可均为 Apache-2.0），保留锁文件、许可、构建结果与校验值。
测试宿主直接调用其核心 API，未重写渲染器，也未引入 RSpace 后端或 React。
这属于沿 RSpace 依赖链找到并复用独立部件，不是 RSpace 自有业务源码抽取。

6 项真实浏览器检查通过：Python 已保存 Markdown/代码/输出、表格/图片、
R 代码与已保存输出、不安全 HTML 清理、390px 布局、无外部请求。
JS 包实测 723,532 字节，gzip 后 228,934 字节；这只是测试配置的体积。
隔离验证没有运行 Notebook 代码，没有接入 kernel/编辑/执行插件。
合成保存结果只用于渲染验收，不是新计算或科研验证。临时服务已关闭。

## v0.7 产品接入

已把现有已校验分析记录转换为标准 nbformat4.5，交给原组件的原生 DOM API 渲染。
薄适配层仅负责绑定任务、加载、关闭、错误和原字节下载；未重写单元格渲染。
真实 Python/R 保存记录、标准格式、历史记录重启、导出字节、错误/篡改/大小限制、
移动端和原有功能回归均通过，具体接口与证据见 NOTEBOOK-VIEW.md、VALIDATION.md。
包版本、锁文件、原许可证和生成文件校验值保存在 scripts/notebook-assets/ 与
frontend/vendor/notebook/manifest.json；离线校验入口为 scripts/prepare_notebook_assets.py --verify。

读取/持久化仍使用我们的接口，保留原记录标识、来源、代码与校验值；数据库仍为
schema6/16张表。没有新增用户目录、共享空间、Notebook 实体或替换执行进程。
没有 Notebook 上传、编辑器、kernel 或任意代码运行能力。RSpace 业务模块的抽取
仍未完成，不能用这次独立依赖复用代称。

其余功能也按同样流程逐项核对。复用收益不足或边界不合适的模块，记录依据后更换
候选项目；不为使用 RSpace 而迁移整套应用，也不继续默认由我们重写全部能力。

## 证据

- 审查：`E:/research-workbench-pilot-20261030/rspace-source-audit/source.json`
- 源文件/校验：同目录 `sources/`、`source-files.json`
- 组件锁定/构建：同目录 `proof/package-lock.json`、`proof/dist/`
- 浏览器：同目录 `proof/browser-result.json`（6 项）
- 结果与清理：同目录 `proof/result.json`
- 截图：同目录 `proof/notebook-component-proof.png`
- 产品接入：`E:/research-workbench-pilot-20261030/reader-v7/`

## v0.8 独立富文本部件

直接使用上游 [Quill2.0.3](https://github.com/slab/quill/tree/v2.0.3) 的编辑器、
工具栏、剪贴板与历史模块，本地锁定构建并保留许可。未重写编辑器，未移植
RSpace 的 TinyMCE 页面或记录/附件插件。保存、出处、修订仍遵循本应用已有边界，
结构化正文校验和导出适配属于本应用代码。详见 RICH-NOTES.md；验收证据位于
E:/research-workbench-pilot-20261030/reader-v8/。这属于独立组件复用。
# v0.9 image component decision

v0.10 visualization reuses the original pinned Plotly strict4.2.0 browser library.
Our source verification, bounded numeric projections, persistence, confirmations
and citation UI remain first-party. Galaxy/openBIS were reviewed as workflow/data
management references; no claim is made that their application modules were
extracted. Original distribution and licensing provenance are locally retained.

OpenSeadragon 6.1.1 + Annotorious 3.9.5 are embedded original components.
Our host supplies source verification, persistence, drafts, explicit confirmation,
export and application navigation. Native viewer handles pan/zoom/rectangle editing.
No RSpace server, user/project/file model, Svelte application migration or notebook
kernel is introduced. Upstream is unmodified. Component proof verifies all eight
JPEG EXIF orientations plus PNG/WebP fixtures; product annotations use normalized
previews to avoid raw-orientation coordinate drift. Source originals remain exact.

## Statistical components: reviewed, not integrated

v0.10 reviewed jamovi's standalone R package jmv, haven file import and JASP's
t-test module. v0.11 evaluated a locked isolated jmv installation, but observed
Windows access violation on exit even with package loading only; it is not a
product runtime dependency. The reviewed jmv Student/Welch branches call R t.test.
The first product method therefore directly reuses this mature R stats component,
without a whole application or a rewritten statistical engine. haven/SPSS file
import remains pending. Source/diagnostics/actual integration are documented in
STATISTICAL-TESTS.md and STATISTICS-SOURCES.md; no full SPSS compatibility claim.



## v0.14 grouped observation component reuse

The unchanged pinned original Plotly strict4.2.0 now also renders categorical
group/raw numeric observations through its existing scatter trace. Host adapters
provide closed source-bound parameters and fixed point projection, not a new
plot engine or RSpace business model. R stats::t.test and datasets::ToothGrowth
are reused for an isolated public-data workflow verification; no new R package,
inferential method or arbitrary-code runtime is added. The independent mpmath
numeric reference is test-only and is not an application dependency.


## v0.27 相关计算部件

新增直接复用已有 R stats::cor.test 的 Pearson/Spearman 内核；输入规范、明确确认、独立执行和产物追溯属于本应用。没有部署上层统计平台或新引入R依赖。见 [方法边界](CORRELATION.md)及 STATISTICS-SOURCES.md。


## v0.28 · public metadata adapters

Reuse existing Python standard-library HTTPS/JSON handling, source registry, approved note writes,
rich-text validation and exports. DataCite relatedIdentifier and Zenodo record APIs supply actual
public metadata; no whole research platform, API client dependency or file mirror was introduced.
Provider-reported relationship/license/access remain separate from verified underlying data.
Official API references and actual supported scope: [ONLINE-DATA.md](ONLINE-DATA.md).
