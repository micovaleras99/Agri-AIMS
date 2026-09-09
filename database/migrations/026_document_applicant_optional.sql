-- Evidence attached to an assistance request need not belong to an applicant.
--
-- Migration 025 assumed "an assistance record carries the farm's applicant_id,
-- so an evidence row always has one". That is wrong: a farm may exist with no
-- applicant linked to it — the seeded Reyes Integrated Farm is one — and the
-- first evidence upload against such a farm failed with
-- "Column 'applicant_id' cannot be null".
--
-- An accreditation document always belongs to an applicant. An assistance
-- evidence document belongs to the REQUEST, and the request belongs to a farm.
-- The column becomes optional so both can live in the same table; every
-- accreditation path still sets it.

ALTER TABLE `documents`
  MODIFY COLUMN `applicant_id` INT UNSIGNED NULL;
