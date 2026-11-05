# K-Dense 对 research workspace 的贡献与接入范围

2026-11-03 只读调研。此文是选取部件的方案；没有把 K-Dense 技能、脚本、模型或完整应用接进本平台。

这里实际记录的是 Scientific Agent Skills 和 K-Dense BYOK；K-Dense Web 未列作本次开源源码来源。
其他候选见 [开源来源总表](TASK-PLAN.md#开源来源与产品关系)，近期安排见 [近期计划](NEAR-TERM-PLAN.md)。

## 两个来源

- [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills)：包、数据库及研究流程的操作说明，部分目录另有可执行脚本。说明、代码、依赖和运行权限需分开确认。
- [K-Dense BYOK](https://github.com/K-Dense-AI/k-dense-byok)：完整的本地研究助手应用。README 描述项目文件、聊天、分析代码、成果、执行记录、恢复与布局协作；这些属于进一步核查的交互和模块候选，目前未完成其具体模块依赖审计。

## 先取哪些部件

| 优先级 | 本平台的实际问题 | 可复用候选 | 必须适配的部分 |
| --- | --- | --- | --- |
| 1 | 上传数据后不清楚字段、缺失与质量 | EDA 的 tabular_profile.py、capability_manifest.py、缺失/泄漏检查等 | 原数据 hash、字段语义、输入/行数边界；只保存真实聚合结果，接入当前原始数据预览与助手 |
| 2 | 助手需要依据研究设计提出统计方案 | statistical-analysis 的诊断脚本与方法说明 | 结合配对/独立、重复测量与目标量；诊断不自动决定方法；计算走现有受控任务与结果校验 |
| 3 | 把有出处的证据和实际结果交付为图表/报告/PPT | 相关科学写作、可视化与幻灯片技能及资源 | 先逐项审计脚本/依赖，再接现有产物保存；引用来自真实来源，统计值来自实际计算；不把大纲文本当 .pptx |
| 4 | 后续多步研究需要恢复、耗时/费用限制和成果轨迹 | BYOK 中的研究流程与执行记录模块候选 | 先阅读具体源码与依赖，不引入第二套聊天状态、资料归属、模型凭据或全局编排器 |

已核对的 [tabular_profile.py](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/exploratory-data-analysis/scripts/tabular_profile.py) 实际导入同目录的 `_capabilities`、`_common`、`_tabular`，有路径根、文件大小、行数与输出边界。不能只复制入口文件就认为完成集成。

已核对的 [assumption_checks.py](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/statistical-analysis/scripts/assumption_checks.py) 提供统计诊断，依赖 NumPy、Pandas、SciPy、Matplotlib。其说明明确“不拒绝”并非验证前提，独立性需研究设计判断；这不能扩写为“自动完成全部 SPSS”。

## 与已有候选的关系

PDF.js 继续负责原页阅读/批注；MinerU 是结构解析主候选，BabelDOC 是版式翻译候选。K-Dense 的程序知识和经审计的小型脚本补充检索、实验数据质检、分析辅助和成果生成。它们消费同一份本平台明确授权的资料，不因添加技能而扩大助手文件访问、网络上传或代码执行权限。

保留当前原始数据、分析、图表和笔记的归属与来源。模型可提出受控能力请求；技能里的命令不能未经适配直接成为任意 Shell/Python 执行入口。tFUS 的队列、脚本选择与回环边界保持原状。

## 许可与当前状态

Scientific Agent Skills 仓库声明 MIT，同时要求逐技能检查 SKILL.md 的 license；外部包、模型、数据库与服务条款继续分别适用。BYOK 当前仓库标示 MIT，具体抽取仍需保留许可并审计依赖。

上述贡献按实际文件/依赖逐项接入，不整体部署，不全量加载全部技能，不把 README 功能或自报基准当成本平台已交付能力。
2026-11-05用户已调整优先级：先易上手分析、科研绘图 skill（含 Nature/Cell 等视觉预设）、可编辑 AI PPT，再继续阅读。
绘图预设只控制视觉，不改数据/统计，也不等于满足具体期刊投稿要求。今天范围见 [近期计划](NEAR-TERM-PLAN.md)，医生完整需求见 [需求记录](CLINICIAN-REQUIREMENTS.md)。
