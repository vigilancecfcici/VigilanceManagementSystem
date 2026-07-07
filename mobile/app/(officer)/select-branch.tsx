import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  ToastAndroid,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { supabase } from '../../lib/supabase';
import { BranchCard, type BranchCardStatusTone } from '../../components/BranchCard';
import { useLocationGate } from '../../lib/useLocationGate';
import { LocationGateModal } from '../../components/LocationGateModal';
import { useAuth } from '../../context/AuthContext';
import { useBranchLocksRealtime } from '../../hooks/useBranchLocksRealtime';
import {
  claimBranchInspection,
  canEditSubmittedBranch,
  canStartNewReportAfterWindow,
  formatEditWindowCountdown,
  isBranchSelectable,
  isOwnCompletedBranch,
  lockLabel,
  markInspectionAsEdit,
  reopenInspectionForEdit,
} from '../../lib/branchLocks';
import { STORES } from '../../constants/stores';
import { useOfficerDistricts } from '../../lib/useOfficerDistricts';
import { OfficerTabHeader } from '../../components/OfficerTabHeader';

interface Branch {
  id: string;
  branch_name: string;
  location: string;
  city: string;
  region?: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius: number;
  store_code?: string | null;
  incharge_name?: string | null;
  incharge_phone?: string | null;
  assigned_officer_id?: string | null;
  distance_metres?: number;
}

const SkeletonCard = () => (
  <View
    style={{
      backgroundColor: '#e5e7eb',
      borderRadius: 12,
      padding: 16,
      marginBottom: 10,
      height: 72,
    }}
  >
    <View style={{ width: '60%', height: 14, backgroundColor: '#d1d5db', borderRadius: 6, marginBottom: 8 }} />
    <View style={{ width: '40%', height: 11, backgroundColor: '#d1d5db', borderRadius: 6 }} />
  </View>
);

function showToast(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert('', message);
  }
}

const normalizeStoreName = (value?: string | null) =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findStoreData = (item: Branch) =>
  STORES.find(
    (store) =>
      store.code === item.store_code ||
      normalizeStoreName(store.name) === normalizeStoreName(item.branch_name) ||
      normalizeStoreName(item.branch_name).includes(normalizeStoreName(store.name)) ||
      normalizeStoreName(store.name).includes(normalizeStoreName(item.branch_name)),
  );

const getInchargeDetails = (item: Branch) => {
  const storeData = findStoreData(item);
  return {
    incharge: item.incharge_name || storeData?.incharge || 'Not assigned',
    phone: item.incharge_phone || storeData?.phone || '',
  };
};

const withStoreFallback = (item: Branch): Branch => {
  const storeData = findStoreData(item);
  return {
    ...item,
    latitude: item.latitude ?? storeData?.latitude ?? null,
    longitude: item.longitude ?? storeData?.longitude ?? null,
    location: item.location || storeData?.address || '',
    store_code: item.store_code ?? storeData?.code ?? null,
    incharge_name: item.incharge_name ?? storeData?.incharge ?? null,
    incharge_phone: item.incharge_phone ?? storeData?.phone ?? null,
  };
};

export default function SelectBranchScreen({ embedded = false }: { embedded?: boolean }) {
  const { branchType } = useLocalSearchParams<{ branchType: string }>();
  const activeBranchType = branchType || 'Ideal Store';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userRolesId } = useAuth();
  const { data: assignedDistricts = [] } = useOfficerDistricts(userRolesId);

  const [branchTypeId, setBranchTypeId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [filtered, setFiltered] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingBranch, setPendingBranch] = useState<Branch | null>(null);
  const [pendingEditCount, setPendingEditCount] = useState<number | null>(null);
  const [pendingReopen, setPendingReopen] = useState(false);
  const [pendingInspectionId, setPendingInspectionId] = useState<string | null>(null);
  const [refilling, setRefilling] = useState(false);
  const [timerTick, setTimerTick] = useState(0);
  const [officerCoords, setOfficerCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // ── Batch 16: Near Me state ──────────────────────────────────────────────
  const [nearMeActive, setNearMeActive] = useState(false);
  const [nearMeBranches, setNearMeBranches] = useState<Branch[]>([]);
  const [nearMeLoading, setNearMeLoading] = useState(false);
  // ─────────────────────────────────────────────────────────────────────────

  const { locks } = useBranchLocksRealtime(branchTypeId, userRolesId);

  useEffect(() => {
    const hasActiveTimers = Object.values(locks).some(
      (lock) => lock.status === 'completed' && formatEditWindowCountdown(lock.editWindowExpiresAt),
    );
    if (!hasActiveTimers) return;
    const id = setInterval(() => setTimerTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [locks]);

  const locationGate = useLocationGate(
    pendingBranch?.latitude ?? null,
    pendingBranch?.longitude ?? null,
    pendingBranch?.geofence_radius ?? 200,
  );

  useEffect(() => {
    fetchBranches();
  }, [activeBranchType, assignedDistricts.join('|')]);

  useEffect(() => {
    if (nearMeActive) return; // FlatList uses nearMeBranches when active
    const q = search.toLowerCase();
    setFiltered(
      q
        ? branches.filter(
            (b) =>
              b.branch_name.toLowerCase().includes(q) ||
              b.city.toLowerCase().includes(q) ||
              b.location.toLowerCase().includes(q)
          )
        : branches
    );
  }, [search, branches, nearMeActive]);

  useEffect(() => {
    if (locationGate.officerCoords) {
      setOfficerCoords(locationGate.officerCoords);
    }
  }, [locationGate.officerCoords]);

  const fetchBranches = async () => {
    setLoading(true);
    setError('');

    // Step 1: resolve branch_type_id from type_name (avoids unreliable
    // PostgREST embedded-filter syntax that returns 400 on some setups)
    const { data: typeRow, error: typeErr } = await supabase
      .from('branch_types')
      .select('id')
      .eq('type_name', activeBranchType)
      .single();

    if (typeErr || !typeRow) {
      setLoading(false);
      setError('Unknown branch type. Please contact admin.');
      return;
    }

    setBranchTypeId(typeRow.id);

    // Step 2: fetch branches filtered by the resolved branch_type_id
    const { data, error: err } = await supabase
      .from('branches')
      .select('id, branch_name, location, city, region, latitude, longitude, geofence_radius, store_code, incharge_name, incharge_phone, assigned_officer_id')
      .eq('is_active', true)
      .eq('branch_type_id', typeRow.id)
      .order('branch_name');

    setLoading(false);
    if (err) {
      const code = (err as { code?: string }).code ?? '';
      const msg = err.message ?? '';
      if (code === '42703' || /geofence_radius/i.test(msg)) {
        setError(
          'Database is out of date — geofence_radius column missing. ' +
          'Please run the latest Supabase migrations.',
        );
      } else {
        setError('Failed to load branches. Check your connection.');
      }
      return;
    }
    let safe = ((data as unknown as Branch[]) || []).map((b) => ({
      ...b,
      geofence_radius: b.geofence_radius ?? 200,
    }));

    if (assignedDistricts.length > 0) {
      safe = safe.filter((b) => b.region && assignedDistricts.includes(b.region));
    }

    const { data: authData } = await supabase.auth.getUser();
    const authUserId = authData.user?.id;
    if (authUserId) {
      safe = safe.filter((b) => !b.assigned_officer_id || b.assigned_officer_id === authUserId);
    }

    setBranches(safe);
  };

  // ── Batch 16: Near Me fetch ──────────────────────────────────────────────
  const fetchNearMe = async () => {
    setNearMeLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showToast('Location permission denied');
        setNearMeLoading(false);
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      const { data, error: rpcError } = await supabase.rpc('branches_within_radius', {
        lat,
        lon,
        radius_metres: 10000,
      });

      if (rpcError || !data) {
        throw new Error(rpcError?.message ?? 'RPC error');
      }

      // Map RPC result to Branch objects
      const mapped: Branch[] = (data as any[]).map((row) => {
        const existing = branches.find(
          (branch) =>
            branch.id === row.id ||
            normalizeStoreName(branch.branch_name) === normalizeStoreName(row.branch_name),
        );
        const storeData = existing ? findStoreData(existing) : undefined;
        return {
          latitude: existing?.latitude ?? storeData?.latitude ?? null,
          longitude: existing?.longitude ?? storeData?.longitude ?? null,
          geofence_radius: existing?.geofence_radius ?? 200,
          store_code: existing?.store_code ?? row.store_code ?? storeData?.code ?? null,
          incharge_name: existing?.incharge_name ?? row.incharge_name ?? storeData?.incharge ?? null,
          incharge_phone: existing?.incharge_phone ?? row.incharge_phone ?? storeData?.phone ?? null,
          id: row.id,
          branch_name: row.branch_name,
          location: row.location ?? '',
          city: row.city ?? '',
          region: row.region ?? existing?.region ?? null,
          distance_metres: row.distance_metres,
        };
      });

      const districtFiltered =
        assignedDistricts.length > 0
          ? mapped.filter((b) => b.region && assignedDistricts.includes(b.region))
          : mapped;

      setNearMeBranches(districtFiltered);
      setNearMeActive(true);
    } catch (_err) {
      // Non-breaking fallback — PostGIS may not be active yet
      showToast('Could not fetch nearby branches');
      setNearMeActive(false);
    } finally {
      setNearMeLoading(false);
    }
  };

  const cancelNearMe = () => {
    setNearMeActive(false);
    setNearMeBranches([]);
  };
  // ─────────────────────────────────────────────────────────────────────────

  const getLockUi = (branchId: string) => {
    const lock = locks[branchId];
    const isOwnCompleted = isOwnCompletedBranch(lock, userRolesId);
    const canEdit = canEditSubmittedBranch(lock, userRolesId);
    const canNewReport = canStartNewReportAfterWindow(lock, userRolesId);
    const selectable = isBranchSelectable(lock, true);
    const hasOwnDraft = !!lock?.inspectionId && lock.status === 'available';
    let statusTone: BranchCardStatusTone = 'completed';
    if (lock?.status === 'in_progress') statusTone = 'in_progress';
    else if (hasOwnDraft) statusTone = 'resume';
    else if (canEdit) statusTone = 'resume';
    const disabled = !selectable && !isOwnCompleted;
    void timerTick;
    const countdown = formatEditWindowCountdown(lock?.editWindowExpiresAt);
    return {
      lock,
      disabled,
      statusLabel: canEdit
        ? `Submitted · Edit window ${countdown ?? ''}`
        : canNewReport
          ? 'Report completed · New visit available'
          : lockLabel(lock, hasOwnDraft),
      timerLabel: canEdit ? countdown : null,
      statusTone,
      canEdit,
      canNewReport,
    };
  };

  const openDirections = async (item: Branch) => {
    const storeData = findStoreData(item);
    const lat = item.latitude ?? storeData?.latitude;
    const lon = item.longitude ?? storeData?.longitude;

    if (!lat || !lon) {
      const address = encodeURIComponent(storeData?.address ?? item.location);
      const url = Platform.OS === 'ios'
        ? `maps://maps.apple.com/?q=${address}`
        : `https://www.google.com/maps/search/?api=1&query=${address}`;
      void Linking.openURL(url);
      return;
    }

    const url = Platform.OS === 'ios'
      ? `maps://maps.apple.com/?daddr=${lat},${lon}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    void Linking.openURL(url);
  };

  const handleBranchPress = (item: Branch) => {
    const { lock, disabled, statusLabel, canEdit, canNewReport } = getLockUi(item.id);
    const { incharge } = getInchargeDetails(item);

    if (canEdit && lock?.inspectionId) {
      Alert.alert(
        'Edit Submitted Report',
        'You can edit this report within the 1-hour window. Your existing answers will be loaded.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Edit Report',
            onPress: async () => {
              setRefilling(true);
              try {
                const result = await reopenInspectionForEdit(lock.inspectionId!);
                if (!result.inspectionId) {
                  showToast(result.message);
                  return;
                }
                setPendingEditCount(null);
                setPendingInspectionId(result.inspectionId);
                setPendingBranch(withStoreFallback(item));
                setPendingReopen(true);
                locationGate.check();
              } finally {
                setRefilling(false);
              }
            },
          },
        ],
      );
      return;
    }

    if (canNewReport) {
      Alert.alert(
        'New Visit Report',
        'The edit window has expired. A new report will be submitted for this store.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Start New Report',
            onPress: () => {
              setPendingEditCount(null);
              setPendingReopen(false);
              setPendingInspectionId(null);
              setPendingBranch(withStoreFallback(item));
              locationGate.check();
            },
          },
        ],
      );
      return;
    }

    if (disabled) {
      showToast(statusLabel ?? 'This store is not available today.');
      return;
    }

    Alert.alert(
      'Opening Store',
      `${item.branch_name}\nIncharge: ${incharge}\n\nWhat would you like to do?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Get Directions',
          onPress: () => { void openDirections(item); },
        },
        {
          text: 'Enter Store',
          onPress: () => {
            setPendingEditCount(null);
            setPendingReopen(false);
            setPendingInspectionId(null);
            setPendingBranch(withStoreFallback(item));
            locationGate.check();
          },
        },
      ],
    );
  };

  const handleConfirm = async () => {
    if (!pendingBranch) return;

    let inspectionId: string | null = null;

    if (pendingReopen && pendingInspectionId) {
      inspectionId = pendingInspectionId;
    } else if (pendingReopen) {
      const lock = locks[pendingBranch.id];
      if (lock?.inspectionId) {
        inspectionId = lock.inspectionId;
      }
    }

    if (!inspectionId) {
      const claim = await claimBranchInspection(pendingBranch.id);
      if (!claim.inspectionId) {
        showToast(claim.message);
        setPendingBranch(null);
        setPendingEditCount(null);
        setPendingReopen(false);
        setPendingInspectionId(null);
        return;
      }
      inspectionId = claim.inspectionId;
    }

    if (pendingEditCount != null) {
      const editMark = await markInspectionAsEdit(inspectionId, pendingEditCount);
      if (!editMark.success) {
        showToast(editMark.message);
      }
    }

    router.push({
      pathname: '/(officer)/checklist',
      params: {
        branchId: pendingBranch.id,
        branchName: pendingBranch.branch_name,
        branchType: activeBranchType,
        inspectionId,
        isEdit: pendingReopen || pendingEditCount != null ? '1' : '0',
        reopen: pendingReopen ? '1' : '0',
        officerLat: officerCoords?.latitude?.toString() ?? '',
        officerLon: officerCoords?.longitude?.toString() ?? '',
      },
    });
    setPendingBranch(null);
    setPendingEditCount(null);
    setPendingReopen(false);
    setPendingInspectionId(null);
    locationGate.reset();
  };

  const handleRetry = () => { locationGate.check(); };
  const handleCancel = () => {
    setPendingBranch(null);
    setPendingEditCount(null);
    setPendingReopen(false);
    setPendingInspectionId(null);
    locationGate.reset();
  };

  const gateModalVisible =
    pendingBranch !== null && locationGate.status !== 'idle';

  // The active list to render in FlatList
  const listData = nearMeActive ? nearMeBranches : filtered;
  const listHeader = (
    <View>
      {embedded ? (
        <OfficerTabHeader
          title="Stores"
          subtitle="Select a store, review incharge details, and begin inspection."
        />
      ) : (
        <LinearGradient
          colors={['#0f172a', '#0f766e']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingHorizontal: 16,
            paddingTop: insets.top + 16,
            paddingBottom: 24,
            flexDirection: 'row',
            alignItems: 'center',
            borderBottomLeftRadius: 24,
            borderBottomRightRadius: 24,
          }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{
              marginRight: 12,
              width: 40,
              height: 40,
              borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#99f6e4', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }}>
              VIGILANCE
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '900', color: '#fff', marginTop: 4 }}>
              Stores
            </Text>
            <Text style={{ color: '#ccfbf1', fontSize: 12, marginTop: 3 }}>
              Select a store, review incharge details, and begin inspection.
            </Text>
          </View>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 16,
              backgroundColor: 'rgba(255,255,255,0.16)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.24)',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900' }}>V</Text>
          </View>
        </LinearGradient>
      )}

      <View
        style={{
          backgroundColor: '#fff',
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 12,
          marginHorizontal: 16,
          marginTop: -10,
          borderRadius: 18,
          shadowColor: '#0f172a',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.1,
          shadowRadius: 18,
          elevation: 7,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#f8fafc',
            borderRadius: 14,
            paddingHorizontal: 12,
            borderWidth: 1,
            borderColor: '#e2e8f0',
          }}
        >
          <Ionicons name="search" size={18} color="#64748b" />
          <TextInput
            value={search}
            onChangeText={(t) => { setSearch(t); if (nearMeActive) cancelNearMe(); }}
            placeholder="Search stores, city, or address..."
            placeholderTextColor="#9ca3af"
            style={{
              flex: 1,
              paddingVertical: 12,
              paddingHorizontal: 8,
              fontSize: 15,
              color: '#1f2937',
            }}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <Text style={{ fontSize: 12, color: '#64748b', fontWeight: '700' }}>
            {nearMeActive ? 'Showing stores within 10 km' : `${listData.length} stores available`}
          </Text>
          {nearMeLoading ? (
            <ActivityIndicator size="small" color="#0f766e" />
          ) : (
            <TouchableOpacity
              onPress={nearMeActive ? cancelNearMe : fetchNearMe}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: nearMeActive ? '#0f766e' : '#ecfeff',
                borderRadius: 20,
                borderWidth: 1,
                borderColor: nearMeActive ? '#0f766e' : '#99f6e4',
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Ionicons name={nearMeActive ? 'close' : 'locate'} size={14} color={nearMeActive ? '#fff' : '#0f766e'} style={{ marginRight: 4 }} />
              <Text style={{ color: nearMeActive ? '#fff' : '#0f766e', fontSize: 12, fontWeight: '800' }}>
                {nearMeActive ? 'Clear' : 'Near Me'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#eef2f7' }}>
      {/* List */}
      {loading ? (
        <View style={{ padding: 16, paddingTop: 20 }}>
          {[1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} />)}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Ionicons name="cloud-offline-outline" size={48} color="#9ca3af" />
          <Text style={{ marginTop: 12, color: '#6b7280', textAlign: 'center' }}>{error}</Text>
          <TouchableOpacity
            onPress={fetchBranches}
            style={{
              marginTop: 16,
              backgroundColor: '#2563eb',
              borderRadius: 10,
              paddingHorizontal: 24,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : refilling ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={{ marginTop: 12, color: '#6b7280', textAlign: 'center' }}>
            Removing previous submission…
          </Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 104 }}
          ListHeaderComponent={listHeader}
          renderItem={({ item }) => {
            const { disabled, statusLabel, statusTone, timerLabel } = getLockUi(item.id);
            const { incharge, phone } = getInchargeDetails(item);
            const inchargeLine = `Incharge: ${incharge}${phone ? ` · ${phone}` : ''}`;
            const distanceLine =
              nearMeActive && item.distance_metres !== undefined
                ? `${(item.distance_metres / 1000).toFixed(1)} km away`
                : null;
            const timerLine = timerLabel ? `Edit window: ${timerLabel} remaining` : null;
            const subtitleParts = [inchargeLine, distanceLine, timerLine].filter(Boolean);
            return (
              <View style={{ paddingHorizontal: 16 }}>
                <BranchCard
                  branchName={item.branch_name}
                  location={item.location}
                  city={item.city}
                  onPress={() => handleBranchPress(item)}
                  disabled={disabled}
                  statusLabel={statusLabel}
                  statusTone={statusTone}
                  subtitle={subtitleParts.join(' · ')}
                />
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="search-outline" size={40} color="#d1d5db" />
              <Text style={{ color: '#9ca3af', marginTop: 12 }}>
                {nearMeActive ? 'No branches found within 10 km' : 'No branches found'}
              </Text>
            </View>
          }
        />
      )}

      <LocationGateModal
        visible={gateModalVisible}
        status={locationGate.status}
        distanceMetres={locationGate.distanceMetres}
        branchName={pendingBranch?.branch_name ?? ''}
        branchLocation={pendingBranch?.location ?? ''}
        radiusMetres={pendingBranch?.geofence_radius ?? 200}
        onConfirm={handleConfirm}
        onRetry={handleRetry}
        onCancel={handleCancel}
      />
    </View>
  );
}
