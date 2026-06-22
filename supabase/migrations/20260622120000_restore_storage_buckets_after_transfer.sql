-- Restore storage buckets lost during Supabase project transfer.
-- Storage buckets are NOT included in SQL schema migrations and must be
-- recreated manually after a project transfer or fresh provisioning.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-files',
  'inspection-files',
  false,
  524288000,
  ARRAY[
    'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif',
    'application/pdf','application/octet-stream',
    'video/mp4','video/quicktime','video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
SET file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types,
    public = false;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photos',
  'profile-photos',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Officers read own inspection files" ON storage.objects;
DROP POLICY IF EXISTS "Officers upload own inspection files" ON storage.objects;
DROP POLICY IF EXISTS "Head/admin read all inspection files" ON storage.objects;
DROP POLICY IF EXISTS inspection_files_insert_authenticated ON storage.objects;
DROP POLICY IF EXISTS inspection_files_select_authenticated ON storage.objects;
DROP POLICY IF EXISTS inspection_files_select_public ON storage.objects;
DROP POLICY IF EXISTS inspection_files_owner_or_staff_select ON storage.objects;
DROP POLICY IF EXISTS inspection_files_owner_path_insert ON storage.objects;
DROP POLICY IF EXISTS inspection_files_officer_draft_insert ON storage.objects;
DROP POLICY IF EXISTS inspection_files_staff_insert ON storage.objects;
DROP POLICY IF EXISTS inspection_files_staff_select ON storage.objects;
DROP POLICY IF EXISTS profile_photos_owner_insert ON storage.objects;
DROP POLICY IF EXISTS profile_photos_owner_update ON storage.objects;
DROP POLICY IF EXISTS profile_photos_public_select ON storage.objects;

CREATE POLICY inspection_files_officer_draft_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-files'
    AND (storage.foldername(name))[1] = 'inspections'
    AND EXISTS (
      SELECT 1
      FROM public.inspections i
      WHERE i.id::text = (storage.foldername(name))[2]
        AND i.officer_id = public.current_user_roles_id()
        AND i.status IN ('draft', 'submitted')
    )
  );

CREATE POLICY inspection_files_staff_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-files'
    AND (storage.foldername(name))[1] = 'inspections'
    AND public.current_user_role() IN ('admin', 'head', 'management')
  );

CREATE POLICY inspection_files_staff_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'inspection-files'
    AND (
      public.current_user_role() IN ('admin', 'head', 'management', 'audit')
      OR owner = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.inspections i
        WHERE i.officer_id = public.current_user_roles_id()
          AND (storage.foldername(name))[1] = 'inspections'
          AND (storage.foldername(name))[2] = i.id::text
      )
    )
  );

CREATE POLICY profile_photos_owner_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = public.current_user_roles_id()::text
  );

CREATE POLICY profile_photos_owner_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = public.current_user_roles_id()::text
  )
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = public.current_user_roles_id()::text
  );

CREATE POLICY profile_photos_public_select
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'profile-photos');

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.district_assignments ENABLE ROW LEVEL SECURITY;

-- Re-assert realtime publication tables (also lost on project transfer)
DO $$
DECLARE
  t text;
  required text[] := ARRAY[
    'inspections',
    'inspection_responses',
    'inspection_files',
    'stores',
    'branches',
    'branch_daily_locks',
    'notifications',
    'escalation_tickets'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = t
    ) AND EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;
