export function bindAssistantComposerKeys({ message, form, sendButton, isHidden }) {
  let composing = false;
  let compositionCommit = false;
  let commitTimer;
  let enterHeld = false;

  message.addEventListener("compositionstart", () => {
    clearTimeout(commitTimer);
    composing = true;
    compositionCommit = false;
  });
  message.addEventListener("compositionend", () => {
    composing = false;
    // Some IMEs finish composition before delivering the confirming Enter.
    compositionCommit = true;
    commitTimer = setTimeout(() => { compositionCommit = false; }, 0);
  });
  message.addEventListener("keyup", (event) => {
    if (event.key !== "Enter") return;
    enterHeld = false;
    compositionCommit = false;
  });
  message.addEventListener("blur", () => {
    clearTimeout(commitTimer);
    composing = false;
    compositionCommit = false;
    enterHeld = false;
  });
  message.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.key !== "Enter" || event.altKey || event.metaKey) return;
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (isHidden() || message.disabled || message.readOnly) return;
    event.preventDefault();
    if (compositionCommit || event.repeat || enterHeld) return;
    enterHeld = true;
    if (event.ctrlKey || event.shiftKey) {
      const start = message.selectionStart;
      const end = message.selectionEnd;
      if (message.maxLength >= 0 && message.value.length - (end - start) + 1 > message.maxLength) return;
      message.setRangeText("\n", start, end, "end");
      message.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (!sendButton.disabled) form.requestSubmit(sendButton);
  });
}
