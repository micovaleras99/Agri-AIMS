-- Remove the dormant Provision-of-Assistance feature.
--
-- The three assistance tables were empty (no route, model, or UI ever wrote to
-- them — the feature was removed) and the documents.assistance_id column only
-- existed to link evidence to them. Zero documents referenced it. Dropping all
-- four leaves the schema and the ERD clean.

-- The documents FK must go before its column.
ALTER TABLE documents DROP FOREIGN KEY fk_documents_assistance;
ALTER TABLE documents DROP COLUMN assistance_id;

-- Children (they FK into assistance_records) before the parent.
DROP TABLE IF EXISTS assistance_completion_reports;
DROP TABLE IF EXISTS assistance_items;
DROP TABLE IF EXISTS assistance_records;
