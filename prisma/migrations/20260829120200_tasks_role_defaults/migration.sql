-- Safely top up only untouched seeded roles. Stable role keys are migration
-- metadata; runtime task authorization remains permission-derived.

UPDATE `roles`
SET `permissions` = JSON_MERGE_PRESERVE(
  `permissions`,
  JSON_ARRAY('task:view', 'task:create', 'task:assign', 'task:update', 'task:complete', 'task:delete', 'task:manage', 'dashboard:tasks:view')
)
WHERE `key` = 'CLINIC_ADMIN'
  AND `is_system` = TRUE
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_LENGTH(`permissions`) = 50
  AND JSON_CONTAINS(
    `permissions`,
    '["clinic:read","clinic:create","clinic:edit","doctor:read","doctor:create","doctor:edit","doctor:delete","patient:read","patient:create","patient:edit","registration:read","registration:create","registration:edit","registration:history:read","report:read","reports:view","reports:export","notification:read","message:send","message:template","role:read","role:manage","settings:view","settings:manage","team:view","team:invite","team:approve","team:manage","feature:view","feature:manage","audit:read","appointment:read","appointment:create","appointment:update","appointment:reschedule","appointment:cancel","appointment:checkin","appointment:convert","appointment:type:manage","marketing:view","marketing:manage","dashboard:view","dashboard:appointments:view","dashboard:registrations:view","dashboard:revenue:view","dashboard:doctors:view","dashboard:activity:view","dashboard:notifications:view","dashboard:team:view","dashboard:clinics:view"]'
  );

UPDATE `roles`
SET `permissions` = JSON_MERGE_PRESERVE(
  `permissions`,
  JSON_ARRAY('dashboard:tasks:view', 'task:view', 'task:create', 'task:complete')
)
WHERE `key` = 'DOCTOR'
  AND `is_system` = TRUE
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_LENGTH(`permissions`) = 10
  AND JSON_CONTAINS(
    `permissions`,
    '["clinic:read","doctor:read","patient:read","registration:read","notification:read","appointment:read","dashboard:view","dashboard:appointments:view","dashboard:registrations:view","dashboard:notifications:view"]'
  );

UPDATE `roles`
SET `permissions` = JSON_MERGE_PRESERVE(
  `permissions`,
  JSON_ARRAY('dashboard:tasks:view', 'task:view', 'task:create', 'task:complete')
)
WHERE `key` = 'RECEPTIONIST'
  AND `is_system` = TRUE
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_LENGTH(`permissions`) = 21
  AND JSON_CONTAINS(
    `permissions`,
    '["clinic:read","doctor:read","patient:read","patient:create","patient:edit","registration:read","registration:create","registration:edit","notification:read","message:send","appointment:read","appointment:create","appointment:update","appointment:reschedule","appointment:cancel","appointment:checkin","appointment:convert","dashboard:view","dashboard:appointments:view","dashboard:registrations:view","dashboard:notifications:view"]'
  );

UPDATE `roles`
SET `permissions` = JSON_MERGE_PRESERVE(
  `permissions`,
  JSON_ARRAY('dashboard:tasks:view', 'task:view', 'task:complete')
)
WHERE `key` = 'STAFF'
  AND `is_system` = TRUE
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_LENGTH(`permissions`) = 10
  AND JSON_CONTAINS(
    `permissions`,
    '["clinic:read","doctor:read","patient:read","patient:create","patient:edit","registration:read","registration:create","registration:edit","dashboard:view","dashboard:registrations:view"]'
  );
