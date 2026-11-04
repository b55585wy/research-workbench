export function isDeviceMode() {
  if (typeof document !== "undefined" && document.documentElement?.dataset.storageMode === "device") return true;
  return typeof location !== "undefined" && (location.pathname === "/device" || location.pathname.startsWith("/device/"));
}

export function mapDeviceAssetUrl(apiPath) {
  if (!isDeviceMode()) return apiPath;
  if (typeof apiPath !== "string") return apiPath;
  let match = /^\/api\/v1\/documents\/([^/]+)\/file\/?$/.exec(apiPath);
  if (match) return `/device/files/${match[1]}/source.pdf`;
  match = /^\/api\/v1\/documents\/([^/]+)\/images\/([^/]+)\/(preview|original|file)\/?$/.exec(apiPath);
  if (match) return `/device/files/${match[1]}/images/${match[2]}/${match[3] === "preview" ? "preview" : "original"}`;
  match = /^\/api\/v1\/documents\/([^/]+)\/notes\/([^/]+)\/excerpt\/?$/.exec(apiPath);
  if (match) return `/device/files/${match[1]}/notes/${match[2]}/excerpt.png`;
  return apiPath;
}
