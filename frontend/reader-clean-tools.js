const tools = document.getElementById("reader-secondary-tools");
const drawMenu = document.getElementById("reader-draw-menu");
const desktopQuery = window.matchMedia("(min-width: 821px)");

function keepDesktopOpen(details) {
  if (desktopQuery.matches && details instanceof HTMLDetailsElement && !details.open) details.open = true;
}

if (tools instanceof HTMLDetailsElement) {
  const summary = tools.querySelector("summary");

  function closeTools(restoreFocus = false) {
    if (desktopQuery.matches) {
      tools.open = true;
      return;
    }
    tools.open = false;
    if (restoreFocus && summary instanceof HTMLElement) summary.focus({ preventScroll: true });
  }

  tools.addEventListener("toggle", () => keepDesktopOpen(tools));
  tools.addEventListener("keydown", (event) => {
    if (desktopQuery.matches || event.key !== "Escape" || !tools.open || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    closeTools(!desktopQuery.matches);
  });
  document.addEventListener("pointerdown", (event) => {
    if (tools.open && event.target instanceof Node && !tools.contains(event.target)) closeTools();
    keepDesktopOpen(drawMenu);
  });
  document.addEventListener("focusin", (event) => {
    if (tools.open && event.target instanceof Node && !tools.contains(event.target)) closeTools();
    keepDesktopOpen(drawMenu);
  });
}

if (drawMenu instanceof HTMLDetailsElement) {
  drawMenu.addEventListener("toggle", () => keepDesktopOpen(drawMenu));
  drawMenu.addEventListener("click", () => keepDesktopOpen(drawMenu));
  drawMenu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !desktopQuery.matches) return;
    if (!event.isComposing) event.preventDefault();
    event.stopPropagation();
    keepDesktopOpen(drawMenu);
  }, true);
}

// The compact annotation controller can close details after a tool/state change.
// Restore desktop expansion before paint, without moving its nodes or focus.
const openObserver = new MutationObserver((records) => {
  for (const { target } of records) keepDesktopOpen(target);
});
for (const details of [tools, drawMenu]) {
  if (details instanceof HTMLDetailsElement) openObserver.observe(details, { attributes: true, attributeFilter: ["open"] });
}

function syncViewport() {
  if (desktopQuery.matches) {
    keepDesktopOpen(tools);
    keepDesktopOpen(drawMenu);
  } else {
    if (tools instanceof HTMLDetailsElement) tools.open = false;
    if (drawMenu instanceof HTMLDetailsElement) drawMenu.open = false;
  }
}

desktopQuery.addEventListener("change", syncViewport);
syncViewport();
