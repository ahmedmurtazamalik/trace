"use client";

import { use } from "react";
import { PageShell } from "@/components/page-shell";
import { ReportDetailView } from "@/features/reports/report-detail";
import { getFixtureReport } from "@/mocks/fixtures/reports";

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PageShell eyebrow="Report details" title="Development activity report" description="Review lifecycle status and deterministic facts while generation progresses."><ReportDetailView reportId={id} loadReport={getFixtureReport} /></PageShell>;
}
