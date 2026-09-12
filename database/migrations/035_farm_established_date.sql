-- Farm/enterprise establishment date, shown on the Self-Assessment form.
--
-- The official ATI-QF/PAD-164 form has a "Date Established" field that no system
-- column held, so the generated form left it blank. This adds it to applicants;
-- it is captured on the Self-Assessment step and filled into the DOCX.
ALTER TABLE applicants
  ADD COLUMN farm_established_date DATE DEFAULT NULL AFTER farm_address;
