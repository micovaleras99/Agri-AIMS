-- LSA-20 — record the applicant's disqualification declaration.
--
-- The briefer lists who may not become an LSA operator (public officials and
-- employees, their spouses, and their unmarried children under 18). Step 1
-- displayed that list and then accepted the acknowledgement without ever asking
-- the applicant to answer it, so nothing in the system could show whether the
-- question had been put to them.
--
-- NULL means "never asked" — which is the state of every application signed
-- before this column existed, and must not be mistaken for "declared eligible".

ALTER TABLE applicants
  ADD COLUMN not_disqualified TINYINT(1) NULL
    COMMENT 'LSA-20: applicant declared they fall under none of the disqualifying grounds. NULL = never asked.',
  ADD COLUMN disqualification_declared_at DATE NULL
    COMMENT 'When the declaration was made, alongside the briefer signature.';
