-- ============================================================
-- 008_compliance.sql  (RSC-05 — monitoring compliance with the LSA guidelines)
--
--   npm run migrate:sql -- database/migrations/008_compliance.sql
--   npm run seed:compliance
--
-- Every requirement carries source_reference naming the part of the LSA
-- Guidelines it comes from, so a finding can always be traced back to the
-- document rather than to somebody's opinion.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `compliance_requirements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` VARCHAR(1000) NOT NULL DEFAULT '',
  `source_reference` VARCHAR(255) NOT NULL DEFAULT '',
  `category` ENUM('facilities','operations','records_reporting','capability','assistance') NOT NULL DEFAULT 'operations',
  `applies_to` ENUM('all','farming','agri_processing') NOT NULL DEFAULT 'all',
  `frequency` ENUM('once','semestral','annual','five_year','ongoing') NOT NULL DEFAULT 'ongoing',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_compliance_requirement_code` (`code`),
  KEY `idx_compliance_requirement_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per check performed. History is kept: the latest row per
-- (requirement, farm) is the current status, earlier rows are the audit trail.
CREATE TABLE IF NOT EXISTS `compliance_checks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requirement_id` INT UNSIGNED NOT NULL,
  `farm_id` INT UNSIGNED NULL,
  `applicant_id` INT UNSIGNED NULL,
  `status` ENUM('compliant','partial','non_compliant','not_applicable','pending') NOT NULL DEFAULT 'pending',
  `checked_at` DATE NOT NULL,
  `checked_by` INT UNSIGNED NULL,
  `evidence_document_id` INT UNSIGNED NULL,
  `remarks` VARCHAR(1000) NOT NULL DEFAULT '',
  `corrective_action` VARCHAR(1000) NOT NULL DEFAULT '',
  `next_check_date` DATE NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_checks_farm` (`farm_id`, `requirement_id`, `id`),
  KEY `idx_checks_applicant` (`applicant_id`),
  KEY `idx_checks_status` (`status`),
  KEY `idx_checks_next` (`next_check_date`),
  CONSTRAINT `fk_checks_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `compliance_requirements` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_checks_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_checks_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_checks_checker` FOREIGN KEY (`checked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_checks_evidence` FOREIGN KEY (`evidence_document_id`) REFERENCES `documents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
