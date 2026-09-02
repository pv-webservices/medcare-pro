-- Phase 5: controlled outbound IVR verification attempts. No existing clinic
-- requires a row; the feature stays dormant until an administrator starts one.

CREATE TABLE `clinic_telephony_test_calls` (
    `id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `requested_by_user_id` VARCHAR(191) NOT NULL,
    `status` ENUM('REQUESTED', 'RINGING', 'ANSWERED', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'REQUESTED',
    `provider_request_uuid` VARCHAR(128) NULL,
    `provider_call_uuid` VARCHAR(128) NULL,
    `destination_last_4` CHAR(4) NULL,
    `active_clinic_id` VARCHAR(191) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `answered_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `failure_category` ENUM('NO_ANSWER', 'BUSY', 'PROVIDER_ERROR', 'UNKNOWN') NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinic_test_calls_active_clinic_key`(`active_clinic_id`),
    INDEX `clinic_test_calls_clinic_created_idx`(`clinic_id`, `created_at`),
    INDEX `clinic_test_calls_requester_created_idx`(`requested_by_user_id`, `created_at`),
    INDEX `clinic_test_calls_status_expiry_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `clinic_telephony_test_calls`
    ADD CONSTRAINT `clinic_test_calls_clinic_fkey`
    FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `clinic_telephony_test_calls`
    ADD CONSTRAINT `clinic_test_calls_requester_fkey`
    FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
