# SPSS 类统计能力：部件来源审查

v0.12 文件导入采用独立 pyreadstat 1.3.7/ReadStat 部件，保留变量/值标签、缺失规则和原文件，
核对后生成分析表。其 Python 接口能直接在独立进程中提供所需的字典和数据，不需要完整统计应用。
haven 继续作为 R 文件库备选；本轮没有接入它。安装与接口见 [DATA-IMPORTS.md](DATA-IMPORTS.md)。

2026-10-31。更新：jmv 已在隔离目录安装并验证，但当前环境退出崩溃，未部署。
v0.11 首个独立样本 t 检验直接复用其实际计算层 R stats::t.test；依据和运行证据见
[STATISTICAL-TESTS.md](STATISTICAL-TESTS.md)。haven文件适配、JASP与PSPP尚未接入。
没有 SPSS 引擎、SPSS语法执行器或“几乎全部 SPSS 分析”。下文保留原始候选审查依据，
实际本轮采用的组件以该方法文档为准。

## 从需求和代码边界作判断

“SPSS 支持”有三个不同目标：计算相同类别的统计方法、读取 SPSS 数据文件、执行
IBM SPSS 的命令。能完成其中一个不能证明另外两个。结果由确切的数据、分组、
缺失值规则、检验假设、参数和算法版本共同决定，软件名称不能证明结果等价。

因此先复用可独立调用的统计包和文件库，保留我们的上传、确认、执行记录、结果
引用和界面。直接迁移完整统计应用会同时引入其 UI、对象模型和执行环境，而当前
没有这些需求。首个方法必须通过独立数值验证后才加入 Agent 的已安装能力目录。

## 已核实的候选

| 来源 | 可复用能力和依据 | 约束与本轮决定 |
| --- | --- | --- |
| [jamovi / jmv](https://github.com/jamovi/jmv) | 官方明确支持在独立 R 会话中调用 jmv；包包含描述统计、t 检验、ANOVA、回归、相关、列联表、因子分析等 | 首个计算候选；无需部署 jamovi 应用。审查版本 2.8.0，GPL (>=2)。有 jmvcore、R6、car、ggplot2 等较多依赖，不是复制单个文件即可运行 |
| [haven](https://haven.tidyverse.org/reference/read_spss.html) | 独立 R 文件库；读取 .sav/.zsav/.por，保留变量标签，并可保留用户自定义缺失信息 | 首个文件适配候选；不是统计引擎。MIT + file LICENSE，包含 ReadStat；发布时需逐一保留对应许可及版权信息 |
| [JASP / jaspTTests](https://github.com/jasp-stats/jaspTTests) | t 检验 R 模块有源码；所审查模块 DESCRIPTION 标记 GPL (>=2) | 依赖 jaspBase/jaspGraphs 等自身框架；暂作备选，尚未证明可作为本应用独立部件运行。不能以单个模块许可推断整个 JASP 许可 |

[jamovi 官方 R 说明](https://docs.jamovi.org/usermanual/um_6_jamovi_and_R.html)
证明独立 R 调用能力；[jmv DESCRIPTION](https://raw.githubusercontent.com/jamovi/jmv/7704a3a1d813882af1deeb5faca2583af5fb162d/DESCRIPTION)
证明审查版本、依赖和许可。没有复制或修改这些上游代码到产品运行目录。

GNU PSPP 也列入调查，但 GNU 官方首页及手册多次获取超时；本轮没有足够原始源码
证据完成其部件边界和构建审查，不据此承诺兼容程度或接入成本。未来只有明确需要
SPSS 命令兼容时再做针对性验证，不把它与独立 R 方法接入合并。

真正调用 IBM SPSS 属于另一条接入路线，须有相应安装和有效使用授权。
[IBM spss.Submit 文档](https://www.ibm.com/docs/en/spss-statistics/30.0.0?topic=classes-spsssubmit-function-python)
描述的是向 SPSS 后端提交命令，并非把 SPSS 变成开源库。

## jmv 源码审查与选择依据

审查提交 `7704a3a1d813882af1deeb5faca2583af5fb162d`。
保存了 DESCRIPTION、NAMESPACE、ttestis 入口/实现/参数与结果 YAML、上游测试及各文件
SHA-256；证据在 `E:/research-workbench-pilot-20261030/reader-v10/statistics-source-review/source.json`。

`R/ttestis.h.R` 的 `ttestIS()` 创建 jmvcore/R6 选项、分析及结果对象；
`R/ttestis.b.R` 校验两组条件，并按参数调用 R 的 t.test 等函数。故第一种验证方式
是锁定完整 jmv 包及所需依赖，以薄适配器调用其公开入口；不抽出函数后假装已消除
依赖。若实际安装体积、耗时或输出适配不可接受，再比较底层独立包，记录改变依据。

以上是技术可行性判断，不是已完成的运行证明。具体集成与分发方式确定后还需核对
GPL 及传递依赖义务；独立进程本身不构成免除许可义务的结论。

## 接入现有产品的最小验证切片

1. 在隔离的 R 包目录安装锁定版本和依赖，记录来源、版本、许可、体积与运行时间；
   不改 tFUS 运行环境，也不覆盖现有 base R 描述统计。
2. 先验证一个明确的独立样本 t 检验：用户指定结果列、恰好两个组、组顺序、Student
   或 Welch、单双侧、置信水平和缺失值规则。Agent 可以建议，不能自行假定研究设计。
3. 通过现有独立任务进程执行固定适配器，输出结构化结果及警告；保存原输入校验值、
   方法/参数、有效及排除样本、代码/包/R 版本。沿用预览、明确确认、笔记引用和导出。
4. haven 导入另作一项验证：数值和字符串标签、自定义缺失范围、系统缺失、编码、
   日期、重复变量名、损坏/超大文件。保留原文件及字段元数据，不能先无损承诺后只留 CSV。

验收至少覆盖：已知数值样本、空组/多组/单样本组、常量列、缺失组别、非数值结果、
组顺序与单双侧、多变量缺失规则、方法不适用、包缺失、超时/取消、重复确认与重启。
对照独立公式/参考实现检查统计量、自由度、p 值、区间和样本数。没有相同设置下的
真实 SPSS 参考输出，就只称为“该统计方法支持”，不称为“与 SPSS 全面兼容”。

这些验证完成前，新方法不出现在用户可执行列表，也不允许 Agent 宣称已安装。
