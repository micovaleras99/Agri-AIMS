-- Personal details for the Farm/Agri-Enterprise Profile (ATI-QF-PAD-48).
--
-- The profile form asks for the applicant's date of birth, civil status, ethnic
-- origin/tribe, educational attainment and home address. None had a column, so
-- the generated form left them blank. They are captured on the applicant's
-- Profile page and filled into the DOCX.
ALTER TABLE applicants
  ADD COLUMN date_of_birth           DATE         DEFAULT NULL AFTER farm_established_date,
  ADD COLUMN civil_status            VARCHAR(40)  NOT NULL DEFAULT '' AFTER date_of_birth,
  ADD COLUMN ethnic_origin           VARCHAR(120) NOT NULL DEFAULT '' AFTER civil_status,
  ADD COLUMN educational_attainment  VARCHAR(120) NOT NULL DEFAULT '' AFTER ethnic_origin,
  ADD COLUMN home_address            VARCHAR(500) NOT NULL DEFAULT '' AFTER educational_attainment;
