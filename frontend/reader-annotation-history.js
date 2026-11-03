const LIMIT = 20;

export function createAnnotationHistory() {
  const documents = new Map();

  function entries(documentId) {
    if (!documents.has(documentId)) documents.set(documentId, { undo: [], redo: [] });
    return documents.get(documentId);
  }

  function record(documentId, entry) {
    const history = entries(documentId);
    history.undo.push(entry);
    if (history.undo.length > LIMIT) history.undo.shift();
    history.redo = [];
  }

  function peek(documentId, direction) {
    const stack = entries(documentId)[direction];
    return stack.at(-1) || null;
  }

  function complete(documentId, direction, revision, expectedEntry) {
    const history = entries(documentId);
    const from = history[direction];
    const to = history[direction === "undo" ? "redo" : "undo"];
    const entry = from.at(-1);
    if (!entry || entry !== expectedEntry) return false;
    from.pop();
    if (direction === "undo") entry.beforeRevision = revision;
    else entry.afterRevision = revision;
    const previous = from.findLast((candidate) => candidate.noteId === entry.noteId);
    if (previous) {
      if (direction === "undo") previous.afterRevision = revision;
      else previous.beforeRevision = revision;
    }
    to.push(entry);
    return true;
  }

  function expectedRevision(entry, direction) {
    return direction === "undo" ? entry.afterRevision : entry.beforeRevision;
  }

  function invalidate(documentId, noteId = null) {
    if (!documents.has(documentId)) return;
    if (!noteId) {
      documents.delete(documentId);
      return;
    }
    const history = entries(documentId);
    history.undo = history.undo.filter((entry) => entry.noteId !== noteId);
    history.redo = history.redo.filter((entry) => entry.noteId !== noteId);
  }

  function counts(documentId) {
    const history = entries(documentId);
    return { undo: history.undo.length, redo: history.redo.length };
  }

  return { record, peek, complete, expectedRevision, invalidate, counts };
}
