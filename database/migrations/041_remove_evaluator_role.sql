-- ============================================================
-- 041_remove_evaluator_role.sql
-- Remove the defunct 'evaluator' role.
--
-- Migration 028 already merged Evaluator into Admin (one role does document
-- evaluation, field validation and Steps 4-7) but left 'evaluator' in the ENUM.
-- Nothing uses it any more, so drop it. Any lingering evaluator account is
-- reassigned to admin first so the ALTER cannot fail on an in-use value.
--
-- Run: npm run migrate:sql -- database/migrations/041_remove_evaluator_role.sql
-- ============================================================

UPDATE `users` SET `role` = 'admin' WHERE `role` = 'evaluator';

ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('admin','operator','applicant') NOT NULL DEFAULT 'applicant';
