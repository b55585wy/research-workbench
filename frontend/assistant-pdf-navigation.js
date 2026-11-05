const SHA256 = /^[a-f0-9]{64}$/;
const PDF_KINDS = new Set(["associated_pdf_page", "pdf_page", "reference_pdf_page"]);

function validSource(source) {
  if (!source || !PDF_KINDS.has(source.kind) || typeof source.document_id !== "string" ||
      !source.document_id || !Number.isInteger(source.page) || source.page < 1) return false;
  if (source.source_sha256 != null && !SHA256.test(source.source_sha256)) return false;
  const rect = source.rect;
  return rect == null || Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) &&
    rect[0] >= 0 && rect[1] >= 0 && rect[2] <= 1 && rect[3] <= 1 && rect[2] > rect[0] && rect[3] > rect[1];
}

export function createAssistantPdfNavigator({ getSnapshot, readDocument, navigate, report }) {
  let generation = 0;
  let destroyed = false;
  const snapshot = () => JSON.stringify(getSnapshot());

  async function open(source) {
    if (destroyed) return false;
    const request = ++generation;
    if (!validSource(source)) {
      report("validation_error");
      return false;
    }
    const frozen = { ...source, rect: source.rect ? [...source.rect] : null };
    const before = snapshot();
    const current = () => !destroyed && request === generation && snapshot() === before;
    let document;
    try {
      document = await readDocument(frozen.document_id);
    } catch (error) {
      if (current()) report(error?.code || "documentOpenFailed");
      return false;
    }
    if (!current()) return false;
    if (!document || document.id !== frozen.document_id || document.kind === "study" ||
        document.deleted_at || document.purged || !Number.isInteger(document.page_count) ||
        frozen.page > document.page_count || !SHA256.test(document.sha256 || "")) {
      report("not_found");
      return false;
    }
    if (frozen.source_sha256 && document.sha256 !== frozen.source_sha256) {
      report("source_changed");
      return false;
    }
    try {
      const isLatest = () => !destroyed && request === generation;
      return Boolean(await navigate(document, frozen, isLatest)) && isLatest();
    } catch (error) {
      if (current()) report(error?.code || "documentOpenFailed");
      return false;
    }
  }

  return {
    open,
    destroy() {
      destroyed = true;
      generation += 1;
    }
  };
}
