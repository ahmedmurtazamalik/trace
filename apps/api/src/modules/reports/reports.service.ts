import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ArtifactStorage } from '@trace/report-storage';
import type { TraceConfig } from '@trace/config';
import { Prisma, PrismaService } from '@trace/database';
import {
  gitObjectIdSchema,
  reportContentSchema,
  reportCreateRequestSchema,
  reportDetailSchema,
  reportFactsSchema,
  reportListQuerySchema,
  reportRegenerationRequestSchema,
  reportRevisionUpdateRequestSchema,
  reportSummarySchema,
  reportDownloadQuerySchema,
  type ReportContent,
  type ReportCreateRequest,
  type ReportCreateResponse,
  type ReportDetailResponse,
  type ReportFacts,
  type ReportListQuery,
  type ReportListResponse,
  type ReportSummary,
} from '@trace/shared';
import { TRACE_CONFIG } from '../../common/config/config.token';
import { REPORT_ARTIFACT_STORAGE } from './report-storage.token';
import { ReportPublisher } from './report.publisher';

type ReportActivityRow = {
  activityId: string;
  occurredAt: Date;
  repositoryId: string;
  repositoryFullName: string;
  contributorId: string | null;
  contributorUsername: string | null;
  contributorDisplayName: string | null;
  metadata: unknown;
};

type MutableFacts = ReportFacts;
type ReportProsePatch = ReturnType<typeof reportRevisionUpdateRequestSchema.parse>['prosePatch'];
export interface ReportArtifactDownload {
  bytes: Buffer;
  fileName: string;
  contentType: 'application/pdf' | 'application/x-tex';
  checksum: string;
}
const MAX_REPORT_ACTIVITY_ROWS = 10_000;
const MAX_REPORT_EVIDENCE_TEXT_BYTES = 500_000;

type ContributorSnapshot = {
  id: string;
  username: string | null;
  displayName: string | null;
  facts: MutableFacts;
};

type RepositorySnapshot = {
  id: string;
  fullName: string;
  facts: MutableFacts;
  contributors: ContributorSnapshot[];
  evidence: Array<{
    activityId: string;
    occurredAt: string;
    type: 'commit';
    sha: string;
    message: string;
  }>;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: ReportPublisher,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
    @Inject(REPORT_ARTIFACT_STORAGE) private readonly storage: ArtifactStorage,
  ) {}

  async create(userId: string, input: unknown): Promise<ReportCreateResponse> {
    const parsed = reportCreateRequestSchema.safeParse(input);
    if (!parsed.success) throw this.validationError();
    const request: ReportCreateRequest = parsed.data;
    const day = this.dayBounds(request.reportDate, request.timezone);
    const rows = await this.authorizedCommitRows(userId, day);
    if (rows.length > MAX_REPORT_ACTIVITY_ROWS) {
      throw new HttpException(
        { code: 'REPORT_GENERATION_UNAVAILABLE', message: 'The selected day contains too much activity for one report.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const snapshot = this.snapshot(request, rows);
    const reportDate = new Date(`${request.reportDate}T00:00:00.000Z`);

    let report;
    try {
      report = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.report.create({
          data: {
            userId,
            reportDate,
            timezone: request.timezone,
            status: 'pending',
            inputSnapshot: snapshot as Prisma.InputJsonValue,
          },
        });
        await transaction.auditLog.create({
          data: { actorUserId: userId, action: 'report.created', targetType: 'report', targetId: created.id },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpException(
          { code: 'REPORT_ALREADY_EXISTS', message: 'A report already exists for this date.' },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
    await this.publisher.publishOneBounded(report.id);

    return {
      report: {
        id: report.id,
        reportDate: request.reportDate,
        timezone: report.timezone,
        status: 'pending',
        createdAt: report.createdAt.toISOString(),
        completedAt: null,
        errorMessage: null,
        revision: null,
        downloadAvailable: false,
      },
    };
  }

  async list(userId: string, input: unknown): Promise<ReportListResponse> {
    const parsed = reportListQuerySchema.safeParse(input);
    if (!parsed.success) throw this.validationError();
    const query: ReportListQuery = parsed.data;
    const fingerprint = JSON.stringify({ version: 1, userId, status: query.status ?? null, limit: query.limit });
    const cursor = this.decodeCursor(query.cursor, fingerprint);
    const reports = await this.prisma.report.findMany({
      where: {
        userId,
        workspaceId: null,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(cursor === null ? {} : {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        currentRevision: { select: { revision: true } },
        artifacts: { select: { kind: true, revision: { select: { revision: true } } } },
      },
    });
    const page = reports.slice(0, query.limit);
    const hasNextPage = reports.length > query.limit;
    const last = page.at(-1);
    return {
      items: page.map((report) => this.summary(report)),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && last !== undefined
          ? this.encodeCursor(last.createdAt, last.id, fingerprint)
          : null,
      },
    };
  }

  async listWorkspace(userId: string, workspaceId: string, input: unknown): Promise<ReportListResponse> {
    const parsed = reportListQuerySchema.safeParse(input);
    if (!parsed.success) throw this.validationError();
    const query: ReportListQuery = parsed.data;
    const status = query.status;
    const fingerprint = JSON.stringify({ version: 1, userId, workspaceId, status: status ?? null, limit: query.limit });
    const cursor = this.decodeCursor(query.cursor, fingerprint);
    const reports = await this.prisma.report.findMany({
      where: {
        workspaceId,
        workspace: { memberships: { some: { userId } } },
        AND: [{ OR: [
          { workspace: { memberships: { some: { userId, role: 'MANAGER' } } } },
          { status: 'completed' },
        ] }],
        ...(status === undefined ? {} : { status }),
        ...(cursor === null ? {} : {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        currentRevision: { select: { revision: true } },
        artifacts: { select: { kind: true, revision: { select: { revision: true } } } },
      },
    });
    const page = reports.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((report) => this.summary(report)),
      pageInfo: {
        hasNextPage: reports.length > query.limit,
        nextCursor: reports.length > query.limit && last !== undefined
          ? this.encodeCursor(last.createdAt, last.id, fingerprint)
          : null,
      },
    };
  }

  async detail(userId: string, reportId: string): Promise<ReportDetailResponse> {
    return this.detailScoped({ userId, workspaceId: null }, reportId);
  }

  async detailWorkspace(userId: string, workspaceId: string, reportId: string): Promise<ReportDetailResponse> {
    return this.detailScoped(this.workspaceReadScope(userId, workspaceId), reportId);
  }

  private async detailScoped(scope: Prisma.ReportWhereInput, reportId: string): Promise<ReportDetailResponse> {
    if (reportId.length === 0 || reportId.length > 256) throw this.notFound();
    const report = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
      const current = await transaction.report.findFirst({
        where: { id: reportId, ...scope },
        include: { currentRevision: true },
      });
      if (current === null) return null;
      const artifacts = current.currentRevisionId === null
        ? []
        : await transaction.reportArtifact.findMany({
          where: { reportId, revisionId: current.currentRevisionId },
          include: { revision: { select: { revision: true } } },
          orderBy: { createdAt: 'asc' },
          take: 2,
        });
      return { ...current, artifacts };
    });
    if (report === null) throw this.notFound();
    const revision = report.currentRevision;
    const detail = {
      ...this.summary(report),
      revisionSource: revision?.source ?? null,
      content: revision === null ? null : reportContentSchema.parse(revision.content),
      facts: this.snapshotFacts(report.inputSnapshot),
      artifacts: report.status !== 'completed' || revision === null
        ? []
        : report.artifacts
          .filter((artifact) => artifact.revision.revision === revision.revision)
          .map((artifact) => ({
            id: artifact.id,
            revision: artifact.revision.revision,
            kind: artifact.kind,
            fileName: this.artifactFileName(artifact.storageKey, artifact.kind),
            contentType: artifact.kind === 'pdf' ? 'application/pdf' as const : 'application/x-tex' as const,
            sizeBytes: artifact.sizeBytes,
            checksum: artifact.checksum,
          })),
    };
    return { report: reportDetailSchema.parse(detail) };
  }

  async updateRevision(userId: string, reportId: string, input: unknown): Promise<ReportDetailResponse> {
    return this.updateRevisionScoped({ userId, workspaceId: null }, userId, reportId, input);
  }

  async updateWorkspaceRevision(actorUserId: string, workspaceId: string, reportId: string, input: unknown): Promise<ReportDetailResponse> {
    return this.updateRevisionScoped(this.workspaceManagerScope(actorUserId, workspaceId), actorUserId, reportId, input);
  }

  private async updateRevisionScoped(scope: Prisma.ReportWhereInput, actorUserId: string, reportId: string, input: unknown): Promise<ReportDetailResponse> {
    const request = this.parseRevisionUpdate(input);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
      const report = await transaction.report.findFirst({
        where: { id: reportId, ...scope },
        include: { currentRevision: true },
      });
      if (report === null) throw this.notFound();
      const current = report.currentRevision;
      if (current !== null && current.revision !== request.expectedRevision) throw this.revisionConflict();
      if (current === null || !['completed', 'failed'].includes(report.status)) throw this.notEditable();
      const currentContent = reportContentSchema.parse(current.content);
      const nextContent = this.applyProsePatch(currentContent, request.prosePatch);
      const nextRevision = current.revision + 1;
      const revision = await transaction.reportRevision.create({
        data: {
          reportId,
          revision: nextRevision,
          source: 'manual',
          content: nextContent,
        },
      });
      const updated = await transaction.report.updateMany({
        where: {
          id: reportId,
          ...scope,
          currentRevisionId: current.id,
          renderGeneration: report.renderGeneration,
        },
        data: {
          currentRevisionId: revision.id,
          status: 'processing',
          completedAt: null,
          error: null,
          processingToken: null,
          processingExpiresAt: null,
          renderRevision: nextRevision,
          renderGeneration: { increment: 1 },
          renderPublishedAt: null,
          latexPath: null,
          pdfPath: null,
        },
      });
      if (updated.count !== 1) throw this.revisionConflict();
      await transaction.auditLog.create({
        data: {
          actorUserId,
          action: 'report.revision_updated',
          targetType: 'report',
          targetId: reportId,
          metadata: { revision: nextRevision },
        },
      });
    });
    await this.publisher.publishOneBounded(reportId);
    return this.detailScoped(scope, reportId);
  }

  async regenerate(userId: string, reportId: string, input: unknown): Promise<ReportDetailResponse> {
    return this.regenerateScoped({ userId, workspaceId: null }, userId, reportId, input);
  }

  async regenerateWorkspace(actorUserId: string, workspaceId: string, reportId: string, input: unknown): Promise<ReportDetailResponse> {
    return this.regenerateScoped(this.workspaceManagerScope(actorUserId, workspaceId), actorUserId, reportId, input);
  }

  private async regenerateScoped(scope: Prisma.ReportWhereInput, actorUserId: string, reportId: string, input: unknown): Promise<ReportDetailResponse> {
    const request = this.parseRegeneration(input);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`;
      const report = await transaction.report.findFirst({
        where: { id: reportId, ...scope },
        include: { currentRevision: true },
      });
      if (report === null) throw this.notFound();
      const current = report.currentRevision;
      if (current !== null && current.revision !== request.expectedRevision) throw this.revisionConflict();
      if (current === null || !['completed', 'failed'].includes(report.status)) throw this.notEditable();
      const updated = await transaction.report.updateMany({
        where: {
          id: reportId,
          ...scope,
          currentRevisionId: current.id,
          renderGeneration: report.renderGeneration,
        },
        data: {
          status: 'processing',
          completedAt: null,
          error: null,
          processingToken: null,
          processingExpiresAt: null,
          renderRevision: current.revision,
          renderGeneration: { increment: 1 },
          renderPublishedAt: null,
          latexPath: null,
          pdfPath: null,
        },
      });
      if (updated.count !== 1) throw this.revisionConflict();
      await transaction.auditLog.create({
        data: {
          actorUserId,
          action: 'report.regenerated',
          targetType: 'report',
          targetId: reportId,
          metadata: { revision: current.revision, generation: report.renderGeneration + 1 },
        },
      });
    });
    await this.publisher.publishOneBounded(reportId);
    return this.detailScoped(scope, reportId);
  }

  async download(userId: string, reportId: string, input: unknown): Promise<ReportArtifactDownload> {
    return this.downloadScoped({ userId, workspaceId: null }, reportId, input);
  }

  async downloadWorkspace(userId: string, workspaceId: string, reportId: string, input: unknown): Promise<ReportArtifactDownload> {
    return this.downloadScoped(this.workspaceReadScope(userId, workspaceId), reportId, input);
  }

  private async downloadScoped(scope: Prisma.ReportWhereInput, reportId: string, input: unknown): Promise<ReportArtifactDownload> {
    const query = this.parseDownloadQuery(input);
    const artifact = await this.prisma.reportArtifact.findFirst({
      where: {
        id: query.artifactId,
        reportId,
        report: { ...scope, status: 'completed', currentRevisionId: { not: null } },
      },
      include: {
        report: { select: { currentRevisionId: true } },
      },
    });
    if (artifact === null || artifact.revisionId !== artifact.report.currentRevisionId) throw this.artifactNotFound();
    let bytes: Buffer;
    try {
      bytes = await this.storage.get(artifact.storageKey, Math.min(artifact.sizeBytes, 100_000_000));
    } catch {
      throw this.artifactUnavailable();
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== artifact.sizeBytes || checksum !== artifact.checksum) throw this.artifactUnavailable();
    const stillAuthorized = await this.prisma.reportArtifact.findFirst({
      where: {
        id: artifact.id,
        reportId,
        revisionId: artifact.revisionId,
        report: { ...scope, status: 'completed', currentRevisionId: artifact.revisionId },
      },
      select: { id: true },
    });
    if (stillAuthorized === null) throw this.artifactNotFound();
    return {
      bytes,
      fileName: this.artifactFileName(artifact.storageKey, artifact.kind),
      contentType: artifact.kind === 'pdf' ? 'application/pdf' : 'application/x-tex',
      checksum,
    };
  }

  private workspaceReadScope(userId: string, workspaceId: string): Prisma.ReportWhereInput {
    return {
      workspaceId,
      workspace: { memberships: { some: { userId } } },
      AND: [{ OR: [
        { workspace: { memberships: { some: { userId, role: 'MANAGER' } } } },
        { status: 'completed' },
      ] }],
    };
  }

  private workspaceManagerScope(userId: string, workspaceId: string): Prisma.ReportWhereInput {
    return {
      workspaceId,
      workspace: { archivedAt: null, memberships: { some: { userId, role: 'MANAGER' } } },
    };
  }

  private applyProsePatch(content: ReportContent, patch: ReportProsePatch): ReportContent {
    const repositories = content.repositories.map((repository) => ({
      ...repository,
      summary: patch.repositories?.find((candidate) => candidate.repositoryId === repository.repositoryId)?.summary
        ?? repository.summary,
      contributors: repository.contributors.map((contributor) => {
        const repositoryPatch = patch.repositories?.find((candidate) => candidate.repositoryId === repository.repositoryId);
        const contributorPatch = repositoryPatch?.contributors?.find(
          (candidate) => candidate.contributorId === contributor.contributorId,
        );
        return {
          ...contributor,
          summary: contributorPatch?.summary ?? contributor.summary,
          accomplishments: contributorPatch?.accomplishments ?? contributor.accomplishments,
        };
      }),
    }));
    for (const repositoryPatch of patch.repositories ?? []) {
      const repository = content.repositories.find((candidate) => candidate.repositoryId === repositoryPatch.repositoryId);
      if (repository === undefined) throw this.validationError();
      for (const contributorPatch of repositoryPatch.contributors ?? []) {
        if (!repository.contributors.some((candidate) => candidate.contributorId === contributorPatch.contributorId)) {
          throw this.validationError();
        }
      }
    }
    return reportContentSchema.parse({
      executiveSummary: patch.executiveSummary ?? content.executiveSummary,
      repositories,
    });
  }

  private parseRevisionUpdate(input: unknown): ReturnType<typeof reportRevisionUpdateRequestSchema.parse> {
    const parsed = reportRevisionUpdateRequestSchema.safeParse(input);
    if (!parsed.success) throw this.validationError();
    return parsed.data;
  }

  private parseRegeneration(input: unknown): ReturnType<typeof reportRegenerationRequestSchema.parse> {
    const parsed = reportRegenerationRequestSchema.safeParse(input);
    if (!parsed.success) throw this.validationError();
    return parsed.data;
  }

  private parseDownloadQuery(input: unknown): ReturnType<typeof reportDownloadQuerySchema.parse> {
    const parsed = reportDownloadQuerySchema.safeParse(input);
    if (!parsed.success) throw this.validationError();
    return parsed.data;
  }

  private async authorizedCommitRows(
    userId: string,
    day: { start: Date; end: Date },
  ): Promise<ReportActivityRow[]> {
    return this.prisma.$queryRaw<ReportActivityRow[]>(Prisma.sql`
      SELECT
        ae.id AS "activityId",
        ae.occurred_at AS "occurredAt",
        ae.metadata,
        r.id AS "repositoryId",
        r.full_name AS "repositoryFullName",
        c.id AS "contributorId",
        c.username AS "contributorUsername",
        c.display_name AS "contributorDisplayName"
      FROM activity_events ae
      INNER JOIN repositories r
        ON r.id = ae.repository_id
       AND r.access_removed_at IS NULL
       AND char_length(r.full_name) BETWEEN 1 AND 512
      INNER JOIN github_installations gi
        ON gi.id = r.github_installation_id
       AND gi.suspended_at IS NULL
      INNER JOIN github_accounts ga
        ON ga.id = gi.github_account_id
       AND ga.user_id = ${userId}
       AND ga.unlinked_at IS NULL
      INNER JOIN user_repositories ur
        ON ur.repository_id = ae.repository_id
       AND ur.user_id = ${userId}
       AND ur.tracking_enabled = true
       AND ur.access_removed_at IS NULL
       AND ae.occurred_at >= ur.created_at
      LEFT JOIN contributors c ON c.id = ae.contributor_id
      WHERE ae.source::text = 'github'
        AND ae.type::text = 'commit'
        AND ae.occurred_at >= ${day.start}
        AND ae.occurred_at < ${day.end}
      ORDER BY r.id ASC, c.id ASC NULLS LAST, ae.occurred_at ASC, ae.id ASC
      LIMIT ${MAX_REPORT_ACTIVITY_ROWS + 1}
    `);
  }

  private snapshot(request: ReportCreateRequest, rows: ReportActivityRow[]) {
    const repositories = new Map<string, RepositorySnapshot>();
    const contributorIds = new Set<string>();
    const facts = this.emptyFacts();
    let evidenceTextBytes = 0;

    for (const row of rows) {
      const metadata = this.metadata(row.metadata);
      const changedFiles = this.nonnegativeInteger(metadata.changedFiles);
      const additions = this.nonnegativeInteger(metadata.additions);
      const deletions = this.nonnegativeInteger(metadata.deletions);
      const sha = this.sha(metadata.sha);
      const message = this.string(metadata.message, 10_000);
      if (changedFiles === null || additions === null || deletions === null || sha === null || message === null) continue;
      evidenceTextBytes += Buffer.byteLength(message, 'utf8');
      if (evidenceTextBytes > MAX_REPORT_EVIDENCE_TEXT_BYTES) {
        throw new HttpException(
          { code: 'REPORT_GENERATION_UNAVAILABLE', message: 'The selected day contains too much report evidence.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      let repository = repositories.get(row.repositoryId);
      if (repository === undefined) {
        repository = {
          id: row.repositoryId,
          fullName: row.repositoryFullName,
          facts: this.emptyFacts(),
          contributors: [],
          evidence: [],
        };
        repositories.set(row.repositoryId, repository);
      }
      this.addCommit(repository.facts, changedFiles, additions, deletions);
      this.addCommit(facts, changedFiles, additions, deletions);
      repository.evidence.push({
        activityId: row.activityId,
        occurredAt: row.occurredAt.toISOString(),
        type: 'commit',
        sha,
        message,
      });

      if (row.contributorId !== null) {
        contributorIds.add(row.contributorId);
        let contributor = repository.contributors.find((item) => item.id === row.contributorId);
        if (contributor === undefined) {
          contributor = {
            id: row.contributorId,
            username: this.string(row.contributorUsername, 100),
            displayName: this.string(row.contributorDisplayName, 256),
            facts: this.emptyFacts(),
          };
          repository.contributors.push(contributor);
        }
        this.addCommit(contributor.facts, changedFiles, additions, deletions);
      }
    }

    facts.repositoryCount = repositories.size;
    facts.contributorCount = contributorIds.size;
    for (const repository of repositories.values()) {
      repository.facts.repositoryCount = 1;
      repository.facts.contributorCount = repository.contributors.length;
      for (const contributor of repository.contributors) {
        contributor.facts.repositoryCount = 1;
        contributor.facts.contributorCount = 1;
      }
    }

    return {
      version: 1,
      reportDate: request.reportDate,
      timezone: request.timezone,
      facts,
      repositories: [...repositories.values()],
    };
  }

  private emptyFacts(): MutableFacts {
    return { repositoryCount: 0, contributorCount: 0, commitCount: 0, filesChanged: 0, additions: 0, deletions: 0 };
  }

  private addCommit(facts: MutableFacts, filesChanged: number, additions: number, deletions: number): void {
    facts.commitCount += 1;
    facts.filesChanged += filesChanged;
    facts.additions += additions;
    facts.deletions += deletions;
    for (const value of [facts.commitCount, facts.filesChanged, facts.additions, facts.deletions]) {
      if (!Number.isSafeInteger(value)) throw new Error('Report aggregate exceeds the safe persistence range.');
    }
  }

  private metadata(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private nonnegativeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  private sha(value: unknown): string | null {
    const parsed = gitObjectIdSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private string(value: unknown, maximum: number): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
  }

  private dayBounds(date: string, timezone: string): { start: Date; end: Date } {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    const start = this.firstInstantOfLocalDate(year, month, day, timezone);
    const end = this.firstInstantOfLocalDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timezone);
    if (start >= end) throw this.validationError();
    return { start, end };
  }

  private firstInstantOfLocalDate(year: number, month: number, day: number, timezone: string): Date {
    const desired = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const center = Date.UTC(year, month - 1, day);
    let low = center - 36 * 60 * 60 * 1_000;
    let high = center + 36 * 60 * 60 * 1_000;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const localDate = (instant: number): string => {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    };
    while (low < high) {
      const midpoint = Math.floor((low + high) / 2);
      if (localDate(midpoint) < desired) low = midpoint + 1;
      else high = midpoint;
    }
    if (localDate(low) !== desired) throw this.validationError();
    return new Date(low);
  }

  private summary(report: {
    id: string;
    reportDate: Date;
    timezone: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdAt: Date;
    completedAt: Date | null;
    error: string | null;
    currentRevision: { revision: number } | null;
    artifacts: Array<{ kind: 'latex' | 'pdf'; revision: { revision: number } }>;
  }): ReportSummary {
    const revision = report.currentRevision?.revision ?? null;
    const downloadAvailable = report.status === 'completed'
      && revision !== null
      && report.artifacts.some((artifact) => artifact.kind === 'pdf' && artifact.revision.revision === revision);
    return reportSummarySchema.parse({
      id: report.id,
      reportDate: report.reportDate.toISOString().slice(0, 10),
      timezone: report.timezone,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      completedAt: report.completedAt?.toISOString() ?? null,
      errorMessage: report.status === 'failed' ? this.safeError(report.error) : null,
      revision,
      downloadAvailable,
    });
  }

  private snapshotFacts(inputSnapshot: unknown): ReportFacts {
    if (typeof inputSnapshot !== 'object' || inputSnapshot === null || Array.isArray(inputSnapshot)) {
      throw new Error('Stored report input snapshot is invalid.');
    }
    const parsed = reportFactsSchema.safeParse((inputSnapshot as Record<string, unknown>).facts);
    if (!parsed.success) throw new Error('Stored report facts are invalid.');
    return parsed.data;
  }

  private safeError(error: string | null): string {
    const value = error?.trim();
    return value === undefined || value.length === 0 ? 'Report generation failed.' : value.slice(0, 1_000);
  }

  private artifactFileName(storageKey: string, kind: 'latex' | 'pdf'): string {
    const candidate = storageKey.split('/').at(-1)?.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200) ?? '';
    if (/^[A-Za-z0-9](?:[A-Za-z0-9._ -]*[A-Za-z0-9])?$/.test(candidate)) return candidate;
    return `trace-report.${kind === 'pdf' ? 'pdf' : 'tex'}`;
  }

  private encodeCursor(createdAt: Date, id: string, fingerprint: string): string {
    const payload = Buffer.from(JSON.stringify({ version: 1, createdAt: createdAt.toISOString(), id, fingerprint })).toString('base64url');
    return `${payload}.${this.cursorSignature(payload)}`;
  }

  private decodeCursor(cursor: string | undefined, fingerprint: string): { createdAt: Date; id: string } | null {
    if (cursor === undefined) return null;
    try {
      const parts = cursor.split('.');
      if (parts.length !== 2) throw new Error('invalid cursor');
      const [payload, signature] = parts as [string, string];
      if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw new Error('invalid cursor');
      const decoded = Buffer.from(payload, 'base64url');
      if (decoded.toString('base64url') !== payload) throw new Error('non-canonical cursor');
      const expected = Buffer.from(this.cursorSignature(payload), 'base64url');
      const supplied = Buffer.from(signature, 'base64url');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('invalid cursor');
      const value = JSON.parse(decoded.toString('utf8')) as unknown;
      if (typeof value !== 'object' || value === null) throw new Error('invalid cursor');
      const encoded = value as { version?: unknown; createdAt?: unknown; id?: unknown; fingerprint?: unknown };
      if (encoded.version !== 1 || typeof encoded.createdAt !== 'string'
        || typeof encoded.id !== 'string' || encoded.id.length === 0 || encoded.id.length > 256
        || encoded.fingerprint !== fingerprint) throw new Error('invalid cursor');
      const createdAt = new Date(encoded.createdAt);
      if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== encoded.createdAt) throw new Error('invalid cursor');
      return { createdAt, id: encoded.id };
    } catch {
      throw this.validationError();
    }
  }

  private cursorSignature(payload: string): string {
    const secret = this.config.sessionSecret;
    if (secret === undefined) throw new Error('Report cursor signing is unavailable.');
    return createHmac('sha256', secret).update(`report-cursor:v1:${payload}`).digest('base64url');
  }

  private notFound(): HttpException {
    return new HttpException({ code: 'REPORT_NOT_FOUND', message: 'Report not found.' }, HttpStatus.NOT_FOUND);
  }

  private artifactNotFound(): HttpException {
    return new HttpException(
      { code: 'REPORT_ARTIFACT_NOT_FOUND', message: 'Report artifact not found.' },
      HttpStatus.NOT_FOUND,
    );
  }

  private notEditable(): HttpException {
    return new HttpException(
      { code: 'REPORT_NOT_EDITABLE', message: 'Report is not editable in its current state.' },
      HttpStatus.CONFLICT,
    );
  }

  private revisionConflict(): HttpException {
    return new HttpException(
      { code: 'REPORT_REVISION_CONFLICT', message: 'The report revision is stale.' },
      HttpStatus.CONFLICT,
    );
  }

  private artifactUnavailable(): HttpException {
    return new HttpException(
      { code: 'REPORT_GENERATION_UNAVAILABLE', message: 'Report artifact is unavailable.' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private validationError(): HttpException {
    return new HttpException({ code: 'VALIDATION_ERROR', message: 'Request validation failed.' }, HttpStatus.BAD_REQUEST);
  }
}
