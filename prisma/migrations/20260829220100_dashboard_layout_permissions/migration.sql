-- Dashboard customization is presentation-only. The account Owner receives
-- these through `*`; existing seeded roles are topped up explicitly.
UPDATE `roles`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'dashboard:customize')
WHERE `is_system` = TRUE
  AND `key` IN ('CLINIC_ADMIN', 'DOCTOR', 'RECEPTIONIST', 'STAFF')
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND NOT JSON_CONTAINS(`permissions`, '"dashboard:customize"');

UPDATE `roles`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'dashboard:layout:manage')
WHERE `is_system` = TRUE
  AND `key` = 'CLINIC_ADMIN'
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND NOT JSON_CONTAINS(`permissions`, '"dashboard:layout:manage"');
