function richOps(content, text = "") {
  return content?.ops || [{ insert: `${text}${text.endsWith("\n") ? "" : "\n"}` }];
}

function hasRichContent(content) {
  return Boolean(content?.ops?.some((op) => (
    typeof op.insert === "object" ||
    typeof op.insert === "string" && op.insert.replace(/\n/g, "").length > 0 ||
    Object.keys(op.attributes || {}).length > 0
  )));
}

export function noteDraftHasContent(draft) {
  return Boolean(draft && (draft.text || hasRichContent(draft.richContent)));
}

export function noteDraftState(context) {
  if (!context) return { changed: false, disabled: true, blocked: null };
  const { draft, mode } = context;
  const contentChanged = mode === "edit"
    ? draft.text !== draft.note.text || JSON.stringify(richOps(draft.richContent, draft.text)) !==
      JSON.stringify(richOps(draft.originalRichContent, draft.note.text))
    : Boolean(noteDraftHasContent(draft) || draft.page != null || context.imageIds.length);
  const changed = Boolean(contentChanged || context.richError || context.capture || context.selection ||
    context.textSelection || context.regionActive || context.highlight);
  const blocked = context.pending ? "noteDraftPending"
    : context.retryRequired ? "noteDraftRetryRequired" : null;
  return { changed, disabled: Boolean(context.pending || mode === "create" && !changed && !blocked), blocked };
}

function fingerprint(context) {
  return JSON.stringify([
    context.scope, context.documentId, context.sourceSha, context.loadGeneration, context.navigationGeneration,
    context.mode, context.draft, context.imageIds, context.richError, context.regionActive, context.highlight,
    context.capture && [context.capture.requestId, context.capture.pending, context.capture.error, context.capture.image?.id],
    context.selection && [context.selection.pointerId, context.selection.currentX, context.selection.currentY],
    context.textSelection && [context.textSelection.page, context.textSelection.text, context.textSelection.source_segments]
  ], (key, value) => ["previewCanvas", "draftOwner"].includes(key) ? undefined : value);
}

function sameContext(before, after, signature) {
  return Boolean(after && before.document === after.document && before.draft === after.draft &&
    before.capture === after.capture && before.selection === after.selection &&
    before.textSelection === after.textSelection && before.highlight === after.highlight && signature === fingerprint(after));
}

// All writes and DOM ownership stay with the injected lifecycle adapters.
export function createNoteDraftControls(adapter) {
  let confirming = false;
  const navigationReceipts = new WeakMap();

  function request(navigation, expectedMode, ticket) {
    if (confirming) return false;
    adapter.capture();
    const context = adapter.getContext();
    if (!context) return navigation;
    if (expectedMode && context.mode !== expectedMode) return false;
    const state = noteDraftState(context);
    const reason = state.blocked || (navigation ? context.navigationBlocked ||
      (context.richError ? "navigationRichDraftError" : null) : null);
    if (reason) {
      adapter.blocked(reason);
      return false;
    }
    // Repeated guards in one navigation must preserve the parked create draft after leaving an edit.
    const receiptContext = { ...context, loadGeneration: null, navigationGeneration: null };
    const receipt = ticket && navigationReceipts.get(ticket);
    if (receipt && sameContext(receipt.context, receiptContext, receipt.signature)) return true;
    if (!state.changed && (navigation || context.mode === "create")) return navigation;
    const signature = fingerprint(context);
    if (state.changed) {
      confirming = true;
      let accepted;
      try {
        accepted = adapter.confirm(context.mode);
      } finally {
        confirming = false;
      }
      if (accepted !== true) return false;
    }
    const current = adapter.getContext();
    if (!sameContext(context, current, signature)) return false;
    const currentReason = noteDraftState(current).blocked || (navigation ? current.navigationBlocked ||
      (current.richError ? "navigationRichDraftError" : null) : null);
    if (currentReason) {
      adapter.blocked(currentReason);
      return false;
    }
    adapter.discard(current, { navigation });
    if (navigation && ticket) {
      const remaining = adapter.getContext();
      if (remaining) {
        const context = { ...remaining, loadGeneration: null, navigationGeneration: null };
        navigationReceipts.set(ticket, { context, signature: fingerprint(context) });
      }
    }
    return true;
  }

  return {
    getState: () => noteDraftState(adapter.getContext()),
    cancel: (mode) => request(false, mode),
    prepareNavigation: (ticket) => request(true, null, ticket)
  };
}

// Stamp every existing URL writer, including workspace tabs, without changing their routes.
export function createNoteDraftHistory(browser) {
  const { history } = browser;
  const indexKey = "workbenchDraftHistoryIndex";
  const entryIndex = () => browser.navigation?.currentEntry?.index ?? history.state?.[indexKey] ?? 0;
  let visibleIndex = entryIndex();
  let restoring = false;
  const replaceState = history.replaceState.bind(history);
  replaceState({ ...history.state, [indexKey]: visibleIndex }, "", browser.location.href);

  for (const method of ["pushState", "replaceState"]) {
    const write = history[method].bind(history);
    history[method] = (data, title, url) => {
      const index = entryIndex() + (method === "pushState" ? 1 : 0);
      write({ ...data, [indexKey]: index }, title, url);
      visibleIndex = entryIndex();
    };
  }

  return {
    traverse(prepare) {
      const targetIndex = entryIndex();
      if (restoring && targetIndex === visibleIndex) {
        restoring = false;
        return false;
      }
      if (restoring || !prepare()) {
        const delta = visibleIndex - targetIndex;
        restoring = delta !== 0;
        if (restoring) history.go(delta);
        return false;
      }
      visibleIndex = targetIndex;
      return true;
    }
  };
}
