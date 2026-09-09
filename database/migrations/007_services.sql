-- ============================================================
-- 007_services.sql  (RSC-04 — monitoring the services available to members)
--
--   npm run migrate:sql -- database/migrations/007_services.sql
--
-- service_type follows the LSA II components named in the guidelines:
-- Training, Demonstration Services, Information Support, Technical Assistance,
-- and Complementary Projects.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `services` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `service_type` ENUM('training','demonstration','information_support','technical_assistance','complementary_project')
      NOT NULL DEFAULT 'training',
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `provider` VARCHAR(255) NOT NULL DEFAULT 'ATI-RTC V',
  `target_beneficiaries` VARCHAR(500) NOT NULL DEFAULT '',
  `eligibility` VARCHAR(500) NOT NULL DEFAULT '',
  `venue` VARCHAR(255) NOT NULL DEFAULT '',
  `barangay_id` INT UNSIGNED NULL,
  `schedule_start` DATE NULL,
  `schedule_end` DATE NULL,
  `slots` INT UNSIGNED NULL,
  `status` ENUM('planned','open','ongoing','completed','cancelled') NOT NULL DEFAULT 'planned',
  `remarks` TEXT NULL,
  `created_by` INT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_services_type` (`service_type`),
  KEY `idx_services_status` (`status`),
  KEY `idx_services_schedule` (`schedule_start`),
  KEY `idx_services_barangay` (`barangay_id`),
  CONSTRAINT `fk_services_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_services_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who applied, who attended, who finished — the record the guidelines expect an
-- LSA to keep of trainees served, and the evidence for up-scaling to LSA II.
CREATE TABLE IF NOT EXISTS `service_participants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `service_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `applicant_id` INT UNSIGNED NULL,
  `application_status` ENUM('applied','approved','rejected','waitlisted','withdrawn') NOT NULL DEFAULT 'applied',
  `attended` TINYINT(1) NOT NULL DEFAULT 0,
  `completed_at` DATE NULL,
  `certificate_document_id` INT UNSIGNED NULL,
  `remarks` VARCHAR(1000) NOT NULL DEFAULT '',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_service_participant` (`service_id`, `user_id`),
  KEY `idx_participants_user` (`user_id`),
  KEY `idx_participants_status` (`application_status`),
  CONSTRAINT `fk_participants_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_participants_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_participants_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_participants_certificate` FOREIGN KEY (`certificate_document_id`) REFERENCES `documents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
