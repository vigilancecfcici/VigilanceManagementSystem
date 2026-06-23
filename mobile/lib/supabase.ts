import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// LargeSecureStore: splits values > 2048 bytes across multiple SecureStore keys
const MAX_SECURE_STORE_VALUE_SIZE = 1800;

class LargeSecureStore {
  private async _saveChunk(key: string, value: string): Promise<void> {
    const chunks: string[] = [];
    let offset = 0;
    while (offset < value.length) {
      chunks.push(value.slice(offset, offset + MAX_SECURE_STORE_VALUE_SIZE));
      offset += MAX_SECURE_STORE_VALUE_SIZE;
    }
    await SecureStore.setItemAsync(`${key}_count`, String(chunks.length));
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(`${key}_${i}`, chunks[i]);
    }
  }

  async getItem(key: string): Promise<string | null> {
    const countStr = await SecureStore.getItemAsync(`${key}_count`);
    if (!countStr) return null;
    const count = parseInt(countStr, 10);
    let value = '';
    for (let i = 0; i < count; i++) {
      const chunk = await SecureStore.getItemAsync(`${key}_${i}`);
      if (chunk == null) return null;
      value += chunk;
    }
    return value;
  }

  async removeItem(key: string): Promise<void> {
    const countStr = await SecureStore.getItemAsync(`${key}_count`);
    if (!countStr) return;
    const count = parseInt(countStr, 10);
    await SecureStore.deleteItemAsync(`${key}_count`);
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(`${key}_${i}`);
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    await this._saveChunk(key, value);
  }
}

const secureStore = new LargeSecureStore();

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  if (__DEV__) {
    console.error(
      'Supabase environment variables are missing! ' +
      'Ensure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are set in your .env file.'
    );
  }
}

// IMPORTANT:
// In production builds these values must be embedded at build time via EAS env vars.
// If they're missing and we call createClient('', ''), supabase-js can throw during
// module initialization, causing the app to crash immediately on launch.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const resolvedSupabaseUrl = supabaseUrl || 'https://example.supabase.co';
const resolvedSupabaseAnonKey = supabaseAnonKey || 'example-anon-key';

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
  auth: {
    storage: secureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// ============================================================
// DATABASE TYPES
// Mirrors the public schema in supabase/schema.sql and the
// 20260513_risk_classification.sql migration.
// ============================================================

export type RiskLevel = 'RED' | 'YELLOW' | 'GREEN';
export type InspectionRisk = 'low' | 'medium' | 'high' | 'critical';
export type InspectionStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type ChecklistResponse = 'Yes' | 'No' | 'N/A' | 'Good' | 'Moderate' | 'Bad';
export type EscalationStatus = 'open' | 'in_progress' | 'closed';
export type NotificationChannel = 'push' | 'sms' | 'email';
export type NotificationStatus = 'sent' | 'failed' | 'pending';

export interface UserRole {
  id: string;
  user_id: string | null;
  role: 'officer' | 'head' | 'management' | 'admin' | 'audit';
  name: string;
  phone?: string | null;
  is_active?: boolean;
  fcm_token?: string | null;
  created_at?: string;
}

export interface BranchType {
  id: string;
  type_name: 'CFC' | 'Store' | string;
}

export interface Branch {
  id: string;
  branch_type_id: string | null;
  branch_name: string;
  location?: string | null;
  city?: string | null;
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_active?: boolean;
  created_at?: string;
}

export interface ChecklistTemplate {
  id: string;
  branch_type_id: string | null;
  section: string;
  item_text: string;
  item_order: number;
  is_active?: boolean;
  created_at?: string;
  risk_level?: RiskLevel;
  statutory_act?: string;
  trigger_on_no?: boolean;
}

export interface Inspection {
  id: string;
  officer_id: string | null;
  branch_id: string | null;
  inspection_date: string;
  time_in?: string | null;
  time_out?: string | null;
  status: InspectionStatus;
  compliance_score?: number | null;
  risk_level?: InspectionRisk | null;
  head_comment?: string | null;
  officer_latitude?: number | null;
  officer_longitude?: number | null;
  device_info?: string | null;
  created_at?: string;
  updated_at?: string;
  submitted_at?: string | null;
}

export interface InspectionResponseRow {
  id: string;
  inspection_id: string;
  checklist_item_id: string;
  response: ChecklistResponse;
  remarks?: string | null;
  created_at?: string;
}

export interface RiskClassification {
  id: string;
  checklist_item_id: string;
  risk_level: RiskLevel;
  trigger_on_no: boolean;
  statutory_act?: string | null;
  legal_notes?: string | null;
  requires_photo: boolean;
  min_remark_chars: number;
}

export interface EscalationTicket {
  id: string;
  inspection_id: string;
  checklist_item_id: string;
  risk_level: RiskLevel;
  status: EscalationStatus;
  assigned_to?: string | null;
  sla_deadline?: string | null;
  reinspection_deadline?: string | null;
  resolved_at?: string | null;
  resolution_notes?: string | null;
  created_at: string;
}

export interface SupervisorAcknowledgement {
  id: string;
  inspection_id: string;
  checklist_item_id: string;
  supervisor_id: string;
  otp_hash: string;
  otp_expires_at: string;
  acknowledged_at?: string | null;
  supervisor_lat?: number | null;
  supervisor_lng?: number | null;
}

export interface NotificationLog {
  id: string;
  inspection_id?: string | null;
  escalation_id?: string | null;
  recipient_id: string;
  channel: NotificationChannel;
  template?: string | null;
  status: NotificationStatus;
  sent_at?: string | null;
  error_message?: string | null;
}
