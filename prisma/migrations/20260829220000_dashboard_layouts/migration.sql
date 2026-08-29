-- Normalized, versioned dashboard presentation preferences. Authorization
-- remains in role permissions; these rows never grant data access.
CREATE TABLE `dashboard_layouts` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `role_id` VARCHAR(191) NULL,
    `layout` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dashboard_layouts_tenant_id_user_id_key`(`tenant_id`, `user_id`),
    UNIQUE INDEX `dashboard_layouts_tenant_id_role_id_key`(`tenant_id`, `role_id`),
    INDEX `dashboard_layouts_tenant_id_idx`(`tenant_id`),
    INDEX `dashboard_layouts_user_id_idx`(`user_id`),
    INDEX `dashboard_layouts_role_id_idx`(`role_id`),
    CONSTRAINT `dashboard_layouts_exactly_one_subject` CHECK ((`user_id` IS NULL) <> (`role_id` IS NULL)),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `dashboard_layouts` ADD CONSTRAINT `dashboard_layouts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `dashboard_layouts` ADD CONSTRAINT `dashboard_layouts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `dashboard_layouts` ADD CONSTRAINT `dashboard_layouts_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
