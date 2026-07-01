-- Restore admin dashboard access when the canonical admin row was soft-deleted.
-- Web login requires user_roles.is_active = true AND deleted_at IS NULL.

UPDATE public.user_roles ur
SET
  is_active = true,
  deleted_at = NULL
FROM auth.users u
WHERE ur.user_id = u.id
  AND u.email = 'admin@vigilance.app'
  AND (ur.is_active IS DISTINCT FROM true OR ur.deleted_at IS NOT NULL);
