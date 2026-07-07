import * as Location from 'expo-location';

export interface OfficerLocationCapture {
  latitude: number;
  longitude: number;
}

/** Best-effort GPS capture at inspection submit — never blocks submission. */
export async function captureOfficerLocation(
  fallback?: OfficerLocationCapture | null,
): Promise<OfficerLocationCapture | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const requested = await Location.requestForegroundPermissionsAsync();
      if (requested.status !== 'granted') return fallback ?? null;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const { latitude, longitude } = position.coords;
    if (
      latitude == null ||
      longitude == null ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude)
    ) {
      return fallback ?? null;
    }

    return { latitude, longitude };
  } catch {
    return fallback ?? null;
  }
}
