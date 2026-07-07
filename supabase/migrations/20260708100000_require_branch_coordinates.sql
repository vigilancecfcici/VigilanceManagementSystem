-- Prevent active branches from being saved without GPS coordinates.
-- Ensures future branch additions always support location verification.

CREATE OR REPLACE FUNCTION public.trg_branch_require_coordinates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.is_active, true)
     AND (NEW.latitude IS NULL OR NEW.longitude IS NULL) THEN
    RAISE EXCEPTION
      'Active branches must have latitude and longitude. Geocode the address before saving.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branch_require_coordinates ON public.branches;
CREATE TRIGGER trg_branch_require_coordinates
BEFORE INSERT OR UPDATE ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.trg_branch_require_coordinates();
