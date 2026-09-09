-- Profile pictures.
--
-- `avatar` holds two initials and is what every screen has drawn until now. It
-- stays: it is the fallback for the accounts that never upload anything, and
-- ATI registers farmers who have no photo to give.
--
-- `photo` holds only the stored filename — the 32 hex characters that
-- config/upload.js generates, plus the extension. The name the file arrived
-- with never reaches the disk or this column, so a crafted name cannot escape
-- the uploads directory. NULL means "no picture, draw the initials".

ALTER TABLE users
  ADD COLUMN `photo` VARCHAR(64) NULL DEFAULT NULL AFTER `avatar`;
