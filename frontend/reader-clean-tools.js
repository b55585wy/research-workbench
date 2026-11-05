const tools = document.getElementById("reader-secondary-tools");

if (tools instanceof HTMLDetailsElement) {
  const summary = tools.querySelector("summary");

  function closeTools(restoreFocus = false) {
    tools.open = false;
    if (restoreFocus && summary instanceof HTMLElement) summary.focus({ preventScroll: true });
  }

  tools.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !tools.open || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    closeTools(true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (tools.open && event.target instanceof Node && !tools.contains(event.target)) closeTools();
  });
  document.addEventListener("focusin", (event) => {
    if (tools.open && event.target instanceof Node && !tools.contains(event.target)) closeTools();
  });
}
