-- LSA-15 / LSA-16 — Provision of Assistance (PDF p.26-29).

-- p.26: whether an LSA receives financial + technical assistance, or technical only.
ALTER TABLE applicants
  ADD COLUMN assistance_type VARCHAR(32) NOT NULL DEFAULT '' AFTER category;

-- p.27: a financial assistance request, capped at PhP 150,000 for facility
-- enhancement or PhP 100,000 for calamity, released in cash, in kind or both.
CREATE TABLE IF NOT EXISTS assistance_records (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  farm_id            INT UNSIGNED NOT NULL,
  applicant_id       INT UNSIGNED NULL,
  reference_no       VARCHAR(32)  NOT NULL,
  kind               VARCHAR(16)  NOT NULL COMMENT 'facility | calamity',
  amount_requested   DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_approved    DECIMAL(12,2) NULL,
  release_form       VARCHAR(16)  NOT NULL DEFAULT 'cash' COMMENT 'cash | in_kind | combination',
  status             VARCHAR(20)  NOT NULL DEFAULT 'submitted',

  -- Calamity requests only (p.28-29).
  disaster_name      VARCHAR(160) NULL,
  disaster_date      DATE         NULL,

  requested_by       VARCHAR(120) NULL,
  requested_at       DATE         NOT NULL,
  reviewed_by        VARCHAR(120) NULL,
  reviewed_at        DATE         NULL,
  inspected_by       VARCHAR(120) NULL,
  inspected_at       DATE         NULL,
  moa_signed_at      DATE         NULL COMMENT 'supplemental MOA on approval (p.29)',
  remarks            TEXT         NULL,

  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_assistance_reference (reference_no),
  KEY idx_assistance_farm (farm_id),
  CONSTRAINT fk_assistance_farm FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- p.27: "Detailed breakdown of expenditure items ... must be attached."
CREATE TABLE IF NOT EXISTS assistance_items (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assistance_id INT UNSIGNED NOT NULL,
  description   VARCHAR(255) NOT NULL,
  quantity      DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_cost     DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  KEY idx_assistance_items (assistance_id),
  CONSTRAINT fk_assistance_items FOREIGN KEY (assistance_id)
    REFERENCES assistance_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- p.27: "The LSA shall submit a quarterly LSA Project Completion Report as
-- required by the COA."
CREATE TABLE IF NOT EXISTS assistance_completion_reports (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assistance_id   INT UNSIGNED NOT NULL,
  period          VARCHAR(40)  NOT NULL COMMENT 'e.g. Q1 2026',
  amount_utilized DECIMAL(12,2) NOT NULL DEFAULT 0,
  narrative       TEXT         NULL,
  submitted_by    VARCHAR(120) NULL,
  submitted_at    DATE         NOT NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_completion_period (assistance_id, period),
  CONSTRAINT fk_completion_assistance FOREIGN KEY (assistance_id)
    REFERENCES assistance_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
