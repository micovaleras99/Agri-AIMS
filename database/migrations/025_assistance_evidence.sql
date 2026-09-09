-- Somewhere to put the calamity evidence the guidelines require.
--
-- PDF p.28 lists three things a calamity request must be supported by, and the
-- request form printed all three in a warning box. Nothing in the system could
-- receive them: no file input on any assistance page, and no column in
-- assistance_records, assistance_items or assistance_completion_reports
-- pointing at a document. The rule was stated and could not be satisfied.
--
-- Rather than a second store, this hangs the evidence off the `documents` table
-- that already exists. That table has the upload path, the random-hex file
-- naming, the authorised download route, and the accept/reject-with-remarks
-- review an evaluator already uses at Step 4 — so evidence is reviewed exactly
-- the way every other document is, by the same people, with the same audit
-- trail. A parallel table would have duplicated all of it.
--
-- applicant_id stays NOT NULL: an assistance record carries the farm's
-- applicant_id, so an evidence row always has one.

ALTER TABLE `documents`
  ADD COLUMN `assistance_id` INT UNSIGNED NULL AFTER `applicant_id`;

ALTER TABLE `documents`
  ADD CONSTRAINT `fk_documents_assistance` FOREIGN KEY (`assistance_id`)
  REFERENCES `assistance_records` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX `idx_documents_assistance` ON `documents` (`assistance_id`);
