const KEY_PREFIX = "research-workbench-reader-progress-v1:";

function keyFor(document) {
  return `${KEY_PREFIX}${document.id}:${document.sha256}`;
}

export function readReaderProgress(document) {
  let raw;
  try {
    raw = localStorage.getItem(keyFor(document));
  } catch {
    return { record: null, unavailable: true };
  }
  if (raw === null || raw.length > 2048) return { record: null, unavailable: false };
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { record: null, unavailable: false };
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) return { record: null, unavailable: false };
  if (value.document_id !== document.id || value.source_sha256 !== document.sha256) return { record: null, unavailable: false };
  if (!Number.isInteger(value.page) || value.page < 1 || value.page > document.page_count) return { record: null, unavailable: false };
  if (!Number.isFinite(value.center_fraction) || value.center_fraction < 0 || value.center_fraction > 1) return { record: null, unavailable: false };
  return { record: { page: value.page, center_fraction: value.center_fraction }, unavailable: false };
}

export function writeReaderProgress(document, page, centerFraction) {
  if (!Number.isInteger(page) || page < 1 || page > document.page_count || !Number.isFinite(centerFraction) || centerFraction < 0 || centerFraction > 1) return true;
  try {
    localStorage.setItem(keyFor(document), JSON.stringify({
      version: 1,
      document_id: document.id,
      source_sha256: document.sha256,
      page,
      center_fraction: centerFraction
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearReaderProgress(documentId) {
  const prefix = `${KEY_PREFIX}${documentId}:`;
  try {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
