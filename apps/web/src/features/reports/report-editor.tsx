"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@trace/ui";
import { reportRevisionUpdateRequestSchema, type ReportContent, type ReportDetail, type ReportRevisionUpdateRequest, type ReportRevisionUpdateResponse } from "@trace/shared";

export type SaveReportRevision = (reportId: string, request: ReportRevisionUpdateRequest, signal?: AbortSignal) => Promise<ReportRevisionUpdateResponse>;
export type ReportRevisionSaved = (report: ReportDetail) => void;
interface Props { report: ReportDetail; saveRevision: SaveReportRevision; contributorLabels?: Record<string, string>; onReloadLatest?: () => void; onDirtyChange?: (dirty: boolean) => void; onSaved?: ReportRevisionSaved }
type EditableReport = ReportDetail & { content: ReportContent; revision: number; revisionSource: "ai" | "manual" };

function cloneContent(content: ReportContent): ReportContent {
  return { executiveSummary: content.executiveSummary, repositories: content.repositories.map((repository) => ({ ...repository, contributors: repository.contributors.map((contributor) => ({ ...contributor, accomplishments: [...contributor.accomplishments] })) })) };
}
function revisionLabel(report: ReportDetail) { return `Revision ${report.revision} · ${report.revisionSource === "manual" ? "Manually edited" : "AI generated"}`; }
function buildPatch(original: ReportContent, draft: ReportContent): ReportRevisionUpdateRequest["prosePatch"] | undefined {
  const prosePatch: ReportRevisionUpdateRequest["prosePatch"] = {};
  if (draft.executiveSummary !== original.executiveSummary) prosePatch.executiveSummary = draft.executiveSummary;
  const repositories = draft.repositories.flatMap((repository, repositoryIndex) => {
    const previous = original.repositories[repositoryIndex];
    if (!previous || previous.repositoryId !== repository.repositoryId) return [];
    const patch: NonNullable<ReportRevisionUpdateRequest["prosePatch"]["repositories"]>[number] = { repositoryId: repository.repositoryId };
    if (repository.summary !== previous.summary) patch.summary = repository.summary;
    const contributors = repository.contributors.flatMap((contributor, contributorIndex) => {
      const oldContributor = previous.contributors[contributorIndex];
      if (!oldContributor || oldContributor.contributorId !== contributor.contributorId) return [];
      const contributorPatch: NonNullable<NonNullable<ReportRevisionUpdateRequest["prosePatch"]["repositories"]>[number]["contributors"]>[number] = { contributorId: contributor.contributorId };
      if (contributor.summary !== oldContributor.summary) contributorPatch.summary = contributor.summary;
      if (JSON.stringify(contributor.accomplishments) !== JSON.stringify(oldContributor.accomplishments)) contributorPatch.accomplishments = contributor.accomplishments;
      return contributorPatch.summary !== undefined || contributorPatch.accomplishments !== undefined ? [contributorPatch] : [];
    });
    if (contributors.length) patch.contributors = contributors;
    return patch.summary !== undefined || patch.contributors !== undefined ? [patch] : [];
  });
  if (repositories.length) prosePatch.repositories = repositories;
  return prosePatch.executiveSummary !== undefined || prosePatch.repositories !== undefined ? prosePatch : undefined;
}

function applyPatch(content: ReportContent, prosePatch: ReportRevisionUpdateRequest["prosePatch"] | undefined): ReportContent {
  const next = cloneContent(content);
  if (!prosePatch) return next;
  if (prosePatch.executiveSummary !== undefined) next.executiveSummary = prosePatch.executiveSummary;
  for (const repositoryPatch of prosePatch.repositories ?? []) {
    const repository = next.repositories.find((item) => item.repositoryId === repositoryPatch.repositoryId);
    if (!repository) continue;
    if (repositoryPatch.summary !== undefined) repository.summary = repositoryPatch.summary;
    for (const contributorPatch of repositoryPatch.contributors ?? []) {
      const contributor = repository.contributors.find((item) => item.contributorId === contributorPatch.contributorId);
      if (!contributor) continue;
      if (contributorPatch.summary !== undefined) contributor.summary = contributorPatch.summary;
      if (contributorPatch.accomplishments !== undefined) contributor.accomplishments = [...contributorPatch.accomplishments];
    }
  }
  return next;
}

export function ReportEditor({ report, saveRevision, contributorLabels = {}, onReloadLatest, onDirtyChange, onSaved }: Props) {
  if (!report.content || !report.revision || !report.revisionSource) return null;
  const editableReport: EditableReport = { ...report, content: report.content, revision: report.revision, revisionSource: report.revisionSource };
  return <ReportEditorReady report={editableReport} saveRevision={saveRevision} contributorLabels={contributorLabels} onReloadLatest={onReloadLatest} onDirtyChange={onDirtyChange} onSaved={onSaved} editable={["completed", "failed"].includes(report.status)} />;
}
function ReportEditorReady({ report, saveRevision, contributorLabels, onReloadLatest, onDirtyChange, onSaved, editable }: { report: EditableReport; saveRevision: SaveReportRevision; contributorLabels: Record<string, string>; onReloadLatest?: () => void; onDirtyChange?: (dirty: boolean) => void; onSaved?: ReportRevisionSaved; editable: boolean }) {
  const [current, setCurrent] = useState(report);
  const [draft, setDraft] = useState(() => cloneContent(report.content));
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const saveController = useRef<AbortController>();
  const saveGeneration = useRef(0);
  const currentRef = useRef(current);
  const draftRef = useRef(draft);
  const patch = useMemo(() => buildPatch(current.content, draft), [current.content, draft]);
  const dirty = patch !== undefined;
  useEffect(() => { currentRef.current = current; draftRef.current = draft; }, [current, draft]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("trace:report-editor-dirty", { detail: { dirty } }));
    return () => { window.dispatchEvent(new CustomEvent("trace:report-editor-dirty", { detail: { dirty: false } })); };
  }, [dirty]);

  useEffect(() => {
    if (report.id === currentRef.current.id && report.revision === currentRef.current.revision) return;
    saveGeneration.current += 1;
    saveController.current?.abort();
    saveController.current = undefined;
    const retainedPatch = report.id === currentRef.current.id ? buildPatch(currentRef.current.content, draftRef.current) : undefined;
    setCurrent(report);
    setDraft(report.id === currentRef.current.id ? applyPatch(report.content, retainedPatch) : cloneContent(report.content));
    setSaving(false);
    setNotice(undefined);
    setError(retainedPatch ? "The latest revision loaded. Your unsaved prose was kept; review and save it again." : undefined);
  }, [report]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => () => saveController.current?.abort(), []);

  const updateRepository = (index: number, summary: string) => setDraft((value) => ({ ...value, repositories: value.repositories.map((repository, itemIndex) => itemIndex === index ? { ...repository, summary } : repository) }));
  const updateContributor = (repositoryIndex: number, contributorIndex: number, field: "summary" | "accomplishments", value: string) => setDraft((content) => ({ ...content, repositories: content.repositories.map((repository, ri) => ri !== repositoryIndex ? repository : { ...repository, contributors: repository.contributors.map((contributor, ci) => ci !== contributorIndex ? contributor : { ...contributor, [field]: field === "accomplishments" ? value.split("\n").map((line) => line.trim()).filter(Boolean) : value }) }) }));

  async function save() {
    if (!editable) return;
    setNotice(undefined); setError(undefined);
    const parsed = reportRevisionUpdateRequestSchema.safeParse({ expectedRevision: current.revision, prosePatch: patch });
    if (!parsed.success) { setError(draft.executiveSummary.trim() ? "Review the highlighted prose. Summaries and accomplishments must contain readable text within the allowed length." : "Executive summary is required before saving."); return; }
    saveController.current?.abort(); const controller = new AbortController(); const generation = ++saveGeneration.current; const submittedDraft = cloneContent(draft); saveController.current = controller; setSaving(true);
    try {
      const response = await saveRevision(current.id, parsed.data, controller.signal);
      if (controller.signal.aborted || saveGeneration.current !== generation) return;
      const postSubmitPatch = buildPatch(submittedDraft, draftRef.current);
      setCurrent(response.report as typeof current);
      setDraft(applyPatch(response.report.content!, postSubmitPatch));
      setNotice(postSubmitPatch ? `Revision ${response.report.revision} saved. Newer edits remain unsaved.` : `Revision ${response.report.revision} saved.`);
      onSaved?.(response.report);
    } catch (cause) {
      if (controller.signal.aborted || saveGeneration.current !== generation) return;
      const code = typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
      setError(code === "REPORT_REVISION_CONFLICT" ? "A newer revision exists. Reload the latest revision; your unsaved prose will be kept for review." : code === "RATE_LIMITED" ? "Too many revision requests. Wait before trying again; your changes remain here." : code === "CSRF_INVALID" ? "Your security session expired. Refresh the page before saving; your changes remain here." : code === "UNAUTHENTICATED" ? "Your session expired. Sign in again before saving." : code === "INVALID_RESPONSE" ? "Trace received an invalid revision response. Your changes remain here so you can retry." : code === "REPORT_NOT_EDITABLE" ? "This report is no longer editable. Reload the latest report state." : code === "REPORT_NOT_FOUND" ? "This report is no longer available. Your changes remain here." : code === "NOT_FOUND" ? "Revision saving is not available in the current backend. Your changes remain here until the backend is updated." : "Trace could not save this revision. Your changes remain here so you can retry.");
    } finally { if (!controller.signal.aborted) setSaving(false); }
  }

  return <Card className="report-editor" aria-label="Structured report editor">
    <header className="report-editor-heading"><div><span>Editable narrative</span><h3>Structured report editor</h3><p>Edit approved prose fields only. Deterministic facts stay locked.</p></div><strong>{revisionLabel(current)}</strong></header>
    <label>Executive summary<textarea aria-label="Executive summary" disabled={!editable} maxLength={20000} value={draft.executiveSummary} onChange={(event) => setDraft({ ...draft, executiveSummary: event.target.value })} /></label>
    {draft.repositories.map((repository, repositoryIndex) => <fieldset key={repository.repositoryId}><legend>Repository {repository.repositoryId}</legend><label>Repository summary<textarea aria-label={`Repository ${repository.repositoryId} summary`} disabled={!editable} maxLength={10000} value={repository.summary} onChange={(event) => updateRepository(repositoryIndex, event.target.value)} /></label>{repository.contributors.map((contributor, contributorIndex) => { const contributorLabel = contributorLabels[contributor.contributorId] ?? "Contributor name unavailable"; return <div className="report-contributor-editor" key={contributor.contributorId}><h4>{contributorLabel}</h4><label>Contributor summary<textarea aria-label={`${contributorLabel} summary`} disabled={!editable} maxLength={10000} value={contributor.summary} onChange={(event) => updateContributor(repositoryIndex, contributorIndex, "summary", event.target.value)} /></label><label>Accomplishments, one per line<textarea aria-label={`${contributorLabel} accomplishments`} disabled={!editable} maxLength={100049} value={contributor.accomplishments.join("\n")} onChange={(event) => updateContributor(repositoryIndex, contributorIndex, "accomplishments", event.target.value)} /></label></div>; })}</fieldset>)}
    <div className="report-editor-actions"><span>{dirty ? "Unsaved changes" : "All changes saved"}</span><Button className="trace-button-secondary" disabled={!editable || !dirty || saving} onClick={() => { setDraft(cloneContent(current.content)); setError(undefined); setNotice(undefined); }}>Cancel changes</Button><Button disabled={!editable || !dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save revision"}</Button></div>
    {notice && <p className="report-notice-success" role="status">{notice}</p>}{error && <div className="report-notice-error" role="alert"><span>{error}</span>{error.startsWith("A newer revision") && <Button className="trace-button-secondary" onClick={onReloadLatest}>Reload latest revision</Button>}</div>}
  </Card>;
}
