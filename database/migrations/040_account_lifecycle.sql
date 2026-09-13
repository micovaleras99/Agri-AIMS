-- ============================================================
-- 040_account_lifecycle.sql
-- User-account lifecycle: soft-delete/deactivation, a strict
-- one-active-account-per-applicant rule, and an account audit trail.
--
-- Nothing here touches applicant/accreditation data. The applicant record
-- is already independent of the user account (users.application_id -> applicants
-- ON DELETE SET NULL; applicants has no FK back to users), so deactivating or
-- even deleting a user never removes an applicant, application, document,
-- assessment, development plan, or monitoring record. This migration only makes
-- the account itself a first-class, reversible thing.
--
-- Run: npm run migrate:sql -- database/migrations/040_account_lifecycle.sql
-- Idempotent: re-running is safe (scripts/run-migration.js skips "already applied").
-- ============================================================

-- ---------- users: account status + soft-delete stamp ----------
-- is_active already exists (a 0/1 flag). status is the richer lifecycle the
-- admin UI shows; is_active stays in lock-step so old queries keep working.
ALTER TABLE `users`
  ADD COLUMN `status` ENUM('active','inactive','suspended','archived')
    NOT NULL DEFAULT 'active' AFTER `is_active`,
  ADD COLUMN `deleted_at` DATETIME NULL DEFAULT NULL AFTER `updated_at`;

-- Existing rows: an account that was flagged inactive becomes 'inactive',
-- everything else 'active'. Run once; harmless to repeat.
UPDATE `users` SET `status` = IF(`is_active` = 1, 'active', 'inactive');

CREATE INDEX `idx_users_status` ON `users` (`status`);

-- One ACTIVE account per applicant, enforced by the database (req. 11).
-- A virtual column that is the application_id only while the account is active
-- (NULL otherwise); a UNIQUE key over it therefore allows any number of
-- inactive/archived accounts to share an application_id — that is the account
-- re-linking case in req. 6 — but never two active ones. Staff accounts have a
-- NULL application_id, so they are excluded automatically.
ALTER TABLE `users`
  ADD COLUMN `active_application_key` VARCHAR(32)
    GENERATED ALWAYS AS (IF(`status` = 'active', `application_id`, NULL)) VIRTUAL,
  ADD UNIQUE KEY `uq_users_active_application` (`active_application_key`);

-- ---------- account_audit: who did what to an account, and when ----------
-- application_id is copied in alongside user_id so the trail survives even a
-- permanent user deletion; the FK is SET NULL, never CASCADE, for the same
-- reason. No passwords or other secrets are stored (req. 13).
CREATE TABLE IF NOT EXISTS `account_audit` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `application_id` VARCHAR(32) NOT NULL DEFAULT '',
  `action` ENUM(
    'account_created','applicant_created',
    'deactivated','reactivated','relinked',
    'suspended','archived','deleted'
  ) NOT NULL,
  `actor_id` INT UNSIGNED DEFAULT NULL,
  `actor_name` VARCHAR(255) NOT NULL DEFAULT '',
  `detail` VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_account_audit_user` (`user_id`),
  KEY `idx_account_audit_application` (`application_id`),
  CONSTRAINT `fk_account_audit_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
