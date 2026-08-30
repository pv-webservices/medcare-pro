-- Stage 5: explicit appointment provenance and idempotent staff callback
-- requests. Existing appointments remain STAFF bookings and retain their
-- booked_by_id values.

ALTER TABLE `appointments`
    DROP FOREIGN KEY `appointments_booked_by_id_fkey`;

ALTER TABLE `appointments`
    ADD COLUMN `booking_source` ENUM('STAFF', 'PHONE_IVR') NOT NULL DEFAULT 'STAFF',
    ADD COLUMN `booking_source_ref` VARCHAR(191) NULL,
    MODIFY `booked_by_id` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `appointments_booking_source_booking_source_ref_key`
    ON `appointments`(`booking_source`, `booking_source_ref`);

ALTER TABLE `appointments`
    ADD CONSTRAINT `appointments_booked_by_id_fkey`
    FOREIGN KEY (`booked_by_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `telephony_booking_requests` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `provider_call_id` VARCHAR(128) NOT NULL,
    `caller_number` VARCHAR(16) NULL,
    `reason` ENUM('NO_PATIENT_MATCH', 'AMBIGUOUS_PATIENT_MATCH', 'USER_REQUESTED') NOT NULL,
    `status` ENUM('PENDING', 'RESOLVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `telephony_booking_requests_clinic_id_provider_provider_call_id_key`
        (`clinic_id`, `provider`, `provider_call_id`),
    INDEX `telephony_booking_requests_tenant_id_clinic_id_status_idx`
        (`tenant_id`, `clinic_id`, `status`),
    INDEX `telephony_booking_requests_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `telephony_booking_requests`
    ADD CONSTRAINT `telephony_booking_requests_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `telephony_booking_requests`
    ADD CONSTRAINT `telephony_booking_requests_clinic_id_fkey`
    FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
