-- Backfill branch geometry and expose coordinates from Near Me RPC.

UPDATE public.branches
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND geom IS NULL;

DROP FUNCTION IF EXISTS public.branches_within_radius(numeric, numeric, integer);

CREATE OR REPLACE FUNCTION public.branches_within_radius(
  lat            numeric,
  lon            numeric,
  radius_metres  integer
)
RETURNS TABLE (
  id               uuid,
  branch_name      text,
  city             text,
  location         text,
  latitude         numeric,
  longitude        numeric,
  geofence_radius  integer,
  store_code       text,
  incharge_name    text,
  incharge_phone   text,
  distance_metres  numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('management', 'admin', 'officer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.branch_name,
    b.city,
    b.location,
    b.latitude,
    b.longitude,
    COALESCE(b.geofence_radius, 200),
    b.store_code,
    b.incharge_name,
    b.incharge_phone,
    ROUND(
      public.haversine_metres(lat, lon, b.latitude, b.longitude)::numeric,
      2
    ) AS distance_metres
  FROM public.branches b
  WHERE b.is_active = true
    AND b.deleted_at IS NULL
    AND b.latitude IS NOT NULL
    AND b.longitude IS NOT NULL
    AND public.haversine_metres(lat, lon, b.latitude, b.longitude) <= radius_metres
  ORDER BY distance_metres;
END;
$$;

REVOKE ALL ON FUNCTION public.branches_within_radius(numeric, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.branches_within_radius(numeric, numeric, integer) TO authenticated;
