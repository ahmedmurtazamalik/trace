import { z } from 'zod';
import { usernameSchema } from './auth';

export const workspaceRoleSchema = z.enum(['MANAGER', 'DEVELOPER']);
export const workspaceRepositoryAccessStateSchema = z.enum(['ACTIVE', 'ACCESS_REMOVED']);

const workspaceNameSchema = z.string().trim().min(3).max(100);
const workspaceIdSchema = z.string().min(1).max(200);

export const workspaceCreateRequestSchema = z.object({
  name: workspaceNameSchema,
}).strict();

export const workspaceUpdateRequestSchema = z.object({
  name: workspaceNameSchema.optional(),
}).strict().refine((value) => value.name !== undefined, { message: 'Workspace update is empty' });

export const workspaceSummarySchema = z.object({
  id: workspaceIdSchema,
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(120),
  role: workspaceRoleSchema,
  memberCount: z.number().int().positive(),
  repositoryCount: z.number().int().nonnegative(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export const workspaceCreateResponseSchema = z.object({ workspace: workspaceSummarySchema }).strict();
export const workspaceUpdateResponseSchema = workspaceCreateResponseSchema;
export const workspaceArchiveResponseSchema = workspaceCreateResponseSchema;

export const workspaceListResponseSchema = z.object({
  items: z.array(workspaceSummarySchema).max(500),
}).strict();

export const workspaceMemberSchema = z.object({
  userId: workspaceIdSchema,
  username: usernameSchema,
  displayName: z.string().min(1).max(100).nullable(),
  role: workspaceRoleSchema,
  joinedAt: z.iso.datetime(),
}).strict();

export const workspaceRepositorySchema = z.object({
  id: workspaceIdSchema,
  fullName: z.string().min(1).max(300),
  private: z.boolean(),
  defaultBranch: z.string().min(1).max(255),
  url: z.url().nullable(),
  accessState: workspaceRepositoryAccessStateSchema,
}).strict();

export const workspaceDetailResponseSchema = z.object({
  workspace: workspaceSummarySchema,
  members: z.array(workspaceMemberSchema).max(1_000),
  repositories: z.array(workspaceRepositorySchema).max(1_000),
}).strict();

export const workspaceMemberRoleUpdateRequestSchema = z.object({
  role: workspaceRoleSchema,
}).strict();

export const workspaceMembershipResponseSchema = z.object({ member: workspaceMemberSchema }).strict();
export const workspaceMemberRemovalResponseSchema = z.object({ removed: z.literal(true) }).strict();

export const workspaceInvitationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED']);
export const workspaceInvitationCreateRequestSchema = z.object({
  username: usernameSchema,
  role: workspaceRoleSchema,
}).strict();
const workspaceInvitationPersonSchema = z.object({
  id: workspaceIdSchema,
  username: usernameSchema,
  displayName: z.string().min(1).max(100).nullable(),
}).strict();
export const workspaceInvitationSchema = z.object({
  id: workspaceIdSchema,
  workspace: z.object({ id: workspaceIdSchema, name: z.string().min(1).max(100) }).strict(),
  invitedUser: workspaceInvitationPersonSchema,
  invitedBy: workspaceInvitationPersonSchema,
  role: workspaceRoleSchema,
  status: workspaceInvitationStatusSchema,
  acceptancePath: z.string().regex(/^\/invitations\/[A-Za-z0-9_-]+$/).max(300),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  declinedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
}).strict();
export const workspaceInvitationCreateResponseSchema = z.object({
  invitation: workspaceInvitationSchema,
  copyablePath: z.string().regex(/^\/invitations\/[A-Za-z0-9_-]+#token=[A-Za-z0-9_-]{43}$/).max(400),
}).strict();
export const workspaceInvitationDetailResponseSchema = z.object({ invitation: workspaceInvitationSchema }).strict();
export const workspaceInvitationListResponseSchema = z.object({ items: z.array(workspaceInvitationSchema).max(1_000) }).strict();
export const workspaceInvitationAcceptResponseSchema = z.object({ invitation: workspaceInvitationSchema, member: workspaceMemberSchema }).strict();
export const workspaceInvitationDecisionResponseSchema = workspaceInvitationDetailResponseSchema;

export const workspaceAssignRepositoryRequestSchema = z.object({
  repositoryId: workspaceIdSchema,
}).strict();

export const workspaceRepositoryAssignmentResponseSchema = z.object({ repository: workspaceRepositorySchema }).strict();
export const workspaceRepositoryRemovalResponseSchema = z.object({ removed: z.literal(true) }).strict();

export const workspaceErrorCodeSchema = z.enum([
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_MANAGER_REQUIRED',
  'WORKSPACE_ARCHIVED',
  'WORKSPACE_MEMBER_NOT_FOUND',
  'WORKSPACE_MEMBER_EXISTS',
  'WORKSPACE_LAST_MANAGER_REQUIRED',
  'WORKSPACE_REPOSITORY_NOT_AVAILABLE',
  'WORKSPACE_REPOSITORY_NOT_ASSIGNED',
  'WORKSPACE_INVITATION_NOT_FOUND',
  'WORKSPACE_INVITATION_EXISTS',
  'WORKSPACE_INVITATION_EXPIRED',
  'WORKSPACE_INVITATION_NOT_PENDING',
  'WORKSPACE_INVITATION_TARGET_INVALID',
]);

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type WorkspaceRepositoryAccessState = z.infer<typeof workspaceRepositoryAccessStateSchema>;
export type WorkspaceCreateRequest = z.infer<typeof workspaceCreateRequestSchema>;
export type WorkspaceUpdateRequest = z.infer<typeof workspaceUpdateRequestSchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type WorkspaceCreateResponse = z.infer<typeof workspaceCreateResponseSchema>;
export type WorkspaceUpdateResponse = z.infer<typeof workspaceUpdateResponseSchema>;
export type WorkspaceArchiveResponse = z.infer<typeof workspaceArchiveResponseSchema>;
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type WorkspaceRepository = z.infer<typeof workspaceRepositorySchema>;
export type WorkspaceDetailResponse = z.infer<typeof workspaceDetailResponseSchema>;
export type WorkspaceMemberRoleUpdateRequest = z.infer<typeof workspaceMemberRoleUpdateRequestSchema>;
export type WorkspaceMembershipResponse = z.infer<typeof workspaceMembershipResponseSchema>;
export type WorkspaceMemberRemovalResponse = z.infer<typeof workspaceMemberRemovalResponseSchema>;
export type WorkspaceInvitationStatus = z.infer<typeof workspaceInvitationStatusSchema>;
export type WorkspaceInvitationCreateRequest = z.infer<typeof workspaceInvitationCreateRequestSchema>;
export type WorkspaceInvitation = z.infer<typeof workspaceInvitationSchema>;
export type WorkspaceInvitationCreateResponse = z.infer<typeof workspaceInvitationCreateResponseSchema>;
export type WorkspaceInvitationDetailResponse = z.infer<typeof workspaceInvitationDetailResponseSchema>;
export type WorkspaceInvitationListResponse = z.infer<typeof workspaceInvitationListResponseSchema>;
export type WorkspaceInvitationAcceptResponse = z.infer<typeof workspaceInvitationAcceptResponseSchema>;
export type WorkspaceInvitationDecisionResponse = z.infer<typeof workspaceInvitationDecisionResponseSchema>;
export type WorkspaceAssignRepositoryRequest = z.infer<typeof workspaceAssignRepositoryRequestSchema>;
export type WorkspaceRepositoryAssignmentResponse = z.infer<typeof workspaceRepositoryAssignmentResponseSchema>;
export type WorkspaceRepositoryRemovalResponse = z.infer<typeof workspaceRepositoryRemovalResponseSchema>;
export type WorkspaceErrorCode = z.infer<typeof workspaceErrorCodeSchema>;
