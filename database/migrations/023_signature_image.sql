-- A drawn signature on the Step 1 briefer.
--
-- Step 1 captured a TYPED name (`step1_acknowledged_by`) and called it the
-- signature. That is an acknowledgement, not a signature: anyone with the
-- account can type the name, and the generated ATI-QF-PAD-162 briefer had no
-- mark on it that came from the applicant's own hand.
--
-- The image itself is written to `uploads/` under a random hex name, the same
-- scheme multer uses for a real upload, and only the filename is stored here.
-- Keeping the bytes out of the row means the applicants table stays small and
-- the file is served and deleted by the same helpers as every other upload.
--
-- The typed name is deliberately kept: it prints under the drawn mark, the way
-- "signature over printed name" works on the paper form, and it remains the
-- accessible path for anyone who cannot draw with a pointer.

ALTER TABLE `applicants`
  ADD COLUMN `step1_signature_file` VARCHAR(255) NULL AFTER `step1_acknowledged_by`;
