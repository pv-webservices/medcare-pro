-- Register IVR as a CORE feature and include it in the default Standard plan.
-- Create-only: an existing feature or deliberate plan decision is untouched.

INSERT INTO `features` (
  `id`, `key`, `name`, `description`, `tier`, `global_enabled`, `created_at`, `updated_at`
)
SELECT
  'feature_ivr_20260903',
  'ivr',
  'IVR',
  'Automated phone menus, call routing, and telephone appointment booking.',
  'CORE',
  TRUE,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `features` WHERE `key` = 'ivr'
);

INSERT INTO `plan_features` (
  `id`, `plan_id`, `feature_id`, `enabled`, `created_at`, `updated_at`
)
SELECT
  CONCAT('ivr_', LEFT(MD5(CONCAT(`plans`.`id`, `features`.`id`)), 24)),
  `plans`.`id`,
  `features`.`id`,
  TRUE,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `plans`
JOIN `features` ON `features`.`key` = 'ivr'
WHERE `plans`.`key` = 'standard'
  AND NOT EXISTS (
    SELECT 1
    FROM `plan_features`
    WHERE `plan_features`.`plan_id` = `plans`.`id`
      AND `plan_features`.`feature_id` = `features`.`id`
  );
