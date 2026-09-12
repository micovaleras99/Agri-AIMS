-- Audit trail of document submissions and validation decisions.
--
-- The `documents` table holds only the CURRENT copy of each requirement — a
-- re-upload replaces the previous row and file, so the record of earlier
-- attempts and why they were rejected was lost. This table keeps one immutable
-- row per event (submitted / accepted / rejected) so the Document Validation
-- history modal can show every attempt with its date, time, status and reason.
CREATE TABLE IF NOT EXISTS document_reviews (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  applicant_id   INT UNSIGNED DEFAULT NULL,
  application_id VARCHAR(32)  NOT NULL DEFAULT '',
  doc_type       VARCHAR(80)  NOT NULL DEFAULT '',
  doc_name       VARCHAR(255) NOT NULL DEFAULT '',
  filename       VARCHAR(255) NOT NULL DEFAULT '',
  action         ENUM('submitted','accepted','rejected') NOT NULL,
  remarks        TEXT         DEFAULT NULL,
  actor          VARCHAR(255) NOT NULL DEFAULT '',
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_docrev_applicant_type (applicant_id, doc_type),
  KEY idx_docrev_applicant (applicant_id),
  CONSTRAINT fk_docrev_applicant FOREIGN KEY (applicant_id)
    REFERENCES applicants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
