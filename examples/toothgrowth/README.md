# 公开实验数据验收样例

来源为[R datasets::ToothGrowth](https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/ToothGrowth.html)。
R官方数据含60行，准备代码筛选dose=0.5，保留source_row，按OJ、VC排列20行。
安装R后，在新建输出目录执行 prepare-toothgrowth.R，首个参数为该目录路径。
脚本生成完整表、筛选表、R环境和独立直接运行的参考文件。原样例数据没有随仓库分发。

在工作台关联实际来源文档，导入 toothgrowth-dose0.5-20.csv。人工确认研究设计后，
可使用现有R Welch独立样本、组1OJ减组2VC、双侧95%、完整案例；图表选择
两组观测点，分组supp、观测len。运行、绘图、笔记分别确认。source_row仅为行号。
len单位在R说明未给出；不补猜。样例没有提供随机化、笼位、盲法资料，
不能据此证明独立性、因果或外推有效性。此例用于软件验收。

核对值：OJ均值13.23，VC均值7.98，差值5.25；t约3.16973278367，
df约14.9687537107，p约0.0063586067641，95%区间约[1.71905727147,8.78094272853]。
实际模型的一次目标闭环、原始20点、来源笔记与离线导出已独立验收，详见
[功能说明](../../GROUPED-OBSERVATIONS.md)与[验证记录](../../VALIDATION.md)。
