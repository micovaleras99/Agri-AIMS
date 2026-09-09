-- Admin and Evaluator are one role now (client §5): the administrator manages
-- applications and performs document evaluation, field validation, and Steps
-- 4-7. Existing evaluator accounts become administrators so they keep working
-- with no re-registration. roleContext re-reads the user each request, so the
-- change takes effect on their next page load without a re-login.
--
-- The 'evaluator' value is left in the users.role ENUM: dropping an ENUM member
-- is a destructive schema change with no benefit here, and every authorization
-- guard already treats admin and evaluator alike.
UPDATE `users` SET `role` = 'admin' WHERE `role` = 'evaluator';
