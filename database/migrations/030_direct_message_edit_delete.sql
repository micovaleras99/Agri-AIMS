-- Edit/delete parity for direct messages (matching Community Chat).
--
-- edited_at / deleted_at mirror chat_messages: a deleted message becomes a
-- tombstone rather than vanishing, and an edited one is marked. updated_at is
-- bumped on an edit or delete (never on a plain read), so the other party's poll
-- can pick the change up behind the newest id — the same "what changed?" half of
-- the poll the community channels use.
ALTER TABLE `direct_messages`
  ADD COLUMN `edited_at`  DATETIME NULL AFTER `read_at`,
  ADD COLUMN `deleted_at` DATETIME NULL AFTER `edited_at`,
  ADD COLUMN `updated_at` DATETIME NULL AFTER `deleted_at`;

CREATE INDEX `idx_dm_changed` ON `direct_messages` (`pair_key`, `updated_at`);
