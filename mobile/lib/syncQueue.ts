/**
 * Offline sync queue for inspection submissions.
 *
 * Replaces the legacy manual AsyncStorage queue in lib/storage.ts with a
 * production-grade pattern:
 *   - Backed by react-native-mmkv when the native module is available
 *     (10× faster than AsyncStorage, supports synchronous reads).
 *   - Falls back transparently to AsyncStorage for Expo Go / web / unit tests.
 *   - Atomic queue ops with a single key + JSON snapshot.
 *   - Flush is idempotent: failed items stay in the queue and are retried on
 *     the next reconnect (see useNetworkSync).
 *   - When a draft was already promoted to a real inspection row (the lazy
 *     RED-trigger path), the queued payload carries `inspectionId` and the
 *     flusher UPDATEs that row instead of inserting a duplicate.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { supabase } from './supabase';
import { captureOfficerLocation } from './captureOfficerLocation';
import { claimBranchInspection } from './branchLocks';
import { getDeviceAudit } from './deviceInfo';
import { uploadInspectionFiles } from './uploadInspectionFiles';
import { isCompliantResponse } from './checklistScoring';
import type { DraftForm } from './draftForm';

const normalizeTime = (value: string | null | undefined, fallback: string): string => {
  const normalized = value?.trim() ?? '';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(normalized)) return normalized;
  return fallback;
};

export type QueuedInspection = DraftForm & {
  inspectionId?: string;
  queuedAt: number;
  attempts: number;
};

const QUEUE_KEY = 'sync_queue_v2';

// ── storage backend ────────────────────────────────────────────────────────
// Lazy-load MMKV so the app still bundles when the native module isn't
// present (Expo Go, web). Falls back to AsyncStorage with the same API surface.

interface KVStore {
  getString(k: string): Promise<string | null>;
  setString(k: string, v: string): Promise<void>;
}

let cached: KVStore | undefined;

const getStore = (): KVStore => {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    const mmkv = new MMKV({ id: 'vigilance.sync' });
    cached = {
      getString: async (k) => mmkv.getString(k) ?? null,
      setString: async (k, v) => mmkv.set(k, v),
    };
  } catch {
    cached = {
      getString: (k) => AsyncStorage.getItem(k),
      setString: (k, v) => AsyncStorage.setItem(k, v),
    };
  }
  return cached;
};

// ── queue ops ───────────────────────────────────────────────────────────────

const LEGACY_QUEUE_KEY = 'offline_submission_queue';

const readQueue = async (): Promise<QueuedInspection[]> => {
  const raw = await getStore().getString(QUEUE_KEY);
  let queue: QueuedInspection[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      queue = Array.isArray(parsed) ? parsed : [];
    } catch {
      queue = [];
    }
  }

  // One-time merge from legacy AsyncStorage queue (offline_submission_queue)
  const legacyRaw = await AsyncStorage.getItem(LEGACY_QUEUE_KEY);
  if (legacyRaw) {
    try {
      const legacy = JSON.parse(legacyRaw) as (DraftForm & { inspectionId?: string })[];
      if (Array.isArray(legacy) && legacy.length > 0) {
        const merged = [
          ...queue,
          ...legacy.map((item) => ({
            ...item,
            queuedAt: Date.now(),
            attempts: 0,
          })),
        ];
        await writeQueue(merged);
        queue = merged;
      }
    } finally {
      await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
    }
  }

  return queue;
};

const writeQueue = async (queue: QueuedInspection[]): Promise<void> => {
  await getStore().setString(QUEUE_KEY, JSON.stringify(queue));
};

export const queueInspection = async (
  data: DraftForm & { inspectionId?: string },
): Promise<void> => {
  const queue = await readQueue();
  queue.push({ ...data, queuedAt: Date.now(), attempts: 0 });
  await writeQueue(queue);
};

export const peekQueue = async (): Promise<QueuedInspection[]> => readQueue();

export const queueSize = async (): Promise<number> => (await readQueue()).length;

export const clearQueue = async (): Promise<void> => writeQueue([]);

// ── flush ───────────────────────────────────────────────────────────────────

export const MAX_SYNC_ATTEMPTS = 3;

/** Item cannot be synced — drop from queue (another officer completed the branch). */
export class BranchCompletedSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BranchCompletedSyncError';
  }
}

/** Item exceeded retry limit — officer must reconnect or contact support. */
export class SyncAttemptsExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncAttemptsExhaustedError';
  }
}

export interface FlushResult {
  attempted: number;
  succeeded: number;
  failed: number;
  /** Queued items dropped because another officer submitted first. */
  branchCompleted: number;
  /** Items removed after MAX_SYNC_ATTEMPTS failures. */
  abandoned: number;
}

/**
 * Drains queued items into Supabase. Returns counts. Safe to call repeatedly;
 * if any item fails it stays in the queue for the next reconnect.
 */
const emptyFlush = (): FlushResult => ({
  attempted: 0,
  succeeded: 0,
  failed: 0,
  branchCompleted: 0,
  abandoned: 0,
});

export const flushQueue = async (): Promise<FlushResult> => {
  const net = await NetInfo.fetch();
  if (!net.isConnected) return emptyFlush();

  const queue = await readQueue();
  if (queue.length === 0) return emptyFlush();

  const remaining: QueuedInspection[] = [];
  let succeeded = 0;
  let failed = 0;
  let branchCompleted = 0;
  let abandoned = 0;

  for (const item of queue) {
    try {
      await syncOne(item);
      succeeded += 1;
    } catch (err) {
      if (err instanceof BranchCompletedSyncError) {
        branchCompleted += 1;
        failed += 1;
        if (__DEV__) console.warn('[syncQueue] branch already completed', err.message);
        continue;
      }
      const nextAttempts = item.attempts + 1;
      if (
        err instanceof SyncAttemptsExhaustedError ||
        nextAttempts >= MAX_SYNC_ATTEMPTS
      ) {
        abandoned += 1;
        failed += 1;
        if (__DEV__) console.warn('[syncQueue] abandoning queue item after retries', err);
        continue;
      }
      failed += 1;
      remaining.push({ ...item, attempts: nextAttempts });
      if (__DEV__) console.warn('[syncQueue] flush failed, will retry', err);
    }
  }

  await writeQueue(remaining);
  return {
    attempted: queue.length,
    succeeded,
    failed,
    branchCompleted,
    abandoned,
  };
};

/**
 * Push one queued draft to Supabase. Creates the inspection row + responses +
 * file rows in sequence. If the payload carries an inspectionId (i.e. it was
 * already created on a RED trigger), we UPDATE that row rather than insert.
 */
async function syncOne(item: QueuedInspection): Promise<void> {
  const {
    branchId,
    date,
    timeIn,
    timeOut,
    responses,
    generalRemark,
    fileUris,
    itemFiles,
    officerLat,
    officerLon,
    inspectionId,
    previousRiskItemIds,
  } = item;

  const { data: userResp } = await supabase.auth.getUser();
  const authedId = userResp?.user?.id;
  if (!authedId) throw new Error('No authenticated user — keeping in queue');

  // Resolve officer's user_roles.id (FK target on inspections.officer_id).
  const { data: officer, error: officerErr } = await supabase
    .from('user_roles')
    .select('id')
    .eq('user_id', authedId)
    .maybeSingle();
  if (officerErr || !officer) throw officerErr ?? new Error('officer not found');

  // Device audit — populated on every flush so re-tries from a different
  // device (rare but possible) show up correctly in the audit log.
  const audit = await getDeviceAudit();
  const now = new Date();
  const fallbackTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const normalizedTimeOut = normalizeTime(timeOut, fallbackTime);
  const normalizedTimeIn = normalizeTime(timeIn, normalizedTimeOut);
  const submitCoords = await captureOfficerLocation(
    officerLat != null && officerLon != null
      ? { latitude: officerLat, longitude: officerLon }
      : null,
  );
  const resolvedOfficerLat = submitCoords?.latitude ?? officerLat;
  const resolvedOfficerLon = submitCoords?.longitude ?? officerLon;

  let resolvedId = inspectionId;
  if (resolvedId) {
    const submittedAt = new Date().toISOString();
    const editWindowExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { data: submittedRows, error: upErr } = await supabase
      .from('inspections')
      .update({
        branch_id: branchId,
        inspection_date: date,
        time_in: normalizedTimeIn,
        time_out: normalizedTimeOut,
        status: 'submitted',
        submitted_at: submittedAt,
        edit_window_expires_at: editWindowExpiresAt,
        officer_latitude: resolvedOfficerLat,
        officer_longitude: resolvedOfficerLon,
        sync_status: 'synced',
        device_id: audit.deviceId,
        app_version: audit.appVersion,
      })
      .eq('id', resolvedId)
      .eq('status', 'draft')
      .select('id, status');
    if (upErr) throw upErr;
    if (!submittedRows?.length || submittedRows[0]?.status !== 'submitted') {
      throw new Error('Could not finalize offline submission.');
    }
  } else {
    const claim = await claimBranchInspection(branchId);
    if (claim.errorCode === 'BRANCH_COMPLETED') {
      throw new BranchCompletedSyncError(
        claim.message || 'Another officer already submitted this store today.',
      );
    }
    if (!claim.inspectionId) {
      throw new Error(claim.message || 'Could not claim inspection');
    }
    resolvedId = claim.inspectionId;
    const submittedAt = new Date().toISOString();
    const editWindowExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { data: submittedRows, error: upErr } = await supabase
      .from('inspections')
      .update({
        branch_id: branchId,
        inspection_date: date,
        time_in: normalizedTimeIn,
        time_out: normalizedTimeOut,
        status: 'submitted',
        submitted_at: submittedAt,
        edit_window_expires_at: editWindowExpiresAt,
        officer_latitude: resolvedOfficerLat,
        officer_longitude: resolvedOfficerLon,
        sync_status: 'synced',
        device_id: audit.deviceId,
        app_version: audit.appVersion,
      })
      .eq('id', resolvedId)
      .eq('status', 'draft')
      .select('id, status');
    if (upErr) throw upErr;
    if (!submittedRows?.length || submittedRows[0]?.status !== 'submitted') {
      throw new Error('Could not finalize offline submission.');
    }
  }

  // Responses (idempotent upsert keyed on inspection + item).
  const responseItemIds = Object.entries(responses)
    .filter(([, v]) => v.response != null)
    .map(([checklist_item_id]) => checklist_item_id);

  const triggerOnNoByItem = new Map<string, boolean>();
  if (responseItemIds.length > 0) {
    const { data: templates, error: templateErr } = await supabase
      .from('checklist_templates')
      .select('id, trigger_on_no')
      .in('id', responseItemIds);
    if (templateErr) throw templateErr;
    for (const row of templates ?? []) {
      triggerOnNoByItem.set(row.id, row.trigger_on_no ?? true);
    }
  }

  const previousRiskSet = new Set(previousRiskItemIds ?? []);
  const responseRows = Object.entries(responses)
    .filter(([, v]) => v.response != null)
    .map(([checklist_item_id, v]) => {
      const wasPreviouslyAtRisk = previousRiskSet.has(checklist_item_id);
      const triggerOnNo = triggerOnNoByItem.get(checklist_item_id) ?? true;
      const resolvedThisInspection =
        wasPreviouslyAtRisk && isCompliantResponse(v.response, triggerOnNo);
      return {
        inspection_id: resolvedId!,
        checklist_item_id,
        response: v.response,
        remarks: v.remark?.trim() || null,
        was_previously_at_risk: wasPreviouslyAtRisk,
        resolved_this_inspection: resolvedThisInspection,
      };
    });
  if (responseRows.length) {
    const { error: rErr } = await supabase
      .from('inspection_responses')
      .upsert(responseRows, { onConflict: 'inspection_id,checklist_item_id' });
    if (rErr) throw rErr;
  }

  if (generalRemark?.trim()) {
    await supabase.from('general_remarks').insert({
      inspection_id: resolvedId,
      remark_text: generalRemark.trim(),
    });
  }

  const queuedItemFiles = itemFiles ?? {};
  if (Object.keys(queuedItemFiles).length > 0) {
    const uploadResult = await uploadInspectionFiles(resolvedId!, queuedItemFiles);
    if (uploadResult.failedCount > 0 && uploadResult.successCount === 0) {
      throw new Error(uploadResult.errors[0] ?? 'Failed to upload queued inspection files');
    }
  }

  const legacyUris = fileUris ?? [];
  if (legacyUris.length > 0) {
    const legacyFiles: Record<string, { uri: string; name: string; type: 'image' | 'document' }[]> = {
      legacy: legacyUris.map((uri) => ({
        uri,
        name: uri.split('/').pop() ?? 'attachment',
        type: /\.(png|jpe?g|webp|heic|heif)$/i.test(uri) ? 'image' as const : 'document' as const,
      })),
    };
    const legacyUpload = await uploadInspectionFiles(resolvedId!, legacyFiles);
    if (legacyUpload.failedCount > 0 && legacyUpload.successCount === 0) {
      throw new Error(legacyUpload.errors[0] ?? 'Failed to upload queued legacy files');
    }
  }
}
