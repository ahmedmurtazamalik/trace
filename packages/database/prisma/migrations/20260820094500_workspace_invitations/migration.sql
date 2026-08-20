CREATE TYPE "WorkspaceInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

CREATE TABLE "workspace_invitations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "invited_user_id" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "status" "WorkspaceInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workspace_memberships" ADD COLUMN "invitation_id" TEXT;

CREATE UNIQUE INDEX "workspace_memberships_invitation_id_key" ON "workspace_memberships"("invitation_id");
CREATE INDEX "workspace_invitations_invited_user_id_status_expires_at_idx" ON "workspace_invitations"("invited_user_id", "status", "expires_at");
CREATE INDEX "workspace_invitations_workspace_id_created_at_idx" ON "workspace_invitations"("workspace_id", "created_at");
CREATE INDEX "workspace_invitations_invited_by_id_idx" ON "workspace_invitations"("invited_by_id");
CREATE UNIQUE INDEX "workspace_invitations_one_pending_per_recipient" ON "workspace_invitations"("workspace_id", "invited_user_id") WHERE "status" = 'PENDING';

ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "workspace_invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
