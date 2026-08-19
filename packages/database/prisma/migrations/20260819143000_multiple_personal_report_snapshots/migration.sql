-- Personal reports are immutable snapshots. A user may create another snapshot
-- for the same local report date after additional activity arrives.
DROP INDEX IF EXISTS "reports_personal_user_date_key";
