-- ============================================================
-- Agri-AIMS database schema (structure only, no data)
-- Database: agri_aims
-- Generated: 2026-09-10T03:30:05.545Z
-- MySQL Workbench: File > Open SQL Script (or Run SQL Script) to load,
--   then Database > Reverse Engineer to draw the ERD.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------- account_audit ----------
DROP TABLE IF EXISTS `account_audit`;
CREATE TABLE `account_audit` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned DEFAULT NULL,
  `application_id` varchar(32) NOT NULL DEFAULT '',
  `action` enum('account_created','applicant_created','deactivated','reactivated','relinked','suspended','archived','deleted') NOT NULL,
  `actor_id` int(10) unsigned DEFAULT NULL,
  `actor_name` varchar(255) NOT NULL DEFAULT '',
  `detail` varchar(500) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_account_audit_user` (`user_id`),
  KEY `idx_account_audit_application` (`application_id`),
  CONSTRAINT `fk_account_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- otp_codes ----------
DROP TABLE IF EXISTS `otp_codes`;
CREATE TABLE `otp_codes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `user_id` int(10) unsigned DEFAULT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `purpose` enum('registration','password_reset') NOT NULL,
  `expires_at` datetime NOT NULL,
  `attempts` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `verified_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_otp_lookup` (`email`,`purpose`,`id`),
  KEY `idx_otp_expires` (`expires_at`),
  CONSTRAINT `fk_otp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- applicants ----------
DROP TABLE IF EXISTS `applicants`;
CREATE TABLE `applicants` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `application_id` varchar(32) NOT NULL,
  `first_name` varchar(120) NOT NULL,
  `last_name` varchar(120) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(40) NOT NULL DEFAULT '',
  `rsbsa_number` varchar(60) NOT NULL DEFAULT '',
  `farm_name` varchar(255) NOT NULL DEFAULT '',
  `farm_area` int(10) unsigned NOT NULL DEFAULT 0,
  `farm_address` varchar(500) NOT NULL DEFAULT '',
  `farm_established_date` date DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `civil_status` varchar(40) NOT NULL DEFAULT '',
  `ethnic_origin` varchar(120) NOT NULL DEFAULT '',
  `educational_attainment` varchar(120) NOT NULL DEFAULT '',
  `home_address` varchar(500) NOT NULL DEFAULT '',
  `region` varchar(80) NOT NULL DEFAULT '',
  `province` varchar(120) NOT NULL DEFAULT '',
  `municipality` varchar(120) NOT NULL DEFAULT '',
  `barangay_id` int(10) unsigned DEFAULT NULL,
  `lsa_type` varchar(40) NOT NULL DEFAULT 'regular',
  `category` varchar(40) NOT NULL DEFAULT 'private',
  `assistance_type` varchar(32) NOT NULL DEFAULT '',
  `classification` varchar(80) NOT NULL DEFAULT '',
  `status` varchar(40) NOT NULL DEFAULT 'submitted',
  `progress` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `submission_date` date DEFAULT NULL,
  `accreditation_step` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `documents` int(10) unsigned NOT NULL DEFAULT 0,
  `total_docs` int(10) unsigned NOT NULL DEFAULT 12,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `geo_tagged_by` varchar(160) DEFAULT NULL,
  `geo_tagged_date` date DEFAULT NULL,
  `geo_tag_status` varchar(40) DEFAULT 'pending',
  `step1_briefer_signed` tinyint(1) NOT NULL DEFAULT 0,
  `step1_briefer_date` date DEFAULT NULL,
  `step1_acknowledged_by` varchar(255) DEFAULT NULL,
  `step1_signature_file` varchar(255) DEFAULT NULL,
  `step2_self_assessment_score` int(11) DEFAULT NULL,
  `step2_qualified` tinyint(1) DEFAULT NULL,
  `step2_completed_date` date DEFAULT NULL,
  `step2_remarks` text DEFAULT NULL,
  `step3_submitted_date` date DEFAULT NULL,
  `step3_docs_submitted` int(11) DEFAULT NULL,
  `step3_docs_required` int(11) DEFAULT NULL,
  `step3_received_by` varchar(255) DEFAULT NULL,
  `step4_eval_date` date DEFAULT NULL,
  `step4_eval_result` varchar(40) DEFAULT NULL,
  `step4_eval_remarks` text DEFAULT NULL,
  `step4_eval_by` varchar(255) DEFAULT NULL,
  `step5_validation_date` date DEFAULT NULL,
  `step5_validation_type` varchar(40) DEFAULT NULL,
  `step5_validation_result` varchar(40) DEFAULT NULL,
  `step5_checked_items` int(11) DEFAULT NULL,
  `step5_twg_remarks` text DEFAULT NULL,
  `step5_inspected_by` varchar(255) DEFAULT NULL,
  `step6_endorsed_date` date DEFAULT NULL,
  `step6_endorsed_by` varchar(255) DEFAULT NULL,
  `step6_endorsement_no` varchar(120) DEFAULT NULL,
  `step6_endorse_remarks` text DEFAULT NULL,
  `step7_certificate_no` varchar(160) DEFAULT NULL,
  `step7_issue_date` date DEFAULT NULL,
  `step7_valid_until` date DEFAULT NULL,
  `step7_moa_date` date DEFAULT NULL,
  `step7_issued_by` varchar(255) DEFAULT NULL,
  `step7_moa_remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `not_disqualified` tinyint(1) DEFAULT NULL COMMENT 'LSA-20: applicant declared they fall under none of the disqualifying grounds. NULL = never asked.',
  `disqualification_declared_at` date DEFAULT NULL COMMENT 'When the declaration was made, alongside the briefer signature.',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_applicants_application_id` (`application_id`),
  KEY `idx_applicants_status` (`status`),
  KEY `idx_applicants_province` (`province`),
  KEY `idx_applicants_email` (`email`),
  KEY `idx_applicants_barangay` (`barangay_id`),
  KEY `idx_applicants_rsbsa` (`rsbsa_number`),
  CONSTRAINT `fk_applicants_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=869 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- assessment_responses ----------
DROP TABLE IF EXISTS `assessment_responses`;
CREATE TABLE `assessment_responses` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `applicant_id` int(10) unsigned NOT NULL,
  `step` tinyint(4) NOT NULL COMMENT '2 = self-assessment, 5 = TWG field validation',
  `item_code` varchar(16) NOT NULL COMMENT 'f1..f7, o1..o9, d1..d5, vc1..vc12',
  `category` varchar(64) NOT NULL DEFAULT '',
  `label` varchar(255) NOT NULL DEFAULT '' COMMENT 'the question as it was asked',
  `facility` varchar(32) DEFAULT NULL COMMENT 'tda, holding_area, wash_area, toilet — PDF p.11',
  `answer` tinyint(1) NOT NULL DEFAULT 0,
  `recorded_by` varchar(120) NOT NULL DEFAULT '',
  `recorded_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assessment_item` (`applicant_id`,`step`,`item_code`),
  KEY `idx_assessment_applicant` (`applicant_id`),
  KEY `idx_assessment_facility` (`facility`),
  CONSTRAINT `fk_assessment_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6041 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------- development_plans ----------
DROP TABLE IF EXISTS `development_plans`;
CREATE TABLE `development_plans` (
  `applicant_id` int(10) unsigned NOT NULL,
  `data` longtext NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`applicant_id`),
  CONSTRAINT `fk_devplan_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- farm_profiles ----------
DROP TABLE IF EXISTS `farm_profiles`;
CREATE TABLE `farm_profiles` (
  `applicant_id` int(10) unsigned NOT NULL,
  `data` longtext NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`applicant_id`),
  CONSTRAINT `fk_farmprofile_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- document_reviews ----------
DROP TABLE IF EXISTS `document_reviews`;
CREATE TABLE `document_reviews` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `applicant_id` int(10) unsigned DEFAULT NULL,
  `application_id` varchar(32) NOT NULL DEFAULT '',
  `doc_type` varchar(80) NOT NULL DEFAULT '',
  `doc_name` varchar(255) NOT NULL DEFAULT '',
  `filename` varchar(255) NOT NULL DEFAULT '',
  `action` enum('submitted','accepted','rejected') NOT NULL,
  `remarks` text DEFAULT NULL,
  `actor` varchar(255) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_docrev_applicant_type` (`applicant_id`,`doc_type`),
  KEY `idx_docrev_applicant` (`applicant_id`),
  CONSTRAINT `fk_docrev_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- barangays ----------
DROP TABLE IF EXISTS `barangays`;
CREATE TABLE `barangays` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `psgc_code` varchar(12) DEFAULT NULL,
  `municipality_id` int(10) unsigned NOT NULL,
  `name` varchar(160) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_barangays_psgc` (`psgc_code`),
  KEY `idx_barangays_name` (`name`),
  KEY `idx_barangays_municipality_name` (`municipality_id`,`name`),
  CONSTRAINT `fk_barangays_municipality` FOREIGN KEY (`municipality_id`) REFERENCES `municipalities` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13898 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- chat_channels ----------
DROP TABLE IF EXISTS `chat_channels`;
CREATE TABLE `chat_channels` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `slug` varchar(80) NOT NULL,
  `description` varchar(500) NOT NULL DEFAULT '',
  `channel_type` enum('public','regional','topic') NOT NULL DEFAULT 'public',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` int(10) unsigned DEFAULT NULL,
  `archived_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_chat_channels_slug` (`slug`),
  KEY `idx_chat_channels_archived` (`archived_at`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- chat_messages ----------
DROP TABLE IF EXISTS `chat_messages`;
CREATE TABLE `chat_messages` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `channel_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned DEFAULT NULL,
  `sender_name` varchar(160) NOT NULL DEFAULT '',
  `sender_avatar` varchar(8) NOT NULL DEFAULT '',
  `body` varchar(4000) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `edited_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_chat_messages_channel` (`channel_id`,`id`),
  KEY `fk_chat_messages_user` (`user_id`),
  KEY `idx_chat_messages_channel_updated` (`channel_id`,`updated_at`),
  CONSTRAINT `fk_chat_messages_channel` FOREIGN KEY (`channel_id`) REFERENCES `chat_channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_chat_messages_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=170 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- compliance_checks ----------
DROP TABLE IF EXISTS `compliance_checks`;
CREATE TABLE `compliance_checks` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `requirement_id` int(10) unsigned NOT NULL,
  `farm_id` int(10) unsigned DEFAULT NULL,
  `applicant_id` int(10) unsigned DEFAULT NULL,
  `status` enum('compliant','partial','non_compliant','not_applicable','pending') NOT NULL DEFAULT 'pending',
  `checked_at` date NOT NULL,
  `checked_by` int(10) unsigned DEFAULT NULL,
  `evidence_document_id` int(10) unsigned DEFAULT NULL,
  `remarks` varchar(1000) NOT NULL DEFAULT '',
  `corrective_action` varchar(1000) NOT NULL DEFAULT '',
  `next_check_date` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_checks_farm` (`farm_id`,`requirement_id`,`id`),
  KEY `idx_checks_applicant` (`applicant_id`),
  KEY `idx_checks_status` (`status`),
  KEY `idx_checks_next` (`next_check_date`),
  KEY `fk_checks_requirement` (`requirement_id`),
  KEY `fk_checks_checker` (`checked_by`),
  KEY `fk_checks_evidence` (`evidence_document_id`),
  CONSTRAINT `fk_checks_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_checks_checker` FOREIGN KEY (`checked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_checks_evidence` FOREIGN KEY (`evidence_document_id`) REFERENCES `documents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_checks_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_checks_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `compliance_requirements` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=51 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- compliance_requirements ----------
DROP TABLE IF EXISTS `compliance_requirements`;
CREATE TABLE `compliance_requirements` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(32) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` varchar(1000) NOT NULL DEFAULT '',
  `source_reference` varchar(255) NOT NULL DEFAULT '',
  `category` enum('facilities','operations','records_reporting','capability','assistance') NOT NULL DEFAULT 'operations',
  `applies_to` enum('all','farming','agri_processing') NOT NULL DEFAULT 'all',
  `frequency` enum('once','semestral','annual','five_year','ongoing') NOT NULL DEFAULT 'ongoing',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_compliance_requirement_code` (`code`),
  KEY `idx_compliance_requirement_active` (`is_active`,`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- direct_messages ----------
DROP TABLE IF EXISTS `direct_messages`;
CREATE TABLE `direct_messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `pair_key` varchar(32) NOT NULL,
  `sender_id` int(10) unsigned NOT NULL,
  `recipient_id` int(10) unsigned NOT NULL,
  `body` text NOT NULL,
  `read_at` datetime DEFAULT NULL,
  `edited_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_dm_pair` (`pair_key`,`id`),
  KEY `idx_dm_unread` (`recipient_id`,`read_at`),
  KEY `idx_dm_changed` (`pair_key`,`updated_at`),
  KEY `fk_dm_sender` (`sender_id`),
  CONSTRAINT `fk_dm_recipient` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_dm_sender` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------- documents ----------
DROP TABLE IF EXISTS `documents`;
CREATE TABLE `documents` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `applicant_id` int(10) unsigned DEFAULT NULL,
  `application_id` varchar(32) NOT NULL,
  `applicant_name` varchar(255) NOT NULL DEFAULT '',
  `name` varchar(255) NOT NULL,
  `type` varchar(80) NOT NULL DEFAULT 'other',
  `filename` varchar(255) NOT NULL DEFAULT '',
  `stored_name` varchar(120) DEFAULT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `size_bytes` int(10) unsigned DEFAULT NULL,
  `size` varchar(40) NOT NULL DEFAULT '',
  `upload_date` date DEFAULT NULL,
  `status` varchar(40) NOT NULL DEFAULT 'pending_review',
  `remarks` text DEFAULT NULL,
  `reviewed_by` int(10) unsigned DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_documents_applicant` (`applicant_id`),
  KEY `idx_documents_status` (`status`),
  KEY `idx_documents_type` (`type`),
  KEY `fk_documents_reviewer` (`reviewed_by`),
  CONSTRAINT `fk_documents_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_documents_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=662 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- elearning_articles ----------
DROP TABLE IF EXISTS `elearning_articles`;
CREATE TABLE `elearning_articles` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `source` enum('moodle_course','moodle_announcement','manual','ati_website') NOT NULL DEFAULT 'manual',
  `external_id` varchar(191) NOT NULL,
  `title` varchar(500) NOT NULL,
  `summary` text DEFAULT NULL,
  `url` varchar(1000) NOT NULL DEFAULT '',
  `published_at` datetime DEFAULT NULL,
  `fetched_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `posted_at` timestamp NULL DEFAULT NULL,
  `chat_channel_id` int(10) unsigned DEFAULT NULL,
  `chat_message_id` bigint(20) unsigned DEFAULT NULL,
  `notified_count` int(10) unsigned NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_elearning_source_external` (`source`,`external_id`),
  KEY `idx_elearning_published` (`published_at`),
  KEY `idx_elearning_posted` (`posted_at`),
  KEY `fk_elearning_channel` (`chat_channel_id`),
  KEY `fk_elearning_message` (`chat_message_id`),
  CONSTRAINT `fk_elearning_channel` FOREIGN KEY (`chat_channel_id`) REFERENCES `chat_channels` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_elearning_message` FOREIGN KEY (`chat_message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4815 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- farms ----------
DROP TABLE IF EXISTS `farms`;
CREATE TABLE `farms` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `applicant_id` int(10) unsigned DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `operator` varchar(255) NOT NULL DEFAULT '',
  `region` varchar(80) NOT NULL DEFAULT '',
  `province` varchar(120) NOT NULL DEFAULT '',
  `municipality` varchar(120) NOT NULL DEFAULT '',
  `barangay_id` int(10) unsigned DEFAULT NULL,
  `address` varchar(500) NOT NULL DEFAULT '',
  `classification` varchar(160) NOT NULL DEFAULT '',
  `lsa_type` varchar(80) NOT NULL DEFAULT '',
  `accreditation_level` varchar(40) NOT NULL DEFAULT '',
  `accredited_since` date DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `farm_area` int(10) unsigned NOT NULL DEFAULT 0,
  `compliance_score` tinyint(3) unsigned DEFAULT NULL,
  `visitors_this_year` int(10) unsigned NOT NULL DEFAULT 0,
  `training_sessions` int(10) unsigned NOT NULL DEFAULT 0,
  `main_crops` varchar(500) NOT NULL DEFAULT '',
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `status` varchar(40) NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_farms_applicant` (`applicant_id`),
  KEY `idx_farms_province` (`province`),
  KEY `idx_farms_barangay` (`barangay_id`),
  CONSTRAINT `fk_farms_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_farms_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=206 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- lsa2_applications ----------
DROP TABLE IF EXISTS `lsa2_applications`;
CREATE TABLE `lsa2_applications` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `applicant_id` int(10) unsigned NOT NULL,
  `farm_id` int(10) unsigned NOT NULL,
  `reference_no` varchar(32) NOT NULL,
  `step` tinyint(4) NOT NULL DEFAULT 1,
  `status` varchar(40) NOT NULL DEFAULT 'draft',
  `competence_enhanced` tinyint(1) DEFAULT NULL COMMENT 'PDF p.16 — assessed by ATI',
  `value_chain_covered` tinyint(1) DEFAULT NULL COMMENT 'PDF p.16 — assessed by ATI',
  `eligibility_remarks` text DEFAULT NULL,
  `assessed_by` varchar(120) DEFAULT NULL,
  `assessed_at` date DEFAULT NULL,
  `submitted_at` date DEFAULT NULL,
  `evaluated_at` date DEFAULT NULL,
  `evaluated_by` varchar(120) DEFAULT NULL,
  `validated_at` date DEFAULT NULL,
  `validated_by` varchar(120) DEFAULT NULL,
  `endorsed_at` date DEFAULT NULL,
  `endorsed_by` varchar(120) DEFAULT NULL,
  `certificate_no` varchar(64) DEFAULT NULL,
  `certified_at` date DEFAULT NULL,
  `moa_signed_at` date DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lsa2_reference` (`reference_no`),
  UNIQUE KEY `uq_lsa2_farm` (`farm_id`),
  KEY `idx_lsa2_applicant` (`applicant_id`),
  CONSTRAINT `fk_lsa2_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lsa2_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=48 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------- municipalities ----------
DROP TABLE IF EXISTS `municipalities`;
CREATE TABLE `municipalities` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `psgc_code` varchar(12) DEFAULT NULL,
  `province_id` int(10) unsigned NOT NULL,
  `name` varchar(160) NOT NULL,
  `type` enum('municipality','city') NOT NULL DEFAULT 'municipality',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_municipalities_province_name` (`province_id`,`name`),
  UNIQUE KEY `uq_municipalities_psgc` (`psgc_code`),
  CONSTRAINT `fk_municipalities_province` FOREIGN KEY (`province_id`) REFERENCES `provinces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=470 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- notifications ----------
DROP TABLE IF EXISTS `notifications`;
CREATE TABLE `notifications` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `type` varchar(60) NOT NULL,
  `title` varchar(255) NOT NULL,
  `body` varchar(1000) NOT NULL DEFAULT '',
  `link` varchar(500) NOT NULL DEFAULT '',
  `icon` varchar(60) NOT NULL DEFAULT 'bell',
  `read_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_unread` (`user_id`,`read_at`,`id`),
  KEY `idx_notifications_type` (`type`),
  CONSTRAINT `fk_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1916 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- provinces ----------
DROP TABLE IF EXISTS `provinces`;
CREATE TABLE `provinces` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `psgc_code` varchar(12) DEFAULT NULL,
  `region_id` int(10) unsigned NOT NULL,
  `name` varchar(120) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provinces_region_name` (`region_id`,`name`),
  UNIQUE KEY `uq_provinces_psgc` (`psgc_code`),
  CONSTRAINT `fk_provinces_region` FOREIGN KEY (`region_id`) REFERENCES `regions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- regions ----------
DROP TABLE IF EXISTS `regions`;
CREATE TABLE `regions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `psgc_code` varchar(12) DEFAULT NULL,
  `name` varchar(120) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_regions_name` (`name`),
  UNIQUE KEY `uq_regions_psgc` (`psgc_code`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- renewal_applications ----------
DROP TABLE IF EXISTS `renewal_applications`;
CREATE TABLE `renewal_applications` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `farm_id` int(10) unsigned NOT NULL,
  `applicant_id` int(10) unsigned DEFAULT NULL,
  `submitted_by` int(10) unsigned DEFAULT NULL,
  `submitted_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `previous_expiry` date DEFAULT NULL,
  `status` enum('submitted','under_review','approved','rejected') NOT NULL DEFAULT 'submitted',
  `operator_remarks` varchar(2000) NOT NULL DEFAULT '',
  `reviewed_by` int(10) unsigned DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `decision_remarks` varchar(2000) NOT NULL DEFAULT '',
  `new_certificate_no` varchar(64) DEFAULT NULL,
  `new_valid_until` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_renewal_farm` (`farm_id`),
  KEY `idx_renewal_status` (`status`),
  KEY `fk_renewal_applicant` (`applicant_id`),
  KEY `fk_renewal_submitted_by` (`submitted_by`),
  KEY `fk_renewal_reviewed_by` (`reviewed_by`),
  CONSTRAINT `fk_renewal_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_renewal_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_renewal_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_renewal_submitted_by` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=145 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- renewal_reminders ----------
DROP TABLE IF EXISTS `renewal_reminders`;
CREATE TABLE `renewal_reminders` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `farm_id` int(10) unsigned NOT NULL,
  `expiry_date` date NOT NULL,
  `days_before` smallint(5) unsigned NOT NULL,
  `notified` int(10) unsigned NOT NULL DEFAULT 0,
  `sent_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reminder_once` (`farm_id`,`expiry_date`,`days_before`),
  CONSTRAINT `fk_reminder_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=155 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- reports ----------
DROP TABLE IF EXISTS `reports`;
CREATE TABLE `reports` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `farm_id` int(10) unsigned NOT NULL,
  `farm_name` varchar(255) NOT NULL DEFAULT '',
  `operator` varchar(255) NOT NULL DEFAULT '',
  `period` varchar(80) NOT NULL DEFAULT '',
  `submission_date` date DEFAULT NULL,
  `visitors` int(10) unsigned NOT NULL DEFAULT 0,
  `training_sessions` int(10) unsigned NOT NULL DEFAULT 0,
  `tech_demos` int(10) unsigned NOT NULL DEFAULT 0,
  `status` varchar(40) NOT NULL DEFAULT 'pending',
  `remarks` varchar(1000) NOT NULL DEFAULT '',
  `reviewed_by` varchar(255) DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_report_farm_period` (`farm_id`,`period`),
  KEY `idx_reports_farm` (`farm_id`),
  KEY `idx_reports_status` (`status`),
  CONSTRAINT `fk_reports_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=137 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- services ----------
DROP TABLE IF EXISTS `services`;
CREATE TABLE `services` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `service_type` enum('training','demonstration','information_support','technical_assistance','complementary_project') NOT NULL DEFAULT 'training',
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `provider` varchar(255) NOT NULL DEFAULT 'ATI-RTC V',
  `target_beneficiaries` varchar(500) NOT NULL DEFAULT '',
  `eligibility` varchar(500) NOT NULL DEFAULT '',
  `venue` varchar(255) NOT NULL DEFAULT '',
  `barangay_id` int(10) unsigned DEFAULT NULL,
  `schedule_start` date DEFAULT NULL,
  `schedule_end` date DEFAULT NULL,
  `slots` int(10) unsigned DEFAULT NULL,
  `status` enum('planned','open','ongoing','completed','cancelled') NOT NULL DEFAULT 'planned',
  `remarks` text DEFAULT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_services_type` (`service_type`),
  KEY `idx_services_status` (`status`),
  KEY `idx_services_schedule` (`schedule_start`),
  KEY `idx_services_barangay` (`barangay_id`),
  KEY `fk_services_creator` (`created_by`),
  CONSTRAINT `fk_services_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_services_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=62 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- service_participants ----------
DROP TABLE IF EXISTS `service_participants`;
CREATE TABLE `service_participants` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `service_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `applicant_id` int(10) unsigned DEFAULT NULL,
  `application_status` enum('applied','approved','rejected','waitlisted','withdrawn') NOT NULL DEFAULT 'applied',
  `attended` tinyint(1) NOT NULL DEFAULT 0,
  `completed_at` date DEFAULT NULL,
  `certificate_document_id` int(10) unsigned DEFAULT NULL,
  `remarks` varchar(1000) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_service_participant` (`service_id`,`user_id`),
  KEY `idx_participants_user` (`user_id`),
  KEY `idx_participants_status` (`application_status`),
  KEY `fk_participants_applicant` (`applicant_id`),
  KEY `fk_participants_certificate` (`certificate_document_id`),
  CONSTRAINT `fk_participants_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_participants_certificate` FOREIGN KEY (`certificate_document_id`) REFERENCES `documents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_participants_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_participants_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=108 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- users ----------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `first_name` varchar(120) NOT NULL,
  `last_name` varchar(120) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('admin','operator','applicant') NOT NULL DEFAULT 'applicant',
  `position` varchar(255) NOT NULL DEFAULT '',
  `office` varchar(255) NOT NULL DEFAULT '',
  `region` varchar(80) NOT NULL DEFAULT '',
  `barangay_id` int(10) unsigned DEFAULT NULL,
  `avatar` varchar(8) NOT NULL DEFAULT '',
  `photo` varchar(64) DEFAULT NULL,
  `phone` varchar(40) NOT NULL DEFAULT '',
  `farm_id` int(10) unsigned DEFAULT NULL,
  `application_id` varchar(32) DEFAULT NULL,
  `created_by_admin` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `status` enum('active','inactive','suspended','archived') NOT NULL DEFAULT 'active',
  `email_verified` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `active_application_key` varchar(32) GENERATED ALWAYS AS (if(`status` = 'active',`application_id`,NULL)) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_active_application` (`active_application_key`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_application` (`application_id`),
  KEY `fk_users_farm` (`farm_id`),
  KEY `idx_users_barangay` (`barangay_id`),
  KEY `idx_users_is_active` (`is_active`),
  KEY `idx_users_status` (`status`),
  CONSTRAINT `fk_users_application` FOREIGN KEY (`application_id`) REFERENCES `applicants` (`application_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_users_barangay` FOREIGN KEY (`barangay_id`) REFERENCES `barangays` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_users_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1209 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
