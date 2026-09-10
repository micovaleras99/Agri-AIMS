-- Remove the unused OCR column from documents.
--
-- documents.ocr_extracted was added for a document-OCR feature that was never
-- built: no model, route or view ever read or wrote it, every row holds the
-- default 0, and no index or constraint references it. Dropping it keeps the
-- schema honest.
ALTER TABLE documents DROP COLUMN ocr_extracted;
