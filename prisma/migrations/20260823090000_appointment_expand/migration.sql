-- MEDCARE PRO — AP-1, migration 1 of 2: EXPAND
--
-- Purely additive. No column is dropped, no type narrowed, no default changed,
-- no existing index altered, and no existing row is read or written. The only
-- statement that touches a table with rows in it is the ADD COLUMN on
-- `registrations`, which adds a NULLABLE column with no default — an instant
-- metadata change on MySQL 8, and safe on a populated table either way.
--
-- The three new tables start EMPTY, so their unique indexes cannot fail on
-- existing data and ship here rather than being deferred. That is the same
-- reasoning STAGE1_NOTES.md records for the Stage 1 tables.
--
-- WHAT IS DELIBERATELY NOT HERE: the UNIQUE index and the foreign key on
-- `registrations.appointment_id`. Those are the only constraints in AP-1 that
-- land on a table which already holds rows, so they wait for the constrain
-- migration, after the validation step has confirmed every existing
-- registration still holds NULL. See 20260823090100_appointment_constrain.
--
-- Not run against production. See prisma/migrations/APPOINTMENT_NOTES.md.

-- CreateTable
CREATE TABLE `appointment_types` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `duration_minutes` INTEGER NOT NULL,
    `default_amount` DECIMAL(10, 2) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `appointment_types_tenant_id_idx`(`tenant_id`),
    INDEX `appointment_types_clinic_id_idx`(`clinic_id`),
    INDEX `appointment_types_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    -- MySQL treats NULLs as DISTINCT, so this does NOT stop two TENANT-WIDE
    -- types (clinic_id IS NULL) sharing a name. The duplicate check for those
    -- has to be done in application code, the way src/lib/roles.ts already does
    -- it for roles(tenant_id, key). AP-6/AP-7 owns that check.
    UNIQUE INDEX `appointment_types_tenant_id_clinic_id_name_key`(`tenant_id`, `clinic_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointments` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `doctor_id` VARCHAR(191) NOT NULL,
    `appointment_type_id` VARCHAR(191) NOT NULL,
    `patient_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `mobile_number` VARCHAR(191) NOT NULL,
    `age` INTEGER NULL,
    `gender` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `city` VARCHAR(191) NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `slot_start` DATETIME(3) NOT NULL,
    `slot_end` DATETIME(3) NOT NULL,
    `active_slot_start` DATETIME(3) NULL,
    `status` ENUM('SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'CONVERTED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED') NOT NULL DEFAULT 'SCHEDULED',
    `booked_by_id` VARCHAR(191) NOT NULL,
    `checked_in_at` DATETIME(3) NULL,
    `checked_in_by_id` VARCHAR(191) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancelled_by_id` VARCHAR(191) NULL,
    `cancellation_reason` TEXT NULL,
    `rescheduled_from_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `appointments_tenant_id_clinic_id_status_idx`(`tenant_id`, `clinic_id`, `status`),
    INDEX `appointments_doctor_id_slot_start_idx`(`doctor_id`, `slot_start`),
    INDEX `appointments_clinic_id_slot_start_idx`(`clinic_id`, `slot_start`),
    INDEX `appointments_patient_id_idx`(`patient_id`),
    INDEX `appointments_appointment_type_id_idx`(`appointment_type_id`),
    INDEX `appointments_rescheduled_from_id_idx`(`rescheduled_from_id`),
    INDEX `appointments_booked_by_id_idx`(`booked_by_id`),
    INDEX `appointments_checked_in_by_id_idx`(`checked_in_by_id`),
    INDEX `appointments_cancelled_by_id_idx`(`cancelled_by_id`),
    -- The partial-unique workaround. `active_slot_start` mirrors `slot_start`
    -- while the appointment occupies the doctor's time and is NULL once it
    -- releases it, and MySQL treats NULLs as distinct — so this constrains only
    -- LIVE rows while any number of cancelled ones may share a doctor and time.
    --
    -- IT IS A BACKSTOP, NOT THE CONCURRENCY CONTROL. It catches exact duplicate
    -- start times only: a 30-minute slot at 09:00 and a 15-minute one at 09:15
    -- overlap but have different starts, and this index cannot see that.
    -- `doctor_schedule_locks` plus a locking overlap query is the real guard.
    UNIQUE INDEX `appointments_doctor_id_active_slot_start_key`(`doctor_id`, `active_slot_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
--
-- Carries no data. Exists solely so every write that can occupy or release a
-- doctor's time has one row to serialise on. See the model comment in
-- prisma/schema.prisma for the full protocol and the lock ordering rule.
CREATE TABLE `doctor_schedule_locks` (
    `id` VARCHAR(191) NOT NULL,
    `doctor_id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `doctor_schedule_locks_doctor_id_date_key`(`doctor_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable — the only change to an existing table in AP-1.
--
-- NULLABLE with no default, so every existing registration keeps its exact
-- current meaning: it was not booked from an appointment, and none is invented
-- for it. The backfill does not populate this column and AP-1 does not change
-- how registrations are created. AP-5 sets it when it converts an appointment.
--
-- Neither the UNIQUE index nor the foreign key is added here — see the header.
ALTER TABLE `registrations` ADD COLUMN `appointment_id` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `appointment_types` ADD CONSTRAINT `appointment_types_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment_types` ADD CONSTRAINT `appointment_types_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_clinic_id_fkey` FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — RESTRICT, matching registrations.doctor_id: a doctor leaving
-- must not silently delete the schedule history attributed to them.
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_doctor_id_fkey` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — RESTRICT: retire a type with is_active, never by deleting it.
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_appointment_type_id_fkey` FOREIGN KEY (`appointment_type_id`) REFERENCES `appointment_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — SET NULL, deliberately UNLIKE registrations.patient_id, which
-- cascades. No appointment row is ever deleted; the denormalised name and
-- mobile_number keep an orphaned booking readable.
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — RESTRICT, matching registrations.created_by.
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_booked_by_id_fkey` FOREIGN KEY (`booked_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — SET NULL: denormalised display pointers, like
-- tenants.approved_by_id. audit_log holds the authoritative trail.
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_checked_in_by_id_fkey` FOREIGN KEY (`checked_in_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_cancelled_by_id_fkey` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — the reschedule chain, self-referencing and RESTRICT so a
-- history link cannot be broken from the far end.
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_rescheduled_from_id_fkey` FOREIGN KEY (`rescheduled_from_id`) REFERENCES `appointments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — CASCADE is correct here and nowhere else in this migration:
-- these rows hold no data, only a lock.
ALTER TABLE `doctor_schedule_locks` ADD CONSTRAINT `doctor_schedule_locks_doctor_id_fkey` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
