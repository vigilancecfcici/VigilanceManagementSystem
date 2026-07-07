-- Fix geofence verification without requiring PostGIS.
-- Uses lat/lon columns directly, sets location_status on submit,
-- and backfills previously unverified inspections that have GPS data.

CREATE OR REPLACE FUNCTION public.haversine_metres(
  lat1 numeric,
  lon1 numeric,
  lat2 numeric,
  lon2 numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  earth_radius constant numeric := 6371000;
  dlat numeric;
  dlon numeric;
  a numeric;
BEGIN
  IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
    RETURN NULL;
  END IF;

  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);
  a := sin(dlat / 2) * sin(dlat / 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) * sin(dlon / 2);

  RETURN earth_radius * 2 * atan2(sqrt(a), sqrt(1 - a));
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_inspection_location_status(
  p_inspection_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_officer_lat numeric;
  v_officer_lon numeric;
  v_branch_lat numeric;
  v_branch_lon numeric;
  v_geofence_radius integer;
  v_distance numeric;
BEGIN
  SELECT
    i.officer_latitude,
    i.officer_longitude,
    b.latitude,
    b.longitude,
    COALESCE(b.geofence_radius, 200)
  INTO v_officer_lat, v_officer_lon, v_branch_lat, v_branch_lon, v_geofence_radius
  FROM public.inspections i
  JOIN public.branches b ON b.id = i.branch_id
  WHERE i.id = p_inspection_id
  LIMIT 1;

  IF NOT FOUND
     OR v_officer_lat IS NULL
     OR v_officer_lon IS NULL
     OR v_branch_lat IS NULL
     OR v_branch_lon IS NULL THEN
    RETURN 'unverified';
  END IF;

  v_distance := public.haversine_metres(
    v_officer_lat,
    v_officer_lon,
    v_branch_lat,
    v_branch_lon
  );

  IF v_distance IS NULL THEN
    RETURN 'unverified';
  END IF;

  IF v_distance <= v_geofence_radius THEN
    RETURN 'inside';
  END IF;

  RETURN 'outside';
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'unverified';
END;
$$;

REVOKE ALL ON FUNCTION public.compute_inspection_location_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_inspection_location_status(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_inspection_location_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_lat numeric;
  v_branch_lon numeric;
  v_geofence_radius integer;
  v_distance numeric;
BEGIN
  IF NEW.status = 'submitted'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT b.latitude, b.longitude, COALESCE(b.geofence_radius, 200)
    INTO v_branch_lat, v_branch_lon, v_geofence_radius
    FROM public.branches b
    WHERE b.id = NEW.branch_id;

    IF NEW.officer_latitude IS NULL
       OR NEW.officer_longitude IS NULL
       OR v_branch_lat IS NULL
       OR v_branch_lon IS NULL THEN
      NEW.location_status := 'unverified';
    ELSE
      v_distance := public.haversine_metres(
        NEW.officer_latitude,
        NEW.officer_longitude,
        v_branch_lat,
        v_branch_lon
      );

      IF v_distance IS NULL THEN
        NEW.location_status := 'unverified';
      ELSIF v_distance <= v_geofence_radius THEN
        NEW.location_status := 'inside';
      ELSE
        NEW.location_status := 'outside';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_location_status ON public.inspections;
CREATE TRIGGER trg_inspection_location_status
BEFORE INSERT OR UPDATE ON public.inspections
FOR EACH ROW EXECUTE FUNCTION public.trg_inspection_location_status();

UPDATE public.inspections i
SET location_status = public.compute_inspection_location_status(i.id)
WHERE i.status = 'submitted'
  AND i.officer_latitude IS NOT NULL
  AND i.officer_longitude IS NOT NULL
  AND (i.location_status IS NULL OR i.location_status = 'unverified');
