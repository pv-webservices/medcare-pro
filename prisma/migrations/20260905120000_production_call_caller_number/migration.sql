-- New calls may retain the validated, canonical caller number for authorised
-- clinic operations. Historical last-four-only rows deliberately remain NULL.
ALTER TABLE `clinic_telephony_calls`
    ADD COLUMN `caller_number` VARCHAR(16) NULL;
