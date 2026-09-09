-- ============================================================
-- 003_location_hierarchy.sql
-- Adds a structured Region → Province → Municipality/City → Barangay
-- hierarchy and links applicants, farms and users to a barangay.
--
-- Run on an existing database:
--   mysql -u root -p agri_aims < database/migrations/003_location_hierarchy.sql
-- Then load the reference data:
--   npm run seed:locations
--
-- Re-running is safe for the tables (IF NOT EXISTS). The ALTER statements at the
-- bottom will report "Duplicate column name" on a second run — that error means
-- the column is already there and can be ignored.
--
-- psgc_code holds the Philippine Standard Geographic Code where it is known.
-- It is nullable so the hierarchy can be seeded from existing records before the
-- official PSA list is imported; see scripts/seed-locations.js.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `regions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `psgc_code` VARCHAR(12) NULL,
  `name` VARCHAR(120) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_regions_name` (`name`),
  UNIQUE KEY `uq_regions_psgc` (`psgc_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `provinces` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `psgc_code` VARCHAR(12) NULL,
  `region_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provinces_region_name` (`region_id`, `name`),
  UNIQUE KEY `uq_provinces_psgc` (`psgc_code`),
  CONSTRAINT `fk_provinces_region` FOREIGN KEY (`region_id`) REFERENCES `regions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `municipalities` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `psgc_code` VARCHAR(12) NULL,
  `province_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `type` ENUM('municipality','city') NOT NULL DEFAULT 'municipality',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_municipalities_province_name` (`province_id`, `name`),
  UNIQUE KEY `uq_municipalities_psgc` (`psgc_code`),
  CONSTRAINT `fk_municipalities_province` FOREIGN KEY (`province_id`) REFERENCES `provinces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `barangays` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `psgc_code` VARCHAR(12) NULL,
  `municipality_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_barangays_municipality_name` (`municipality_id`, `name`),
  UNIQUE KEY `uq_barangays_psgc` (`psgc_code`),
  KEY `idx_barangays_name` (`name`),
  CONSTRAINT `fk_barangays_municipality` FOREIGN KEY (`municipality_id`) REFERENCES `municipalities` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Link the existing records to a barangay ───────────────────────
-- The legacy region / province / municipality / address text columns are kept so
-- nothing breaks while records are migrated; barangay_id is the new source of truth.

ALTER TABLE `applicants`
  ADD COLUMN `barangay_id` INT UNSIGNED NULL AFTER `municipality`,
  ADD KEY `idx_applicants_barangay` (`barangay_id`),
  ADD CONSTRAINT `fk_applicants_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `farms`
  ADD COLUMN `barangay_id` INT UNSIGNED NULL AFTER `municipality`,
  ADD KEY `idx_farms_barangay` (`barangay_id`),
  ADD CONSTRAINT `fk_farms_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `users`
  ADD COLUMN `barangay_id` INT UNSIGNED NULL AFTER `region`,
  ADD KEY `idx_users_barangay` (`barangay_id`),
  ADD CONSTRAINT `fk_users_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
