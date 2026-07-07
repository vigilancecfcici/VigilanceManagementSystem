/** Normalize branch GPS values from Supabase (numeric columns may arrive as strings). */
export function normalizeCoordinate(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeGeofenceRadius(value: unknown, fallback = 200): number {
  const parsed = normalizeCoordinate(value);
  if (parsed == null || parsed <= 0) return fallback;
  return Math.round(parsed);
}

export interface BranchCoordinateInput {
  latitude?: unknown;
  longitude?: unknown;
  geofence_radius?: unknown;
}

export function resolveBranchCoordinates(branch: BranchCoordinateInput | null | undefined) {
  return {
    latitude: normalizeCoordinate(branch?.latitude),
    longitude: normalizeCoordinate(branch?.longitude),
    geofence_radius: normalizeGeofenceRadius(branch?.geofence_radius),
  };
}

export function branchHasCoordinates(branch: BranchCoordinateInput | null | undefined): boolean {
  const { latitude, longitude } = resolveBranchCoordinates(branch);
  return latitude != null && longitude != null;
}
