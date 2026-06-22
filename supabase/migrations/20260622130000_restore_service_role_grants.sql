-- Restore PostgREST privileges for service_role after project transfer.
-- Edge functions (admin-create-user, admin-update-user, etc.) use the service
-- role key; without table GRANTs PostgREST returns 403 even though RLS is bypassed.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;

-- Ensure admin ALL policies have explicit WITH CHECK for INSERT/UPDATE.
DROP POLICY IF EXISTS "Admin full access to user_roles" ON public.user_roles;
CREATE POLICY "Admin full access to user_roles"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin manage branches" ON public.branches;
CREATE POLICY "Admin manage branches"
  ON public.branches
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin manage checklist_templates" ON public.checklist_templates;
CREATE POLICY "Admin manage checklist_templates"
  ON public.checklist_templates
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin manage branch_types" ON public.branch_types;
CREATE POLICY "Admin manage branch_types"
  ON public.branch_types
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin manage risk_classifications" ON public.risk_classifications;
CREATE POLICY "Admin manage risk_classifications"
  ON public.risk_classifications
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
