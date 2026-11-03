const KATEX_OPTIONS = {
  trust: false,
  throwOnError: false,
  maxExpand: 100,
  maxSize: 10
};

// KaTeX needs sanitized SVG for stretchy math; active and external-resource SVG stays forbidden.
const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  FORBID_TAGS: [
    "animate", "animateColor", "animateMotion", "animateTransform", "audio",
    "base", "button", "discard", "embed", "filter", "foreignObject", "form",
    "iframe", "img", "image", "input", "link", "meta", "mpath", "object",
    "option", "picture", "script", "select", "set", "source", "style",
    "textarea", "use", "video"
  ],
  FORBID_ATTR: ["formaction", "poster", "srcset", "xlink:href"]
};

function plainFallback(answer, notice) {
  const fragment = document.createDocumentFragment();
  const warning = document.createElement("p");
  warning.className = "assistant-rendering-notice";
  warning.setAttribute("role", "note");
  warning.textContent = notice;
  const content = document.createElement("pre");
  content.className = "assistant-answer-plain";
  content.tabIndex = 0;
  content.textContent = answer;
  fragment.append(warning, content);
  return { fragment, tableSources: [] };
}

export function renderAssistantMarkdown(answer, { t }) {
  const text = String(answer);
  const markdownit = window.markdownit;
  const purify = window.DOMPurify;
  if (typeof markdownit !== "function" || typeof purify?.sanitize !== "function") {
    return plainFallback(text, t("markdownUnavailable"));
  }

  try {
    const md = markdownit({
      html: false,
      linkify: false,
      typographer: false,
      breaks: false
    });
    const mathAvailable = typeof window.texmath === "function" && typeof window.katex?.renderToString === "function";
    if (mathAvailable) {
      md.use(window.texmath, {
        engine: window.katex,
        delimiters: ["dollars", "brackets"],
        katexOptions: KATEX_OPTIONS
      });
    }
    const tokens = md.parse(text, {});
    const lines = text.split("\n");
    const tableSources = tokens.filter((token) => token.type === "table_open").map((token) => {
      if (!Array.isArray(token.map)) return "";
      return lines.slice(token.map[0], token.map[1]).join("\n");
    });
    const rendered = md.renderer.render(tokens, md.options, {});
    const sanitized = purify.sanitize(rendered, SANITIZE_OPTIONS);
    const template = document.createElement("template");
    template.innerHTML = sanitized;
    if (!mathAvailable) {
      const warning = document.createElement("p");
      warning.className = "assistant-rendering-notice";
      warning.setAttribute("role", "note");
      warning.textContent = t("mathUnavailable");
      template.content.prepend(warning);
    }
    return { fragment: template.content, tableSources };
  } catch {
    return plainFallback(text, t("markdownUnavailable"));
  }
}
