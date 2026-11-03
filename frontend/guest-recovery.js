(() => {
  "use strict";

  const strings = {
    zh: {
      documentTitle: "找回已有空间 · research workspace",
      title: "找回已有空间",
      intro: "输入你保存的恢复码，以在此浏览器中找回原有游客空间。",
      label: "恢复码",
      warning: "提交后会切换到找回的空间；请先保存当前编辑。此操作不会合并或删除当前空间。",
      submit: "找回空间",
      busy: "正在验证…",
      success: "验证成功，正在返回工作台…",
      invalid: "请输入恢复码。",
      failed: "无法找回空间，请检查恢复码后重试。",
      unavailable: "服务暂时不可用，请稍后重试。",
      language: "EN",
      languageLabel: "Switch to English"
    },
    en: {
      documentTitle: "Recover an existing space · research workspace",
      title: "Recover an existing space",
      intro: "Enter your saved recovery code to return to your guest space in this browser.",
      label: "Recovery code",
      warning: "Submitting switches to the recovered space; save your current edits first. This does not merge or delete the current space.",
      submit: "Recover space",
      busy: "Verifying…",
      success: "Verified. Returning to the workspace…",
      invalid: "Enter a recovery code.",
      failed: "The space could not be recovered. Check the recovery code and try again.",
      unavailable: "The service is temporarily unavailable. Try again later.",
      language: "中文",
      languageLabel: "切换到中文"
    }
  };

  let language = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  let busy = false;

  const form = document.getElementById("recovery-form");
  const input = document.getElementById("recovery-code");
  const submit = document.getElementById("recovery-submit");
  const status = document.getElementById("recovery-status");
  const languageButton = document.getElementById("recovery-language");

  function setText(id, value) {
    document.getElementById(id).textContent = value;
  }

  function applyLanguage() {
    const copy = strings[language];
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = copy.documentTitle;
    setText("recovery-title", copy.title);
    setText("recovery-intro", copy.intro);
    setText("recovery-code-label", copy.label);
    setText("recovery-warning", copy.warning);
    submit.textContent = busy ? copy.busy : copy.submit;
    languageButton.textContent = copy.language;
    languageButton.setAttribute("aria-label", copy.languageLabel);
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    submit.disabled = nextBusy;
    input.readOnly = nextBusy;
    form.setAttribute("aria-busy", String(nextBusy));
    applyLanguage();
  }

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.dataset.kind = isError ? "error" : "info";
    status.setAttribute("role", isError ? "alert" : "status");
  }

  async function serverMessage(response) {
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || !payload.detail || typeof payload.detail !== "object") {
      return null;
    }
    return typeof payload.detail.message === "string" && payload.detail.message
      ? payload.detail.message
      : null;
  }

  languageButton.addEventListener("click", () => {
    language = language === "zh" ? "en" : "zh";
    applyLanguage();
  });

  input.addEventListener("input", () => {
    if (!busy && status.dataset.kind === "error") showStatus("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;

    const recoveryCode = input.value.trim();
    if (!recoveryCode) {
      showStatus(strings[language].invalid, true);
      input.focus();
      return;
    }

    let succeeded = false;
    setBusy(true);
    showStatus(strings[language].busy);

    try {
      const response = await fetch("/api/v1/access/recover", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ recovery_code: recoveryCode })
      });

      if (!response.ok) {
        const message = await serverMessage(response);
        const fallback = response.status >= 500 ? strings[language].unavailable : strings[language].failed;
        showStatus(message || fallback, true);
        return;
      }

      const payload = await response.json().catch(() => null);
      const workspaceId = payload && typeof payload === "object"
        ? payload.workspace_id
        : null;
      if (typeof workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
        showStatus(strings[language].failed, true);
        return;
      }

      succeeded = true;
      input.value = "";
      form.reset();
      showStatus(strings[language].success);
      window.location.replace("/");
    } catch {
      showStatus(strings[language].unavailable, true);
    } finally {
      if (!succeeded) setBusy(false);
    }
  });

  applyLanguage();
})();
