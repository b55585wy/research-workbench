export function parsePaperPages(value, pageCount, maximum = 60) {
  if (typeof value !== "string" || value.length > 240 || !Number.isInteger(pageCount) || pageCount < 1) return { valid: false, pages: null };
  if (!value.trim()) return { valid: pageCount <= maximum, pages: null };
  const pages = [];
  for (const token of value.replaceAll("，", ",").replaceAll("–", "-").split(",")) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) return { valid: false, pages: null };
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > pageCount || end - start + pages.length + 1 > maximum) return { valid: false, pages: null };
    for (let page = start; page <= end; page += 1) pages.push(page);
  }
  if (new Set(pages).size !== pages.length) return { valid: false, pages: null };
  return { valid: true, pages: pages.sort((a, b) => a - b) };
}

export function missingPaperCitation(outline, sources) {
  if (sources?.length !== 1 || sources[0].kind !== "paper" || !Array.isArray(outline?.slides)) return false;
  return outline.slides.some((slide) => Array.isArray(slide?.body) && slide.body.some((text) => typeof text === "string" && text.trim())
    && (!Array.isArray(slide.source_refs) || !slide.source_refs.includes(sources[0].ref)));
}

export function createPresentationPaperView(container, getModel, callbacks) {
  let handle = null;
  let loading = null;
  let destroyed = false;
  return {
    update() {
      if (!container || destroyed) return;
      if (handle) { handle.update(getModel()); return; }
      if (loading) return;
      loading = import(new URL("./vendor/workspace-shell/workspace-shell.js", import.meta.url).href)
        .then((module) => {
          if (destroyed) return;
          handle = module.mountPresentationPaper({ container, model: getModel(), callbacks });
        })
        .catch(() => { if (!destroyed) container.textContent = getModel().language === "en" ? "Paper selection could not load. Reopen PPT to retry." : "论文选项未能加载，请重新打开 PPT 重试。"; })
        .finally(() => { loading = null; });
    },
    destroy() {
      destroyed = true;
      handle?.destroy();
      handle = null;
    }
  };
}
