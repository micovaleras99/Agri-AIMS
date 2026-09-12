-- Development Plan content authored by the applicant, for the LSA Development
-- Plan form. One plan per application. The plan is a small structured document
-- (implementation date, budget summary, rationale, objectives, and two
-- repeatable tables — work plan and budget), so it is stored as JSON text and
-- injected into the official DOCX at generation time.
CREATE TABLE IF NOT EXISTS development_plans (
  applicant_id  INT UNSIGNED NOT NULL,
  data          LONGTEXT      NOT NULL,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (applicant_id),
  CONSTRAINT fk_devplan_applicant FOREIGN KEY (applicant_id)
    REFERENCES applicants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
