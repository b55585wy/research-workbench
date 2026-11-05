export function createHeaderSettingsAdapter({
  container = document.getElementById("header-settings"),
  controls = document.querySelector(".app-header .header-controls"),
  identity = document.getElementById("workspace-identity"),
  bundleURL = "/vendor/workspace-shell/workspace-shell.js"
} = {}) {
  let handle = null;
  let destroyed = false;

  function restoreControls() {
    document.documentElement.removeAttribute("data-ui-settings");
    handle?.destroy();
    handle = null;
  }

  if (container && controls && identity) {
    void import(bundleURL).then((module) => {
      if (destroyed || typeof module.mountHeaderSettings !== "function") {
        restoreControls();
        return;
      }
      handle = module.mountHeaderSettings({
        container,
        controls,
        identity,
        onMounted() {
          if (!destroyed) document.documentElement.dataset.uiSettings = "ready";
        }
      });
    }).catch(restoreControls);
  }

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      restoreControls();
    }
  };
}

const headerSettings = createHeaderSettingsAdapter();
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) headerSettings.destroy();
});
