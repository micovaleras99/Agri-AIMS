-- RSC (directory): two-way direct messaging between users.
--
-- One row per message. A conversation is the pair of users, identified by
-- pair_key = "<lowerId>-<higherId>" so both directions share one thread and the
-- thread can be read with a single indexed lookup — no separate conversations
-- table to keep in step. read_at is NULL until the recipient opens the thread,
-- which is all the unread badge needs.
CREATE TABLE IF NOT EXISTS `direct_messages` (
  `id`           INT AUTO_INCREMENT PRIMARY KEY,
  `pair_key`     VARCHAR(32) NOT NULL,
  `sender_id`    INT NOT NULL,
  `recipient_id` INT NOT NULL,
  `body`         TEXT NOT NULL,
  `read_at`      DATETIME NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_dm_pair` (`pair_key`, `id`),
  INDEX `idx_dm_unread` (`recipient_id`, `read_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
