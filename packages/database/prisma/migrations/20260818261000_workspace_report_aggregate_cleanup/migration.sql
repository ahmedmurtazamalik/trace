-- Permit only aggregate-root workspace cleanup while preserving standalone report deletion protection.
ALTER TABLE "workspace_report_occurrences"
  DROP CONSTRAINT "workspace_report_occurrences_report_id_fkey";
ALTER TABLE "workspace_report_occurrences"
  ADD CONSTRAINT "workspace_report_occurrences_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "reports"
  DROP CONSTRAINT "reports_workspace_id_fkey";
ALTER TABLE "reports"
  ADD CONSTRAINT "reports_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
