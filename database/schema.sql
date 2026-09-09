-- ============================================================
-- Agri-AIMS — MySQL schema (relational, InnoDB, utf8mb4)
-- Run: mysql -u root -p < database/schema.sql
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `chat_messages`;
DROP TABLE IF EXISTS `chat_channels`;
DROP TABLE IF EXISTS `documents`;
DROP TABLE IF EXISTS `reports`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `farms`;
DROP TABLE IF EXISTS `applicants`;
DROP TABLE IF EXISTS `barangays`;
DROP TABLE IF EXISTS `municipalities`;
DROP TABLE IF EXISTS `provinces`;
DROP TABLE IF EXISTS `regions`;

SET FOREIGN_KEY_CHECKS = 1;

-- ─── Location hierarchy (PSGC-ready) ──────────────────────────
-- A municipality can hold two barangays with the same name, distinguished only by
-- their PSGC code, so (municipality_id, name) is deliberately NOT unique.
-- psgc_code carries the Philippine Standard Geographic Code where known; it is
-- nullable so the tables can be seeded from existing records before the official
-- PSA list is imported. See scripts/seed-locations.js.

CREATE TABLE `regions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `psgc_code` VARCHAR(12) NULL,
  `name` VARCHAR(120) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_regions_name` (`name`),
  UNIQUE KEY `uq_regions_psgc` (`psgc_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `provinces` (
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

CREATE TABLE `municipalities` (
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

CREATE TABLE `barangays` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `psgc_code` VARCHAR(12) NULL,
  `municipality_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_barangays_municipality_name` (`municipality_id`, `name`),
  UNIQUE KEY `uq_barangays_psgc` (`psgc_code`),
  KEY `idx_barangays_name` (`name`),
  CONSTRAINT `fk_barangays_municipality` FOREIGN KEY (`municipality_id`) REFERENCES `municipalities` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `applicants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `application_id` VARCHAR(32) NOT NULL,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name` VARCHAR(120) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(40) NOT NULL DEFAULT '',
  `farm_name` VARCHAR(255) NOT NULL DEFAULT '',
  `farm_area` INT UNSIGNED NOT NULL DEFAULT 0,
  `farm_address` VARCHAR(500) NOT NULL DEFAULT '',
  `region` VARCHAR(80) NOT NULL DEFAULT '',
  `province` VARCHAR(120) NOT NULL DEFAULT '',
  `municipality` VARCHAR(120) NOT NULL DEFAULT '',
  `lsa_type` VARCHAR(40) NOT NULL DEFAULT 'regular',
  `barangay_id` INT UNSIGNED NULL,
  `category` VARCHAR(40) NOT NULL DEFAULT 'private',
  `classification` VARCHAR(80) NOT NULL DEFAULT '',
  `status` VARCHAR(40) NOT NULL DEFAULT 'submitted',
  `progress` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `submission_date` DATE NULL,
  `accreditation_step` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `documents` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_docs` INT UNSIGNED NOT NULL DEFAULT 12,
  `latitude` DECIMAL(10,7) NULL,
  `longitude` DECIMAL(10,7) NULL,
  `geo_tagged_by` VARCHAR(160) NULL,
  `geo_tagged_date` DATE NULL,
  `geo_tag_status` VARCHAR(40) NULL DEFAULT 'pending',

  `step1_briefer_signed` TINYINT(1) NOT NULL DEFAULT 0,
  `step1_briefer_date` DATE NULL,
  `step1_acknowledged_by` VARCHAR(255) NULL,

  `step2_self_assessment_score` INT NULL,
  `step2_qualified` TINYINT(1) NULL,
  `step2_completed_date` DATE NULL,
  `step2_remarks` TEXT NULL,

  `step3_submitted_date` DATE NULL,
  `step3_docs_submitted` INT NULL,
  `step3_docs_required` INT NULL,
  `step3_received_by` VARCHAR(255) NULL,

  `step4_eval_date` DATE NULL,
  `step4_eval_result` VARCHAR(40) NULL,
  `step4_eval_remarks` TEXT NULL,
  `step4_eval_by` VARCHAR(255) NULL,

  `step5_validation_date` DATE NULL,
  `step5_validation_type` VARCHAR(40) NULL,
  `step5_validation_result` VARCHAR(40) NULL,
  `step5_checked_items` INT NULL,
  `step5_twg_remarks` TEXT NULL,
  `step5_inspected_by` VARCHAR(255) NULL,

  `step6_endorsed_date` DATE NULL,
  `step6_endorsed_by` VARCHAR(255) NULL,
  `step6_endorsement_no` VARCHAR(120) NULL,
  `step6_endorse_remarks` TEXT NULL,

  `step7_certificate_no` VARCHAR(160) NULL,
  `step7_issue_date` DATE NULL,
  `step7_valid_until` DATE NULL,
  `step7_moa_date` DATE NULL,
  `step7_issued_by` VARCHAR(255) NULL,
  `step7_moa_remarks` TEXT NULL,

  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_applicants_application_id` (`application_id`),
  KEY `idx_applicants_status` (`status`),
  KEY `idx_applicants_province` (`province`),
  KEY `idx_applicants_email` (`email`),
  KEY `idx_applicants_barangay` (`barangay_id`),
  CONSTRAINT `fk_applicants_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `farms` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `applicant_id` INT UNSIGNED NULL,
  `name` VARCHAR(255) NOT NULL,
  `operator` VARCHAR(255) NOT NULL DEFAULT '',
  `region` VARCHAR(80) NOT NULL DEFAULT '',
  `province` VARCHAR(120) NOT NULL DEFAULT '',
  `municipality` VARCHAR(120) NOT NULL DEFAULT '',
  `address` VARCHAR(500) NOT NULL DEFAULT '',
  `barangay_id` INT UNSIGNED NULL,
  `classification` VARCHAR(160) NOT NULL DEFAULT '',
  `lsa_type` VARCHAR(80) NOT NULL DEFAULT '',
  `accreditation_level` VARCHAR(40) NOT NULL DEFAULT '',
  `accredited_since` DATE NULL,
  `expiry_date` DATE NULL,
  `farm_area` INT UNSIGNED NOT NULL DEFAULT 0,
  `compliance_score` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `visitors_this_year` INT UNSIGNED NOT NULL DEFAULT 0,
  `training_sessions` INT UNSIGNED NOT NULL DEFAULT 0,
  `main_crops` VARCHAR(500) NOT NULL DEFAULT '',
  `latitude` DECIMAL(10,7) NULL,
  `longitude` DECIMAL(10,7) NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_farms_applicant` (`applicant_id`),
  KEY `idx_farms_province` (`province`),
  KEY `idx_farms_barangay` (`barangay_id`),
  CONSTRAINT `fk_farms_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_farms_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `documents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `applicant_id` INT UNSIGNED NOT NULL,
  `application_id` VARCHAR(32) NOT NULL,
  `applicant_name` VARCHAR(255) NOT NULL DEFAULT '',
  `name` VARCHAR(255) NOT NULL,
  `type` VARCHAR(80) NOT NULL DEFAULT 'other',
  `filename` VARCHAR(255) NOT NULL DEFAULT '',
  `size` VARCHAR(40) NOT NULL DEFAULT '',
  `upload_date` DATE NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'pending_review',
  `remarks` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_documents_applicant` (`applicant_id`),
  KEY `idx_documents_status` (`status`),
  KEY `idx_documents_type` (`type`),
  CONSTRAINT `fk_documents_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `farm_id` INT UNSIGNED NOT NULL,
  `farm_name` VARCHAR(255) NOT NULL DEFAULT '',
  `operator` VARCHAR(255) NOT NULL DEFAULT '',
  `period` VARCHAR(80) NOT NULL DEFAULT '',
  `submission_date` DATE NULL,
  `visitors` INT UNSIGNED NOT NULL DEFAULT 0,
  `training_sessions` INT UNSIGNED NOT NULL DEFAULT 0,
  `tech_demos` INT UNSIGNED NOT NULL DEFAULT 0,
  `status` VARCHAR(40) NOT NULL DEFAULT 'pending',
  `reviewed_by` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reports_farm` (`farm_id`),
  KEY `idx_reports_status` (`status`),
  CONSTRAINT `fk_reports_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name` VARCHAR(120) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin','evaluator','operator','applicant') NOT NULL DEFAULT 'applicant',
  `position` VARCHAR(255) NOT NULL DEFAULT '',
  `office` VARCHAR(255) NOT NULL DEFAULT '',
  `region` VARCHAR(80) NOT NULL DEFAULT '',
  `avatar` VARCHAR(8) NOT NULL DEFAULT '',
  `barangay_id` INT UNSIGNED NULL,
  `phone` VARCHAR(40) NOT NULL DEFAULT '',
  `farm_id` INT UNSIGNED NULL,
  `application_id` VARCHAR(32) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_application` (`application_id`),
  CONSTRAINT `fk_users_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  KEY `idx_users_barangay` (`barangay_id`),
  CONSTRAINT `fk_users_application` FOREIGN KEY (`application_id`) REFERENCES `applicants` (`application_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_users_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Community chat ───────────────────────────────────────────

CREATE TABLE `chat_channels` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `slug` VARCHAR(80) NOT NULL,
  `description` VARCHAR(500) NOT NULL DEFAULT '',
  `channel_type` ENUM('public','regional','topic') NOT NULL DEFAULT 'public',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_chat_channels_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `chat_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NULL,
  `sender_name` VARCHAR(160) NOT NULL DEFAULT '',
  `sender_avatar` VARCHAR(8) NOT NULL DEFAULT '',
  `body` VARCHAR(4000) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chat_messages_channel` (`channel_id`, `id`),
  CONSTRAINT `fk_chat_messages_channel` FOREIGN KEY (`channel_id`) REFERENCES `chat_channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_chat_messages_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `chat_channels` (`id`, `name`, `slug`, `description`, `channel_type`) VALUES
(1, '#general', 'general', 'General discussions', 'public'),
(2, '#region-v-bicol', 'region-v-bicol', 'Bicol Region LSA operators', 'regional'),
(3, '#organic-farming', 'organic-farming', 'Organic agriculture practices', 'topic'),
(4, '#technology-sharing', 'technology-sharing', 'Share agricultural technologies', 'topic'),
(5, '#market-linkages', 'market-linkages', 'Market opportunities and connections', 'topic')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
