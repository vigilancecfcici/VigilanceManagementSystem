import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet.heat';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../../lib/supabase';
import { storeDistrict } from '../../lib/districtCalculations';

// Fix Leaflet default marker icon paths broken by Vite bundling
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface Branch {
  id: string;
  branch_name: string;
  city: string;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface Inspection {
  id: string;
  branch_id: string;
  officer_latitude: number | null;
  officer_longitude: number | null;
  status: string;
  inspection_date: string;
  compliance_score: number | null;
  risk_level: string | null;
  branch_name?: string;
  officer_name?: string;
}

interface BranchHeatStat {
  count: number;
  scoreSum: number;
}

interface BranchHeatPoint {
  branchId: string;
  branchName: string;
  city: string;
  latitude: number;
  longitude: number;
  visits: number;
  avgScore: number;
  colour: string;
  label: string;
}

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

const RISK_COLOURS: Record<RiskLevel | 'unknown', string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
  unknown: '#94a3b8',
};

function riskColour(level: string | null | undefined): string {
  return RISK_COLOURS[(level?.toLowerCase() as RiskLevel) ?? 'unknown'] ?? RISK_COLOURS.unknown;
}

function makeCircleIcon(color: string, size = 12) {
  const dot = Math.max(8, size);
  const anchor = Math.floor(dot / 2);
  return L.divIcon({
    className: '',
    html: `<div style="width:${dot}px;height:${dot}px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 10px ${color}88,0 2px 8px rgba(0,0,0,.55)"></div>`,
    iconSize: [dot, dot],
    iconAnchor: [anchor, anchor],
  });
}

function scoreHeatColour(avgScore: number): string {
  if (avgScore >= 85) return '#16a34a';
  if (avgScore >= 70) return '#eab308';
  return '#dc2626';
}

function scoreHeatLabel(avgScore: number): string {
  if (avgScore >= 85) return 'Healthy';
  if (avgScore >= 70) return 'Normal';
  return 'Critical';
}

function scoreHeatRadius(avgScore: number, visits: number): number {
  return 280 + visits * 65 + Math.max(0, 82 - avgScore) * 16;
}

function scoreHeatOpacity(avgScore: number): number {
  if (avgScore >= 85) return 0.28;
  if (avgScore >= 70) return 0.36;
  return 0.48;
}

function heatIntensityForScore(avgScore: number, visitWeight = 1): number {
  const severity = Math.max(0, (100 - avgScore) / 100);
  const weighted = severity * (0.65 + Math.min(visitWeight, 2.2) * 0.25);
  return Math.min(1, Math.max(0.08, weighted));
}

function toScoreFromRisk(level: string | null | undefined): number {
  const key = String(level ?? '').toLowerCase();
  if (key === 'critical' || key === 'red') return 48;
  if (key === 'high') return 62;
  if (key === 'medium' || key === 'yellow') return 76;
  if (key === 'low' || key === 'green') return 90;
  return 72;
}

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

const BLUE_BRANCH_ICON = L.divIcon({
  className: '',
  html: `<div style="width:16px;height:16px;background:#2563eb;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const KERALA_CENTER: L.LatLngExpression = [10.8505, 76.2711];
const DEFAULT_ZOOM = 8;

async function fetchBranches(): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('id, branch_name, city, region, latitude, longitude')
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? []) as Branch[];
}

async function fetchInspections(): Promise<Inspection[]> {
  const { data, error } = await supabase
    .from('inspections')
    .select(
      `id, branch_id, officer_latitude, officer_longitude,
      status, inspection_date, compliance_score, risk_level,
      branches ( branch_name ),
      user_roles ( name )`,
    )
    .eq('status', 'submitted')
    .order('inspection_date', { ascending: false })
    .limit(1200);
  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    ...row,
    branch_name: row.branches?.branch_name ?? 'Unknown',
    officer_name: row.user_roles?.name ?? 'Unknown',
  }));
}

export default function CeoMapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedDistrict = searchParams.get('district');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const heatCirclesRef = useRef<L.Circle[]>([]);
  const heatLayerRef = useRef<L.Layer | null>(null);
  const branchCoordsRef = useRef<Map<string, L.LatLngTuple>>(new Map());

  const { data: branches, isLoading: branchesLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: fetchBranches,
  });

  const { data: inspections, isLoading: inspectionsLoading } = useQuery({
    queryKey: ['inspections', 'map-history'],
    queryFn: fetchInspections,
  });

  const branchRegionRef = useRef<Map<string, string>>(new Map());

  const heatPoints = useMemo<BranchHeatPoint[]>(() => {
    if (!branches || !inspections) return [];

    branchRegionRef.current.clear();
    branches.forEach((branch) => {
      branchRegionRef.current.set(branch.id, storeDistrict(branch.region));
    });

    const branchIdByName = new Map<string, string>();
    branches.forEach((branch) => {
      branchIdByName.set(normalizeKey(branch.branch_name), branch.id);
    });

    const branchStats = new Map<string, BranchHeatStat>();
    inspections.forEach((insp) => {
      const resolvedBranchId = insp.branch_id || branchIdByName.get(normalizeKey(insp.branch_name)) || null;
      if (!resolvedBranchId) return;
      const existing = branchStats.get(resolvedBranchId) ?? { count: 0, scoreSum: 0 };
      existing.count += 1;
      const score = insp.compliance_score ?? toScoreFromRisk(insp.risk_level);
      existing.scoreSum += Number.isFinite(score) ? score : toScoreFromRisk(insp.risk_level);
      branchStats.set(resolvedBranchId, existing);
    });

    return branches
      .filter((branch): branch is Branch & { latitude: number; longitude: number } => (
        branch.latitude !== null && branch.longitude !== null
      ))
      .map((branch) => {
        const stats = branchStats.get(branch.id);
        const visits = stats?.count ?? 0;
        const avgScore = visits > 0 ? stats!.scoreSum / visits : 0;
        return {
          branchId: branch.id,
          branchName: branch.branch_name,
          city: branch.city,
          latitude: branch.latitude,
          longitude: branch.longitude,
          visits,
          avgScore,
          colour: scoreHeatColour(avgScore),
          label: scoreHeatLabel(avgScore),
        };
      })
      .filter((point) => point.visits > 0);
  }, [branches, inspections]);

  const districtAttention = useMemo(() => {
    const grouped = new Map<string, BranchHeatPoint[]>();
    heatPoints.forEach((point) => {
      const district = branchRegionRef.current.get(point.branchId) ?? 'Unknown District';
      const list = grouped.get(district) ?? [];
      list.push(point);
      grouped.set(district, list);
    });

    return Array.from(grouped.entries())
      .map(([district, stores]) => {
        const avgCompliance =
          stores.reduce((sum, store) => sum + store.avgScore, 0) / Math.max(stores.length, 1);
        return { district, avgCompliance, stores };
      })
      .sort((a, b) => a.avgCompliance - b.avgCompliance);
  }, [heatPoints]);

  const panelStores = selectedDistrict
    ? districtAttention.find((row) => row.district === selectedDistrict)?.stores ?? []
    : [];

  const mapSummary = useMemo(() => {
    if (selectedDistrict && panelStores.length) {
      const critical = panelStores.filter((point) => point.avgScore < 70).length;
      const watch = panelStores.filter((point) => point.avgScore >= 70 && point.avgScore < 85).length;
      const healthy = panelStores.filter((point) => point.avgScore >= 85).length;
      const totalVisits = panelStores.reduce((sum, point) => sum + point.visits, 0);
      const weightedAvg =
        totalVisits > 0
          ? panelStores.reduce((sum, point) => sum + point.avgScore * point.visits, 0) / totalVisits
          : 0;
      return {
        inspectedStores: panelStores.length,
        critical,
        watch,
        healthy,
        totalVisits,
        weightedAvg,
      };
    }

    const inspectedStores = heatPoints.length;
    const districtBuckets = districtAttention.reduce(
      (acc, row) => {
        if (row.avgCompliance < 70 || row.stores.some((s) => s.avgScore < 70)) acc.critical += 1;
        else if (row.avgCompliance >= 85 && row.stores.every((s) => s.avgScore >= 85)) acc.healthy += 1;
        else acc.watch += 1;
        return acc;
      },
      { critical: 0, watch: 0, healthy: 0 },
    );
    const totalVisits = heatPoints.reduce((sum, point) => sum + point.visits, 0);
    const weightedAvg =
      totalVisits > 0
        ? heatPoints.reduce((sum, point) => sum + point.avgScore * point.visits, 0) / totalVisits
        : 0;

    return {
      inspectedStores,
      critical: districtBuckets.critical,
      watch: districtBuckets.watch,
      healthy: districtBuckets.healthy,
      totalVisits,
      weightedAvg,
    };
  }, [districtAttention, heatPoints, panelStores, selectedDistrict]);

  const zoomToDistrict = useCallback((district: string) => {
    const map = mapInstanceRef.current;
    const row = districtAttention.find((entry) => entry.district === district);
    if (!map || !row?.stores.length) return;
    const bounds = L.latLngBounds(row.stores.map((store) => [store.latitude, store.longitude] as L.LatLngTuple));
    map.flyToBounds(bounds, { padding: [48, 48], duration: 1.2, maxZoom: 12 });
    setSearchParams({ district });
  }, [districtAttention, setSearchParams]);

  const textureHeatPoints = useMemo<Array<[number, number, number]>>(() => {
    if (!inspections) return [];

    const points: Array<[number, number, number]> = [];
    inspections.forEach((insp) => {
      const score = insp.compliance_score ?? toScoreFromRisk(insp.risk_level);
      const intensity = heatIntensityForScore(score);
      if (insp.officer_latitude !== null && insp.officer_longitude !== null) {
        points.push([insp.officer_latitude, insp.officer_longitude, intensity]);
      }
    });

    heatPoints.forEach((point) => {
      const visitWeight = Math.log10(point.visits + 1) + 0.9;
      points.push([point.latitude, point.longitude, heatIntensityForScore(point.avgScore, visitWeight)]);
    });

    return points;
  }, [inspections, heatPoints]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstanceRef.current) return; // Already initialized

    mapInstanceRef.current = L.map(mapRef.current, {
      zoomControl: false,
      preferCanvas: true,
    }).setView(KERALA_CENTER, DEFAULT_ZOOM);
    L.control.zoom({ position: 'bottomright' }).addTo(mapInstanceRef.current);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      maxZoom: 19,
    }).addTo(mapInstanceRef.current);
    // Ensure proper render when container size is controlled by dashboard layout.
    setTimeout(() => mapInstanceRef.current?.invalidateSize(), 60);
    setTimeout(() => mapInstanceRef.current?.invalidateSize(), 260);
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Branch markers (blue)
    if (branches) {
      branchCoordsRef.current.clear();
      branches.forEach((b) => {
        if (b.latitude !== null && b.longitude !== null) {
          branchCoordsRef.current.set(b.id, [b.latitude, b.longitude]);
          const marker = L.marker([b.latitude, b.longitude], { icon: BLUE_BRANCH_ICON, zIndexOffset: 250 });
          marker.bindPopup(`<strong>${b.branch_name}</strong><br/>${b.city}<br/>District: ${storeDistrict(b.region)}`);
          marker.addTo(mapInstanceRef.current!);
          markersRef.current.push(marker);
        }
      });
    }

    // Store risk heat layer
    if (heatLayerRef.current) {
      heatLayerRef.current.remove();
      heatLayerRef.current = null;
    }

    if (textureHeatPoints.length > 0) {
      const heatFactory = (L as typeof L & {
        heatLayer: (latlngs: Array<[number, number, number]>, options?: Record<string, unknown>) => L.Layer;
      }).heatLayer;
      heatLayerRef.current = heatFactory(textureHeatPoints, {
        radius: 34,
        blur: 26,
        maxZoom: 12,
        minOpacity: 0.2,
        gradient: {
          0.15: '#22c55e',
          0.45: '#eab308',
          0.7: '#f97316',
          1.0: '#dc2626',
        },
      });
      heatLayerRef.current.addTo(mapInstanceRef.current);
    }

    heatCirclesRef.current.forEach((circle) => circle.remove());
    heatCirclesRef.current = [];

    if (heatPoints.length > 0) {
      heatPoints.forEach((point) => {
        const radius = scoreHeatRadius(point.avgScore, point.visits);
        const outerHalo = L.circle([point.latitude, point.longitude], {
          radius: radius * 1.35,
          color: point.colour,
          fillColor: point.colour,
          fillOpacity: 0.12,
          weight: 1,
          interactive: false,
        });
        outerHalo.addTo(mapInstanceRef.current!);
        heatCirclesRef.current.push(outerHalo);

        const circle = L.circle([point.latitude, point.longitude], {
          radius,
          color: point.colour,
          fillColor: point.colour,
          fillOpacity: scoreHeatOpacity(point.avgScore) * 0.5,
          weight: 1,
          interactive: true,
        });
        circle.bindPopup(`
          <div>
            <strong>${point.branchName}</strong><br/>
            District: ${branchRegionRef.current.get(point.branchId) ?? 'Unknown'}<br/>
            ${point.city}<br/>
            Avg compliance: <strong>${point.avgScore.toFixed(1)}%</strong><br/>
            Heat level: <span style="color:${point.colour};font-weight:700;">${point.label}</span><br/>
            Visits in range: ${point.visits}
          </div>
        `);

        circle.addTo(mapInstanceRef.current!);
        heatCirclesRef.current.push(circle);
      });
    }

    // Inspection markers (colored by risk)
    if (inspections) {
      inspections.forEach((insp) => {
        if (insp.officer_latitude !== null && insp.officer_longitude !== null) {
          const color = riskColour(insp.risk_level);
          const dotSize = insp.risk_level?.toLowerCase() === 'critical' || insp.risk_level?.toLowerCase() === 'red' ? 14 : 10;
          const marker = L.marker([insp.officer_latitude, insp.officer_longitude], {
            icon: makeCircleIcon(color, dotSize),
            zIndexOffset: 120,
          });
          const popupText = `
            <div>
              <strong>${insp.branch_name}</strong><br/>
              District: ${branchRegionRef.current.get(insp.branch_id) ?? 'Unknown'}<br/>
              Officer: ${insp.officer_name}<br/>
              Risk: <span style="color: ${color}; font-weight: bold;">${insp.risk_level ?? 'unknown'}</span><br/>
              Date: ${new Date(insp.inspection_date).toLocaleDateString()}
            </div>
          `;
          marker.bindPopup(popupText);
          marker.addTo(mapInstanceRef.current!);
          markersRef.current.push(marker);
        }
      });
    }
    const boundsPoints: L.LatLngTuple[] = [];
    if (branches) {
      branches.forEach((b) => {
        if (b.latitude !== null && b.longitude !== null) {
          boundsPoints.push([b.latitude, b.longitude]);
        }
      });
    }
    if (boundsPoints.length >= 2) {
      mapInstanceRef.current.fitBounds(L.latLngBounds(boundsPoints), { padding: [40, 40], maxZoom: 11 });
    }
  }, [branches, inspections, heatPoints, textureHeatPoints]);

  return (
    <div className="space-y-4">
      <div className="ceo-map-shell relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-black/40 shadow-[0_0_40px_rgba(6,182,212,0.2)]">
        {(branchesLoading || inspectionsLoading) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10">
            <div className="text-white text-sm">Loading map data...</div>
          </div>
        )}
        <div className="pointer-events-none absolute left-4 top-4 z-[500] rounded-xl border border-cyan-400/30 bg-black/55 p-3 backdrop-blur-sm">
          <p className="text-[11px] uppercase tracking-wider text-cyan-200">Heat Summary</p>
          <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-gray-200">
            <span>Inspected stores</span>
            <span className="text-right font-semibold">{mapSummary.inspectedStores}</span>
            <span>Total visits</span>
            <span className="text-right font-semibold">{mapSummary.totalVisits}</span>
            <span>Weighted avg score</span>
            <span className="text-right font-semibold">{mapSummary.weightedAvg.toFixed(1)}%</span>
          </div>
          <div className="mt-2 flex gap-2 text-[11px]">
            <span className="rounded bg-green-500/25 px-2 py-0.5 text-green-300">{mapSummary.healthy} Healthy</span>
            <span className="rounded bg-yellow-500/25 px-2 py-0.5 text-yellow-300">{mapSummary.watch} Normal</span>
            <span className="rounded bg-red-500/25 px-2 py-0.5 text-red-300">{mapSummary.critical} Critical</span>
          </div>
        </div>
        <div className="pointer-events-auto absolute right-4 top-4 z-[500] w-64 rounded-xl border border-cyan-400/30 bg-black/55 p-3 backdrop-blur-sm">
          {selectedDistrict ? (
            <>
              <button
                type="button"
                onClick={() => setSearchParams({})}
                className="mb-2 text-left text-xs text-cyan-200 min-h-[44px]"
              >
                ← All Districts
              </button>
              <p className="text-[11px] uppercase tracking-wider text-cyan-200">{selectedDistrict}</p>
              <div className="mt-2 space-y-1.5 text-xs text-gray-100">
                {panelStores.length === 0 ? (
                  <p className="text-gray-400">No stores in this district.</p>
                ) : (
                  panelStores.map((store) => (
                    <button
                      key={store.branchId}
                      type="button"
                      onClick={() => {
                        const map = mapInstanceRef.current;
                        const coords = branchCoordsRef.current.get(store.branchId);
                        if (map && coords) map.flyTo(coords, 14, { duration: 1.2 });
                      }}
                      className="flex w-full items-center justify-between rounded bg-white/5 px-2 py-1 text-left transition hover:bg-white/10"
                    >
                      <span className="truncate pr-2 underline-offset-2 hover:underline">{store.branchName}</span>
                      <span style={{ color: store.colour }} className="font-semibold">
                        {store.avgScore.toFixed(1)}%
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-wider text-cyan-200">Attention stores</p>
              <div className="mt-2 space-y-1.5 text-xs text-gray-100">
                {districtAttention.length === 0 ? (
                  <p className="text-gray-400">No inspections in selected range.</p>
                ) : (
                  districtAttention.map((row) => (
                    <button
                      key={row.district}
                      type="button"
                      onClick={() => zoomToDistrict(row.district)}
                      className="flex w-full items-center justify-between rounded bg-white/5 px-2 py-1 text-left transition hover:bg-white/10"
                    >
                      <span className="truncate pr-2 underline-offset-2 hover:underline">{row.district}</span>
                      <span className="font-semibold text-red-300">{row.avgCompliance.toFixed(1)}%</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
        <div
          ref={mapRef}
          className="ceo-map-canvas"
          style={{
            width: '100%',
            height: 'min(72vh, 720px)',
            minHeight: 480,
            backgroundColor: '#0A0A0F',
          }}
        />
        <div className="absolute bottom-0 left-0 right-0 border-t border-cyan-500/20 bg-black/60 px-4 py-3 backdrop-blur-sm">
          <div className="flex flex-wrap gap-5 text-xs">
            <div className="flex items-center gap-2">
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#2563eb' }} />
              <span className="text-gray-300">Store anchors</span>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#16a34a' }} />
              <span className="text-gray-300">Green: Healthy score (85+)</span>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#eab308' }} />
              <span className="text-gray-300">Yellow: Normal score (70-84)</span>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#dc2626' }} />
              <span className="text-gray-300">Red: Critical score (&lt;70)</span>
            </div>
            <div className="ml-auto min-w-[220px]">
              <div className="h-2 w-full rounded-full bg-gradient-to-r from-green-600 via-yellow-500 to-red-600" />
              <p className="mt-1 text-[11px] text-gray-400">
                Heat amplifies when scores drop or visit volume rises.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="ceo-map-stat-card ceo-map-stat-card--critical">
          <p className="ceo-map-stat-label font-semibold uppercase tracking-wide">
            {selectedDistrict ? 'Critical Stores' : 'Critical Districts'}
          </p>
          <p className="ceo-map-stat-value mt-1 text-2xl font-bold">{mapSummary.critical}</p>
        </div>
        <div className="ceo-map-stat-card ceo-map-stat-card--normal">
          <p className="ceo-map-stat-label font-semibold uppercase tracking-wide">
            {selectedDistrict ? 'Normal Stores' : 'Normal Districts'}
          </p>
          <p className="ceo-map-stat-value mt-1 text-2xl font-bold">{mapSummary.watch}</p>
        </div>
        <div className="ceo-map-stat-card ceo-map-stat-card--healthy">
          <p className="ceo-map-stat-label font-semibold uppercase tracking-wide">
            {selectedDistrict ? 'Healthy Stores' : 'Healthy Districts'}
          </p>
          <p className="ceo-map-stat-value mt-1 text-2xl font-bold">{mapSummary.healthy}</p>
        </div>
      </div>
    </div>
  );
}
