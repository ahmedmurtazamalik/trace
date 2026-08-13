import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TraceConfig } from '@trace/config';
import { Prisma, PrismaService } from '@trace/database';
import type { ActivityListQuery, ActivityListResponse, ActivitySummary } from '@trace/shared';
import { activityListQuerySchema } from '@trace/shared';
import { TRACE_CONFIG } from '../../common/config/config.token';

type ActivityRow = {
  id: string;
  source: string;
  type: string;
  occurredAt: Date;
  metadata: unknown;
  repositoryId: string;
  repositoryFullName: string;
  repositoryUrl: string | null;
  contributorId: string | null;
  contributorUsername: string | null;
  contributorDisplayName: string | null;
  contributorAvatarUrl: string | null;
};

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRACE_CONFIG) private readonly config: TraceConfig,
  ) {}

  async list(userId: string, input: unknown, routeRepositoryId?: string): Promise<ActivityListResponse> {
    const query = this.listQuery(input);
    if (routeRepositoryId !== undefined && (routeRepositoryId.length === 0 || routeRepositoryId.length > 256)) {
      throw this.validationError();
    }
    if (routeRepositoryId !== undefined && query.repositoryId !== undefined && query.repositoryId !== routeRepositoryId) {
      throw this.validationError();
    }
    const repositoryId = routeRepositoryId ?? query.repositoryId;
    if (routeRepositoryId !== undefined) {
      const membership = await this.prisma.userRepository.findUnique({
        where: { userId_repositoryId: { userId, repositoryId: routeRepositoryId } },
        select: { id: true },
      });
      if (membership === null) {
        throw new HttpException(
          { code: 'REPOSITORY_NOT_FOUND', message: 'Repository not found.' },
          HttpStatus.NOT_FOUND,
        );
      }
    }
    const fingerprint = this.fingerprint(userId, query, repositoryId ?? null);
    const cursor = this.decodeCursor(query.cursor, fingerprint);
    const day = query.date === undefined ? null : this.dayBounds(query.date, query.timezone);
    const rows = await this.prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
      SELECT
        ae.id,
        ae.source::text AS source,
        ae.type::text AS type,
        ae.occurred_at AS "occurredAt",
        ae.metadata,
        r.id AS "repositoryId",
        r.full_name AS "repositoryFullName",
        r.html_url AS "repositoryUrl",
        c.id AS "contributorId",
        c.username AS "contributorUsername",
        c.display_name AS "contributorDisplayName",
        c.avatar_url AS "contributorAvatarUrl"
      FROM activity_events ae
      INNER JOIN repositories r ON r.id = ae.repository_id
      INNER JOIN user_repositories ur
        ON ur.repository_id = ae.repository_id
       AND ur.user_id = ${userId}
       AND ae.occurred_at >= ur.created_at
       AND (ur.access_removed_at IS NULL OR ae.occurred_at <= ur.access_removed_at)
      LEFT JOIN contributors c ON c.id = ae.contributor_id
      WHERE (${repositoryId ?? null}::text IS NULL OR ae.repository_id = ${repositoryId ?? null})
        AND char_length(r.full_name) BETWEEN 1 AND 512
        AND ae.source::text = 'github'
        AND ae.type::text IN ('commit', 'push', 'pull_request')
        AND (${query.contributorId ?? null}::text IS NULL OR ae.contributor_id = ${query.contributorId ?? null})
        AND (${query.source ?? null}::text IS NULL OR ae.source::text = ${query.source ?? null})
        AND (${query.type ?? null}::text IS NULL OR ae.type::text = ${query.type ?? null})
        AND (${day?.start ?? null}::timestamptz IS NULL OR ae.occurred_at >= ${day?.start ?? null})
        AND (${day?.end ?? null}::timestamptz IS NULL OR ae.occurred_at < ${day?.end ?? null})
        AND (
          ${cursor?.occurredAt ?? null}::timestamptz IS NULL
          OR ae.occurred_at < ${cursor?.occurredAt ?? null}
          OR (ae.occurred_at = ${cursor?.occurredAt ?? null} AND ae.id < ${cursor?.id ?? null})
        )
      ORDER BY ae.occurred_at DESC, ae.id DESC
      LIMIT ${query.limit + 1}
    `);
    const page = rows.slice(0, query.limit);
    const hasNextPage = rows.length > query.limit;
    const last = page.at(-1);
    return {
      items: page.map((row) => this.summary(row)),
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && last !== undefined
          ? this.encodeCursor(last.occurredAt, last.id, fingerprint)
          : null,
      },
    };
  }

  private fingerprint(userId: string, query: ActivityListQuery, repositoryId: string | null): string {
    return JSON.stringify({
      version: 1,
      userId,
      date: query.date ?? null,
      timezone: query.timezone,
      repositoryId,
      contributorId: query.contributorId ?? null,
      source: query.source ?? null,
      type: query.type ?? null,
      limit: query.limit,
    });
  }

  private encodeCursor(occurredAt: Date, id: string, fingerprint: string): string {
    const payload = Buffer.from(JSON.stringify({
      version: 1,
      occurredAt: occurredAt.toISOString(),
      id,
      fingerprint,
    })).toString('base64url');
    return `${payload}.${this.cursorSignature(payload)}`;
  }

  private decodeCursor(cursor: string | undefined, fingerprint: string): { occurredAt: Date; id: string } | null {
    if (cursor === undefined) return null;
    try {
      if (cursor.length > 2_048) throw new Error('cursor too large');
      const parts = cursor.split('.');
      if (parts.length !== 2) throw new Error('invalid cursor');
      const [payload, signature] = parts as [string, string];
      if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
        throw new Error('invalid cursor encoding');
      }
      const decoded = Buffer.from(payload, 'base64url');
      if (decoded.toString('base64url') !== payload) throw new Error('non-canonical cursor');
      const expected = Buffer.from(this.cursorSignature(payload), 'base64url');
      const supplied = Buffer.from(signature, 'base64url');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new Error('invalid cursor signature');
      }
      const value = JSON.parse(decoded.toString('utf8')) as unknown;
      if (typeof value !== 'object' || value === null) throw new Error('invalid cursor');
      const encoded = value as { version?: unknown; occurredAt?: unknown; id?: unknown; fingerprint?: unknown };
      if (
        encoded.version !== 1
        || typeof encoded.occurredAt !== 'string'
        || typeof encoded.id !== 'string' || encoded.id.length === 0 || encoded.id.length > 256
        || encoded.fingerprint !== fingerprint
      ) throw new Error('invalid cursor');
      const occurredAt = new Date(encoded.occurredAt);
      if (!Number.isFinite(occurredAt.getTime()) || occurredAt.toISOString() !== encoded.occurredAt) {
        throw new Error('invalid cursor');
      }
      return { occurredAt, id: encoded.id };
    } catch {
      throw this.validationError();
    }
  }

  private cursorSignature(payload: string): string {
    const secret = this.config.sessionSecret;
    if (secret === undefined) throw new Error('Activity cursor signing is unavailable.');
    return createHmac('sha256', secret).update(`activity-cursor:v1:${payload}`).digest('base64url');
  }

  private dayBounds(date: string, timezone: string): { start: Date; end: Date } {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    const start = this.localMidnight(year, month, day, timezone);
    const end = this.localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timezone);
    if (start >= end) throw this.validationError();
    return { start, end };
  }

  private localMidnight(year: number, month: number, day: number, timezone: string): Date {
    const desired = Date.UTC(year, month - 1, day);
    let candidate = desired;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
      const represented = Date.UTC(
        Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        Number(parts.hour), Number(parts.minute), Number(parts.second),
      );
      const adjustment = desired - represented;
      candidate += adjustment;
      if (adjustment === 0) break;
    }
    return new Date(candidate);
  }

  private summary(row: ActivityRow): ActivitySummary {
    const metadata = typeof row.metadata === 'object' && row.metadata !== null
      ? row.metadata as Record<string, unknown>
      : {};
    const branch = this.branch(metadata.branch ?? metadata.ref);
    return {
      id: row.id,
      repository: { id: row.repositoryId, fullName: row.repositoryFullName, url: this.url(row.repositoryUrl, 'github.com') },
      contributor: row.contributorId === null ? null : {
        id: row.contributorId,
        username: this.string(row.contributorUsername, 100),
        displayName: this.string(row.contributorDisplayName, 256),
        avatarUrl: this.url(row.contributorAvatarUrl, 'avatars.githubusercontent.com'),
      },
      source: row.source as ActivitySummary['source'],
      type: row.type as ActivitySummary['type'],
      occurredAt: row.occurredAt.toISOString(),
      facts: {
        sha: this.sha(metadata.sha),
        message: this.string(metadata.message, 10_000),
        branch,
        filesChanged: this.number(metadata.changedFiles),
        additions: this.number(metadata.additions),
        deletions: this.number(metadata.deletions),
        url: this.url(metadata.url, row.source === 'github' ? 'github.com' : undefined),
      },
    };
  }

  private sha(value: unknown): string | null {
    return typeof value === 'string' && value.length >= 7 && value.length <= 64 ? value : null;
  }

  private url(value: unknown, allowedHost?: string): string | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:'
        && (allowedHost === undefined || parsed.hostname === allowedHost)
        && parsed.toString() === value
        ? value
        : null;
    } catch {
      return null;
    }
  }

  private branch(value: unknown): string | null {
    const branch = this.string(value, 1_035);
    return branch?.startsWith('refs/heads/') === true ? branch.slice('refs/heads/'.length) : branch;
  }

  private string(value: unknown, maximum: number): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
  }

  private number(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  private listQuery(input: unknown): ActivityListQuery {
    const parsed = activityListQuerySchema.safeParse(input);
    if (!parsed.success) throw this.validationError();
    return parsed.data;
  }

  private validationError(): HttpException {
    return new HttpException({ code: 'VALIDATION_ERROR', message: 'Request validation failed.' }, HttpStatus.BAD_REQUEST);
  }
}
