-- AlterTable
-- FR-3.1a — marks a visit as the patient's first ("NEW") or a return
-- ("FOLLOW_UP"). Defaulted so the column can be added to a table that already
-- holds rows: every pre-existing registration was, by definition, entered
-- before follow-ups were tracked and is treated as a new visit.
ALTER TABLE `registrations` ADD COLUMN `visit_type` VARCHAR(20) NOT NULL DEFAULT 'NEW';
