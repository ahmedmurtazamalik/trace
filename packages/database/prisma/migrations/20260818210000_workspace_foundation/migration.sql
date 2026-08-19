CREATE TYPE "WorkspaceRole" AS ENUM ('MANAGER', 'DEVELOPER');

CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_memberships" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_repositories" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_repositories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");
CREATE INDEX "workspaces_created_by_id_idx" ON "workspaces"("created_by_id");
CREATE INDEX "workspaces_archived_at_created_at_idx" ON "workspaces"("archived_at", "created_at");
CREATE UNIQUE INDEX "workspace_memberships_workspace_id_user_id_key" ON "workspace_memberships"("workspace_id", "user_id");
CREATE INDEX "workspace_memberships_user_id_role_idx" ON "workspace_memberships"("user_id", "role");
CREATE INDEX "workspace_memberships_workspace_id_role_idx" ON "workspace_memberships"("workspace_id", "role");
CREATE UNIQUE INDEX "workspace_repositories_workspace_id_repository_id_key" ON "workspace_repositories"("workspace_id", "repository_id");
CREATE INDEX "workspace_repositories_repository_id_idx" ON "workspace_repositories"("repository_id");
CREATE INDEX "workspace_repositories_assigned_by_id_idx" ON "workspace_repositories"("assigned_by_id");

ALTER TABLE "workspaces"
    ADD CONSTRAINT "workspaces_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships"
    ADD CONSTRAINT "workspace_memberships_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships"
    ADD CONSTRAINT "workspace_memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_repositories"
    ADD CONSTRAINT "workspace_repositories_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_repositories"
    ADD CONSTRAINT "workspace_repositories_repository_id_fkey"
    FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_repositories"
    ADD CONSTRAINT "workspace_repositories_assigned_by_id_fkey"
    FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "enforce_workspace_membership_manager"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_workspace_id TEXT;
BEGIN
    affected_workspace_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;

    PERFORM 1 FROM "workspaces" WHERE "id" = affected_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM "workspace_memberships"
        WHERE "workspace_id" = affected_workspace_id AND "role" = 'MANAGER'
    ) THEN
        RAISE EXCEPTION 'workspace must retain at least one manager'
            USING ERRCODE = '23514', CONSTRAINT = 'workspace_requires_manager';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE CONSTRAINT TRIGGER "workspace_membership_requires_manager"
AFTER INSERT OR UPDATE OF "workspace_id", "role" OR DELETE
ON "workspace_memberships"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "enforce_workspace_membership_manager"();

CREATE FUNCTION "enforce_workspace_initial_manager"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "workspace_memberships"
        WHERE "workspace_id" = NEW.id AND "role" = 'MANAGER'
    ) THEN
        RAISE EXCEPTION 'workspace must have an initial manager'
            USING ERRCODE = '23514', CONSTRAINT = 'workspace_requires_manager';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "workspace_insert_requires_manager"
AFTER INSERT ON "workspaces"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_workspace_initial_manager"();
