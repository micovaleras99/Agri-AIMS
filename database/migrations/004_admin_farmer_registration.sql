-- ============================================================
-- 004_admin_farmer_registration.sql
-- Supports RSC-02: an administrator registering a farmer directly, and the
-- RSBSA registration number the LSA Guidelines require of every farmer
-- applicant (Qualification Requirements — The Farmer/Farm Family).
--
--   mysql -u root -p agri_aims < database/migrations/004_admin_farmer_registration.sql
--
-- Re-running reports "Duplicate column name", which is safe to ignore.
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE `users`
  ADD COLUMN `created_by_admin` TINYINT(1) NOT NULL DEFAULT 0 AFTER `application_id`,
  ADD COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 1 AFTER `created_by_admin`,
  ADD KEY `idx_users_is_active` (`is_active`);

-- RSBSA (DA Registry System for Basic Sectors in Agriculture); coconut-based
-- farmers carry an NCFRS number from the PCA instead — both live in this column.
ALTER TABLE `applicants`
  ADD COLUMN `rsbsa_number` VARCHAR(60) NOT NULL DEFAULT '' AFTER `phone`,
  ADD KEY `idx_applicants_rsbsa` (`rsbsa_number`);
