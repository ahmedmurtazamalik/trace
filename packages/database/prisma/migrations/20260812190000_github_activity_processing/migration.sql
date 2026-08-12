ALTER TABLE "commits"
ADD COLUMN "author_name" TEXT,
ADD COLUMN "author_email" TEXT,
ADD COLUMN "author_username" TEXT,
ADD COLUMN "committer_name" TEXT,
ADD COLUMN "committer_email" TEXT,
ADD COLUMN "committer_username" TEXT;

UPDATE "commits"
SET
  "author_name" = '[legacy unavailable]',
  "author_email" = '[legacy unavailable]',
  "committer_name" = '[legacy unavailable]',
  "committer_email" = '[legacy unavailable]';

ALTER TABLE "commits"
ALTER COLUMN "author_name" SET NOT NULL,
ALTER COLUMN "author_email" SET NOT NULL,
ALTER COLUMN "committer_name" SET NOT NULL,
ALTER COLUMN "committer_email" SET NOT NULL;

ALTER TABLE "activity_events"
ADD COLUMN "source_key" TEXT;

UPDATE "activity_events"
SET "source_key" = 'legacy:' || "id";

ALTER TABLE "activity_events"
ALTER COLUMN "source_key" SET NOT NULL;

CREATE UNIQUE INDEX "activity_events_source_key_key"
ON "activity_events"("source_key");