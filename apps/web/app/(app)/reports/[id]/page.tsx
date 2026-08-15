"use client";

import { use } from "react";
import { PageShell } from "@/components/page-shell";
import { ReportDetailView } from "@/features/reports/report-detail";
import { downloadReportArtifact, getReport, regenerateReport, updateReportRevision } from "@/api/reports";
import { resolveReportContributorLabels } from "@/api/report-contributors";
import { useAuthSession } from "@/auth/session-provider";

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { csrfToken } = useAuthSession();
  const saveRevision = (reportId: string, request: Parameters<typeof updateReportRevision>[1], signal?: AbortSignal) => {
    if (!csrfToken) throw new Error("Authenticated session is missing CSRF protection.");
    return updateReportRevision(reportId, request, csrfToken, signal);
  };
  const regenerate = (reportId: string, request: Parameters<typeof regenerateReport>[1], signal?: AbortSignal) => {
    if (!csrfToken) throw new Error("Authenticated session is missing CSRF protection.");
    return regenerateReport(reportId, request, csrfToken, signal);
  };
  return <PageShell eyebrow="Report details" title="Development activity report" description="Review deterministic facts separately from editable structured narrative."><ReportDetailView reportId={id} loadReport={getReport} saveRevision={saveRevision} regenerateReport={regenerate} downloadArtifact={downloadReportArtifact} resolveContributorLabels={resolveReportContributorLabels} /></PageShell>;
}
