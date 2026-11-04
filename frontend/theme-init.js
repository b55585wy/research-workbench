(function () {
  var theme = "default";
  try {
    var saved = window.localStorage.getItem("research-workbench-theme");
    if (saved === "default" || saved === "doraemon-blue") theme = saved;
  } catch {
    theme = "default";
  }
  document.documentElement.dataset.theme = theme;
})();
