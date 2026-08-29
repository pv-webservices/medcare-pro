-- Some installations have not yet run the independent Dashboard Data role
-- top-up. Recognise those earlier untouched snapshots and add only Tasks
-- rights; do not grant the unrelated dashboard rights from that other stage.

UPDATE `roles`
SET `permissions` = JSON_MERGE_PRESERVE(
  `permissions`,
  JSON_ARRAY('task:view', 'task:create', 'task:assign', 'task:update', 'task:complete', 'task:delete', 'task:manage', 'dashboard:tasks:view')
)
WHERE `key` = 'CLINIC_ADMIN'
  AND `is_system` = TRUE
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_LENGTH(`permissions`) = 41
  AND JSON_CONTAINS(
    `permissions`,
    '["clinic:read","clinic:create","clinic:edit","doctor:read","doctor:create","doctor:edit","doctor:delete","patient:read","patient:create","patient:edit","registration:read","registration:create","registration:edit","registration:history:read","report:read","reports:view","reports:export","notification:read","message:send","message:template","role:read","role:manage","settings:view","settings:manage","team:view","team:invite","team:approve","team:manage","feature:view","feature:manage","audit:read","appointment:read","appointment:create","appointment:update","appointment:reschedule","appointment:cancel","appointment:checkin","appointment:convert","appointment:type:manage","marketing:view","marketing:manage"]'
  );

UPDATE `roles`
SET `permissions` = JSON_MERGE_PRESERVE(
  `permissions`,
  JSON_ARRAY('dashboard:tasks:view', 'task:view', 'task:create', 'task:complete')
)
WHERE `key` = 'DOCTOR'
  AND `is_system` = TRUE
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_LENGTH(`permissions`) = 6
  AND JSON_CONTAINS(
    `permissions`,
    '["clinic:read","doctor:read","patient:read","registration:read","notification:read","appointment:read"]'
  );

UPDATE `roles`
SET `permissions` = JSON_MERGE_PRESERVE(
  `permissions`,
  JSON_ARRAY('dashboard:tasks:view', 'task:view', 'task:create', 'task:complete')
)
WHERE `key` = 'RECEPTIONIST'
  AND `is_system` = TRUE
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_LENGTH(`permissions`) = 17
  AND JSON_CONTAINS(
    `permissions`,
    '["clinic:read","doctor:read","patient:read","patient:create","patient:edit","registration:read","registration:create","registration:edit","notification:read","message:send","appointment:read","appointment:create","appointment:update","appointment:reschedule","appointment:cancel","appointment:checkin","appointment:convert"]'
  );

UPDATE `roles`
SET `permissions` = JSON_MERGE_PRESERVE(
  `permissions`,
  JSON_ARRAY('dashboard:tasks:view', 'task:view', 'task:complete')
)
WHERE `key` = 'STAFF'
  AND `is_system` = TRUE
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_LENGTH(`permissions`) = 8
  AND JSON_CONTAINS(
    `permissions`,
    '["clinic:read","doctor:read","patient:read","patient:create","patient:edit","registration:read","registration:create","registration:edit"]'
  );

