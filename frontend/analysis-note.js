const SHA256 = /^[0-9a-f]{64}$/i;
const METHODS = new Set(["describe", "ttest_independent", "ttest_paired", "correlation"]);

const messages = {
  zh: {
    title: "分析结果",
    dataFile: "数据文件",
    method: "方法",
    engine: "引擎",
    selectedFields: "所选字段",
    completedAt: "完成时间",
    source: "来源",
    describe: "描述统计",
    independent: "独立样本 t 检验",
    paired: "配对 t 检验",
    correlation: "相关分析",
    pearson: "Pearson 相关",
    spearman: "Spearman 秩相关",
    rows: "行数",
    used: "使用行数",
    excluded: "排除行数",
    completePairs: "完整配对数",
    excludedPairs: "排除配对数",
    n: "n",
    missing: "缺失",
    mean: "均值",
    median: "中位数",
    sd: "样本标准差",
    min: "最小值",
    max: "最大值",
    group: "组",
    direction: "差值方向",
    variant: "方差处理",
    alternative: "备择方向",
    two_sided: "双侧（two_sided）",
    greater: "大于（greater）",
    less: "小于（less）",
    confidence: "置信水平",
    ci: "置信区间",
    statistic: "t 统计量",
    df: "自由度",
    pValue: "p 值",
    difference: "均值差",
    unit: "配对单位 ID 列",
    pairedStats: "完整配对摘要",
    differenceStats: "差值摘要",
    columns: "列"
  },
  en: {
    title: "Analysis results",
    dataFile: "Data file",
    method: "Method",
    engine: "Engine",
    selectedFields: "Selected fields",
    completedAt: "Completed",
    source: "Source",
    describe: "Descriptive statistics",
    independent: "Independent-samples t-test",
    paired: "Paired t-test",
    correlation: "Correlation analysis",
    pearson: "Pearson correlation",
    spearman: "Spearman rank correlation",
    rows: "Rows",
    used: "Rows used",
    excluded: "Rows excluded",
    completePairs: "Complete pairs",
    excludedPairs: "Excluded pairs",
    n: "n",
    missing: "Missing",
    mean: "Mean",
    median: "Median",
    sd: "Sample SD",
    min: "Minimum",
    max: "Maximum",
    group: "Group",
    direction: "Difference direction",
    variant: "Variance method",
    alternative: "Alternative",
    two_sided: "Two-sided (two_sided)",
    greater: "Greater (greater)",
    less: "Less (less)",
    confidence: "Confidence level",
    ci: "Confidence interval",
    statistic: "t statistic",
    df: "Degrees of freedom",
    pValue: "p value",
    difference: "Mean difference",
    unit: "Pairing unit ID column",
    pairedStats: "Complete-pair summaries",
    differenceStats: "Difference summary",
    columns: "Columns"
  }
};

function invalid() {
  const error = new Error("invalid_analysis_note");
  error.code = "invalid_analysis_note";
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (typeof value === "number" && !Number.isFinite(value)) throw invalid();
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function object(value) {
  if (!isObject(value)) throw invalid();
  return value;
}

function text(value) {
  if (typeof value !== "string" || !value.length || value.length > 10000) throw invalid();
  return value;
}

function count(value) {
  if (!Number.isInteger(value) || value < 0) throw invalid();
  return value;
}

function numeric(value, nullable = false) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw invalid();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid();
    return value;
  }
  if (typeof value === "string" && value.length && value.length <= 200 && !/[\r\n]/.test(value)) return value;
  throw invalid();
}

function display(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function field(lines, label, value) {
  lines.push(`${label}: ${display(value)}`);
}

function validateStat(stat) {
  object(stat);
  text(stat.column);
  count(stat.n);
  count(stat.missing);
  for (const key of ["mean", "median", "sd", "min", "max"]) numeric(stat[key], true);
}

function statLine(stat, labels) {
  validateStat(stat);
  return `${stat.column}: ${labels.n} ${display(stat.n)} · ${labels.missing} ${display(stat.missing)} · ${labels.mean} ${display(stat.mean)} · ${labels.median} ${display(stat.median)} · ${labels.sd} ${display(stat.sd)} · ${labels.min} ${display(stat.min)} · ${labels.max} ${display(stat.max)}`;
}

function validateCounts(result) {
  const counts = object(result.counts);
  count(counts.total);
  count(counts.used);
  count(counts.excluded);
  return counts;
}

function validateColumns(columns, expected) {
  if (!Array.isArray(columns) || columns.length !== 2 || columns.some((value) => typeof value !== "string" || !value.length)) throw invalid();
  if (expected && !same(columns, expected)) throw invalid();
  return columns;
}

function validateAlternative(test) {
  if (!["two_sided", "greater", "less"].includes(test.alternative)) throw invalid();
  numeric(test.confidence);
}

function intervalLines(lines, test, labels) {
  validateAlternative(test);
  const ci = object(test.ci);
  if (typeof ci.lower_unbounded !== "boolean" || typeof ci.upper_unbounded !== "boolean") throw invalid();
  for (const side of ["lower", "upper"]) {
    if (ci[`${side}_unbounded`]) {
      if (ci[side] !== null) throw invalid();
    } else {
      numeric(ci[side]);
    }
  }
  const lower = ci.lower_unbounded ? "−∞" : display(ci.lower);
  const upper = ci.upper_unbounded ? "+∞" : display(ci.upper);
  field(lines, labels.alternative, labels[test.alternative]);
  field(lines, labels.confidence, test.confidence);
  field(lines, labels.ci, `[${lower}, ${upper}]`);
}

function validateTestValues(test) {
  for (const key of ["statistic", "df", "difference", "standard_error"]) numeric(test[key]);
  numeric(test.p_value);
}

function describeLines(result, lines, labels) {
  count(result.row_count);
  if (!Array.isArray(result.stats) || !result.stats.length) throw invalid();
  field(lines, labels.rows, result.row_count);
  for (const stat of result.stats) lines.push(statLine(stat, labels));
}

function independentLines(result, test, lines, labels) {
  const counts = validateCounts(result);
  const groups = validateColumns(test.groups);
  if (!Array.isArray(result.stats) || result.stats.length !== 2) throw invalid();
  text(test.outcome);
  text(test.group_column);
  text(test.variant);
  validateTestValues(test);
  field(lines, labels.used, counts.used);
  field(lines, labels.excluded, counts.excluded);
  field(lines, labels.direction, `${groups[0]} − ${groups[1]}`);
  field(lines, labels.variant, test.variant);
  for (let index = 0; index < 2; index += 1) {
    const stat = result.stats[index];
    validateStat(stat);
    if (stat.column !== groups[index]) throw invalid();
    lines.push(`${labels.group} ${index + 1} ${groups[index]}: ${labels.n} ${display(stat.n)} · ${labels.mean} ${display(stat.mean)} · ${labels.sd} ${display(stat.sd)}`);
  }
  field(lines, labels.statistic, test.statistic);
  field(lines, labels.df, test.df);
  field(lines, labels.pValue, test.p_value);
  field(lines, labels.difference, test.difference);
  intervalLines(lines, test, labels);
}

function pairedLines(result, test, lines, labels) {
  const counts = validateCounts(result);
  const columns = validateColumns(test.columns);
  validateColumns(result.pairing?.columns, columns);
  if (result.pairing?.direction !== "first_minus_second") throw invalid();
  text(test.unit_column);
  if (!Array.isArray(result.stats) || result.stats.length !== 2) throw invalid();
  validateTestValues(test);
  field(lines, labels.unit, test.unit_column);
  field(lines, labels.direction, `${columns[0]} − ${columns[1]}`);
  field(lines, labels.completePairs, counts.used);
  field(lines, labels.excludedPairs, counts.excluded);
  lines.push(`${labels.pairedStats}:`);
  for (let index = 0; index < 2; index += 1) {
    const stat = result.stats[index];
    validateStat(stat);
    if (stat.column !== columns[index]) throw invalid();
    lines.push(statLine(stat, labels));
  }
  const difference = object(result.difference_stats);
  count(difference.n);
  for (const key of ["mean", "median", "sd", "min", "max"]) numeric(difference[key], true);
  lines.push(`${labels.differenceStats} (${columns[0]} − ${columns[1]}): ${labels.n} ${display(difference.n)} · ${labels.mean} ${display(difference.mean)} · ${labels.median} ${display(difference.median)} · ${labels.sd} ${display(difference.sd)} · ${labels.min} ${display(difference.min)} · ${labels.max} ${display(difference.max)}`);
  field(lines, labels.statistic, test.statistic);
  field(lines, labels.df, test.df);
  field(lines, labels.pValue, test.p_value);
  field(lines, labels.difference, test.difference);
  intervalLines(lines, test, labels);
}

function correlationLines(result, test, lines, labels) {
  const counts = validateCounts(result);
  const columns = validateColumns(test.columns);
  if (!["pearson", "spearman"].includes(test.kind)) throw invalid();
  const coefficient = test.kind === "spearman" ? "rho" : "r";
  if (test.coefficient !== coefficient) throw invalid();
  numeric(test.estimate);
  numeric(test.p_value);
  field(lines, labels.columns, columns.join(", "));
  field(lines, labels.completePairs, counts.used);
  field(lines, labels.excludedPairs, counts.excluded);
  field(lines, coefficient, test.estimate);
  field(lines, labels.pValue, test.p_value);
  if (test.ci !== null && test.ci !== undefined) {
    const ci = object(test.ci);
    numeric(ci.lower);
    numeric(ci.upper);
    numeric(test.confidence);
    field(lines, labels.confidence, test.confidence);
    field(lines, labels.ci, `[${display(ci.lower)}, ${display(ci.upper)}]`);
  }
}

function analysisMethod(job, result) {
  const method = job.method === undefined ? "describe" : job.method;
  if (!METHODS.has(method)) throw invalid();
  if (result.method !== undefined && result.method !== method) throw invalid();
  if (method === "describe") {
    count(result.row_count);
    if (!Array.isArray(result.stats) || !result.stats.length || result.test !== undefined
      || result.counts !== undefined || result.pairing !== undefined || result.difference_stats !== undefined) throw invalid();
  } else if (result.method !== method) throw invalid();
  return method;
}

function verifiedResult(job, notebook) {
  if (job?.status !== "succeeded" || !isObject(job.result)) throw invalid();
  const workbench = object(notebook?.metadata?.workbench);
  if (workbench.kind !== "saved_analysis" || workbench.read_only !== true || workbench.code_executed_in_view !== false
    || workbench.document_id !== job.document_id || workbench.analysis_id !== job.id
    || workbench.dataset_id !== job.dataset_id || workbench.dataset_sha256 !== job.dataset_sha256
    || workbench.code_sha256 !== job.recipe?.sha256 || workbench.engine_version !== job.engine_version
    || !SHA256.test(workbench.dataset_sha256 || "") || !SHA256.test(workbench.code_sha256 || "")) throw invalid();
  if (!Array.isArray(job.outputs)) throw invalid();
  const artifacts = {};
  for (const output of job.outputs) {
    if (!isObject(output) || typeof output.name !== "string" || !SHA256.test(output.sha256 || "") || Object.hasOwn(artifacts, output.name)) throw invalid();
    artifacts[output.name] = output.sha256;
  }
  if (!artifacts["summary.json"] || !same(workbench.artifact_sha256, artifacts)) throw invalid();
  if (!Array.isArray(notebook.cells)) throw invalid();
  const saved = [];
  for (const cell of notebook.cells) {
    if (!Array.isArray(cell?.outputs)) continue;
    for (const output of cell.outputs) {
      if (output?.output_type === "display_data" && typeof output.data?.["text/plain"] === "string") saved.push(output.data["text/plain"]);
    }
  }
  if (saved.length !== 1) throw invalid();
  let result;
  try {
    result = JSON.parse(saved[0]);
  } catch {
    throw invalid();
  }
  if (!same(result, job.result)) throw invalid();
  return { result, method: analysisMethod(job, result) };
}

export function formatAnalysisNote(job, notebook, sourceUrl, language = "en") {
  if (typeof sourceUrl !== "string" || !/^\/(?!\/)[^\r\n]*$/.test(sourceUrl)) throw invalid();
  const { result, method } = verifiedResult(job, notebook);
  const labels = messages[language === "zh" ? "zh" : "en"];
  const methodKey = { describe: "describe", ttest_independent: "independent", ttest_paired: "paired" }[method];
  const methodLabel = method === "correlation" ? labels[result.test?.kind] || labels.correlation : labels[methodKey];
  const lines = [labels.title];
  field(lines, labels.dataFile, text(job.dataset_name));
  field(lines, labels.method, methodLabel);
  field(lines, labels.engine, `${job.engine === "r" ? "R" : job.engine === "python" ? "Python" : text(job.engine)} ${text(job.engine_version)}`);
  if (!Array.isArray(job.columns) || !job.columns.length || job.columns.some((column) => typeof column !== "string" || !column.length)) throw invalid();
  field(lines, labels.selectedFields, job.columns.join(", "));
  if (job.finished_at !== null && job.finished_at !== undefined) field(lines, labels.completedAt, text(job.finished_at));
  if (method === "describe") {
    if (!same(job.columns, result.stats?.map((stat) => stat?.column))) throw invalid();
    describeLines(result, lines, labels);
  } else {
    const test = object(result.test);
    if (!same(job.columns, test.columns || (method === "ttest_independent" ? [test.outcome] : null))) throw invalid();
    if (method === "ttest_independent") independentLines(result, test, lines, labels);
    else if (method === "ttest_paired") pairedLines(result, test, lines, labels);
    else correlationLines(result, test, lines, labels);
  }
  field(lines, labels.source, sourceUrl);
  return lines.join("\n");
}
