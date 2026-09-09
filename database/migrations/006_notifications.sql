-- ============================================================
-- 006_notifications.sql
-- Replaces the hardcoded notification list in the navbar with real records.
--
--   npm run migrate:sql -- database/migrations/006_notifications.sql
--
-- One row per recipient. Broadcasts fan out at write time, which keeps the
-- read state per person without a second table.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `type` VARCHAR(60) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` VARCHAR(1000) NOT NULL DEFAULT '',
  `link` VARCHAR(500) NOT NULL DEFAULT '',
  `icon` VARCHAR(60) NOT NULL DEFAULT 'bell',
  `read_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_unread` (`user_id`, `read_at`, `id`),
  KEY `idx_notifications_type` (`type`),
  CONSTRAINT `fk_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
