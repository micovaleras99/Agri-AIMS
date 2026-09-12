-- Farm/Agri-Enterprise Profile (ATI-QF-PAD-48) content authored by the applicant.
-- The identity fields already live on `applicants`; everything else the form asks
-- for (owner type, sex, organization block, membership/trainings/topics/enterprise
-- /machinery tables, farm operation details and facility checkboxes) is stored
-- here as JSON and injected into the official DOCX at generation time.
CREATE TABLE IF NOT EXISTS farm_profiles (
  applicant_id  INT UNSIGNED NOT NULL,
  data          LONGTEXT      NOT NULL,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (applicant_id),
  CONSTRAINT fk_farmprofile_applicant FOREIGN KEY (applicant_id)
    REFERENCES applicants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
