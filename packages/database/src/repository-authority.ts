import { Prisma, type PrismaClient } from '@prisma/client';

export type RepositoryAuthorityClient = Pick<PrismaClient, '$queryRaw'>;

/**
 * Canonical workspace repository authority.
 *
 * Authority belongs to one enabled workspace member who simultaneously has an
 * active UserRepository relation and the linked GitHub account that owns the
 * repository's current, non-suspended installation.
 */
export async function hasWorkspaceRepositoryAuthority(
  client: RepositoryAuthorityClient,
  workspaceId: string,
  repositoryId: string,
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ authorized: number }>>(Prisma.sql`
    SELECT 1 AS authorized
    FROM workspace_memberships wm
    INNER JOIN users u
      ON u.id = wm.user_id
     AND u.disabled_at IS NULL
    INNER JOIN user_repositories ur
      ON ur.user_id = wm.user_id
     AND ur.repository_id = ${repositoryId}
     AND ur.access_removed_at IS NULL
     AND ur.removed_at IS NULL
    INNER JOIN github_accounts ga
      ON ga.user_id = wm.user_id
     AND ga.unlinked_at IS NULL
    INNER JOIN repositories r
      ON r.id = ur.repository_id
     AND r.access_removed_at IS NULL
    INNER JOIN github_installations gi
      ON gi.id = r.github_installation_id
     AND gi.github_account_id = ga.id
     AND gi.suspended_at IS NULL
    WHERE wm.workspace_id = ${workspaceId}
      AND r.id = ${repositoryId}
    LIMIT 1
    FOR SHARE OF wm, u, ur, ga, r, gi
  `);
  return rows.length > 0;
}
