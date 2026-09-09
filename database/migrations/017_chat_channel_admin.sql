-- Administrators can rename and remove channels.
--
-- Removal is an archive, not a DELETE, for two reasons.
--
-- First, consistency: a deleted *message* keeps its row so the record of who
-- said what survives. Dropping a channel would take every message in it with
-- them, which is a far bigger erasure than deleting one message and is the last
-- thing an accreditation system should do quietly.
--
-- Second, it would not even work. chatChannelModel.ensureSeed() re-inserts the
-- five default channels on every listing, so a hard-deleted #general would
-- reappear on the next page load and the administrator would have no idea why.
-- An archived row is still present, so the INSERT IGNORE keeps ignoring it.
--
-- Renaming deliberately leaves `slug` alone. The slug is the address: the API
-- routes on it, ATI_CHANNEL_SLUG and ELEARNING_CHANNEL_SLUG point the article
-- sync at it, and any tab already open is holding one. A display name is a
-- label and can change freely; an address cannot.

ALTER TABLE chat_channels
  ADD COLUMN archived_at DATETIME NULL DEFAULT NULL;

-- Listings filter on it, so give it an index rather than scanning.
ALTER TABLE chat_channels
  ADD INDEX idx_chat_channels_archived (archived_at);
