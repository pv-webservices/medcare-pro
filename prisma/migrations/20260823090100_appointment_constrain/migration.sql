-- MEDCARE PRO — AP-1, migration 2 of 2: CONSTRAIN
--
-- Run ONLY after `npm run verify:ap1-appointments-schema` passes on the expand
-- migration. Both statements below fail loudly if any existing registration has
-- somehow acquired a non-NULL `appointment_id`, or if two share one. That is
-- the intended safety behaviour: a failure here means the validation step was
-- skipped, never that data was lost.
--
-- WHY ONLY THESE TWO. Everything else AP-1 adds lands on a table created empty
-- in the expand migration, where a unique constraint cannot fail on existing
-- data. `registrations` is the one table in AP-1 that already holds rows, so it
-- is the one place where a constraint is worth proving before applying.
--
-- Not run against production.

-- CreateIndex — one registration per appointment.
--
-- This is the DATABASE-LEVEL guard against converting the same appointment
-- twice. AP-5's second attempt hits this index rather than racing past an
-- application check that read "not converted yet" a moment before.
--
-- Safe alongside the existing rows: every one of them holds NULL, and MySQL
-- permits unlimited NULLs under a UNIQUE index. If this statement fails, some
-- row was populated between the expand migration and now — investigate that row
-- rather than dropping the index.
CREATE UNIQUE INDEX `registrations_appointment_id_key` ON `registrations`(`appointment_id`);

-- AddForeignKey — deferred to here alongside the index above, rather than split
-- across the two migrations.
--
-- Adding it in the expand migration would have made MySQL auto-create its own
-- plain index on the column to satisfy InnoDB's requirement, which this UNIQUE
-- index would then duplicate — leaving a redundant index behind for good. This
-- order lets the UNIQUE index serve the foreign key, so there is exactly one.
--
-- RESTRICT: an appointment that produced revenue must not become deletable, and
-- nothing deletes appointments anyway — they retire by status.
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_appointment_id_fkey` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
