import { useState, useCallback } from 'react';
import * as Location from 'expo-location';

export type LocationGateStatus =
  | 'idle'
  | 'requesting_permission'
  | 'fetching'
  | 'within_range'
  | 'out_of_range'
  | 'no_branch_coords'
  | 'permission_denied'
  | 'error';

export interface OfficerCoords {
  latitude: number;
  longitude: number;
}

export interface LocationGateResult {
  status: LocationGateStatus;
  distanceMetres: number | null;
  officerCoords: OfficerCoords | null;
  check: () => Promise<void>;
  reset: () => void;
}

function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useLocationGate(
  branchLat: number | null | undefined,
  branchLon: number | null | undefined,
  radiusMetres: number = 200,
): LocationGateResult {
  const [status, setStatus] = useState<LocationGateStatus>('idle');
  const [distanceMetres, setDistanceMetres] = useState<number | null>(null);
  const [officerCoords, setOfficerCoords] = useState<OfficerCoords | null>(null);

  const check = useCallback(async () => {
    try {
      setStatus('requesting_permission');
      const { status: permStatus } =
        await Location.requestForegroundPermissionsAsync();

      if (permStatus !== 'granted') {
        setStatus('permission_denied');
        return;
      }

      setStatus('fetching');
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = position.coords;
      const coords: OfficerCoords = { latitude, longitude };
      setOfficerCoords(coords);

      if (branchLat == null || branchLon == null) {
        setStatus('no_branch_coords');
        setDistanceMetres(null);
        return;
      }

      const dist = haversineMetres(latitude, longitude, branchLat, branchLon);
      setDistanceMetres(Math.round(dist));

      setStatus(dist <= radiusMetres ? 'within_range' : 'out_of_range');
    } catch {
      setStatus('error');
    }
  }, [branchLat, branchLon, radiusMetres]);

  const reset = useCallback(() => {
    setStatus('idle');
    setDistanceMetres(null);
    setOfficerCoords(null);
  }, []);

  return { status, distanceMetres, officerCoords, check, reset };
}
