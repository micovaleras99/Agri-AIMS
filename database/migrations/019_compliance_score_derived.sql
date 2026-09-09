-- RSC-05 — make farms.compliance_score mean something.
--
-- The column was loaded from data/farms.json and never computed again, so the
-- Farms list and each farm's page showed confident figures — 95%, 88%, 72% —
-- for farms against which not a single compliance check had ever been
-- recorded. The operator dashboard was rebuilt to read real checks and showed
-- 0% for the same farms at the same moment. Two screens, two numbers, and the
-- reassuring one was the invented one.
--
-- From here the column is derived: recomputed from compliance_checks whenever
-- a check is recorded, and never written by hand.
--
-- NULL is added as a distinct state and is not the same as zero. A farm nobody
-- has assessed yet is "Not yet assessed"; 0% means it was assessed and met
-- nothing. Collapsing those two into one number is how the original problem
-- looked convincing in the first place.

ALTER TABLE farms
  MODIFY COLUMN compliance_score TINYINT UNSIGNED NULL DEFAULT NULL;

-- Clear the seeded figures. Anything with a real check behind it is restored
-- immediately afterwards by the recompute in the same migration run.
UPDATE farms SET compliance_score = NULL;

-- Recompute from recorded checks: the latest check per requirement, scored the
-- way models/complianceModel.scoreFor does it — compliant counts one, partial
-- counts a half, not_applicable is excluded from the denominator.
UPDATE farms f
  JOIN (
    SELECT latest.farm_id,
           ROUND(
             SUM(CASE latest.status WHEN 'compliant' THEN 1
                                    WHEN 'partial'   THEN 0.5
                                    ELSE 0 END)
             / COUNT(*) * 100
           ) AS score
      FROM (
        SELECT c.farm_id, c.requirement_id, c.status
          FROM compliance_checks c
          JOIN (
            SELECT farm_id, requirement_id, MAX(id) AS id
              FROM compliance_checks
             WHERE farm_id IS NOT NULL
             GROUP BY farm_id, requirement_id
          ) newest ON newest.id = c.id
         WHERE c.status <> 'not_applicable'
      ) latest
     GROUP BY latest.farm_id
  ) s ON s.farm_id = f.id
   SET f.compliance_score = s.score;
