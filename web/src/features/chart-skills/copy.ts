export const skillCopy = {
  en: {
    label: "Figure skill", builtin: "Built-in presets", new: "New skill", edit: "Edit skill", import: "Import skill JSON",
    export: "Export skill JSON", editor: "Figure skill editor", name: "Name", description: "Purpose", kind: "Chart type",
    palette: "Palette", color: "Color", addColor: "Add color", removeColor: "Remove last color", font: "Font",
    fontSize: "Font size", lineWidth: "Line width", markerSize: "Marker size", width: "Width", height: "Height",
    bins: "Bins", formats: "Export formats", offline: "Offline package", save: "Save", saveVersion: "Save new version",
    cancel: "Cancel", retry: "Retry exact save", discard: "Discard save request", discardDraft: "Discard draft",
    reload: "Retry loading", dirty: "Unsaved changes", saving: "Saving…", uncertain: "Save unconfirmed. Retry or discard the request.",
    loading: "Loading…", unavailable: "Figure skills are unavailable here.", listError: "Could not load figure skills.",
    invalid: "Check the skill fields or imported JSON (maximum 16 KiB).", writeError: "Could not confirm the save.",
    changed: "This skill has changed. Discard this request and reopen the latest version.", quota: "The skill limit has been reached.",
    detached: "Another figure has unsaved work. Return to it or discard the draft.",
    discardConfirm: "Discard unsaved skill changes?", requestConfirm: "Discard this save request? It may already have been saved.",
    palettePreset: "Palette preset", custom: "Custom", neutral: "Default", nature: "Nature-inspired", cell: "Cell-inspired",
    kinds: { analysis_counts: "Analysis counts", histogram: "Histogram", scatter: "Scatter", grouped_points: "Grouped points" },
    requirements: {
      analysis_counts: "Requires a saved analysis.", histogram: "Requires one numeric X field.",
      scatter: "Requires distinct numeric X and Y fields.", grouped_points: "Requires categorical X, numeric Y and exactly two valid groups."
    }
  },
  zh: {
    label: "绘图 skill", builtin: "内置预设", new: "新建 skill", edit: "编辑 skill", import: "导入 skill JSON",
    export: "导出 skill JSON", editor: "编辑绘图 skill", name: "名称", description: "用途", kind: "图表类型",
    palette: "配色", color: "颜色", addColor: "添加颜色", removeColor: "移除最后一种颜色", font: "字体",
    fontSize: "字号", lineWidth: "线宽", markerSize: "点大小", width: "宽度", height: "高度",
    bins: "分箱数", formats: "导出格式", offline: "离线包", save: "保存", saveVersion: "保存新版本",
    cancel: "取消", retry: "重试原保存请求", discard: "放弃保存请求", discardDraft: "放弃草稿",
    reload: "重新加载", dirty: "有未保存的修改", saving: "正在保存…", uncertain: "保存结果未确认，请重试或放弃该请求。",
    loading: "正在加载…", unavailable: "此处暂不支持绘图 skill。", listError: "无法加载绘图 skill。",
    invalid: "请检查字段或导入的 JSON（最多 16 KiB）。", writeError: "未能确认保存结果。",
    changed: "此 skill 已有变化，请放弃该请求并重新打开最新版本。", quota: "已达到 skill 数量或版本上限。",
    detached: "另一张图仍有未保存内容，请返回处理或放弃草稿。",
    discardConfirm: "放弃未保存的 skill 修改？", requestConfirm: "放弃此保存请求？该请求可能已经保存成功。",
    palettePreset: "配色预设", custom: "自定义", neutral: "默认", nature: "Nature 风格", cell: "Cell 风格",
    kinds: { analysis_counts: "分析计数", histogram: "直方图", scatter: "散点图", grouped_points: "分组散点" },
    requirements: {
      analysis_counts: "需要已保存的分析结果。", histogram: "需要一个数值型 X 字段。",
      scatter: "需要不同的数值型 X、Y 字段。", grouped_points: "需要分类型 X、数值型 Y，且恰有两个有效分组。"
    }
  }
};
