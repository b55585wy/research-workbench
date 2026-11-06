import { createRoot } from "react-dom/client";

type Model = {
  language: "zh" | "en";
  visible: boolean;
  selected: boolean;
  disabled: boolean;
  title: string;
  pageCount: number;
  pageRange: string;
  invalidPages: boolean;
  scope: string;
};
type Callbacks = { onSelect: (selected: boolean, scope: string) => void; onPages: (pages: string, scope: string) => void };

function PaperSource({ model, callbacks }: { model: Model; callbacks: Callbacks }) {
  if (!model.visible) return null;
  const english = model.language === "en";
  return <section className="presentation-paper-source" aria-label={english ? "Paper PDF" : "论文 PDF"}>
    <label className="presentation-paper-choice">
      <input type="checkbox" checked={model.selected} disabled={model.disabled}
        onChange={(event) => callbacks.onSelect(event.target.checked, model.scope)} />
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />
      </svg>
      <span><strong>{english ? "Use this paper PDF" : "使用当前论文 PDF"}</strong>
        <span className="presentations-source-meta" title={model.title}>{model.title} · {model.pageCount}{english ? " pages" : " 页"}</span>
      </span>
    </label>
    {model.selected && <details className="presentation-paper-range">
      <summary>{english ? "Page range" : "页面范围"}</summary>
      <label htmlFor="presentation-paper-pages">{english ? "Leave empty for all pages" : "留空表示全部页面"}</label>
      <input id="presentation-paper-pages" type="text" value={model.pageRange} disabled={model.disabled}
        maxLength={240} placeholder={english ? "All pages, or 1-5, 8" : "全部页面，或 1-5, 8"} aria-invalid={model.invalidPages}
        aria-describedby={model.invalidPages ? "presentation-paper-page-error" : undefined}
        onChange={(event) => callbacks.onPages(event.target.value, model.scope)} />
      {model.invalidPages && <p id="presentation-paper-page-error" role="alert">{english ? "Enter up to 60 valid, distinct page numbers." : "请填写不重复的有效页码，每次最多 60 页。"}</p>}
    </details>}
  </section>;
}

export function mountPresentationPaper({ container, model, callbacks }: { container: HTMLElement; model: Model; callbacks: Callbacks }) {
  const root = createRoot(container);
  let active = true;
  const update = (next: Model) => { if (active) root.render(<PaperSource model={next} callbacks={callbacks} />); };
  update(model);
  return { update, destroy() { if (active) { active = false; root.unmount(); } } };
}
