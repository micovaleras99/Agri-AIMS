-- LSA-13 / LSA-14 — the LSA I to LSA II up-scaling path (PDF p.16, p.21-23).
--
-- One row per up-scaling application. The five steps come from the "Procedure
-- in Certifying the LSA II" and mirror how the LSA I flow already records its
-- own steps, so staff see the same shape twice.
--
-- The two criteria ATI must judge (competence enhanced, value chain coverage)
-- are stored as nullable booleans: NULL means "not yet assessed", which is
-- deliberately different from "assessed and failed".

CREATE TABLE IF NOT EXISTS lsa2_applications (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  applicant_id         INT UNSIGNED NOT NULL,
  farm_id              INT UNSIGNED NOT NULL,
  reference_no         VARCHAR(32)  NOT NULL,
  step                 TINYINT      NOT NULL DEFAULT 1,
  status               VARCHAR(40)  NOT NULL DEFAULT 'draft',

  competence_enhanced  TINYINT(1)   NULL COMMENT 'PDF p.16 — assessed by ATI',
  value_chain_covered  TINYINT(1)   NULL COMMENT 'PDF p.16 — assessed by ATI',
  eligibility_remarks  TEXT         NULL,
  assessed_by          VARCHAR(120) NULL,
  assessed_at          DATE         NULL,

  submitted_at         DATE         NULL,
  evaluated_at         DATE         NULL,
  evaluated_by         VARCHAR(120) NULL,
  validated_at         DATE         NULL,
  validated_by         VARCHAR(120) NULL,
  endorsed_at          DATE         NULL,
  endorsed_by          VARCHAR(120) NULL,
  certificate_no       VARCHAR(64)  NULL,
  certified_at         DATE         NULL,
  moa_signed_at        DATE         NULL,
  remarks              TEXT         NULL,

  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_lsa2_reference (reference_no),
  -- One live up-scaling application per farm; history is kept by reference_no.
  UNIQUE KEY uq_lsa2_farm (farm_id),
  KEY idx_lsa2_applicant (applicant_id),

  CONSTRAINT fk_lsa2_applicant FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE,
  CONSTRAINT fk_lsa2_farm      FOREIGN KEY (farm_id)      REFERENCES farms(id)      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
