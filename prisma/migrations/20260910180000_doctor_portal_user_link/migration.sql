-- Add an optional, history-preserving portal identity to Doctor profiles.
-- Existing rows intentionally remain NULL; no identity is inferred from names,
-- email addresses, phone numbers, or role labels.
ALTER TABLE `doctors` ADD COLUMN `user_id` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `doctors_clinic_id_user_id_key`
  ON `doctors`(`clinic_id`, `user_id`);
CREATE INDEX `doctors_user_id_idx` ON `doctors`(`user_id`);

ALTER TABLE `doctors`
  ADD CONSTRAINT `doctors_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
