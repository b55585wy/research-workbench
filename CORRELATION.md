# 相关分析 · v0.27

沿用现有“数据与分析”和研究助手入口，新增 Pearson、Spearman 两种相关分析，不增加独立页面或执行环境。计算直接调用已校验的 R4.6.2 `stats::cor.test`，不在模型或浏览器里重写相关检验。

## 使用

选择同一张数据表的两列数值，选择 Pearson 线性相关或 Spearman 秩相关、备择方向，并核实每行 X/Y 来自同一观察对象、各观察行相互独立。两变量可以具有不同物理单位；这与要求两次测量可相减的配对 t 检验不同。

Pearson 需明确置信水平；Spearman 隐藏该设置。先预览完整数据与固定代码，核对有效/排除配对数和缺失原因，再确认运行。预览不计算 p 值、不创建任务。也可明确共享数据后，直接在助手中说明分析目的和设计，审核它提出的具体方案。

## 统计语义与边界

- 仅按同一原始数据行配对；缺任一项时整对排除，分别报告仅缺 X、仅缺 Y、两项均缺。描述统计同样只基于完整配对。
- 至少3个完整配对；两列须为不同的有限数值列，常量列或超出数值范围拒绝执行。不按行号跨数据表猜测对象对应关系。
- Pearson 返回 r、t、自由度、p 值；至少4个完整配对时才提供 R 的 Fisher 区间。3个配对可计算检验，但区间明确为空。
- Spearman 返回 ρ、S 和 p 值。本轮固定 `exact=FALSE, continuity=FALSE`，采用渐近 t 近似；保留并列值计数，不声称精确小样本检验，不生成 R 没有返回的置信区间。
- 完全正/负相关可有无穷 t 统计量；JSON 用空数值加正/负无穷标记表示，页面显示 ±∞，不伪装成0。p 值和缺失区间也不混用。
- 独立性、抽样方式、分布、异常值及方法是否适合研究问题仍需核实。相关本身不证明因果关系。

计算语义依据 [R 官方 cor.test 文档](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/cor.test.html)及本机锁定的 stats4.6.2；本轮没有新增第三方包。

## 结果、确认与追溯

沿用原独立分析进程、30秒限制、取消/中断、失败处理和幂等运行编号。源数据、固定 R 代码、输入准备源码及统计库 SHA256 在确认与执行时绑定；读取保存结果会校验全部产物。

产物包括规范输入、原始行映射 `pair-map.json`（从1开始的数据行，不含表头）、准备源码及哈希、R 代码、明确参数、原始 `r-correlation-result.tsv`、结构化结果、CSV、环境/统计库锁、日志和校验清单。Notebook、分析 ZIP、图表/来源笔记使用同一保存结果，读取时不重跑计算。

Agent 新增 `preview_correlation`、`propose_correlation`，只访问发送时明确共享的数据。运行提案 `run_correlation` 仍需具体确认；原连续任务可接续已注册散点图及来源笔记，三个写入阶段分别确认。核对状态不会自动变成“已复核”。

## API 与兼容性

- 方法目录增加 `correlation`，引擎 `r`，变体 `pearson/spearman`，配方 `correlation-rstats-v1`。
- POST `/api/v1/documents/{owner}/analyses/correlation/preview` 接收完整分析参数，返回 counts、完整配对 stats、pairs/ties、固定代码/库与限制说明；没有运行结果或任务。
- 实际运行沿用 POST `.../analyses`：`method=correlation`、两列 `columns`、`correlation={kind,alternative,confidence,missing:complete_pairs,independent_pairs_confirmed:true}`，以及原 request/dataset/recipe/library 校验值。Pearson confidence 为0.5–0.999；Spearman 必须为 null。
- 旧描述统计、独立/配对 t 检验的请求序列化和配方指纹保持一致。数据库仍是 schema15、31张表；不增加账号、共享空间、任意脚本执行或 tFUS 接口。

验证范围为相关冒烟：15项后端、10项页面，以及实际配置模型使用合成数据完成相关分析→散点图→来源笔记，三个阶段逐项确认。没有运行全量回归，也没有向模型发送用户真实研究数据。证据保存在 E:/research-workbench-pilot-20261030/correlation-v1。
