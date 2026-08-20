import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { hasWorkspaceRepositoryAuthority, Prisma, PrismaService, type WorkspaceRole } from '@trace/database';
import {
  workspaceAssignRepositoryRequestSchema,
  workspaceCreateRequestSchema,
  workspaceMemberRoleUpdateRequestSchema,
  workspaceUpdateRequestSchema,
  type WorkspaceArchiveResponse,
  type WorkspaceCreateResponse,
  type WorkspaceDetailResponse,
  type WorkspaceListResponse,
  type WorkspaceMember,
  type WorkspaceMemberRemovalResponse,
  type WorkspaceMembershipResponse,
  type WorkspaceRepository,
  type WorkspaceRepositoryAssignmentResponse,
  type WorkspaceRepositoryRemovalResponse,
  type WorkspaceSummary,
  type WorkspaceUpdateResponse,
} from '@trace/shared';
import { randomBytes } from 'node:crypto';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: unknown): Promise<WorkspaceCreateResponse> {
    const parsed = workspaceCreateRequestSchema.safeParse(input);
    if (!parsed.success) this.validationError();
    const name = parsed.data.name;
    const slug = `${this.slugBase(name)}-${randomBytes(4).toString('hex')}`;
    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name,
          slug,
          createdById: userId,
          memberships: { create: { userId, role: 'MANAGER' } },
        },
        include: { _count: { select: { memberships: true, repositories: true } } },
      });
      await this.audit(tx, userId, 'workspace.created', created.id, { name });
      return created;
    });
    return { workspace: this.summary(workspace, 'MANAGER') };
  }

  async list(userId: string): Promise<WorkspaceListResponse> {
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      include: { workspace: { include: { _count: { select: { memberships: true, repositories: true } } } } },
      orderBy: [{ workspace: { createdAt: 'desc' } }, { workspaceId: 'asc' }],
    });
    return { items: memberships.map((membership) => this.summary(membership.workspace, membership.role)) };
  }

  async detail(userId: string, workspaceId: string): Promise<WorkspaceDetailResponse> {
    await this.membership(this.prisma, userId, workspaceId);
    const { membership, members, repositories } = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      const currentMembership = await this.membership(tx, userId, workspaceId);
      const [currentMembers, currentRepositories] = await Promise.all([
        tx.workspaceMembership.findMany({
          where: { workspaceId },
          include: { user: { select: { id: true, username: true, displayName: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        tx.workspaceRepository.findMany({
          where: { workspaceId },
          include: { repository: true },
          orderBy: [{ repository: { fullName: 'asc' } }, { id: 'asc' }],
        }),
      ]);
      return { membership: currentMembership, members: currentMembers, repositories: currentRepositories };
    });
    return {
      workspace: this.summary(membership.workspace, membership.role),
      members: members.map((item) => this.member(item)),
      repositories: repositories.map((item) => this.repository(item.repository)),
    };
  }

  async update(userId: string, workspaceId: string, input: unknown): Promise<WorkspaceUpdateResponse> {
    const parsed = workspaceUpdateRequestSchema.safeParse(input);
    if (!parsed.success) this.validationError();
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManager(tx, userId, workspaceId);
      const workspace = await tx.workspace.update({
        where: { id: workspaceId },
        data: { name: parsed.data.name },
        include: { _count: { select: { memberships: true, repositories: true } } },
      });
      await this.audit(tx, userId, 'workspace.renamed', workspaceId, { name: workspace.name });
      return workspace;
    });
    return { workspace: this.summary(result, 'MANAGER') };
  }

  async archive(userId: string, workspaceId: string): Promise<WorkspaceArchiveResponse> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManager(tx, userId, workspaceId);
      const archivedAt = new Date();
      const workspace = await tx.workspace.update({
        where: { id: workspaceId },
        data: { archivedAt },
        include: { _count: { select: { memberships: true, repositories: true } } },
      });
      const revoked = await tx.workspaceInvitation.updateMany({
        where: { workspaceId, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: archivedAt },
      });
      await this.audit(tx, userId, 'workspace.archived', workspaceId, { revokedPendingInvitationCount: revoked.count });
      return workspace;
    });
    return { workspace: this.summary(result, 'MANAGER') };
  }

  async updateMemberRole(managerUserId: string, workspaceId: string, userId: string, input: unknown): Promise<WorkspaceMembershipResponse> {
    const parsed = workspaceMemberRoleUpdateRequestSchema.safeParse(input);
    if (!parsed.success) this.validationError();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockWorkspace(tx, workspaceId);
        await this.requireManager(tx, managerUserId, workspaceId);
        const existing = await tx.workspaceMembership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId } },
          include: { user: { select: { id: true, username: true, displayName: true } } },
        });
        if (existing === null) this.memberNotFound();
        if (existing.role === parsed.data.role) return { member: this.member(existing) };
        if (existing.role === 'MANAGER' && parsed.data.role === 'DEVELOPER') await this.assertAnotherManager(tx, workspaceId, userId);
        const updated = await tx.workspaceMembership.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role: parsed.data.role },
          include: { user: { select: { id: true, username: true, displayName: true } } },
        });
        await this.audit(tx, managerUserId, 'workspace.member.role_changed', workspaceId, { userId, from: existing.role, to: updated.role });
        return { member: this.member(updated) };
      });
    } catch (error) {
      if (this.isLastManagerError(error)) this.lastManagerRequired();
      throw error;
    }
  }

  async removeMember(managerUserId: string, workspaceId: string, userId: string): Promise<WorkspaceMemberRemovalResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockWorkspace(tx, workspaceId);
        await this.requireManager(tx, managerUserId, workspaceId);
        const existing = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
        if (existing === null) this.memberNotFound();
        if (existing.role === 'MANAGER') await this.assertAnotherManager(tx, workspaceId, userId);
        await tx.workspaceMembership.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
        await this.audit(tx, managerUserId, 'workspace.member.removed', workspaceId, { userId, role: existing.role });
        return { removed: true };
      });
    } catch (error) {
      if (this.isLastManagerError(error)) this.lastManagerRequired();
      throw error;
    }
  }

  async assignRepository(managerUserId: string, workspaceId: string, input: unknown): Promise<{ created: boolean; response: WorkspaceRepositoryAssignmentResponse }> {
    const parsed = workspaceAssignRepositoryRequestSchema.safeParse(input);
    if (!parsed.success) this.validationError();
    return this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManager(tx, managerUserId, workspaceId);
      const repositoryId = parsed.data.repositoryId;
      if (!await hasWorkspaceRepositoryAuthority(tx, workspaceId, repositoryId)) this.repositoryNotAvailable();
      const repository = await tx.repository.findUnique({ where: { id: repositoryId } });
      if (repository === null) this.repositoryNotAvailable();
      const inserted = await tx.workspaceRepository.createMany({
        data: { workspaceId, repositoryId, assignedById: managerUserId },
        skipDuplicates: true,
      });
      if (inserted.count === 1) await this.audit(tx, managerUserId, 'workspace.repository.assigned', workspaceId, { repositoryId });
      return { created: inserted.count === 1, response: { repository: this.repository(repository) } };
    });
  }

  async removeRepository(managerUserId: string, workspaceId: string, repositoryId: string): Promise<WorkspaceRepositoryRemovalResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManager(tx, managerUserId, workspaceId);
      const removed = await tx.workspaceRepository.deleteMany({ where: { workspaceId, repositoryId } });
      if (removed.count === 0) {
        throw new HttpException({ code: 'WORKSPACE_REPOSITORY_NOT_ASSIGNED', message: 'Repository is not assigned.' }, HttpStatus.NOT_FOUND);
      }
      await this.audit(tx, managerUserId, 'workspace.repository.removed', workspaceId, { repositoryId });
      return { removed: true };
    });
  }

  private async lockWorkspace(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`);
    if (rows.length === 0) this.notFound();
  }

  private async membership(client: DatabaseClient, userId: string, workspaceId: string) {
    const membership = await client.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: { include: { _count: { select: { memberships: true, repositories: true } } } } },
    });
    if (membership === null) this.notFound();
    return membership;
  }

  private async requireManager(client: DatabaseClient, userId: string, workspaceId: string): Promise<void> {
    const membership = await this.membership(client, userId, workspaceId);
    if (membership.role !== 'MANAGER') {
      throw new HttpException({ code: 'WORKSPACE_MANAGER_REQUIRED', message: 'Manager access required.' }, HttpStatus.FORBIDDEN);
    }
    if (membership.workspace.archivedAt !== null) {
      throw new HttpException({ code: 'WORKSPACE_ARCHIVED', message: 'Archived workspaces are read-only.' }, HttpStatus.CONFLICT);
    }
  }

  private async assertAnotherManager(tx: Prisma.TransactionClient, workspaceId: string, excludedUserId: string): Promise<void> {
    const count = await tx.workspaceMembership.count({ where: { workspaceId, role: 'MANAGER', userId: { not: excludedUserId } } });
    if (count === 0) this.lastManagerRequired();
  }

  private async audit(tx: Prisma.TransactionClient, actorUserId: string, action: string, workspaceId: string, metadata: Prisma.InputJsonValue | null): Promise<void> {
    await tx.auditLog.create({
      data: { actorUserId, action, targetType: 'workspace', targetId: workspaceId, metadata: metadata ?? Prisma.JsonNull },
    });
  }

  private summary(workspace: { id: string; name: string; slug: string; archivedAt: Date | null; createdAt: Date; updatedAt: Date; _count: { memberships: number; repositories: number } }, role: WorkspaceRole): WorkspaceSummary {
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role,
      memberCount: workspace._count.memberships,
      repositoryCount: workspace._count.repositories,
      archivedAt: workspace.archivedAt?.toISOString() ?? null,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    };
  }

  private member(membership: { role: WorkspaceRole; createdAt: Date; user: { id: string; username: string; displayName: string | null } }): WorkspaceMember {
    return {
      userId: membership.user.id,
      username: membership.user.username,
      displayName: membership.user.displayName,
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
    };
  }

  private repository(repository: { id: string; fullName: string; private: boolean; defaultBranch: string; htmlUrl: string | null; accessRemovedAt: Date | null }): WorkspaceRepository {
    return {
      id: repository.id,
      fullName: repository.fullName,
      private: repository.private,
      defaultBranch: repository.defaultBranch,
      url: repository.htmlUrl,
      accessState: repository.accessRemovedAt === null ? 'ACTIVE' : 'ACCESS_REMOVED',
    };
  }

  private slugBase(name: string): string {
    const normalized = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return (normalized || 'workspace').slice(0, 100).replace(/-$/g, '');
  }

  private validationError(): never {
    throw new HttpException({ code: 'VALIDATION_ERROR', message: 'Workspace request is invalid.' }, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  private notFound(): never {
    throw new HttpException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' }, HttpStatus.NOT_FOUND);
  }

  private memberNotFound(): never {
    throw new HttpException({ code: 'WORKSPACE_MEMBER_NOT_FOUND', message: 'Workspace member not found.' }, HttpStatus.NOT_FOUND);
  }

  private memberExists(): never {
    throw new HttpException({ code: 'WORKSPACE_MEMBER_EXISTS', message: 'Workspace member already exists.' }, HttpStatus.CONFLICT);
  }

  private lastManagerRequired(): never {
    throw new HttpException({ code: 'WORKSPACE_LAST_MANAGER_REQUIRED', message: 'A workspace must retain at least one Manager.' }, HttpStatus.CONFLICT);
  }

  private repositoryNotAvailable(): never {
    throw new HttpException({ code: 'WORKSPACE_REPOSITORY_NOT_AVAILABLE', message: 'Repository not available.' }, HttpStatus.NOT_FOUND);
  }

  private prismaErrorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
  }

  private isLastManagerError(error: unknown): boolean {
    return error instanceof Error && /workspace must retain at least one manager|workspace_requires_manager/i.test(error.message);
  }
}
