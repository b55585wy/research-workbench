import { teachingCatalog, teachingExample, teachingDatasetMatches, teachingExampleForDataset,
  teachingJobMatches, teachingChartMatches, teachingPresentationTitle } from "/teaching-catalog.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function availability(example, native) {
  const engine = example.analysis.method === "describe" ? "python" : "r";
  if (!native.engines || engine === "r" && !native.methods) return native.loading ? "loading" : "unavailable";
  const runtime = native.engines.find((item) => item.id === engine);
  if (!runtime?.available) return "unavailable";
  if (engine === "python") return "ready";
  const method = native.methods.find((item) => item.id === example.analysis.method);
  return method?.available && method.library?.available ? "ready" : "unavailable";
}

export function createTeachingWorkflow(adapter) {
  function snapshot() {
    const context = adapter.getContext();
    const native = adapter.analysis.getTeachingState();
    const dataset = native.ownerId === context.ownerId ? native.dataset : null;
    const example = teachingExampleForDataset(dataset);
    const job = example ? native.jobs.find((item) => teachingJobMatches(item, dataset, example)) : null;
    const chart = job ? adapter.charts.getTeachingCharts(context.ownerId).find((item) => teachingChartMatches(item, dataset, example)) : null;
    return { context, native, dataset, example, job, chart };
  }

  function getModel() {
    const { context, native, dataset, example, job, chart } = snapshot();
    return { language: context.language, ownerId: context.ownerId,
      available: Boolean(context.available && context.ownerId && native.ownerId === context.ownerId),
      busy: Boolean(context.busy || native.busy || adapter.charts.getSkillModel().busy || adapter.presentations.hasPending(context.ownerId)),
      examples: teachingCatalog.map(({ id, title, question, design, rowMeaning, rowCount, fields, previewRows }) => ({
        id, title, question, design, rowMeaning, rowCount, fields, previewRows,
        availability: availability(teachingExample(id), native)
      })),
      progress: example ? { exampleId: example.id, datasetId: dataset.id,
        stage: chart ? "charted" : job ? "analyzed" : "imported", analysisId: job?.id || null, chartId: chart?.id || null } : null };
  }

  function sameContext(stamp) {
    const now = adapter.getContext(), native = adapter.analysis.getTeachingState();
    return now.ownerId === stamp.ownerId && now.sha256 === stamp.sha256 && now.generation === stamp.generation &&
      native.ownerId === stamp.ownerId && native.revision === stamp.revision;
  }

  async function importExample(command) {
    const model = getModel(), example = teachingExample(command?.exampleId);
    if (!example || !UUID.test(command?.requestId || "") || command.ownerId !== model.ownerId ||
        !model.available || model.busy || model.examples.find((item) => item.id === example.id)?.availability !== "ready") throw new Error("teaching_import_unavailable");
    const stamp = { ...adapter.getContext(), revision: adapter.analysis.getTeachingState().revision };
    const form = new FormData();
    form.append("file", new File([example.csv], example.filename, { type: "text/csv" }));
    form.append("request_id", command.requestId);
    const response = await adapter.checkedFetch(`/api/v1/documents/${encodeURIComponent(command.ownerId)}/datasets`, { method: "POST", body: form });
    const dataset = await response.json();
    if (!response.ok || dataset?.id !== command.requestId || dataset.document_id !== command.ownerId || !teachingDatasetMatches(dataset, example)) throw new Error("teaching_import_invalid");
    adapter.analysis.openImportedDataset(command.ownerId, dataset, { select: false });
    const accepted = sameContext(stamp) && adapter.analysis.applyTeachingDataset(command.ownerId, dataset, example.analysis);
    adapter.sourcesChanged?.(command.ownerId);
    return { status: accepted ? "imported" : "stale", datasetId: dataset.id };
  }

  async function continueExample(action) {
    if (!["analysis", "charts", "presentations"].includes(action)) return false;
    const before = snapshot(), model = getModel();
    if (!model.available || model.busy || !before.example || action !== "analysis" && !before.job || action === "presentations" && !before.chart) return false;
    if (await adapter.navigate(action) !== true) return false;
    const after = snapshot();
    if (!adapter.isArea(action) || after.context.ownerId !== before.context.ownerId || after.dataset?.id !== before.dataset.id ||
        after.dataset.sha256 !== before.dataset.sha256) return false;
    const { context, dataset, example, job, chart } = after;
    if (action === "analysis") {
      if (job) { await adapter.analysis.openJob(job.id, { preserveFocus: true }); return true; }
      return true;
    }
    if (!job) return false;
    if (action === "presentations") {
      return Boolean(chart && await adapter.presentations.prepareTeachingSources(context.ownerId, dataset, job, chart, teachingPresentationTitle(example, context.language)));
    }
    const chartRevision = adapter.charts.getTeachingRevision(context.ownerId);
    const planRevision = after.native.revision;
    await adapter.charts.reload(context.ownerId);
    const current = snapshot();
    if (current.context.ownerId !== context.ownerId || current.context.sha256 !== context.sha256 || current.context.generation !== context.generation ||
        current.native.revision !== planRevision || current.dataset?.id !== dataset.id || current.dataset.sha256 !== dataset.sha256 ||
        adapter.charts.getTeachingRevision(context.ownerId) !== chartRevision || !adapter.isArea(action)) return false;
    return adapter.charts.prepareTeachingChart(context.ownerId, dataset, example.chart, teachingPresentationTitle(example, context.language));
  }

  return { getModel, importExample, continueExample,
    async refresh() {
      const context = adapter.getContext();
      if (context.available && context.ownerId && !getModel().busy) await adapter.analysis.reload(context.ownerId);
    } };
}
