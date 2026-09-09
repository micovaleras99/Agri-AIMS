-- Community chat: edit and delete a message, and admin-created channels.
--
-- Deleting is a soft delete. Two reasons: this is a government accreditation
-- system where an audit trail matters more than reclaiming a row, and the chat
-- polls with `?afterId=N`, which can only ever tell a client about *new*
-- messages. A hard DELETE would simply vanish from the sender's screen and stay
-- on everyone else's until they reloaded the page.
--
-- `updated_at` is what makes edits and deletions reach other people at all: the
-- poll asks "anything changed since <time>?" alongside "anything after <id>?".
-- MariaDB maintains it on its own, so no application code can forget to.

ALTER TABLE chat_messages
  ADD COLUMN edited_at  DATETIME NULL DEFAULT NULL AFTER created_at,
  ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL AFTER edited_at,
  ADD COLUMN updated_at TIMESTAMP NOT NULL
             DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER deleted_at;

-- The change feed reads "this channel, changed since X", so it wants both.
ALTER TABLE chat_messages
  ADD INDEX idx_chat_messages_channel_updated (channel_id, updated_at);

-- Who added a channel, for the same audit reason. NULL means it came from the
-- seed rather than from a person.
ALTER TABLE chat_channels
  ADD COLUMN created_by INT UNSIGNED NULL DEFAULT NULL;
