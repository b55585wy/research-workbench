const drawMenu = document.getElementById("reader-draw-menu");

if (drawMenu) {
  const summary = drawMenu.querySelector("summary");
  const buttons = Array.from(drawMenu.querySelectorAll(".reader-shape-tool-menu button"));
  const defaultIcon = summary.querySelector("[data-reader-draw-icon]").cloneNode(true);
  const phoneQuery = window.matchMedia("(max-width: 820px)");

  function closeMenu(restoreFocus = false) {
    drawMenu.open = false;
    if (restoreFocus) summary.focus({ preventScroll: true });
  }

  function syncState() {
    const selected = buttons.find((button) => button.getAttribute("aria-pressed") === "true");
    const disabled = buttons.every((button) => button.disabled);
    summary.setAttribute("aria-disabled", String(disabled));
    if (disabled) closeMenu();
    if (selected) drawMenu.dataset.activeTool = selected.id.replace("reader-shape-", "");
    else delete drawMenu.dataset.activeTool;
    const icon = selected ? selected.querySelector("svg").cloneNode(true) : defaultIcon.cloneNode(true);
    icon.setAttribute("data-reader-draw-icon", "");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    summary.querySelector("[data-reader-draw-icon]").replaceWith(icon);
  }

  summary.addEventListener("click", (event) => {
    if (summary.getAttribute("aria-disabled") === "true") event.preventDefault();
  });
  summary.addEventListener("keydown", (event) => {
    if (summary.getAttribute("aria-disabled") === "true" && ["Enter", " "].includes(event.key)) event.preventDefault();
  });
  drawMenu.addEventListener("click", (event) => {
    const button = event.target.closest(".reader-shape-tool-menu button");
    if (button && !button.disabled) closeMenu();
  });
  drawMenu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !drawMenu.open) return;
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (drawMenu.open && !drawMenu.contains(event.target)) closeMenu();
  });
  phoneQuery.addEventListener("change", () => closeMenu());

  const observer = new MutationObserver(syncState);
  observer.observe(drawMenu, { attributes: true, subtree: true, attributeFilter: ["disabled", "aria-pressed"] });
  syncState();
}
