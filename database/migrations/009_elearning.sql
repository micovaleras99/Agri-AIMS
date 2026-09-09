-- ============================================================
-- 009_elearning.sql  (RSC-03 — monitoring the ATI e-Learning site)
--
--   npm run migrate:sql -- database/migrations/009_elearning.sql
--
-- One row per article seen. The unique key on (source, external_id) is what
-- stops the same item being posted to Community Chat twice.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `elearning_articles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source` ENUM('moodle_course','moodle_announcement','manual') NOT NULL DEFAULT 'manual',
  `external_id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(500) NOT NULL,
  `summary` TEXT NULL,
  `url` VARCHAR(1000) NOT NULL DEFAULT '',
  `published_at` DATETIME NULL,
  `fetched_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `posted_at` TIMESTAMP NULL DEFAULT NULL,
  `chat_channel_id` INT UNSIGNED NULL,
  `chat_message_id` BIGINT UNSIGNED NULL,
  `notified_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_elearning_source_external` (`source`, `external_id`),
  KEY `idx_elearning_published` (`published_at`),
  KEY `idx_elearning_posted` (`posted_at`),
  CONSTRAINT `fk_elearning_channel` FOREIGN KEY (`chat_channel_id`) REFERENCES `chat_channels` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_elearning_message` FOREIGN KEY (`chat_message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The channel the sync posts into.
INSERT IGNORE INTO `chat_channels` (`name`, `slug`, `description`, `channel_type`)
VALUES ('#e-learning', 'e-learning', 'New courses and announcements from the ATI e-Learning site', 'topic');
