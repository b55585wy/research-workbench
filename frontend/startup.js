(() => {
  const notice = document.getElementById("startup-status");
  if (!notice) return;
  const title = document.getElementById("startup-title");
  const detail = document.getElementById("startup-detail");
  const retry = document.getElementById("startup-retry");
  const messages = {
    zh: {
      tools: "正在加载阅读器和笔记工具",
      workspace: "正在准备工作区",
      device: "正在打开本机资料",
      library: "正在读取资料列表",
      document: "正在打开文献",
      hint: "首次打开可能稍慢，请稍候。",
      slow: "加载时间较长",
      waiting: "仍在等待加载。你可以继续等待，或重新加载页面。",
      failed: "暂时无法完成加载",
      failedHint: "页面未能完成加载，请重新加载后再试。",
      retry: "重新加载"
    },
    en: {
      tools: "Loading reader and note tools",
      workspace: "Preparing your workspace",
      device: "Opening on-device library",
      library: "Loading your library",
      document: "Opening your paper",
      hint: "The first visit may take a little longer. Please wait.",
      slow: "Loading is taking longer",
      waiting: "Still waiting for loading to finish. You can keep waiting or reload the page.",
      failed: "Unable to finish loading",
      failedHint: "The page could not finish loading. Reload the page to try again.",
      retry: "Reload"
    }
  };
  let language = "zh";
  try {
    if (localStorage.getItem("research-workbench-language") === "en") language = "en";
  } catch {}
  let phase = "tools";
  let mode = "loading";
  let active = true;

  function render() {
    if (!active) return;
    const copy = messages[language];
    notice.dataset.state = mode;
    title.textContent = copy[mode === "loading" ? phase : mode];
    detail.textContent = copy[mode === "failed" ? "failedHint" : mode === "slow" ? "waiting" : "hint"];
    retry.textContent = copy.retry;
    retry.hidden = mode === "loading";
  }

  function fail() {
    if (!active) return;
    mode = "failed";
    render();
  }

  function resourceError(event) {
    const source = event.target?.tagName === "SCRIPT" ? event.target.src : event.filename;
    if (source && new URL(source, location.href).origin === location.origin) fail();
  }

  const timer = window.setTimeout(() => {
    if (!active || mode === "failed") return;
    mode = "slow";
    render();
  }, 20_000);
  const observer = new MutationObserver(() => {
    language = document.documentElement.lang.startsWith("en") ? "en" : "zh";
    render();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  window.addEventListener("error", resourceError, true);
  retry.addEventListener("click", () => location.reload());
  window.workbenchStartup = {
    stage(next) {
      if (!active || !Object.hasOwn(messages.zh, next)) return;
      phase = next;
      if (mode !== "failed") render();
    },
    ready() {
      active = false;
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("error", resourceError, true);
      notice.hidden = true;
    },
    fail
  };
  render();
})();
