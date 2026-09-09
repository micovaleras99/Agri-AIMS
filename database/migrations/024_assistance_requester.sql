-- Separation of duties on assistance decisions.
--
-- `POST /assistance/:reference/advance` checked only that the actor was ATI
-- staff. Nothing compared the approver to the requester, so one evaluator could
-- file a request on behalf of a farm and approve it herself in two clicks. That
-- was demonstrated end to end: a PhP 5,000 facility request filed and approved
-- by the same person, with no second party involved.
--
-- The check needs an identity, not a name. `requested_by` is a VARCHAR holding
-- a display name, so comparing it would break the moment two staff share a name
-- or somebody is renamed — neither is an acceptable failure mode for a control
-- over public money. This records who actually filed it.

ALTER TABLE `assistance_records`
  ADD COLUMN `requested_by_user_id` INT UNSIGNED NULL AFTER `requested_by`;

ALTER TABLE `assistance_records`
  ADD CONSTRAINT `fk_assistance_requester` FOREIGN KEY (`requested_by_user_id`)
  REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
