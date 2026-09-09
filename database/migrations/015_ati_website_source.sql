-- RSC-03 — allow the ATI Bicol website as an article source.
--
-- `elearning_articles.source` is an ENUM listing only the Moodle and manual
-- drivers. Inserting 'ati_website' did not fail: MySQL is running in a
-- non-strict mode here, so it silently coerced every row to the empty string.
-- Dedupe still worked by accident, because external_id differs per article, but
-- the rows were unattributable and the enum constraint was being violated.
--
-- Widening the enum is the fix. Existing rows written as '' while the value was
-- rejected are re-attributed by their URL.

ALTER TABLE elearning_articles
  MODIFY COLUMN source ENUM('moodle_course','moodle_announcement','manual','ati_website')
  NOT NULL DEFAULT 'manual';

UPDATE elearning_articles
   SET source = 'ati_website'
 WHERE source = ''
   AND url LIKE '%ati2.da.gov.ph%';
