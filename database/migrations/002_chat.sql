-- Run on existing databases: mysql -u root -p agri_aims < database/migrations/002_chat.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `chat_channels` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `slug` VARCHAR(80) NOT NULL,
  `description` VARCHAR(500) NOT NULL DEFAULT '',
  `channel_type` ENUM('public','regional','topic') NOT NULL DEFAULT 'public',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_chat_channels_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NULL,
  `sender_name` VARCHAR(160) NOT NULL DEFAULT '',
  `sender_avatar` VARCHAR(8) NOT NULL DEFAULT '',
  `body` VARCHAR(4000) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chat_messages_channel` (`channel_id`, `id`),
  CONSTRAINT `fk_chat_messages_channel` FOREIGN KEY (`channel_id`) REFERENCES `chat_channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_chat_messages_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `chat_channels` (`id`, `name`, `slug`, `description`, `channel_type`) VALUES
(1, '#general', 'general', 'General discussions', 'public'),
(2, '#region-v-bicol', 'region-v-bicol', 'Bicol Region LSA operators', 'regional'),
(3, '#organic-farming', 'organic-farming', 'Organic agriculture practices', 'topic'),
(4, '#technology-sharing', 'technology-sharing', 'Share agricultural technologies', 'topic'),
(5, '#market-linkages', 'market-linkages', 'Market opportunities and connections', 'topic');
