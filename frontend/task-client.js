const BUSY_STATUSES = new Set(["running", "waiting_confirmation", "waiting_analysis", "needs_input", "paused"]);
const POLL_STATUSES = new Set(["running", "waiting_confirmation", "waiting_analysis", "needs_input"]);
const STOP_STATUSES = new Set(["running", "waiting_confirmation", "waiting_analysis", "needs_input"]);
const RESUME_STATUSES = new Set(["paused", "failed", "needs_input"]);
const DEFINITIVE_CONTROL_ERRORS = new Set([
  "agent_task_control_conflict",
  "agent_task_invalid_state",
  "agent_task_sources_required",
  "agent_task_scope_changed",
  "agent_task_paused",
  "not_found",
  "validation_error"
]);

const messages = {
  zh: {
    taskMode: "连续完成分析、图表和笔记",
    taskModeHelp: "默认关闭。开启后仍须逐一确认每次分析、图表和笔记写入。",
    taskTitle: "连续任务",
    taskLoading: "正在读取连续任务…",
    taskGoal: "原始目标",
    taskDataset: "原始数据",
    taskPage: "原始出处",
    taskPageValue: "第 {page} 页",
    taskOpenSource: "打开原始出处",
    taskPlan: "固定三步计划",
    taskAnalysis: "1. 分析",
    taskChart: "2. 图表",
    taskNote: "3. 来源笔记",
    taskDone: "已完成",
    taskCurrent: "当前步骤",
    taskPending: "待进行",
    taskOpenAnalysis: "查看已提交分析",
    taskOpenChart: "打开已保存图表",
    taskOpenNote: "打开来源笔记",
    taskStop: "停止接续",
    taskResume: "继续接续",
    taskStopping: "正在停止接续…",
    taskResuming: "正在继续接续…",
    taskStopHelp: "仅停止后续助手工作；已提交的分析独立运行，可在分析工作区取消。",
    taskSourcesRequired: "继续前，请重新明确共享原始数据和原任务所选图片；不会自动共享新来源。",
    taskRetry: "按原请求重试",
    taskRetryLoad: "重试读取任务",
    taskBusy: "此对话已有连续任务。请停止接续，或开始新对话。",
    running: "正在接续",
    waiting_confirmation: "等待你确认当前提案",
    waiting_analysis: "等待已提交分析完成",
    needs_input: "需要你处理后才能继续",
    failed: "连续任务未完成，可核对来源后继续",
    paused: "接续已停止，可明确继续",
    completed: "三步已完成",
    agent_task_dataset_required: "连续任务需要先明确共享所选数据。",
    agent_task_busy: "此对话已有连续任务。请停止接续，或开始新对话。",
    agent_task_scope_changed: "文献或来源范围已变化，未继续任务。",
    agent_task_paused: "任务已暂停，请明确继续后再操作。",
    agent_task_stage: "当前步骤不能执行此操作。",
    agent_task_sources_required: "请重新共享原始数据和原任务所选图片后再继续。",
    agent_task_limit: "连续任务已达到自动接续上限，请查看当前进度。",
    agent_task_control_conflict: "任务状态已变化，原控制请求未被应用；请读取最新状态。",
    agent_task_invalid_state: "当前任务状态不能执行此控制操作。",
    idempotency_conflict: "请求标识冲突，原请求未被改写。",
    source_changed: "来源已变化，未继续任务。",
    storage_unavailable: "本地存储暂不可用，请稍后重试。",
    not_found: "找不到连续任务或相关来源。",
    validation_error: "控制请求无效，请核对任务状态和来源。",
    network: "无法连接本地服务；原控制请求和草稿已保留。",
    request_failed: "操作结果不确定；请按原请求重试，不要改发新请求。"
  },
  en: {
    taskMode: "Complete analysis, chart, and note in sequence",
    taskModeHelp: "Off by default. Every analysis, chart, and note write still requires your confirmation.",
    taskTitle: "Continuation task",
    taskLoading: "Loading continuation task…",
    taskGoal: "Original goal",
    taskDataset: "Original data",
    taskPage: "Original source",
    taskPageValue: "Page {page}",
    taskOpenSource: "Open original source",
    taskPlan: "Fixed three-step plan",
    taskAnalysis: "1. Analysis",
    taskChart: "2. Chart",
    taskNote: "3. Source note",
    taskDone: "Done",
    taskCurrent: "Current step",
    taskPending: "Pending",
    taskOpenAnalysis: "View submitted analysis",
    taskOpenChart: "Open saved chart",
    taskOpenNote: "Open source note",
    taskStop: "Stop continuation",
    taskResume: "Continue task",
    taskStopping: "Stopping continuation…",
    taskResuming: "Continuing task…",
    taskStopHelp: "This stops future assistant work only. Submitted analysis runs independently and can be cancelled in the analysis workspace.",
    taskSourcesRequired: "Before continuing, explicitly share the original data and the images selected for the task again. No new source is shared automatically.",
    taskRetry: "Retry exact request",
    taskRetryLoad: "Retry loading task",
    taskBusy: "This conversation has a continuation task. Stop it or start a new conversation.",
    running: "Continuing",
    waiting_confirmation: "Waiting for you to confirm the current proposal",
    waiting_analysis: "Waiting for submitted analysis",
    needs_input: "Your input is required before continuing",
    failed: "Task did not complete; check the sources to continue",
    paused: "Continuation stopped; continue explicitly to resume",
    completed: "All three steps are complete",
    agent_task_dataset_required: "Share the selected data explicitly before starting a continuation task.",
    agent_task_busy: "This conversation has a continuation task. Stop it or start a new conversation.",
    agent_task_scope_changed: "The paper or source scope changed, so the task was not continued.",
    agent_task_paused: "The task is paused. Continue it explicitly before taking this action.",
    agent_task_stage: "This action is not available at the current step.",
    agent_task_sources_required: "Share the original data and task-selected images again before continuing.",
    agent_task_limit: "The continuation limit was reached. Review the current progress.",
    agent_task_control_conflict: "The task state changed and the control request was not applied. Load the latest state.",
    agent_task_invalid_state: "This control action is unavailable in the current task state.",
    idempotency_conflict: "The request ID conflicted; the original request was not changed.",
    source_changed: "The source changed, so the task was not continued.",
    storage_unavailable: "Local storage is unavailable. Try again shortly.",
    not_found: "The continuation task or its source could not be found.",
    validation_error: "The control request is invalid. Check the task state and sources.",
    network: "Cannot connect to the local service. The exact control request and your draft are retained.",
    request_failed: "The outcome is uncertain. Retry the exact request instead of issuing a new one."
  }
};

function sameIds(left, right) {
  const a = [...new Set(left || [])].sort();
  const b = [...new Set(right || [])].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function createTaskClient(adapter) {
  const elements = {
    section: document.getElementById("assistant-task"),
    card: document.getElementById("assistant-task-card"),
    enabled: document.getElementById("assistant-continue-task"),
    help: document.getElementById("assistant-continue-task-help"),
    label: document.querySelector('label[for="assistant-continue-task"] span')
  };
  const papers = new Map();
  let language = adapter.getLanguage();

  function t(key, values = {}) {
    let text = messages[language][key] || messages.en[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  function paperState(paperId) {
    if (!papers.has(paperId)) papers.set(paperId, { states: new Map(), activeConversationId: null, continueTask: false });
    return papers.get(paperId);
  }

  function stateFor(paperId, conversationId) {
    const paper = paperState(paperId);
    if (!paper.states.has(conversationId)) {
      paper.states.set(conversationId, {
        paperId,
        conversationId,
        task: null,
        initialized: false,
        loading: false,
        error: null,
        control: null,
        pollToken: 0,
        pollTimer: null,
        pollController: null,
        listController: null
      });
    }
    return paper.states.get(conversationId);
  }

  function currentState() {
    const paper = adapter.getDocument();
    const conversationId = paper ? adapter.getConversationId(paper.id) : null;
    return paper && conversationId ? stateFor(paper.id, conversationId) : null;
  }

  function errorText(error, fallback = "request_failed") {
    const code = typeof error === "string" ? error : error?.code;
    if (code && (Object.hasOwn(messages[language], code) || Object.hasOwn(messages.en, code))) return t(code);
    return t(fallback);
  }

  function stopPolling(state) {
    state.pollToken += 1;
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
    state.pollController?.abort();
    state.pollController = null;
  }

  function mergeTask(state, snapshot) {
    if (!snapshot?.id || snapshot.document_id !== state.paperId || snapshot.conversation_id !== state.conversationId) return false;
    const previous = state.task;
    if (previous && previous.id === snapshot.id && Number(snapshot.revision) < Number(previous.revision)) return false;
    state.task = snapshot;
    state.error = null;
    return Boolean(previous && (previous.id !== snapshot.id || previous.current_turn_id !== snapshot.current_turn_id || previous.revision !== snapshot.revision));
  }

  function selectedSources(state) {
    const task = state.task;
    const currentPaper = adapter.getDocument();
    if (!task || currentPaper?.id !== state.paperId) return { available: false, matches: false, datasetId: null, imageIds: [] };
    const datasetId = adapter.getSharedDatasetId() || null;
    const imageIds = adapter.getChatImages(state.paperId).map((image) => image.id);
    return {
      available: true,
      datasetId,
      imageIds,
      matches: datasetId === task.dataset_id && sameIds(imageIds, task.reading_context?.image_ids || [])
    };
  }

  function checkSharing(state) {
    if (!state?.task || !STOP_STATUSES.has(state.task.status) || state.control) return;
    const sources = selectedSources(state);
    if (sources.available && !sources.matches) startControl(state, "stop", "sharing_changed");
  }

  async function refreshConversation(state) {
    if (adapter.getConversationId(state.paperId) !== state.conversationId) return;
    await adapter.refreshConversation(state.paperId, state.conversationId);
  }

  async function poll(state, token) {
    if (token !== state.pollToken || !state.task) return;
    const taskId = state.task.id;
    const controller = new AbortController();
    state.pollController = controller;
    try {
      const snapshot = await adapter.api(`/api/v1/documents/${encodeURIComponent(state.paperId)}/agent/tasks/${encodeURIComponent(taskId)}`, { signal: controller.signal });
      if (token !== state.pollToken) return;
      const changed = mergeTask(state, snapshot);
      if (changed) await refreshConversation(state);
      if (token !== state.pollToken) return;
      checkSharing(state);
      if (changed) adapter.render();
      if (POLL_STATUSES.has(state.task.status)) state.pollTimer = setTimeout(() => poll(state, token), 1000);
      else stopPolling(state);
    } catch (error) {
      if (error?.name === "AbortError" || token !== state.pollToken) return;
      state.error = error;
      adapter.render();
    } finally {
      if (state.pollController === controller) state.pollController = null;
    }
  }

  function startPolling(state) {
    stopPolling(state);
    if (state.task && POLL_STATUSES.has(state.task.status)) poll(state, state.pollToken);
  }

  async function loadTasks(state) {
    stopPolling(state);
    state.listController?.abort();
    const controller = new AbortController();
    state.listController = controller;
    state.loading = true;
    adapter.render();
    try {
      const body = await adapter.api(`/api/v1/documents/${encodeURIComponent(state.paperId)}/agent/tasks?conversation_id=${encodeURIComponent(state.conversationId)}`, { signal: controller.signal });
      if (state.listController !== controller) return;
      const items = Array.isArray(body.items) ? body.items : [];
      items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      const snapshot = items.find((item) => item.id === state.task?.id) || items.find((item) => BUSY_STATUSES.has(item.status)) || items[0] || null;
      state.initialized = true;
      if (snapshot) {
        const changed = mergeTask(state, snapshot);
        if (changed) await refreshConversation(state);
      } else {
        state.task = null;
        state.error = null;
      }
      checkSharing(state);
      if (paperState(state.paperId).activeConversationId === state.conversationId) startPolling(state);
    } catch (error) {
      if (error?.name === "AbortError") return;
      state.error = error;
    } finally {
      if (state.listController === controller) {
        state.listController = null;
        state.loading = false;
      }
      adapter.render();
    }
  }

  function resumeContext(state, sources) {
    const original = state.task.reading_context || {};
    const activeImage = original.active_image;
    return {
      page: state.task.page || original.page,
      rect: original.rect ? [...original.rect] : null,
      active_note_id: original.active_note_id || null,
      image_ids: [...sources.imageIds],
      dataset_id: sources.datasetId,
      active_analysis_id: original.active_analysis_id || null,
      active_image: activeImage ? {
        source_kind: activeImage.source_kind,
        source_id: activeImage.source_id,
        ...(activeImage.annotation_id ? { annotation_id: activeImage.annotation_id } : {})
      } : null,
      active_chart_id: original.active_chart_id || null,
      language,
      ...(Array.isArray(original.note_refs) && original.note_refs.length ? {
        note_refs: original.note_refs.map((reference) => ({ note_id: reference.note_id, revision: reference.revision }))
      } : {})
    };
  }

  function startControl(state, action, reason = "user") {
    if (!state?.task || state.control) return;
    let context = null;
    let message = "";
    let draft = "";
    if (action === "resume") {
      const sources = selectedSources(state);
      if (!sources.available || !sources.matches) {
        state.error = { code: "agent_task_sources_required" };
        adapter.render();
        return;
      }
      context = resumeContext(state, sources);
      draft = adapter.getDraft(state.paperId);
      message = draft;
    }
    state.control = {
      action,
      taskId: state.task.id,
      draft,
      pending: false,
      error: null,
      body: {
        request_id: crypto.randomUUID(),
        expected_generation: state.task.generation,
        action,
        context,
        message,
        reason
      }
    };
    state.error = null;
    runControl(state, state.control);
  }

  async function runControl(state, operation) {
    if (!operation || operation.pending || state.control !== operation) return;
    const previousTurnId = state.task?.current_turn_id;
    const previousPhase = state.task?.phase;
    operation.pending = true;
    operation.error = null;
    adapter.render();
    try {
      const snapshot = await adapter.api(`/api/v1/documents/${encodeURIComponent(state.paperId)}/agent/tasks/${encodeURIComponent(operation.taskId)}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.body)
      });
      if (state.control === operation) state.control = null;
      mergeTask(state, snapshot);
      if (operation.action === "resume" && snapshot.current_turn_id !== previousTurnId && snapshot.phase === previousPhase) {
        adapter.clearDraft(state.paperId, operation.draft);
      }
      await refreshConversation(state);
      startPolling(state);
      checkSharing(state);
    } catch (error) {
      operation.pending = false;
      operation.error = error;
      if (DEFINITIVE_CONTROL_ERRORS.has(error.code)) {
        if (state.control === operation) state.control = null;
        state.error = error;
        loadTasks(state);
        return;
      }
      state.error = error;
    } finally {
      adapter.render();
    }
  }

  function appendField(list, label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    list.append(term, description);
  }

  function sourceButton(label, handler, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "assistant-source-button assistant-task-link";
    button.dataset.action = action;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function stepState(task, step) {
    if (task.status === "completed") return "done";
    const order = { analysis: 0, chart: 1, note: 2 };
    const current = order[task.phase] ?? 0;
    const index = order[step];
    if (index < current) return "done";
    if (index === current) return "current";
    return "pending";
  }

  function renderTask(state) {
    elements.card.replaceChildren();
    elements.section.hidden = !state || (!state.task && !state.loading && !state.error);
    if (elements.section.hidden) return;
    const heading = document.createElement("h3");
    heading.textContent = t("taskTitle");
    elements.card.append(heading);
    if (!state.task) {
      const text = document.createElement("p");
      text.className = "assistant-task-status";
      text.textContent = state.loading ? t("taskLoading") : errorText(state.error);
      elements.card.append(text);
      if (state.error) {
        const retry = sourceButton(t("taskRetryLoad"), () => loadTasks(state), "retry-task-list");
        retry.className = "button button-quiet";
        elements.card.append(retry);
      }
      return;
    }

    const task = state.task;
    const status = document.createElement("p");
    status.className = "assistant-task-status";
    status.dataset.status = task.status;
    status.setAttribute("role", "status");
    status.textContent = t(task.status);
    const details = document.createElement("dl");
    details.className = "assistant-task-details";
    appendField(details, t("taskGoal"), task.goal || "—");
    appendField(details, t("taskDataset"), task.dataset_name || task.dataset_id || "—");
    appendField(details, t("taskPage"), t("taskPageValue", { page: task.page || task.reading_context?.page || "—" }));
    elements.card.append(status, details);

    const plan = document.createElement("ol");
    plan.className = "assistant-task-plan";
    plan.setAttribute("aria-label", t("taskPlan"));
    for (const [step, label] of [["analysis", "taskAnalysis"], ["chart", "taskChart"], ["note", "taskNote"]]) {
      const item = document.createElement("li");
      const progress = stepState(task, step);
      item.dataset.state = progress;
      item.textContent = `${t(label)} · ${t(progress === "done" ? "taskDone" : progress === "current" ? "taskCurrent" : "taskPending")}`;
      plan.append(item);
    }
    elements.card.append(plan);

    const links = document.createElement("div");
    links.className = "assistant-task-links";
    links.append(sourceButton(t("taskOpenSource"), () => adapter.navigateSource({
      document_id: state.paperId,
      page: task.page || task.reading_context?.page,
      rect: task.reading_context?.rect ? [...task.reading_context.rect] : null
    }), "open-task-source"));
    if (task.analysis_id) links.append(sourceButton(t("taskOpenAnalysis"), () => adapter.openAnalysisJob(state.paperId, task.analysis_id), "open-task-analysis"));
    if (task.chart_id) links.append(sourceButton(t("taskOpenChart"), () => adapter.openChart(state.paperId, task.chart_id), "open-task-chart"));
    if (task.note_id) links.append(sourceButton(t("taskOpenNote"), () => adapter.navigateSource({ document_id: state.paperId, note_id: task.note_id }), "open-task-note"));
    elements.card.append(links);

    if (task.error) {
      const error = document.createElement("p");
      error.className = "assistant-error";
      error.textContent = errorText(task.error);
      elements.card.append(error);
    }
    if (state.error || state.control?.error) {
      const error = document.createElement("p");
      error.className = "assistant-error";
      error.textContent = errorText(state.control?.error || state.error);
      elements.card.append(error);
    }

    const actions = document.createElement("div");
    actions.className = "assistant-task-actions";
    if (state.control) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.id = "assistant-task-control-retry";
      retry.className = "button button-secondary";
      retry.dataset.action = "retry-task-control";
      retry.disabled = state.control.pending;
      retry.textContent = t(state.control.pending
        ? state.control.action === "stop" ? "taskStopping" : "taskResuming"
        : "taskRetry");
      retry.addEventListener("click", () => runControl(state, state.control));
      actions.append(retry);
    } else {
      if (STOP_STATUSES.has(task.status)) {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.id = "assistant-task-stop";
        stop.className = "button button-quiet";
        stop.dataset.action = "stop-task";
        stop.textContent = t("taskStop");
        stop.addEventListener("click", () => startControl(state, "stop"));
        actions.append(stop);
      }
      if (RESUME_STATUSES.has(task.status)) {
        const resume = document.createElement("button");
        resume.type = "button";
        resume.id = "assistant-task-resume";
        resume.className = "button button-secondary";
        resume.dataset.action = "resume-task";
        resume.textContent = t("taskResume");
        resume.addEventListener("click", () => startControl(state, "resume"));
        actions.append(resume);
      }
      if (state.error && POLL_STATUSES.has(task.status)) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "button button-quiet";
        retry.dataset.action = "retry-task-poll";
        retry.textContent = t("taskRetryLoad");
        retry.addEventListener("click", () => startPolling(state));
        actions.append(retry);
      }
    }
    elements.card.append(actions);

    if (STOP_STATUSES.has(task.status)) {
      const help = document.createElement("p");
      help.className = "assistant-task-help";
      help.textContent = t("taskStopHelp");
      elements.card.append(help);
    }
    if (RESUME_STATUSES.has(task.status) && !selectedSources(state).matches) {
      const help = document.createElement("p");
      help.className = "assistant-task-help";
      help.textContent = t("taskSourcesRequired");
      elements.card.append(help);
    }
  }

  function render() {
    const paper = adapter.getDocument();
    const paperState = paper ? paperStateForRender(paper.id) : null;
    if (paperState && !adapter.getSharedDatasetId()) paperState.continueTask = false;
    elements.enabled.checked = Boolean(paperState?.continueTask);
    elements.enabled.disabled = !paper || !adapter.getSharedDatasetId();
    elements.label.textContent = t("taskMode");
    elements.help.textContent = t("taskModeHelp");
    elements.section.setAttribute("aria-label", t("taskTitle"));
    renderTask(currentState());
  }

  function paperStateForRender(paperId) {
    return papers.get(paperId) || null;
  }

  elements.enabled.addEventListener("change", () => {
    const paper = adapter.getDocument();
    if (!paper) return;
    paperState(paper.id).continueTask = elements.enabled.checked && Boolean(adapter.getSharedDatasetId());
    adapter.render();
  });

  return {
    applyLanguage(nextLanguage) {
      language = nextLanguage;
      render();
    },
    documentChanged() {
      const paper = adapter.getDocument();
      if (!paper) return;
      const conversationId = adapter.getConversationId(paper.id);
      this.conversationChanged(paper.id, conversationId);
    },
    conversationChanged(paperId, conversationId) {
      const paper = paperState(paperId);
      if (paper.activeConversationId === conversationId) {
        const existing = conversationId ? stateFor(paperId, conversationId) : null;
        if (existing?.loading) return;
        if (!conversationId || existing.initialized) {
          if (existing) startPolling(existing);
          return;
        }
      }
      for (const state of paper.states.values()) {
        stopPolling(state);
        if (state.conversationId !== conversationId) state.listController?.abort();
      }
      paper.activeConversationId = conversationId;
      if (conversationId) loadTasks(stateFor(paperId, conversationId));
    },
    contextChanged() {
      const document = adapter.getDocument();
      if (!document || !papers.has(document.id)) return;
      for (const state of paperState(document.id).states.values()) checkSharing(state);
    },
    acceptTurn(paperId, conversationId, turn) {
      const taskId = turn?.context?.task_id;
      if (!taskId || !conversationId) return;
      const paper = paperState(paperId);
      for (const other of paper.states.values()) {
        stopPolling(other);
        other.listController?.abort();
      }
      paper.activeConversationId = conversationId;
      const state = stateFor(paperId, conversationId);
      state.initialized = true;
      state.task = {
        id: taskId,
        document_id: paperId,
        conversation_id: conversationId,
        goal: turn.message || "",
        dataset_id: turn.context.dataset_id || null,
        dataset_name: turn.context.dataset_id || null,
        page: turn.context.page,
        reading_context: turn.context,
        phase: "analysis",
        status: "running",
        generation: 0,
        revision: -1,
        current_turn_id: turn.id,
        error: null
      };
      startPolling(state);
    },
    isBusy(paperId, conversationId) {
      if (!conversationId || !papers.has(paperId)) return false;
      const task = paperState(paperId).states.get(conversationId)?.task;
      return Boolean(task && BUSY_STATUSES.has(task.status));
    },
    continueTaskRequested(paperId) {
      return Boolean(paperState(paperId).continueTask && adapter.getSharedDatasetId());
    },
    render
  };
}
