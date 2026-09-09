-- ============================================================
-- 027_report_review.sql — the semestral report can be decided, and filed once
--
--   npm run migrate:sql -- database/migrations/027_report_review.sql
--
-- Two defects in one table.
--
-- 1. Nothing could ever approve a report. reportModel.create wrote
--    status = 'pending' and no code anywhere wrote 'approved', while the
--    Reports page counted approved ones and models/lsa2Model counted them as an
--    LSA II up-scaling criterion — a criterion no farm could therefore meet.
--    Deciding a report needs somewhere to put the reason and the date, which is
--    what documents.remarks / reviewed_at already do for documentary
--    requirements.
--
-- 2. The same period could be filed any number of times. The dashboard calendar
--    shows the first and ignores the rest, but the farm's visitor and training
--    counters are re-derived by summing every row, so each duplicate inflated
--    them. The application now refuses a period already filed; this constraint
--    is what makes that true even if something bypasses the route.
-- ============================================================

ALTER TABLE reports
  ADD COLUMN remarks VARCHAR(1000) NOT NULL DEFAULT '' AFTER status,
  ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL AFTER reviewed_by;

-- One report per farm per reporting period.
ALTER TABLE reports
  ADD CONSTRAINT uq_report_farm_period UNIQUE (farm_id, period);
