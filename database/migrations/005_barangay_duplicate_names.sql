-- ============================================================
-- 005_barangay_duplicate_names.sql
--
-- The PSGC contains municipalities with two barangays of the same name,
-- distinguished only by their code — six such pairs exist in Region V alone
-- (for example Balogo, Buenavista, Salvacion, San Isidro and San Juan all
-- appear twice in Pilar, Sorsogon). The original UNIQUE (municipality_id, name)
-- key silently rejected the second of each pair, so those barangays were
-- missing from the address selectors.
--
-- Replaced with a plain index for lookups. Uniqueness of official rows is
-- already enforced by uq_barangays_psgc on psgc_code.
--
--   npm run migrate:sql -- database/migrations/005_barangay_duplicate_names.sql
--
-- After running this, reload the reference data so the missing barangays appear:
--   npm run seed:locations -- --strict
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE `barangays`
  DROP INDEX `uq_barangays_municipality_name`,
  ADD KEY `idx_barangays_municipality_name` (`municipality_id`, `name`);
