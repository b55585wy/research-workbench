# 配对 t 检验 · v0.19

在现有“数据与分析”里选择“配对 t 检验”。数据采用宽表：每行一个对象，一列唯一
对象标识，加两列可相减且单位一致的测量。选择第一列、第二列及 ID，明确核实
配对设计，预览完整/排除对数与固定代码，再确认运行。差值始终是第一列减第二列。

ID 不得重复、为空、有首尾空格/控制字符或超过200字符；大小写和前导零保持原样。
一侧或两侧测量缺失时整对排除，分别报告三类原因。非数值、非有限差值、少于两对
或恒定差值拒绝执行。不按行顺序跨表配对，不自动合并 ID 或切换独立样本方法。

统计计算直接调用已校验 R stats::t.test(paired=TRUE)，支持双侧/单侧与50%–99.9%
置信水平。配对关系、对象间独立性、差值分布、异常值、量纲与设计适用性由用户核实。
软件只验证输入形式，不证明这些科学假设，也不从 p 值推断临床、因果或普遍有效性。
本轮只支持每对象一对测量，不提供多时点模型或自动长宽转换。

## 结果与追溯

两列的描述统计都只使用完整配对；n 是有效对数，排除对数不是各列单独缺失数。
结果另存差值统计、t、自由度、p、差值均值、标准误和区间。单侧区间明确表示
无穷边界。Notebook 展示保存结果，不重新执行。可加入来源笔记并统一导出。

原始输入保持不变。分析产物包含规范输入、pair-map.json（原始行、原 ID、是否
使用及排除原因）、准备源码及哈希、固定 R 代码、参数、环境/组件锁和原始 R 结果。
配方指纹同时绑定输入准备源码；读取配对结果、Notebook 和导出时校验全部产物。
取消、中断、失败与结果损坏不会被当作有效输出。网络不确定时用原请求编号重试。

Agent 先查看已安装能力，只能使用明确共享的数据。preview_paired_t_test 是只读
检查，不产生 p 值；propose_paired_t_test 产生具体待确认方案。确认后才入独立
工作进程。连续任务可接续散点图与来源笔记，每项写入仍需确认，笔记保持未复核。

## 已有接口的扩展

GET /api/v1/analysis/methods 增加 ttest_paired；对应配方是
/api/v1/analysis/recipes/r?method=ttest_paired，id=ttest-paired-rstats-v1。
POST /api/v1/documents/{owner}/analyses/paired/preview 接收完整分析参数；实际运行
沿用 POST .../analyses：engine=r、method=ttest_paired、columns=[第一列,第二列]、
paired={unit_column,alternative,confidence,missing:complete_pairs,paired_samples_confirmed:true}，
以及 request_id、dataset_id/dataset_sha256、recipe_sha256、library_sha256。
paired 与旧 ttest 选项互斥。旧描述统计及独立样本的请求指纹/配方保持兼容。
本轮没有新依赖、数据库迁移或执行权限；仍是 schema13、28表、本机单人服务。

公开验收材料与步骤见 [sleep 样例](examples/sleep/README.md)。R 的
[配对接口说明](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/t.test.html)
是计算语义来源，数值另以独立60位精度参考核对，不能把软件验收当作实验设计验证。
