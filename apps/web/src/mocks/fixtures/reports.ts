import {
  reportCreateRequestSchema, reportCreateResponseSchema, reportDetailResponseSchema, reportListQuerySchema, reportListResponseSchema,
  type ReportCreateRequest, type ReportCreateResponse, type ReportDetailResponse, type ReportListQuery, type ReportListResponse, type ReportStatus,
} from "@trace/shared";

const summaries = reportListResponseSchema.parse({
  items: [
    { id: "report-completed", reportDate: "2026-08-12", timezone: "UTC", status: "completed", createdAt: "2026-08-13T00:00:00.000Z", completedAt: "2026-08-13T00:02:00.000Z", errorMessage: null, revision: 1, downloadAvailable: true },
    { id: "report-processing", reportDate: "2026-08-11", timezone: "UTC", status: "processing", createdAt: "2026-08-12T00:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false },
    { id: "report-pending", reportDate: "2026-08-10", timezone: "UTC", status: "pending", createdAt: "2026-08-11T00:00:00.000Z", completedAt: null, errorMessage: null, revision: null, downloadAvailable: false },
    { id: "report-failed", reportDate: "2026-08-09", timezone: "UTC", status: "failed", createdAt: "2026-08-10T00:00:00.000Z", completedAt: null, errorMessage: "No development activity was found for this date.", revision: null, downloadAvailable: false },
  ],
  pageInfo: { nextCursor: null, hasNextPage: false },
});
const facts = { repositoryCount: 2, contributorCount: 3, commitCount: 8, filesChanged: 21, additions: 342, deletions: 71 };

export async function listFixtureReports(input: ReportListQuery): Promise<ReportListResponse> {
  const query = reportListQuerySchema.parse(input);
  return reportListResponseSchema.parse({ ...summaries, items: query.status ? summaries.items.filter((item) => item.status === query.status) : summaries.items });
}
export async function createFixtureReport(input: ReportCreateRequest): Promise<ReportCreateResponse> {
  const request = reportCreateRequestSchema.parse(input);
  const report = { id: `report-${request.reportDate}`, reportDate: request.reportDate, timezone: request.timezone, status: "pending" as const, createdAt: new Date().toISOString(), completedAt: null, errorMessage: null, revision: null, downloadAvailable: false };
  return reportCreateResponseSchema.parse({ report });
}
export async function getFixtureReport(id: string): Promise<ReportDetailResponse> {
  const summary = summaries.items.find((item) => item.id === id);
  if (!summary) throw new Error("Report not found");
  const completed = summary.status === "completed";
  return reportDetailResponseSchema.parse({ report: {
    ...summary, revisionSource: completed ? "ai" : null,
    content: completed ? { executiveSummary: "Development activity across tracked repositories was converted into a structured factual report.", repositories: [] } : null,
    facts,
    artifacts: completed ? [{ id: "artifact-pdf-1", revision: 1, kind: "pdf", fileName: "trace-report-2026-08-12.pdf", contentType: "application/pdf", sizeBytes: 42000, checksum: "a".repeat(64) }] : [],
  } });
}
export const fixtureReportStatuses: ReportStatus[] = ["pending", "processing", "completed", "failed"];
