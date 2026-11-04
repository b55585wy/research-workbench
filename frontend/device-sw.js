import { openDeviceDB } from "./device-db.js";

self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

function response(blob, type, request) {
  const base = { "Content-Type": type || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Accept-Ranges": "bytes" };
  const range = request.headers.get("Range");
  const head = request.method === "HEAD";
  if (!range) return new Response(head ? null : blob, { status: 200, headers: { ...base, "Content-Length": String(blob.size) } });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start;
  let end;
  if (match && (match[1] || match[2])) {
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (Number.isSafeInteger(suffix) && suffix > 0) { start = Math.max(0, blob.size - suffix); end = blob.size - 1; }
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : blob.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) start = -1;
      else end = Math.min(end, blob.size - 1);
    }
  }
  if (!Number.isSafeInteger(start) || start < 0 || start >= blob.size || !Number.isSafeInteger(end) || end < start) {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${blob.size}`, "Content-Length": "0" } });
  }
  const length = end - start + 1;
  return new Response(head ? null : blob.slice(start, end + 1, type), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${blob.size}`, "Content-Length": String(length) } });
}

function missing() {
  return new Response(JSON.stringify({ detail: { code: "not_found", message: "找不到本机文件。" } }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Accept-Ranges": "bytes" } });
}

async function asset(pathname, request) {
  const failClosed = () => { throw new Error("missing"); };
  try {
    const db = await openDeviceDB();
    let match = /^\/device\/files\/([0-9a-f-]{36})\/source\.pdf$/.exec(pathname);
    if (match) {
      const document = await db.get("documents", match[1]);
      if (!document || document.deleted_at || !(document.blob instanceof Blob)) failClosed();
      return response(document.blob, "application/pdf", request);
    }
    match = /^\/device\/files\/([0-9a-f-]{36})\/images\/([0-9a-f-]{36})\/(preview|original)$/.exec(pathname);
    if (match) {
      const [document, image] = await Promise.all([db.get("documents", match[1]), db.get("images", match[2])]);
      if (!document || document.deleted_at || !image || image.document_id !== match[1]) failClosed();
      const preview = match[3] === "preview";
      const blob = preview ? image.preview : image.original;
      if (!(blob instanceof Blob)) failClosed();
      return response(blob, preview ? image.preview_mime_type : image.mime_type, request);
    }
    match = /^\/device\/files\/([0-9a-f-]{36})\/notes\/([0-9a-f-]{36})\/excerpt\.png$/.exec(pathname);
    if (match) {
      const [document, note, excerpt] = await Promise.all([db.get("documents", match[1]), db.get("notes", match[2]), db.get("excerpts", match[2])]);
      if (!document || document.deleted_at || !note || note.document_id !== match[1] || note.deleted_at || note.purged || !excerpt || excerpt.document_id !== match[1] || excerpt.source_sha256 !== document.sha256 || !(excerpt.blob instanceof Blob)) failClosed();
      return response(excerpt.blob, "image/png", request);
    }
  } catch { return missing(); }
  return missing();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!["GET", "HEAD"].includes(request.method)) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/device/files/")) return;
  event.respondWith(asset(url.pathname, request));
});
