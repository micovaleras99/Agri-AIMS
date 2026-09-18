-- ============================================================
-- 042_otp.sql
-- Email OTP verification for registration and password reset.
--
-- - users.email_verified: a self-registered account is inactive for login until
--   its email is verified by OTP. Every EXISTING account is backfilled to 1
--   (they are already trusted and active) so nobody is locked out by this change.
-- - otp_codes: one row per issued code. The code itself is stored only as a
--   bcrypt hash; purpose keeps registration and password-reset codes separate so
--   a code from one flow can never satisfy the other.
--
-- Run: npm run migrate:sql -- database/migrations/042_otp.sql
-- ============================================================

ALTER TABLE `users`
  ADD COLUMN `email_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`;

-- Existing accounts predate email verification and are already active — trust
-- them so this migration cannot lock anyone out. New rows default to 0.
UPDATE `users` SET `email_verified` = 1;

CREATE TABLE IF NOT EXISTS `otp_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `otp_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('registration','password_reset') NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `verified_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_otp_lookup` (`email`,`purpose`,`id`),
  KEY `idx_otp_expires` (`expires_at`),
  CONSTRAINT `fk_otp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
