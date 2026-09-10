-- direct_messages was created (029) with sender_id / recipient_id as plain
-- indexed columns, no foreign keys — so it had no referential integrity and
-- showed up disconnected in the ERD, unlike its sibling chat_messages. Both
-- columns are NOT NULL, so a deleted user's messages cascade rather than being
-- nulled. Safe to apply: the table is empty and no row references a missing user.
--
-- The columns were created as signed int(11); users.id is int(10) unsigned, and a
-- foreign key needs the exact same type, so they are aligned first.
ALTER TABLE direct_messages
  MODIFY sender_id    int(10) unsigned NOT NULL,
  MODIFY recipient_id int(10) unsigned NOT NULL;

ALTER TABLE direct_messages
  ADD CONSTRAINT fk_dm_sender    FOREIGN KEY (sender_id)    REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT fk_dm_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
