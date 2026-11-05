const RENDERER_PATH = "vendor/plotly/4.2.0/plotly-strict.min.js";
// API identity is protocol data; UI asset rewriting must not change it.
const RENDERER_API_PATH = "/" + RENDERER_PATH;

export const CHART_RENDERER_URL = new URL(RENDERER_PATH, import.meta.url).href;

export function isChartRenderer(renderer) {
  return Boolean(renderer && renderer.id === "plotly-strict" && renderer.version === "4.2.0" &&
    renderer.script_url === RENDERER_API_PATH && typeof renderer.sha256 === "string" && renderer.sha256.length === 64 &&
    /^[0-9a-f]{64}$/.test(renderer.sha256) && Number.isSafeInteger(renderer.byte_size) && renderer.byte_size > 0);
}
