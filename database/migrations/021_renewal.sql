-- Renewal / re-accreditation — Objective 2.5 and the three Table 10 test cases
-- ("Renewal Notification", "Re-accreditation Submission", "Accreditation
-- Validity Tracking").
--
-- Only the validity DATE existed before this: farms.expiry_date and
-- applicants.step7_valid_until were written at Step 7 and then never read by
-- anything that could act on them. There was no way for an operator to apply
-- for renewal and nothing that warned anyone a certificate was running out.

CREATE TABLE IF NOT EXISTS `renewal_applications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `farm_id` INT UNSIGNED NOT NULL,
  `applicant_id` INT UNSIGNED NULL,
  `submitted_by` INT UNSIGNED NULL,
  `submitted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The expiry the farm held when the application was made. Kept because the
  -- farm's own expiry_date moves when the renewal is approved, and the record
  -- of what was being renewed must not move with it.
  `previous_expiry` DATE NULL,
  `status` ENUM('submitted','under_review','approved','rejected') NOT NULL DEFAULT 'submitted',
  `operator_remarks` VARCHAR(2000) NOT NULL DEFAULT '',
  `reviewed_by` INT UNSIGNED NULL,
  `reviewed_at` TIMESTAMP NULL DEFAULT NULL,
  `decision_remarks` VARCHAR(2000) NOT NULL DEFAULT '',
  `new_certificate_no` VARCHAR(64) NULL,
  `new_valid_until` DATE NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_renewal_farm` (`farm_id`),
  KEY `idx_renewal_status` (`status`),
  CONSTRAINT `fk_renewal_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_renewal_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `applicants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_renewal_submitted_by` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_renewal_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A reminder that fires every time the scheduler runs is not a reminder, it is
-- a nuisance, and an operator who is warned four times a day stops reading. The
-- unique key is the whole point of this table: one row per farm, per expiry
-- date, per window, and the insert is what decides whether the notice is sent.
--
-- Keyed on expiry_date as well as farm_id so a renewed farm starts a fresh set
-- of windows five years later instead of being silenced by the old rows.
CREATE TABLE IF NOT EXISTS `renewal_reminders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `farm_id` INT UNSIGNED NOT NULL,
  `expiry_date` DATE NOT NULL,
  `days_before` SMALLINT UNSIGNED NOT NULL,
  `notified` INT UNSIGNED NOT NULL DEFAULT 0,
  `sent_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reminder_once` (`farm_id`, `expiry_date`, `days_before`),
  CONSTRAINT `fk_reminder_farm` FOREIGN KEY (`farm_id`) REFERENCES `farms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
