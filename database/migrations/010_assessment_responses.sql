-- LSA-09 and LSA-03 — keep the per-item answers, not just the total.
--
-- Step 2 asked 21 questions and stored one percentage. Step 5 asked 12 and
-- stored one count. The guidelines require the basic facilities (Technology
-- Demonstration Area, holding area, wash area, toilet — PDF p.11) to be
-- established per farm, and the TWG field validation (PDF p.17) to produce a
-- report of what was actually inspected. Neither was answerable from the data.
--
-- One row per answered item. `label` is a snapshot of the question as it was
-- asked, so a report from 2026 still reads correctly if the wording changes in
-- 2027. Re-submitting a step overwrites its rows via the unique key.

CREATE TABLE IF NOT EXISTS assessment_responses (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Must match applicants.id exactly (int(10) unsigned) or InnoDB refuses the
  -- foreign key with errno 150.
  applicant_id  INT UNSIGNED NOT NULL,
  step          TINYINT      NOT NULL COMMENT '2 = self-assessment, 5 = TWG field validation',
  item_code     VARCHAR(16)  NOT NULL COMMENT 'f1..f7, o1..o9, d1..d5, vc1..vc12',
  category      VARCHAR(64)  NOT NULL DEFAULT '',
  label         VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'the question as it was asked',
  facility      VARCHAR(32)  NULL COMMENT 'tda, holding_area, wash_area, toilet — PDF p.11',
  answer        TINYINT(1)   NOT NULL DEFAULT 0,
  recorded_by   VARCHAR(120) NOT NULL DEFAULT '',
  recorded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_assessment_item (applicant_id, step, item_code),
  KEY idx_assessment_applicant (applicant_id),
  KEY idx_assessment_facility (facility),

  CONSTRAINT fk_assessment_applicant
    FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
