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

const selectedAnnotationToolbar = document.getElementById("selected-annotation-toolbar");

if (selectedAnnotationToolbar) {
  const kindSelect = document.getElementById("selected-annotation-kind");
  const colorSelect = document.getElementById("selected-annotation-color");
  const kindButtons = Array.from(selectedAnnotationToolbar.querySelectorAll("[data-selected-annotation-kind]"));
  const colorButtons = Array.from(selectedAnnotationToolbar.querySelectorAll("[data-selected-annotation-color]"));

  function syncSelectedAnnotationControls() {
    for (const button of kindButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.selectedAnnotationKind === kindSelect.value));
    }
    for (const button of colorButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.selectedAnnotationColor === colorSelect.value));
    }
  }

  selectedAnnotationToolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-selected-annotation-kind], [data-selected-annotation-color]");
    if (!button || button.disabled) return;
    const isKind = button.hasAttribute("data-selected-annotation-kind");
    const select = isKind ? kindSelect : colorSelect;
    const value = isKind ? button.dataset.selectedAnnotationKind : button.dataset.selectedAnnotationColor;
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    syncSelectedAnnotationControls();
  });
  selectedAnnotationToolbar.addEventListener("selected-annotation-render", syncSelectedAnnotationControls);
  kindSelect.addEventListener("change", syncSelectedAnnotationControls);
  colorSelect.addEventListener("change", syncSelectedAnnotationControls);

  const observer = new MutationObserver(syncSelectedAnnotationControls);
  observer.observe(selectedAnnotationToolbar, { attributes: true, subtree: true, attributeFilter: ["disabled"] });
  syncSelectedAnnotationControls();
}
