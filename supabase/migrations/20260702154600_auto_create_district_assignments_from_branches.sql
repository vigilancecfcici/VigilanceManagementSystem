-- Auto-create district assignments when new districts appear in branches.region.
-- This keeps the map + district officers UI in sync when admins add a branch
-- with a brand-new district name.

-- Ensure we can upsert a single primary row per district.
CREATE UNIQUE INDEX IF NOT EXISTS district_assignments_primary_district_key
  ON public.district_assignments (district)
  WHERE is_primary = true;

-- Backfill any missing primary assignments for districts already present in branches.
INSERT INTO public.district_assignments (district, officer_id, is_primary, is_on_leave)
SELECT DISTINCT b.region, NULL::uuid, true, false
FROM public.branches b
WHERE b.region IS NOT NULL
  AND b.region <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.district_assignments da
    WHERE da.district = b.region
      AND da.is_primary = true
  );

CREATE OR REPLACE FUNCTION public.ensure_primary_district_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  d text;
BEGIN
  d := NULLIF(BTRIM(NEW.region), '');
  IF d IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.district_assignments da
    WHERE da.district = d
      AND da.is_primary = true
  ) THEN
    INSERT INTO public.district_assignments (district, officer_id, is_primary, is_on_leave)
    VALUES (d, NULL::uuid, true, false);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branches_ensure_district_assignment ON public.branches;
CREATE TRIGGER trg_branches_ensure_district_assignment
AFTER INSERT OR UPDATE OF region
ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.ensure_primary_district_assignment();

