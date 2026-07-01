export interface GeocodeResult {
  city: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
}

type GeocodeHit = {
  latitude: number;
  longitude: number;
  city: string | null;
  district: string | null;
};

const KERALA_DISTRICTS = [
  'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam',
  'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram', 'Kozhikode',
  'Wayanad', 'Kannur', 'Kasaragod',
];

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Puducherry',
];

function matchDistrictFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const district of KERALA_DISTRICTS) {
    if (lower.includes(district.toLowerCase())) return district;
  }
  return null;
}

function isIndianState(part: string): boolean {
  const normalized = part.trim().toLowerCase();
  return INDIAN_STATES.some((state) => state.toLowerCase() === normalized);
}

function stripPlusCodes(address: string): string {
  return address.replace(/\b[A-Z0-9]{4,}\+[A-Z0-9]{2,3}\b,?\s*/gi, '').trim();
}

function extractPincode(address: string): string | null {
  const match = address.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

function extractState(address: string): string | null {
  for (const state of INDIAN_STATES) {
    if (address.toLowerCase().includes(state.toLowerCase())) return state;
  }
  return null;
}

function withIndiaSuffix(query: string): string {
  return /\bindia\b/i.test(query) ? query : `${query}, India`;
}

function parseCityFromAddress(address: string): string | null {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
      .replace(/\b\d{6}\b/g, '')
      .replace(/\bIndia\b/gi, '')
      .trim();
    if (!part) continue;
    if (isIndianState(part)) continue;
    if (KERALA_DISTRICTS.some((d) => d.toLowerCase() === part.toLowerCase())) continue;
    if (/^\d+$/.test(part)) continue;
    if (/^[A-Z0-9]{4,}\+[A-Z0-9]{2,3}$/i.test(part)) continue;
    if (/^(road|rd|street|st|nh\d+)$/i.test(part)) continue;
    return part;
  }
  return null;
}

function isValidIndiaCoordinate(lat: number, lng: number): boolean {
  return !Number.isNaN(lat) && !Number.isNaN(lng) && lat >= 6 && lat <= 37 && lng >= 68 && lng <= 97;
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(6));
}

function parseEmbeddedCoordinates(text: string): { latitude: number; longitude: number } | null {
  const patterns = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{2,3}\.\d+)/,
    /[?&]q=(-?\d{1,2}\.\d+),\s*(-?\d{2,3}\.\d+)/,
    /(?:^|\s)(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{2,3}\.\d{4,})(?:\s|$)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const latitude = Number.parseFloat(match[1]);
    const longitude = Number.parseFloat(match[2]);
    if (isValidIndiaCoordinate(latitude, longitude)) {
      return { latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
    }
  }
  return null;
}

function buildGeocodeQueries(address: string): string[] {
  const trimmed = address.trim();
  const withoutPlus = stripPlusCodes(trimmed);
  const pincode = extractPincode(trimmed);
  const state = extractState(trimmed);
  const city = parseCityFromAddress(trimmed);
  const queries: string[] = [];

  const push = (value: string) => {
    const q = withIndiaSuffix(value.trim());
    if (q.length >= 5 && !queries.includes(q)) queries.push(q);
  };

  if (city && state && pincode) push(`${city}, ${state} ${pincode}`);
  if (city && state) push(`${city}, ${state}`);
  push(withoutPlus);
  if (withoutPlus !== trimmed) push(trimmed);
  if (pincode && state) push(`${pincode}, ${state}`);
  if (pincode) push(pincode);

  return queries;
}

function pickCity(props: Record<string, string | undefined>, fallback: string | null): string | null {
  const candidates = [props.city, props.town, props.village, props.locality, props.name];
  for (const value of candidates) {
    if (!value) continue;
    if (/^\d{6}$/.test(value)) continue;
    if (isIndianState(value)) continue;
    return value;
  }
  return fallback;
}

async function searchPhoton(query: string): Promise<GeocodeHit | null> {
  const res = await fetch(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=en`,
    { headers: { Accept: 'application/json', 'User-Agent': 'VigilanceAdmin/1.0' } },
  );
  if (!res.ok) return null;

  const data = await res.json() as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, string | undefined>;
    }>;
  };

  const feature = data.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;

  const longitude = coords[0];
  const latitude = coords[1];
  if (!isValidIndiaCoordinate(latitude, longitude)) return null;

  const props = feature.properties ?? {};
  return {
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
    city: pickCity(props, null),
    district:
      matchDistrictFromText([props.county, props.state, props.district].filter(Boolean).join(' ')) ??
      props.county ??
      props.district ??
      null,
  };
}

async function searchNominatim(query: string): Promise<GeocodeHit | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=in&addressdetails=1`,
    { headers: { Accept: 'application/json', 'User-Agent': 'VigilanceAdmin/1.0 (branch-setup)' } },
  );
  if (!res.ok) return null;

  const data = await res.json() as Array<{
    lat: string;
    lon: string;
    address?: Record<string, string>;
  }>;
  if (!Array.isArray(data) || data.length === 0) return null;

  const hit = data[0];
  const addr = hit.address ?? {};
  const latitude = Number.parseFloat(hit.lat);
  const longitude = Number.parseFloat(hit.lon);
  if (!isValidIndiaCoordinate(latitude, longitude)) return null;

  return {
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
    city: pickCity(addr, null),
    district:
      matchDistrictFromText(
        [addr.county, addr.state_district, addr.district].filter(Boolean).join(' '),
      ) ??
      addr.county ??
      addr.state_district ??
      addr.district ??
      null,
  };
}

async function resolveGeocodeHit(address: string): Promise<GeocodeHit | null> {
  const queries = buildGeocodeQueries(address);
  for (const query of queries) {
    const photonHit = await searchPhoton(query);
    if (photonHit) return photonHit;
  }
  for (const query of queries) {
    const nominatimHit = await searchNominatim(query);
    if (nominatimHit) return nominatimHit;
  }
  return null;
}

export async function geocodeAddressText(address: string): Promise<GeocodeResult> {
  const trimmed = address.trim();
  if (trimmed.length < 10) {
    return { city: null, district: null, latitude: null, longitude: null };
  }

  const districtFromText = matchDistrictFromText(trimmed);
  const cityFromText = parseCityFromAddress(trimmed);
  const embedded = parseEmbeddedCoordinates(trimmed);

  if (embedded) {
    return {
      city: cityFromText,
      district: districtFromText,
      latitude: embedded.latitude,
      longitude: embedded.longitude,
    };
  }

  const hit = await resolveGeocodeHit(trimmed);
  if (!hit) {
    return {
      city: cityFromText,
      district: districtFromText,
      latitude: null,
      longitude: null,
    };
  }

  return {
    city: hit.city ?? cityFromText,
    district: hit.district ?? districtFromText,
    latitude: hit.latitude,
    longitude: hit.longitude,
  };
}
