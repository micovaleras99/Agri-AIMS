-- Real file uploads. `filename` already holds the name the farmer's file had;
-- the bytes now live on disk under uploads/ with a random name, kept here so a
-- user-supplied name can never influence the path we read from.
ALTER TABLE documents
  ADD COLUMN stored_name VARCHAR(120) NULL AFTER filename,
  ADD COLUMN mime_type   VARCHAR(100) NULL AFTER stored_name,
  ADD COLUMN size_bytes  INT UNSIGNED NULL AFTER mime_type;
