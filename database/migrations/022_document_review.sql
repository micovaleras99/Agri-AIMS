-- Per-document accept / reject with remarks.
--
-- `documents.status` and `documents.remarks` have existed since the first
-- schema and are read everywhere: the dashboard counts verified documents, the
-- documents page filters on the status and prints the remarks, and Step 6
-- builds the endorsement packet from `status = 'verified'` rows. Nothing ever
-- wrote them. A grep for "UPDATE documents" across the whole project returned
-- nothing, so every upload stayed 'pending_review' for good and the only
-- verified rows in the database were the seeded ones.
--
-- Step 4 recorded one verdict for the whole application, on the applicant row.
-- An evaluator who found one unreadable page out of twelve documents could only
-- return the entire application with a single free-text note that did not say
-- which document was at fault.
--
-- These two columns are what the decision was missing: an accreditation record
-- has to say who accepted or rejected a document and when, the same way
-- `renewal_applications` records `reviewed_by` / `reviewed_at`.

ALTER TABLE `documents`
  ADD COLUMN `reviewed_by` INT UNSIGNED NULL AFTER `remarks`,
  ADD COLUMN `reviewed_at` TIMESTAMP NULL DEFAULT NULL AFTER `reviewed_by`;

ALTER TABLE `documents`
  ADD CONSTRAINT `fk_documents_reviewer` FOREIGN KEY (`reviewed_by`)
  REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
