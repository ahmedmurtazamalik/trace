import { http, HttpResponse } from "msw";
import {
  reportCreateRequestSchema,
  reportDetailResponseSchema,
  reportRegenerationRequestSchema,
  reportRevisionUpdateRequestSchema,
  type ReportContent,
  type ReportDetailResponse,
  type ReportStatus,
  type ReportSummary,
} from "@trace/shared";
import { dashboardFixtures } from "../fixtures/dashboard";
import { activityFixturePages } from "../fixtures/activity";
import { createFixtureReport, getFixtureReport, listFixtureReports } from "../fixtures/reports";
import { workspaceFixture } from "../fixtures/workspace";

export const mockSession = {
  user: {
    id: "user-demo",
    username: "trace.demo",
    displayName: "Trace Demo User",
    email: "demo@trace.local",
    createdAt: "2026-08-17T00:00:00.000Z",
  },
  csrfToken: "csrf-demo-only",
} as const;

let githubConnected = true;
const githubStatus = {
  accountConnection: {
    status: "CONNECTED",
    account: { id: "github-demo", username: "trace-demo", displayName: "Trace Demo", avatarUrl: null },
  },
  installationAuthorization: {
    status: "ACTIVE",
    installation: { id: "installation-demo", accountType: "ORGANIZATION", accountLogin: "trace-demo-org" },
  },
  accessibleRepositoryCount: 2,
  trackedRepositoryCount: 1,
  historyRetained: true,
} as const;

const repositories = [
  {
    id: "repo_01", owner: "trace-demo-org", name: "trace", fullName: "trace-demo-org/trace", private: true,
    defaultBranch: "main", url: "https://github.com/trace-demo-org/trace", accessible: true, trackingEnabled: true,
    removed: false, lastActivityAt: "2026-08-17T09:30:00.000Z", contributorCount: 3,
  },
  {
    id: "repo_02", owner: "trace-demo-org", name: "docs", fullName: "trace-demo-org/docs", private: false,
    defaultBranch: "main", url: "https://github.com/trace-demo-org/docs", accessible: true, trackingEnabled: false,
    removed: false, lastActivityAt: "2026-08-16T15:00:00.000Z", contributorCount: 2,
  },
];

const demoPdfBytes = new TextEncoder().encode("%PDF-1.4\n% Trace demo report\n%%EOF\n");
const demoPdfChecksum = "a8fd5105097d76a336713c5c61ad1890cad5c56d8c00b963c52bb61dc88de840";
const reportStore = new Map<string, ReportDetailResponse>();
const zeroFacts = { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 };

function demoPdf(revision: number) {
  return {
    id: `artifact-pdf-${revision}`,
    revision,
    kind: "pdf" as const,
    fileName: "trace-demo-report.pdf",
    contentType: "application/pdf" as const,
    sizeBytes: demoPdfBytes.byteLength,
    checksum: demoPdfChecksum,
  };
}

function reportSummary(detail: ReportDetailResponse): ReportSummary {
  const report = detail.report;
  return {
    id: report.id,
    reportDate: report.reportDate,
    timezone: report.timezone,
    status: report.status,
    createdAt: report.createdAt,
    completedAt: report.completedAt,
    errorMessage: report.errorMessage,
    revision: report.revision,
    downloadAvailable: report.downloadAvailable,
  };
}

async function readReport(id: string): Promise<ReportDetailResponse | undefined> {
  const stored = reportStore.get(id);
  if (stored) return stored;
  try {
    const fixture = await getFixtureReport(id);
    const normalized = reportDetailResponseSchema.parse({
      report: {
        ...fixture.report,
        artifacts: fixture.report.status === "completed" && fixture.report.revision !== null
          ? [demoPdf(fixture.report.revision)]
          : [],
      },
    });
    reportStore.set(id, normalized);
    return normalized;
  } catch {
    return undefined;
  }
}

function applyContentPatch(content: ReportContent, patch: ReturnType<typeof reportRevisionUpdateRequestSchema.parse>["prosePatch"]): ReportContent {
  const repositoriesContent = content.repositories.map((repository) => {
    const repositoryPatch = patch.repositories?.find((candidate) => candidate.repositoryId === repository.repositoryId);
    if (!repositoryPatch) return repository;
    return {
      ...repository,
      summary: repositoryPatch.summary ?? repository.summary,
      contributors: repository.contributors.map((contributor) => {
        const contributorPatch = repositoryPatch.contributors?.find((candidate) => candidate.contributorId === contributor.contributorId);
        return contributorPatch ? {
          ...contributor,
          summary: contributorPatch.summary ?? contributor.summary,
          accomplishments: contributorPatch.accomplishments ?? contributor.accomplishments,
        } : contributor;
      }),
    };
  });
  return {
    executiveSummary: patch.executiveSummary ?? content.executiveSummary,
    repositories: repositoriesContent,
  };
}

function apiError(code: string, message: string, status: number) {
  return HttpResponse.json({ code, message, requestId: "mock-request" }, { status });
}

function csrfError(request: Request) {
  return request.headers.get("x-csrf-token") === mockSession.csrfToken
    ? undefined
    : apiError("CSRF_INVALID", "The demo CSRF token is missing or invalid.", 403);
}

function setTracking(repositoryId: string, request: Request, trackingEnabled: boolean) {
  const invalid = csrfError(request);
  if (invalid) return invalid;
  const repository = repositories.find((item) => item.id === repositoryId);
  if (!repository) return apiError("REPOSITORY_NOT_FOUND", "Repository not found.", 404);
  repository.trackingEnabled = trackingEnabled;
  return HttpResponse.json({ repositoryId: repository.id, trackingEnabled });
}

export const handlers = [
  http.get("*/api/v1/auth/me", () => HttpResponse.json(mockSession)),
  http.post("*/api/v1/auth/login", () => HttpResponse.json(mockSession)),
  http.post("*/api/v1/auth/register", () => HttpResponse.json(mockSession, { status: 201 })),
  http.post("*/api/v1/auth/logout", ({ request }) => csrfError(request) ?? HttpResponse.json({ success: true })),
  http.post("*/api/v1/auth/password/forgot", () => HttpResponse.json({ message: "If the account exists, password reset instructions have been sent." }, { status: 202 })),
  http.post("*/api/v1/auth/password/reset", () => HttpResponse.json({ success: true })),

  http.get("*/api/v1/dashboard", () => HttpResponse.json(dashboardFixtures.ready)),

  http.get("*/api/v1/github/status", () => HttpResponse.json(githubConnected ? githubStatus : {
    accountConnection: { status: "DISCONNECTED", account: null },
    installationAuthorization: { status: "NOT_INSTALLED", installation: null },
    accessibleRepositoryCount: 0,
    trackedRepositoryCount: 0,
    historyRetained: true,
  })),
  http.delete("*/api/v1/github/connection", ({ request }) => {
    const invalid = csrfError(request);
    if (invalid) return invalid;
    githubConnected = false;
    return HttpResponse.json({ success: true, historyRetained: true });
  }),

  http.post("*/api/v1/repositories/sync", ({ request }) => csrfError(request) ?? HttpResponse.json({ accessibleRepositoryCount: repositories.filter((item) => item.accessible).length })),
  http.post("*/api/v1/repositories/:repositoryId/tracking", ({ params, request }) => setTracking(String(params.repositoryId), request, true)),
  http.delete("*/api/v1/repositories/:repositoryId/tracking", ({ params, request }) => setTracking(String(params.repositoryId), request, false)),
  http.post("*/api/v1/repositories/:repositoryId/restore", ({ params, request }) => {
    const invalid = csrfError(request);
    if (invalid) return invalid;
    const repository = repositories.find((item) => item.id === params.repositoryId);
    if (!repository) return apiError("REPOSITORY_NOT_FOUND", "Repository not found.", 404);
    repository.removed = false;
    repository.trackingEnabled = false;
    return HttpResponse.json({ repositoryId: repository.id, trackingEnabled: false, removed: false });
  }),
  http.delete("*/api/v1/repositories/:repositoryId", ({ params, request }) => {
    const invalid = csrfError(request);
    if (invalid) return invalid;
    const repository = repositories.find((item) => item.id === params.repositoryId);
    if (!repository) return apiError("REPOSITORY_NOT_FOUND", "Repository not found.", 404);
    repository.removed = true;
    repository.trackingEnabled = false;
    return HttpResponse.json({ repositoryId: repository.id, trackingEnabled: false, removed: true });
  }),
  http.get("*/api/v1/repositories/:repositoryId/activity", () => HttpResponse.json(activityFixturePages.first)),
  http.get("*/api/v1/repositories/:repositoryId", ({ params }) => {
    const repository = repositories.find((item) => item.id === params.repositoryId);
    return repository ? HttpResponse.json({ repository }) : apiError("REPOSITORY_NOT_FOUND", "Repository not found.", 404);
  }),
  http.get("*/api/v1/repositories", ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.toLowerCase();
    const showRemoved = url.searchParams.get("visibility") === "removed";
    const items = repositories.filter((item) => item.removed === showRemoved && (!search || item.fullName.toLowerCase().includes(search)));
    return HttpResponse.json({ items, pageInfo: { nextCursor: null, hasNextPage: false } });
  }),

  http.get("*/api/v1/activity", ({ request }) => {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return HttpResponse.json(cursor ? activityFixturePages.second : activityFixturePages.first);
  }),

  http.post("*/api/v1/reports", async ({ request }) => {
    const invalid = csrfError(request);
    if (invalid) return invalid;
    const input = reportCreateRequestSchema.parse(await request.json());
    const created = await createFixtureReport(input);
    const detail = reportDetailResponseSchema.parse({
      report: {
        ...created.report,
        createdAt: "2026-08-17T12:00:00.000Z",
        revisionSource: null,
        content: null,
        facts: zeroFacts,
        artifacts: [],
      },
    });
    reportStore.set(detail.report.id, detail);
    return HttpResponse.json({ report: reportSummary(detail) });
  }),
  http.put("*/api/v1/reports/:reportId/revision", async ({ params, request }) => {
    const invalid = csrfError(request);
    if (invalid) return invalid;
    const input = reportRevisionUpdateRequestSchema.parse(await request.json());
    const current = await readReport(String(params.reportId));
    if (!current) return apiError("REPORT_NOT_FOUND", "Report not found.", 404);
    if (current.report.status !== "completed" || current.report.revision !== input.expectedRevision || current.report.content === null) {
      return apiError("REPORT_REVISION_CONFLICT", "The report revision changed.", 409);
    }
    const revision = current.report.revision + 1;
    const updated = reportDetailResponseSchema.parse({
      report: {
        ...current.report,
        revision,
        revisionSource: "manual",
        content: applyContentPatch(current.report.content, input.prosePatch),
        artifacts: [demoPdf(revision)],
      },
    });
    reportStore.set(updated.report.id, updated);
    return HttpResponse.json(updated);
  }),
  http.post("*/api/v1/reports/:reportId/regenerate", async ({ params, request }) => {
    const invalid = csrfError(request);
    if (invalid) return invalid;
    const input = reportRegenerationRequestSchema.parse(await request.json());
    const current = await readReport(String(params.reportId));
    if (!current) return apiError("REPORT_NOT_FOUND", "Report not found.", 404);
    if (current.report.revision !== input.expectedRevision) return apiError("REPORT_REVISION_CONFLICT", "The report revision changed.", 409);
    const processing = reportDetailResponseSchema.parse({
      report: {
        ...current.report,
        status: "processing",
        completedAt: null,
        errorMessage: null,
        downloadAvailable: false,
        artifacts: [],
      },
    });
    reportStore.set(processing.report.id, processing);
    return HttpResponse.json(processing);
  }),
  http.get("*/api/v1/reports/:reportId/download", async ({ params, request }) => {
    const detail = await readReport(String(params.reportId));
    const artifactId = new URL(request.url).searchParams.get("artifactId");
    const artifact = detail?.report.artifacts.find((candidate) => candidate.id === artifactId && candidate.kind === "pdf");
    if (!artifact) return apiError("REPORT_ARTIFACT_NOT_FOUND", "Report artifact not found.", 404);
    return HttpResponse.arrayBuffer(demoPdfBytes.buffer as ArrayBuffer, {
      headers: {
        "content-type": artifact.contentType,
        "content-length": String(artifact.sizeBytes),
      },
    });
  }),
  http.get("*/api/v1/reports/:reportId", async ({ params }) => {
    const detail = await readReport(String(params.reportId));
    return detail ? HttpResponse.json(detail) : apiError("REPORT_NOT_FOUND", "Report not found.", 404);
  }),
  http.get("*/api/v1/reports", async ({ request }) => {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const statuses: ReportStatus[] = ["pending", "processing", "completed", "failed"];
    const status = statuses.find((candidate) => candidate === statusParam);
    const fixtures = await listFixtureReports({ limit: Number(url.searchParams.get("limit") ?? 20) });
    const byId = new Map(fixtures.items.map((summary) => [summary.id, summary]));
    for (const detail of reportStore.values()) byId.set(detail.report.id, reportSummary(detail));
    const items = [...byId.values()].filter((summary) => status === undefined || summary.status === status);
    return HttpResponse.json({ items, pageInfo: { nextCursor: null, hasNextPage: false } });
  }),

  http.get("*/api/v1/frontend-preview", () => HttpResponse.json(workspaceFixture)),
  http.all(/\/api\/v1(?:\/|$)/, () => apiError("MOCK_API_UNHANDLED", "This API operation is not available in demo mode.", 501)),
];
