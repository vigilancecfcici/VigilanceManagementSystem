-- Per-option highlight colors for checklist items (RED / GREEN / YELLOW when selected).
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS option_colors jsonb DEFAULT NULL;

COMMENT ON COLUMN public.checklist_templates.option_colors IS
  'Map of lowercase option label -> highlight color (RED, GREEN, YELLOW) when officer selects that answer.';

-- Remove district assignments when no active, non-deleted branches remain in that district.
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_district(p_district text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_district IS NULL OR btrim(p_district) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.region = p_district
      AND b.deleted_at IS NULL
      AND b.is_active = true
  ) THEN
    DELETE FROM public.district_assignments
    WHERE district = p_district;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_branches_cleanup_district()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_district text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.region IS NOT NULL AND (
      (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
      OR (OLD.is_active = true AND NEW.is_active = false)
      OR (OLD.region IS DISTINCT FROM NEW.region)
    ) THEN
      old_district := OLD.region;
      PERFORM public.cleanup_orphaned_district(old_district);
    END IF;
    IF NEW.region IS DISTINCT FROM OLD.region AND NEW.region IS NOT NULL THEN
      PERFORM public.cleanup_orphaned_district(NEW.region);
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.region IS NOT NULL THEN
    PERFORM public.cleanup_orphaned_district(OLD.region);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_branches_cleanup_district ON public.branches;
CREATE TRIGGER trg_branches_cleanup_district
  AFTER UPDATE OF deleted_at, is_active, region OR DELETE
  ON public.branches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_branches_cleanup_district();

-- Customer movement: YES should highlight green when selected.
UPDATE public.checklist_templates ct
SET option_colors = jsonb_build_object('yes', 'GREEN', 'no', 'RED', 'n/a', 'YELLOW')
WHERE ct.item_text ILIKE '%customer movement%'
  AND ct.is_active = true;
