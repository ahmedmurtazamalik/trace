import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@trace/database';
import {
  workspaceInvitationCreateRequestSchema,
  type WorkspaceInvitation,
  type WorkspaceInvitationAcceptResponse,
  type WorkspaceInvitationCreateResponse,
  type WorkspaceInvitationDecisionResponse,
  type WorkspaceInvitationDetailResponse,
  type WorkspaceInvitationListResponse,
} from '@trace/shared';

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const invitationInclude = {
  workspace: { select: { id: true, name: true } },
  invitedUser: { select: { id: true, username: true, displayName: true } },
  invitedBy: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.WorkspaceInvitationInclude;
type InvitationRecord = Prisma.WorkspaceInvitationGetPayload<{ include: typeof invitationInclude }>;
type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class WorkspaceInvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(managerUserId: string, workspaceId: string, input: unknown): Promise<WorkspaceInvitationCreateResponse> {
    const parsed = workspaceInvitationCreateRequestSchema.safeParse(input);
    if (!parsed.success) this.validationError();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockWorkspace(tx, workspaceId);
        await this.requireManager(tx, managerUserId, workspaceId);
        const invitedUser = await tx.user.findUnique({ where: { username: parsed.data.username } });
        if (invitedUser === null || invitedUser.disabledAt !== null) this.targetInvalid();
        await this.expirePending(tx, workspaceId, invitedUser.id, managerUserId);
        const existingMember = await tx.workspaceMembership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: invitedUser.id } }, select: { id: true },
        });
        if (existingMember !== null) this.memberExists();
        const createdAt = new Date();
        const token = randomBytes(32).toString('base64url');
        const invitation = await tx.workspaceInvitation.create({
          data: {
            workspaceId, invitedUserId: invitedUser.id, invitedById: managerUserId, role: parsed.data.role,
            tokenHash: this.hashToken(token),
            createdAt, expiresAt: new Date(createdAt.getTime() + INVITATION_LIFETIME_MS),
          },
          include: invitationInclude,
        });
        await this.audit(tx, managerUserId, 'workspace.invitation.created', workspaceId, {
          invitationId: invitation.id, invitedUserId: invitation.invitedUserId,
          role: invitation.role, expiresAt: invitation.expiresAt.toISOString(),
        });
        return {
          invitation: this.serialize(invitation),
          copyablePath: `/invitations/${invitation.id}#token=${token}`,
        };
      });
    } catch (error) {
      if (this.prismaErrorCode(error) === 'P2002') this.invitationExists();
      throw error;
    }
  }

  async listWorkspace(managerUserId: string, workspaceId: string): Promise<WorkspaceInvitationListResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManager(tx, managerUserId, workspaceId, true);
      const items = await tx.workspaceInvitation.findMany({
        where: { workspaceId }, include: invitationInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      return { items: items.map((item) => this.serialize(item)) };
    });
  }

  async listMine(userId: string): Promise<WorkspaceInvitationListResponse> {
    const items = await this.prisma.workspaceInvitation.findMany({
      where: { invitedUserId: userId }, include: invitationInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return { items: items.map((item) => this.serialize(item)) };
  }

  async detail(userId: string, invitationId: string, token?: string): Promise<WorkspaceInvitationDetailResponse> {
    return { invitation: this.serialize(await this.recipientInvitation(this.prisma, userId, invitationId, token)) };
  }

  async accept(userId: string, invitationId: string, token?: string): Promise<WorkspaceInvitationAcceptResponse> {
    const locator = await this.recipientInvitation(this.prisma, userId, invitationId, token);
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await this.lockWorkspace(tx, locator.workspaceId);
        const invitation = await this.recipientInvitation(tx, userId, invitationId, token);
        const workspace = await tx.workspace.findUnique({ where: { id: invitation.workspaceId }, select: { archivedAt: true } });
        if (workspace === null) this.invitationNotFound();
        if (workspace.archivedAt !== null) this.workspaceArchived();
        if (invitation.status !== 'PENDING') this.invitationNotPending();
        if (invitation.expiresAt.getTime() <= Date.now()) {
          await this.expireInvitation(tx, invitation, userId);
          return { expired: true as const };
        }
        const membership = await tx.workspaceMembership.create({
          data: { workspaceId: invitation.workspaceId, userId, role: invitation.role, invitationId: invitation.id },
          include: { user: { select: { id: true, username: true, displayName: true } } },
        });
        const accepted = await tx.workspaceInvitation.update({
          where: { id: invitation.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() }, include: invitationInclude,
        });
        await this.audit(tx, userId, 'workspace.invitation.accepted', invitation.workspaceId, {
          invitationId: invitation.id, invitedUserId: userId, role: invitation.role,
        });
        return {
          expired: false as const,
          response: {
            invitation: this.serialize(accepted),
            member: {
              userId: membership.user.id, username: membership.user.username, displayName: membership.user.displayName,
              role: membership.role, joinedAt: membership.createdAt.toISOString(),
            },
          },
        };
      });
      if (outcome.expired) this.invitationExpired();
      return outcome.response;
    } catch (error) {
      if (this.prismaErrorCode(error) === 'P2002') this.memberExists();
      throw error;
    }
  }

  async decline(userId: string, invitationId: string, token?: string): Promise<WorkspaceInvitationDecisionResponse> {
    const locator = await this.recipientInvitation(this.prisma, userId, invitationId, token);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, locator.workspaceId);
      const invitation = await this.recipientInvitation(tx, userId, invitationId, token);
      if (invitation.status !== 'PENDING') this.invitationNotPending();
      if (invitation.expiresAt.getTime() <= Date.now()) {
        await this.expireInvitation(tx, invitation, userId);
        return { expired: true as const };
      }
      const declined = await tx.workspaceInvitation.update({
        where: { id: invitation.id }, data: { status: 'DECLINED', declinedAt: new Date() }, include: invitationInclude,
      });
      await this.audit(tx, userId, 'workspace.invitation.declined', invitation.workspaceId, {
        invitationId: invitation.id, invitedUserId: userId, role: invitation.role,
      });
      return { expired: false as const, response: { invitation: this.serialize(declined) } };
    });
    if (outcome.expired) this.invitationExpired();
    return outcome.response;
  }

  async revoke(managerUserId: string, workspaceId: string, invitationId: string): Promise<WorkspaceInvitationDecisionResponse> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkspace(tx, workspaceId);
      await this.requireManager(tx, managerUserId, workspaceId);
      const invitation = await tx.workspaceInvitation.findFirst({
        where: { id: invitationId, workspaceId }, include: invitationInclude,
      });
      if (invitation === null) this.invitationNotFound();
      if (invitation.status !== 'PENDING') this.invitationNotPending();
      if (invitation.expiresAt.getTime() <= Date.now()) {
        await this.expireInvitation(tx, invitation, managerUserId);
        return { expired: true as const };
      }
      const revoked = await tx.workspaceInvitation.update({
        where: { id: invitation.id }, data: { status: 'REVOKED', revokedAt: new Date() }, include: invitationInclude,
      });
      await this.audit(tx, managerUserId, 'workspace.invitation.revoked', workspaceId, {
        invitationId: invitation.id, invitedUserId: invitation.invitedUserId, role: invitation.role,
      });
      return { expired: false as const, response: { invitation: this.serialize(revoked) } };
    });
    if (outcome.expired) this.invitationExpired();
    return outcome.response;
  }

  private async recipientInvitation(client: DatabaseClient, userId: string, invitationId: string, token?: string): Promise<InvitationRecord> {
    const invitation = await client.workspaceInvitation.findFirst({
      where: { id: invitationId, invitedUserId: userId }, include: invitationInclude,
    });
    if (invitation === null) this.invitationNotFound();
    if (token !== undefined) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) this.invitationNotFound();
      const suppliedHash = Buffer.from(this.hashToken(token), 'hex');
      const storedHash = Buffer.from(invitation.tokenHash, 'hex');
      if (storedHash.length !== suppliedHash.length || !timingSafeEqual(storedHash, suppliedHash)) this.invitationNotFound();
    }
    return invitation;
  }

  private async expirePending(tx: Prisma.TransactionClient, workspaceId: string, invitedUserId: string, actorUserId: string): Promise<void> {
    const expired = await tx.workspaceInvitation.findFirst({
      where: { workspaceId, invitedUserId, status: 'PENDING', expiresAt: { lte: new Date() } }, include: invitationInclude,
    });
    if (expired !== null) await this.expireInvitation(tx, expired, actorUserId);
  }

  private async expireInvitation(tx: Prisma.TransactionClient, invitation: InvitationRecord, actorUserId: string): Promise<void> {
    await tx.workspaceInvitation.update({ where: { id: invitation.id }, data: { status: 'REVOKED', revokedAt: null } });
    await this.audit(tx, actorUserId, 'workspace.invitation.expired', invitation.workspaceId, {
      invitationId: invitation.id, invitedUserId: invitation.invitedUserId, role: invitation.role,
    });
  }

  private async lockWorkspace(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`);
    if (rows.length === 0) this.workspaceNotFound();
  }

  private async requireManager(tx: Prisma.TransactionClient, userId: string, workspaceId: string, allowArchived = false): Promise<void> {
    const membership = await tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } }, include: { workspace: { select: { archivedAt: true } } },
    });
    if (membership === null) this.workspaceNotFound();
    if (membership.role !== 'MANAGER') {
      throw new HttpException({ code: 'WORKSPACE_MANAGER_REQUIRED', message: 'Manager access required.' }, HttpStatus.FORBIDDEN);
    }
    if (!allowArchived && membership.workspace.archivedAt !== null) this.workspaceArchived();
  }

  private serialize(record: InvitationRecord): WorkspaceInvitation {
    const expired = record.expiresAt.getTime() <= Date.now()
      && (record.status === 'PENDING' || (record.status === 'REVOKED' && record.revokedAt === null));
    return {
      id: record.id, workspace: record.workspace, invitedUser: record.invitedUser, invitedBy: record.invitedBy,
      role: record.role, status: expired ? 'EXPIRED' : record.status, acceptancePath: `/invitations/${record.id}`,
      expiresAt: record.expiresAt.toISOString(), createdAt: record.createdAt.toISOString(),
      acceptedAt: record.acceptedAt?.toISOString() ?? null, declinedAt: record.declinedAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async audit(tx: Prisma.TransactionClient, actorUserId: string, action: string, workspaceId: string, metadata: Prisma.InputJsonValue): Promise<void> {
    await tx.auditLog.create({ data: { actorUserId, action, targetType: 'workspace', targetId: workspaceId, metadata } });
  }

  private validationError(): never { throw new HttpException({ code: 'VALIDATION_ERROR', message: 'Workspace invitation request is invalid.' }, HttpStatus.UNPROCESSABLE_ENTITY); }
  private workspaceNotFound(): never { throw new HttpException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' }, HttpStatus.NOT_FOUND); }
  private workspaceArchived(): never { throw new HttpException({ code: 'WORKSPACE_ARCHIVED', message: 'Archived workspaces are read-only.' }, HttpStatus.CONFLICT); }
  private targetInvalid(): never { throw new HttpException({ code: 'WORKSPACE_INVITATION_TARGET_INVALID', message: 'Invitation target is invalid.' }, HttpStatus.NOT_FOUND); }
  private memberExists(): never { throw new HttpException({ code: 'WORKSPACE_MEMBER_EXISTS', message: 'Workspace member already exists.' }, HttpStatus.CONFLICT); }
  private invitationExists(): never { throw new HttpException({ code: 'WORKSPACE_INVITATION_EXISTS', message: 'A pending invitation already exists.' }, HttpStatus.CONFLICT); }
  private invitationNotFound(): never { throw new HttpException({ code: 'WORKSPACE_INVITATION_NOT_FOUND', message: 'Workspace invitation not found.' }, HttpStatus.NOT_FOUND); }
  private invitationExpired(): never { throw new HttpException({ code: 'WORKSPACE_INVITATION_EXPIRED', message: 'Workspace invitation has expired.' }, HttpStatus.GONE); }
  private invitationNotPending(): never { throw new HttpException({ code: 'WORKSPACE_INVITATION_NOT_PENDING', message: 'Workspace invitation is not pending.' }, HttpStatus.CONFLICT); }
  private prismaErrorCode(error: unknown): string | undefined { return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined; }
}
