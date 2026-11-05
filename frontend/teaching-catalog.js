const local = (zh, en) => ({ zh, en });
const field = (name, zh, en, numeric, meaningZh, meaningEn, unit = null) => ({
  name, label: local(zh, en), numeric, meaning: local(meaningZh, meaningEn), unit
});
const unit = local("示例单位", "Illustrative units");
const identifier = () => field("record_id", "虚构编号", "Synthetic ID", false, "仅用于区分合成记录", "Identifies synthetic records only");
const hashes = {
  "measurements-v1": "14d048d953dd22879b94bb781d5312abdf8be8a2125c039c608069def422d160",
  "independent-v1": "8874b6ca0c8398cbfc9dcd8d94d6ee3ef07c144e6923404c76c682d335534b58",
  "paired-v1": "7a239bde3ad41bb1607ad9eda178483a830c455f46f22a4cf1cab21376ce99fa",
  "correlation-v1": "6b9364ca03121163518f477d1d190a2dfc2657087c909e88ab44a0c1455286e2"
};

const definitions = [
  {
    id: "measurements-v1", title: local("测量值概况", "Summarize measurements"),
    question: local("这组虚构测量值的分布和缺失情况如何？", "How are these fictional measurements distributed, and how many are missing?"),
    design: local("描述统计练习；不进行组间比较或因果推断。", "Descriptive practice; no group comparison or causal inference."),
    rowMeaning: local("每行是一个虚构对象的一次测量。", "Each row is one measurement from a fictional subject."),
    fields: [identifier(), field("measurement", "测量值", "Measurement", true, "用于计算概况的合成数值", "Synthetic numeric measurement to summarize", unit)],
    rows: [["S001", "12"], ["S002", "15"], ["S003", ""], ["S004", "9"], ["S005", "14"], ["S006", "11"], ["S007", "13"], ["S008", "10"]],
    analysis: { method: "describe", columns: ["measurement"] },
    chart: { kind: "histogram", x: "measurement", y: null, bins: 4 }
  },
  {
    id: "independent-v1", title: local("两组得分比较", "Compare two groups"),
    question: local("两个虚构独立组的得分是否不同？", "Do scores differ between two fictional independent groups?"),
    design: local("每个对象只属于一组；示例给出独立组结构，检验前仍需核对前提。", "Each subject belongs to one group. Review the test prerequisites before proceeding."),
    rowMeaning: local("每行是一个虚构对象的分组与一次得分。", "Each row is one fictional subject, their group, and one score."),
    fields: [identifier(), field("group", "分组", "Group", false, "仅为虚构的 A、B 标签", "Fictional A/B labels only"), field("score", "得分", "Score", true, "无临床含义的合成得分", "Synthetic scores without clinical meaning", unit)],
    rows: [["S001", "A", "10"], ["S002", "A", "12"], ["S003", "A", "11"], ["S004", "A", "9"], ["S005", "B", "13"], ["S006", "B", "15"], ["S007", "B", "14"], ["S008", "B", "16"], ["S009", "A", ""]],
    analysis: { method: "ttest_independent", columns: ["score"], groupColumn: "group", group1: "A", group2: "B" },
    chart: { kind: "grouped_points", x: "group", y: "score", bins: null }
  },
  {
    id: "paired-v1", title: local("同一对象前后测量", "Compare paired measurements"),
    question: local("同一个虚构对象的前后两次测量是否不同？", "Do before/after measurements differ within the same fictional subject?"),
    design: local("按编号配对，差值方向为前测减后测；仍需明确确认配对关系。", "Pair by ID; differences are before minus after. Pairing must still be confirmed."),
    rowMeaning: local("每行是同一个虚构对象的前测与后测。", "Each row contains before/after measurements of one fictional subject."),
    fields: [identifier(), field("before", "前测", "Before", true, "合成的第一次测量", "Synthetic first measurement", unit), field("after", "后测", "After", true, "合成的第二次测量；有一条缺失", "Synthetic second measurement; one value is missing", unit)],
    rows: [["S001", "10", "11"], ["S002", "12", "11"], ["S003", "9", "11"], ["S004", "14", "15"], ["S005", "11", "13"], ["S006", "13", "14"], ["S007", "15", ""], ["S008", "16", "18"]],
    analysis: { method: "ttest_paired", columns: ["before", "after"], unit: "record_id", first: "before", second: "after" },
    chart: { kind: "scatter", x: "before", y: "after", bins: null }
  },
  {
    id: "correlation-v1", title: local("两项测量相关", "Explore a correlation"),
    question: local("同一虚构对象的两项测量是否相关？", "Are two measurements from the same fictional subject correlated?"),
    design: local("每行两项测量来自同一对象；相关不表示因果，检验前仍需核对前提。", "Both measurements in a row belong to one subject. Correlation does not establish causation; review prerequisites."),
    rowMeaning: local("每行是一个虚构对象的两项测量。", "Each row contains two measurements of one fictional subject."),
    fields: [identifier(), field("measurement_x", "测量 X", "Measurement X", true, "第一项合成测量", "First synthetic measurement", unit), field("measurement_y", "测量 Y", "Measurement Y", true, "第二项合成测量；有一条缺失", "Second synthetic measurement; one value is missing", unit)],
    rows: [["S001", "1", "3"], ["S002", "2", "2"], ["S003", "3", "5"], ["S004", "4", "4"], ["S005", "5", "7"], ["S006", "6", "7"], ["S007", "7", "8"], ["S008", "8", ""]],
    analysis: { method: "correlation", columns: ["measurement_x", "measurement_y"], first: "measurement_x", second: "measurement_y" },
    chart: { kind: "scatter", x: "measurement_x", y: "measurement_y", bins: null }
  }
];

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export const teachingCatalog = freeze(definitions.map((item) => ({ ...item,
  filename: `synthetic-teaching-${item.id}.csv`, sha256: hashes[item.id], rowCount: item.rows.length,
  fields: item.fields.map((column, index) => ({ ...column, missing: item.rows.filter((row) => row[index] === "").length })),
  previewRows: item.rows.slice(0, 5), csv: [item.fields.map((column) => column.name), ...item.rows].map((row) => row.join(",")).join("\n") + "\n"
})));

export function teachingExample(id) { return teachingCatalog.find((item) => item.id === id) || null; }

export function teachingDatasetMatches(dataset, example) {
  return Boolean(dataset && example && dataset.sha256 === example.sha256 && dataset.original_filename === example.filename &&
    dataset.row_count === example.rowCount && dataset.column_count === example.fields.length && Array.isArray(dataset.columns) &&
    dataset.columns.length === example.fields.length && dataset.columns.every((column, index) => column.name === example.fields[index].name &&
      column.numeric === example.fields[index].numeric && column.missing === example.fields[index].missing));
}

export function teachingExampleForDataset(dataset) { return teachingCatalog.find((item) => teachingDatasetMatches(dataset, item)) || null; }

export function teachingJobMatches(job, dataset, example) {
  if (!(teachingDatasetMatches(dataset, example) && job?.status === "succeeded" && job.document_id === dataset.document_id &&
    job.dataset_id === dataset.id && job.dataset_sha256 === dataset.sha256 && (job.method || "describe") === example.analysis.method &&
    JSON.stringify(job.columns) === JSON.stringify(example.analysis.columns))) return false;
  if (example.analysis.method === "describe") return true;
  const options = job.ttest || job.paired || job.correlation;
  if (job.engine !== "r" || options?.alternative !== "two_sided" || options.confidence !== 0.95) return false;
  if (example.analysis.method === "ttest_independent") return Boolean(job.ttest?.group_column === example.analysis.groupColumn &&
    JSON.stringify(job.ttest.groups) === JSON.stringify([example.analysis.group1, example.analysis.group2]) && job.ttest.variant === "welch");
  if (example.analysis.method === "ttest_paired") return job.paired?.unit_column === example.analysis.unit;
  return job.correlation?.kind === "pearson";
}

export function teachingChartMatches(chart, dataset, example) {
  return Boolean(teachingDatasetMatches(dataset, example) && chart && !chart.deleted_at && chart.document_id === dataset.document_id &&
    chart.dataset_id === dataset.id && chart.dataset_sha256 === dataset.sha256 && chart.kind === example.chart.kind &&
    chart.spec?.x === example.chart.x && chart.spec?.y === example.chart.y);
}

export function teachingPresentationTitle(example, language) {
  return language === "en" ? `Synthetic teaching: ${example.title.en}` : `合成教学：${example.title.zh}`;
}
