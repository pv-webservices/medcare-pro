-- Phase 6: privacy-bounded production IVR observability. Existing calls are
-- not backfilled; test calls and booking requests remain separate domains.

CREATE TABLE `clinic_telephony_calls` (
    `id` VARCHAR(191) NOT NULL,
    `clinic_id` VARCHAR(191) NOT NULL,
    `provider_call_uuid` VARCHAR(128) NOT NULL,
    `caller_last_4` CHAR(4) NULL,
    `status` ENUM('ACTIVE', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE',
    `initial_route` ENUM('RECEPTION', 'IVR') NULL,
    `routing_mode_at_start` ENUM('AUTO', 'OPEN', 'AFTER_HOURS') NOT NULL,
    `phone_menu_source` ENUM('DEFAULT', 'CUSTOM') NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,
    `duration_seconds` INTEGER NULL,
    `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clinic_calls_provider_uuid_key`(`provider_call_uuid`),
    INDEX `clinic_calls_clinic_started_idx`(`clinic_id`, `started_at`),
    INDEX `clinic_calls_started_idx`(`started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `clinic_telephony_call_events` (
    `id` VARCHAR(191) NOT NULL,
    `call_id` VARCHAR(191) NOT NULL,
    `event_type` ENUM(
        'CALL_RECEIVED',
        'ROUTED_TO_RECEPTION',
        'ROUTED_TO_IVR',
        'MAIN_MENU_TOMORROW_SLOTS',
        'MAIN_MENU_APPOINTMENT_BOOKING',
        'MAIN_MENU_URGENT_ASSISTANCE',
        'MAIN_MENU_CLINIC_INFORMATION',
        'MAIN_MENU_REPEAT',
        'MAIN_MENU_INVALID_INPUT',
        'MENU_REVISION_REFRESHED',
        'APPOINTMENTS_UNAVAILABLE',
        'RECEPTION_CONNECTED',
        'RECEPTION_FAILED',
        'RECEPTION_FALLBACK_TO_IVR',
        'URGENT_TRANSFER_CONNECTED',
        'URGENT_TRANSFER_FAILED',
        'URGENT_TRANSFER_UNAVAILABLE',
        'BOOKING_FOLLOW_UP_CREATED',
        'CALL_COMPLETED'
    ) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `clinic_call_events_call_type_key`(`call_id`, `event_type`),
    INDEX `clinic_call_events_call_occurred_idx`(`call_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `clinic_telephony_calls`
    ADD CONSTRAINT `clinic_calls_clinic_fkey`
    FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `clinic_telephony_call_events`
    ADD CONSTRAINT `clinic_call_events_call_fkey`
    FOREIGN KEY (`call_id`) REFERENCES `clinic_telephony_calls`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
