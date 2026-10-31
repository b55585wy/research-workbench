# 连续研究任务

在助手中明确共享一份数据，勾选“连续完成分析、图表和笔记”，输入一个目标。
默认关闭。进度卡按分析、图表、来源笔记三个阶段推进，每次写入仍需确认：

1. 助手提出已安装的 Python/R 分析方案，用户核对并确认。
2. 独立分析进程真正成功、结果校验通过后，自动提出图表方案。先预览再确认。
3. 图表保存后，自动读取本次分析与图表，提出含两条真实链接的来源笔记。
   确认后完成，笔记仍为未复核。

模型可以选择当前目录中已安装的方法及参数，不能运行任意代码、下载远程资料或
改变权限。材料不足、方法不适用或用户拒绝时，任务等待补充，不能冒充成功。
导出仍由界面操作。

## 停止与继续

“停止接续”停止后续模型工作和未确认写入。已经确认提交的分析是独立任务，
可在分析区域另外取消。切换共享数据或取消共享会停止接续；浏览其他论文不会
改变原任务来源。控制响应不确定时，按原请求重试，不能猜测是否已经停止。

继续时必须明确共享原数据及原选图片，来源文件校验通过。待确认提案沿用冻结内容，
已提交或成功的分析复用原记录；失败或取消的分析需要新提案及再次确认。
服务重启后任务暂停，需要重新授权继续。每次任务最多八个 Agent 回合，
同时最多五项活跃任务；每个对话只保留一个未完成接续任务。

## 接口

前缀 `/api/v1/documents/{document_id}/agent`：

- `POST /turns` 增加可选严格布尔 `continue_task`，默认 false；开启须共享 dataset_id。
  返回回合的 `context.task_id` 为根请求 UUID。关闭时保留原请求指纹与语义。
- `GET /tasks?conversation_id=UUID` 返回 `{items:[task]}`，最多二十条。
- `GET /tasks/{task_id}` 返回完整检查点。
- `POST /tasks/{task_id}/control`：request_id、expected_generation、action=stop/resume、
  context、message、reason=user/sharing_changed。stop 不带新上下文或消息；resume
  需要新 ReadingContext，可附当前步骤的补充说明，最多八千字符。

检查点含 id、document_id、conversation_id、goal、dataset_id/sha256/name、page、
reading_context、phase、status、revision、generation、current_turn_id、turn_ids、
analysis_id、chart_id、note_id、error 和时间。阶段为 analysis/chart/note；状态为
running、waiting_confirmation、waiting_analysis、needs_input、failed、paused、completed。
revision 随进度变化；generation 在停止、继续或重启失效时递增。客户端忽略旧 revision。

控制请求按 UUID 和完整内容保存冻结回执。精确重试不重做控制，改写请求返回409；
控制代次过期、阶段错误、来源变化或暂停后的确认均拒绝。原来已执行的确认回执
仍可重复读取。写入检查和确认在同一事务内，晚到回调不能恢复被停止的任务。

## 本轮设计依据

尚未验证的假设是“研究目标需要任意步骤规划器”。已知事实只有三个：模型回复
不等于业务成功；每次写入需要具体确认；本地服务会停止和重启。因此仅增加
固定三阶段检查点，复用现有回合、提案、独立分析进程和产物，不引入通用工作流。
按功能继续增加独立面板会让用户反复输入下一步，不能解决成功状态与接续问题。

v0.13 将 schema10 升级到11，只新增 agent_tasks 和 agent_task_operations，
保留原有22张表及文件。升级前备份整个 data；旧版本无法读取 schema11，
回退必须恢复升级前备份。本轮没有共享工作空间、认证目录或 tFUS 业务接入。
任务ID和 local_compat 记录不构成已认证身份。
