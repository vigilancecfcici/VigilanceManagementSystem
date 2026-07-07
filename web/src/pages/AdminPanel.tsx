import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { supabase } from '../lib/supabase';
import { branchSchema, type BranchFormValues } from '../lib/schemas';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../components/ui/form';
import { AccountRequestsTab, usePendingAccountRequestCount } from './admin/AccountRequestsTab';
import { KeralaBranchMap } from '../components/admin/KeralaBranchMap';
import { DistrictOfficersPanel } from '../components/admin/DistrictOfficersPanel';
import { ChecklistAdminTab } from '../components/admin/ChecklistAdminTab';
import { KpiDetailModal } from '../components/dashboard/KpiDetailModal';
import type { PrefillNewUser } from '../types/accountRequest';
import { KERALA_DISTRICT_NAMES } from '../lib/storeRegions';
import { parseEmbeddedCoordinates, resolveBranchCoordinates } from '../lib/geocodeAddress';
import { resolvePrimaryStoreBranchTypeId } from '../lib/branchTypes';
import { parseAdminTab, adminTabLabel } from '../lib/adminTabs';
import { downloadAdminUnifiedReport } from '../lib/adminReportExport';
import { parseEdgeFunctionError } from '../lib/edgeFunctionError';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface UserRow {
  id: string;
  user_id: string | null;
  email: string;
  name: string;
  role: string;
  phone: string;
  is_active: boolean;
  created_at: string;
}

interface Branch {
  id: string;
  branch_name: string;
  branch_type_id: string;
  branch_type?: string;
  location: string;
  city: string;
  region: string;
  incharge_name?: string | null;
  incharge_phone?: string | null;
  is_active: boolean;
  deleted_at?: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius: number;
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Password generation lives in the `admin-create-user` Edge Function â€” the
// browser must never see / generate auth credentials directly.

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// â”€â”€â”€ AdminPanel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function AdminPanel() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = parseAdminTab(searchParams.get('tab'));
  const [userPrefill, setUserPrefill] = useState<PrefillNewUser | null>(null);
  const { data: pendingRequestCount = 0 } = usePendingAccountRequestCount();

  return (
    <div className="admin-panel space-y-6">
      <h1 className="admin-panel-title">{adminTabLabel(tab, pendingRequestCount)}</h1>

      <div>
        {tab === 'users' && (
          <UsersTab
            prefill={userPrefill}
            onClearPrefill={() => setUserPrefill(null)}
          />
        )}
        {tab === 'account-requests' && (
          <AccountRequestsTab
            onApprove={(prefill) => {
              setUserPrefill(prefill);
              navigate('/admin?tab=users');
            }}
          />
        )}
        {tab === 'checklists' && <ChecklistAdminTab />}
        {tab === 'branches' && <BranchesTab />}
        {tab === 'reports' && <ReportsTab />}
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TAB 1 â€” USERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function UsersTab({
  prefill,
  onClearPrefill,
}: {
  prefill: PrefillNewUser | null;
  onClearPrefill: () => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState('');

  React.useEffect(() => {
    if (prefill) {
      setShowAdd(true);
    }
  }, [prefill]);

  const { data: users = [], isLoading } = useQuery<UserRow[]>({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('id, user_id, email, name, role, phone, is_active, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: districtByOfficer = new Map<string, string>() } = useQuery({
    queryKey: ['admin-officer-districts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('district_assignments')
        .select('officer_id, district')
        .eq('is_primary', true);
      if (error) throw error;
      const map = new Map<string, string>();
      (data ?? []).forEach((row: { officer_id: string | null; district: string }) => {
        if (row.officer_id) map.set(row.officer_id, row.district);
      });
      return map;
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      // Soft delete pattern: when deactivating, also stamp deleted_at so we
      // can distinguish "temporarily disabled" from "removed from the org"
      // when running audit queries later. Re-activating clears it.
      const { error } = await supabase
        .from('user_roles')
        .update({ is_active, deleted_at: is_active ? null : new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const filtered = users.filter((u) => {
    const district = districtByOfficer.get(u.id) ?? '';
    const matchesSearch =
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      district.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const exportUsersCsv = () => {
    const header = ['name', 'email', 'role', 'phone', 'status', 'created_at'];
    const rows = filtered.map((u) =>
      [
        u.name,
        u.email,
        u.role,
        u.phone ?? '',
        u.is_active ? 'active' : 'inactive',
        u.created_at,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Search by name, email, or district..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-64"
          />
          <select
            className="input w-40"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="all">All roles</option>
            <option value="officer">Officer</option>
            <option value="management">Management</option>
            <option value="admin">Admin</option>
            <option value="audit">Audit</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportUsersCsv} className="btn-secondary">
            Export CSV
          </button>
          <button type="button" onClick={() => setShowAdd(true)} className="btn-primary">
            + Add User
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Password resets are handled by an administrator - set a new password when creating or editing a user, or share credentials securely.
      </p>

      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {['Name', 'Email', 'Role', 'Status', 'Created', 'Actions'].map(h => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="td text-center text-gray-400 py-8">
                    No users match your search.
                  </td>
                </tr>
              )}
              {filtered.map(u => (
                <tr key={u.id} className="tr">
                  <td className="td font-medium">{u.name}</td>
                  <td className="td text-gray-500">{u.email}</td>
                  <td className="td">
                    <span className="badge-role">{u.role}</span>
                  </td>
                  <td className="td">
                    <span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="td text-gray-400">{formatDate(u.created_at)}</td>
                  <td className="td">
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => setEditUser(u)} className="btn-xs">Edit</button>
                      <button
                        onClick={() => toggleActive.mutate({ id: u.id, is_active: !u.is_active })}
                        className={`btn-xs ${u.is_active ? 'btn-xs-red' : 'btn-xs-green'}`}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddUserModal
          prefill={prefill}
          onClose={() => {
            setShowAdd(false);
            setGeneratedPassword('');
            onClearPrefill();
          }}
          onCreated={(pwd) => {
            setGeneratedPassword(pwd);
            qc.invalidateQueries({ queryKey: ['admin-users'] });
            onClearPrefill();
          }}
        />
      )}

      {generatedPassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg">User Created!</h3>
            <p className="text-sm text-gray-500">Share this password securely with the new user:</p>
            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 font-mono text-lg text-center select-all">
              {generatedPassword}
            </div>
            <button onClick={() => setGeneratedPassword('')} className="btn-primary w-full">
              Done
            </button>
          </div>
        </div>
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => { setEditUser(null); qc.invalidateQueries({ queryKey: ['admin-users'] }); }}
        />
      )}
    </div>
  );
}

function AddUserModal({
  prefill,
  onClose,
  onCreated,
}: {
  prefill: PrefillNewUser | null;
  onClose: () => void;
  onCreated: (pwd: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: prefill?.name ?? '',
    email: prefill?.email ?? '',
    password: '',
    role: 'officer',
    phone: '',
  });
  const [autoGen, setAutoGen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (prefill) {
      setForm({
        name: prefill.name,
        email: prefill.email,
        password: '',
        role: 'officer',
        phone: '',
      });
      setAutoGen(true);
    }
  }, [prefill]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    // User provisioning is delegated to the `admin-create-user` Edge
    // Function: `supabase.auth.admin` requires the service-role key, which
    // must never live in browser bundles. The edge function does the auth
    // creation + user_roles row atomically (with rollback) and returns the
    // password â€” either the one we passed, or one it auto-generated.
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<{
        user_id: string;
        password: string;
        generated: boolean;
      }>('admin-create-user', {
        body: {
          email: form.email.trim().toLowerCase(),
          name: form.name.trim(),
          role: form.role,
          phone: form.phone.trim() || undefined,
          password: autoGen ? undefined : form.password,
        },
      });
      if (invokeErr) throw invokeErr;
      if (!data?.user_id) throw new Error('User creation failed.');

      if (prefill?.requestId) {
        const { data: authData } = await supabase.auth.getUser();
        await supabase
          .from('account_requests')
          .update({
            status: 'approved',
            reviewed_at: new Date().toISOString(),
            reviewed_by: authData.user?.id ?? null,
          })
          .eq('id', prefill.requestId);
        void qc.invalidateQueries({ queryKey: ['account-requests'] });
        void qc.invalidateQueries({ queryKey: ['admin-pending-request-count'] });
      }

      onCreated(data.password);
      onClose();
    } catch (err: unknown) {
      const msg = await parseEdgeFunctionError(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 max-w-md w-full space-y-4">
        <h3 className="font-bold text-xl">Add New User</h3>
        {prefill && (
          <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Pre-filled from an approved access request. Set role and password, then create the account.
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input className="input w-full" placeholder="Full Name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input
            className="input w-full"
            placeholder="Email"
            type="email"
            required
            readOnly={!!prefill}
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          />
          <input className="input w-full" placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          <select className="input w-full" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="officer">Officer</option>
            <option value="management">Management</option>
            <option value="admin">Admin</option>
            <option value="audit">Audit</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoGen} onChange={e => setAutoGen(e.target.checked)} />
            Auto-generate password
          </label>
          {!autoGen && (
            <input className="input w-full" placeholder="Password" type="password" required={!autoGen} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Creating…' : 'Create User'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({ user, onClose, onSaved }: { user: UserRow; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    password: '',
    phone: user.phone || '',
    role: user.role,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: pendingRequest } = useQuery({
    queryKey: ['pending-request-for-email', user.email],
    queryFn: async () => {
      const { data, error: reqErr } = await supabase
        .from('account_requests')
        .select('id')
        .eq('email', user.email.toLowerCase())
        .eq('status', 'pending')
        .maybeSingle();
      if (reqErr) throw reqErr;
      return data;
    },
  });

  const emailReadonly = !!pendingRequest;

  const handleSave = async () => {
    setLoading(true);
    setError('');
    if (form.password.trim() && form.password.trim().length < 8) {
      setError('Password must be at least 8 characters.');
      setLoading(false);
      return;
    }
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<{
        user_id?: string;
        error?: string;
      }>('admin-update-user', {
        body: {
          user_roles_id: user.id,
          email: form.email.trim().toLowerCase(),
          name: form.name.trim(),
          role: form.role,
          phone: form.phone.trim() || undefined,
          password: form.password.trim() || undefined,
        },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      if (!data?.user_id) throw new Error('User update failed.');
      onSaved();
    } catch (err: unknown) {
      setError(await parseEdgeFunctionError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 max-w-md w-full space-y-4">
        <h3 className="font-bold text-xl">Edit User</h3>
        <input className="input w-full" placeholder="Full Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <input
          className="input w-full"
          placeholder="Email"
          type="email"
          readOnly={emailReadonly}
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
        />
        {emailReadonly && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Email is locked while a pending access request exists for this address.
          </p>
        )}
        <input
          className="input w-full"
          placeholder="Leave blank to keep current password"
          type="password"
          value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
        />
        <input className="input w-full" placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
        <select className="input w-full" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
          <option value="officer">Officer</option>
          <option value="management">Management</option>
          <option value="admin">Admin</option>
          <option value="audit">Audit</option>
        </select>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="button" onClick={() => void handleSave()} disabled={loading} className="btn-primary flex-1">{loading ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TAB 3 â€” BRANCHES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function BranchesTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  const { data: branches = [], isLoading } = useQuery<Branch[]>({
    queryKey: ['admin-branches', showDeleted],
    queryFn: async () => {
      let query = supabase
        .from('branches')
        .select(
          `id, branch_name, branch_type_id, location, city, region, latitude, longitude,
           incharge_name, incharge_phone,
           geofence_radius, is_active, deleted_at,
           branch_types:branch_type_id ( type_name )`,
        )
        .order('branch_name');
      if (!showDeleted) {
        query = query.is('deleted_at', null);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => {
        const typeRel = (row as { branch_types?: { type_name?: string } | { type_name?: string }[] | null }).branch_types;
        const typeName = Array.isArray(typeRel) ? typeRel[0]?.type_name : typeRel?.type_name;
        return {
          ...(row as Branch),
          branch_type: typeName ?? 'Store',
        };
      });
    },
  });

  const toggleBranch = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('branches')
        .update({ is_active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-branches'] }),
    onError: (err: Error) => window.alert(err.message || 'Failed to update branch.'),
  });

  const deleteBranch = useMutation({
    mutationFn: async (id: string) => {
      const { data: branch, error: fetchErr } = await supabase
        .from('branches')
        .select('region')
        .eq('id', id)
        .single();
      if (fetchErr) throw fetchErr;

      const { error } = await supabase
        .from('branches')
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;

      if (branch?.region) {
        await supabase.rpc('cleanup_orphaned_district', { p_district: branch.region });
      }
    },
    onSuccess: () => {
      setEditBranch(null);
      qc.invalidateQueries({ queryKey: ['admin-branches'] });
      qc.invalidateQueries({ queryKey: ['district-assignments'] });
      qc.invalidateQueries({ queryKey: ['branch-district-centers'] });
      qc.invalidateQueries({ queryKey: ['branch-officer-assignments'] });
    },
    onError: (err: Error) => window.alert(err.message || 'Failed to delete branch.'),
  });

  const restoreBranch = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('branches')
        .update({ is_active: true, deleted_at: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-branches'] }),
    onError: (err: Error) => window.alert(err.message || 'Failed to restore branch.'),
  });

  const handleDeleteBranch = (branch: Branch) => {
    const confirmed = window.confirm(
      `Delete "${branch.branch_name}"?\n\nThis removes the branch from the list and officer pickers. Past inspections are kept.`,
    );
    if (confirmed) deleteBranch.mutate(branch.id);
  };

  const filteredBranches = branches.filter((b) => {
    const q = branchSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      b.branch_name.toLowerCase().includes(q) ||
      (b.location ?? '').toLowerCase().includes(q) ||
      (b.city ?? '').toLowerCase().includes(q) ||
      (b.region ?? '').toLowerCase().includes(q)
    );
  });

  const isDeletedBranch = (b: Branch) => !!b.deleted_at;

  return (
    <div className="space-y-6">
      <KeralaBranchMap onAddBranch={() => setShowAdd(true)} />
      <DistrictOfficersPanel />

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          className="input w-full max-w-md"
          placeholder="Search branches by name, city, or district..."
          value={branchSearch}
          onChange={(e) => setBranchSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          Show deleted branches
        </label>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading branches...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {['Branch Name', 'Location', 'City', 'District', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {!isLoading && filteredBranches.length === 0 && (
                <tr>
                  <td colSpan={6} className="td text-center text-gray-400 py-8">
                    {branchSearch.trim()
                      ? `No branches match "${branchSearch.trim()}".${showDeleted ? '' : ' Try enabling "Show deleted branches".'}`
                      : showDeleted
                        ? 'No deleted branches.'
                        : 'No branches found.'}
                  </td>
                </tr>
              )}
              {filteredBranches.map((b) => (
                <tr key={b.id} className="tr">
                  <td className="td font-medium">{b.branch_name}</td>
                  <td className="td text-gray-500 max-w-xs truncate">{b.location}</td>
                  <td className="td">{b.city}</td>
                  <td className="td">{b.region}</td>
                  <td className="td">
                    <span
                      className={`badge ${
                        isDeletedBranch(b) ? 'badge-red' : b.is_active ? 'badge-green' : 'badge-red'
                      }`}
                    >
                      {isDeletedBranch(b) ? 'Deleted' : b.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="td">
                    <div className="flex gap-2 flex-wrap">
                      {isDeletedBranch(b) ? (
                        <button
                          type="button"
                          onClick={() => restoreBranch.mutate(b.id)}
                          disabled={restoreBranch.isPending}
                          className="btn-xs btn-xs-green"
                        >
                          Restore
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => setEditBranch(b)} className="btn-xs">Edit</button>
                          <button
                            type="button"
                            onClick={() => toggleBranch.mutate({ id: b.id, is_active: !b.is_active })}
                            className={`btn-xs ${b.is_active ? 'btn-xs-red' : 'btn-xs-green'}`}
                          >
                            {b.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteBranch(b)}
                            disabled={deleteBranch.isPending}
                            className="btn-xs btn-xs-red"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <BranchModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            qc.invalidateQueries({ queryKey: ['admin-branches'] });
          }}
        />
      )}
      {editBranch && (
        <BranchModal
          branch={editBranch}
          onClose={() => setEditBranch(null)}
          onSaved={() => {
            setEditBranch(null);
            qc.invalidateQueries({ queryKey: ['admin-branches'] });
          }}
        />
      )}
    </div>
  );
}

/**
 * BranchModal â€” zod-validated, react-hook-form-driven.
 *
 * Pattern reference: this is the canonical example we want every other admin
 * form (users, checklist items, ...) to follow. See `web/src/lib/schemas.ts`
 * for the zod schema and `components/ui/form.tsx` for the shadcn wrappers.
 */
function BranchModal({
  branch,
  onClose,
  onSaved,
}: {
  branch?: Branch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    data: storeTypeId,
    isLoading: storeTypeLoading,
    isError: storeTypeQueryError,
  } = useQuery({
    queryKey: ['admin-store-branch-type-id'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('branch_types').select('id, type_name');
      if (error) throw error;
      const id = resolvePrimaryStoreBranchTypeId(data ?? []);
      if (!id) {
        throw new Error('Store branch type not found. Expected "Ideal Store" or "Store".');
      }
      return id;
    },
  });

  const form = useForm<BranchFormValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: {
      name: branch?.branch_name ?? '',
      location: branch?.location ?? '',
      city: branch?.city ?? '',
      region: branch?.region ?? '',
      incharge_name: branch?.incharge_name ?? '',
      incharge_phone: branch?.incharge_phone ?? '',
      latitude: branch?.latitude ?? undefined,
      longitude: branch?.longitude ?? undefined,
      geofence_radius: branch?.geofence_radius ?? 200,
    },
  });

  const [customDistrict, setCustomDistrict] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodedAddressRef = useRef('');
  const districtOptions = useMemo(() => {
    const current = form.watch('region')?.trim();
    const extra = customDistrict.trim();
    const names = [...KERALA_DISTRICT_NAMES];
    if (extra && !names.includes(extra)) names.push(extra);
    if (current && !names.includes(current)) names.push(current);
    return names.sort((a, b) => a.localeCompare(b));
  }, [customDistrict, form]);

  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    };
  }, []);

  const scheduleAddressGeocode = (address: string) => {
    const trimmed = address.trim();
    if (trimmed.length < 15) return;
    if (trimmed === lastGeocodedAddressRef.current) return;

    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    geocodeTimerRef.current = setTimeout(() => {
      lastGeocodedAddressRef.current = trimmed;
      void handleAddressGeocode(trimmed);
    }, 800);
  };

  const applyGeocodeResult = (result: Awaited<ReturnType<typeof resolveBranchCoordinates>>, trimmed: string) => {
    form.setValue('location', trimmed, { shouldDirty: true });
    if (result.city) form.setValue('city', result.city, { shouldDirty: true });
    const currentDistrict = form.getValues('region')?.trim();
    if (!currentDistrict && result.district) {
      form.setValue('region', result.district, { shouldDirty: true });
    }
    if (result.latitude != null && !Number.isNaN(result.latitude)) {
      form.setValue('latitude', result.latitude, { shouldDirty: true, shouldValidate: true });
    }
    if (result.longitude != null && !Number.isNaN(result.longitude)) {
      form.setValue('longitude', result.longitude, { shouldDirty: true, shouldValidate: true });
    }
  };

  const handleAddressGeocode = async (address: string) => {
    const trimmed = address.trim();
    if (trimmed.length < 10) return;

    setGeocoding(true);
    setGeocodeError(null);

    const embedded = parseEmbeddedCoordinates(trimmed);
    if (embedded) {
      applyGeocodeResult(
        {
          city: form.getValues('city') ?? null,
          district: form.getValues('region') ?? null,
          latitude: embedded.latitude,
          longitude: embedded.longitude,
        },
        trimmed,
      );
      setGeocoding(false);
      return;
    }

    form.setValue('latitude', undefined, { shouldDirty: true });
    form.setValue('longitude', undefined, { shouldDirty: true });
    try {
      const result = await resolveBranchCoordinates({
        location: trimmed,
        name: form.getValues('name'),
        city: form.getValues('city'),
        region: form.getValues('region'),
      });
      applyGeocodeResult(result, trimmed);
      if (result.latitude == null || result.longitude == null) {
        setGeocodeError('Could not detect coordinates. Paste the full Google Maps address, share link, or pin coordinates.');
      }
    } catch {
      setGeocodeError('Address lookup failed. Enter latitude and longitude manually.');
    } finally {
      setGeocoding(false);
    }
  };

  const onSubmit = async (values: BranchFormValues) => {
    if (!storeTypeId) {
      setSubmitError(
        storeTypeLoading
          ? 'Loading store branch type…'
          : storeTypeQueryError
            ? 'Could not load store branch type. Refresh and try again.'
            : 'Store branch type not found.',
      );
      return;
    }
    setSubmitError(null);

    let latitude = values.latitude ?? null;
    let longitude = values.longitude ?? null;

    if (latitude == null || longitude == null) {
      const resolved = await resolveBranchCoordinates({
        location: values.location,
        name: values.name,
        city: values.city,
        region: values.region,
      });
      if (resolved.latitude != null && resolved.longitude != null) {
        latitude = resolved.latitude;
        longitude = resolved.longitude;
        applyGeocodeResult(resolved, values.location?.trim() ?? '');
      }
    }

    if (latitude == null || longitude == null) {
      setSubmitError(
        'GPS coordinates are required. Paste the Google Maps address or location link so the branch can be pinned automatically.',
      );
      return;
    }

    const payload = {
      branch_name: values.name,
      branch_type_id: storeTypeId,
      location: values.location ?? null,
      city: values.city ?? null,
      region: values.region ?? null,
      incharge_name: values.incharge_name ?? null,
      incharge_phone: values.incharge_phone ?? null,
      latitude,
      longitude,
      geofence_radius: values.geofence_radius,
      is_active: true,
    };
    const op = branch
      ? supabase.from('branches').update(payload).eq('id', branch.id)
      : supabase.from('branches').insert(payload);
    const { error } = await op;
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-xl mb-4">{branch ? 'Edit Branch' : 'Add Branch'}</h3>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Branch name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Aluva CFC" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="geofence_radius"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Geofence radius (m)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={50}
                        max={5000}
                        step={50}
                        placeholder="200"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>How close officers must be to start an inspection.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Paste full address from Google Maps…"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          field.onChange(e);
                          scheduleAddressGeocode(e.target.value);
                        }}
                        onPaste={(e) => {
                          const pasted = e.clipboardData.getData('text').trim();
                          if (pasted.length < 10) return;
                          e.preventDefault();
                          field.onChange(pasted);
                          if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
                          lastGeocodedAddressRef.current = pasted;
                          void handleAddressGeocode(pasted);
                        }}
                        onBlur={(e) => {
                          field.onBlur();
                          const value = e.target.value.trim();
                          if (value.length >= 15 && value !== lastGeocodedAddressRef.current) {
                            lastGeocodedAddressRef.current = value;
                            void handleAddressGeocode(value);
                          }
                        }}
                      />
                    </FormControl>
                    {geocoding ? (
                      <FormDescription>Detecting city, district, and coordinates…</FormDescription>
                    ) : (
                      <FormDescription>
                        Paste a Google Maps address or share link — city, district, and map pin update automatically.
                      </FormDescription>
                    )}
                    {geocodeError ? (
                      <p className="text-amber-600 text-xs mt-1">{geocodeError}</p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="Kochi" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="region"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>District</FormLabel>
                    <FormControl>
                      <select
                        className="input w-full"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value)}
                      >
                        <option value="">Select district</option>
                        {districtOptions.map((district) => (
                          <option key={district} value={district}>
                            {district}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormDescription>
                      <input
                        className="input w-full mt-2"
                        placeholder="Or type a new district name and press Enter"
                        value={customDistrict}
                        onChange={(e) => setCustomDistrict(e.target.value)}
                        onBlur={() => {
                          const value = customDistrict.trim();
                          if (value) {
                            field.onChange(value);
                            setCustomDistrict('');
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const value = customDistrict.trim();
                            if (value) {
                              field.onChange(value);
                              setCustomDistrict('');
                            }
                          }
                        }}
                      />
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="incharge_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Incharge name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Manager name" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="incharge_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Incharge phone</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 9876543210" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="latitude"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Latitude</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        placeholder="Auto-detected"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="longitude"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Longitude</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        placeholder="Auto-detected"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {submitError && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
                {submitError}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={form.formState.isSubmitting || storeTypeLoading || !storeTypeId}
              >
                {form.formState.isSubmitting ? 'Saving…' : storeTypeLoading ? 'Loading…' : 'Save'}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TAB 4 â€” REPORTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function ReportsTab() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [branchType, setBranchType] = useState('all');
  const [status, setStatus] = useState('all');
  const [showRevisitModal, setShowRevisitModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    officerId: '',
    leaveDate: new Date().toISOString().split('T')[0],
    leaveType: 'absent',
  });

  const today = new Date().toISOString().split('T')[0];

  const { data: rangeInspections = [] } = useQuery({
    queryKey: ['admin-range-inspections', from, to, status],
    queryFn: async () => {
      let q = supabase
        .from('inspections')
        .select(
          `id, branch_id, submitted_at,
          branches:branch_id ( branch_name ),
          user_roles:officer_id ( name )`,
        )
        .gte('submitted_at', `${from}T00:00:00`)
        .lte('submitted_at', `${to}T23:59:59`);
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const uniqueStoresVisited = useMemo(
    () => new Set(rangeInspections.map((r: { branch_id: string }) => r.branch_id)).size,
    [rangeInspections],
  );
  const revisitInspections = Math.max(0, rangeInspections.length - uniqueStoresVisited);

  const revisitRows = useMemo(() => {
    const grouped = new Map<
      string,
      { branchName: string; visits: Array<{ date: string; officer: string }> }
    >();
    rangeInspections.forEach((row) => {
      const entry = row as {
        branch_id: string;
        submitted_at: string;
        branches?: { branch_name?: string } | { branch_name?: string }[] | null;
        user_roles?: { name?: string } | { name?: string }[] | null;
      };
      const branchRel = Array.isArray(entry.branches) ? entry.branches[0] : entry.branches;
      const officerRel = Array.isArray(entry.user_roles) ? entry.user_roles[0] : entry.user_roles;
      const list = grouped.get(entry.branch_id) ?? {
        branchName: branchRel?.branch_name ?? 'Unknown',
        visits: [],
      };
      list.visits.push({
        date: entry.submitted_at,
        officer: officerRel?.name ?? 'Unknown',
      });
      grouped.set(entry.branch_id, list);
    });
    return Array.from(grouped.entries())
      .filter(([, value]) => value.visits.length > 1)
      .map(([branchId, value]) => ({
        id: branchId,
        primary: value.branchName,
        secondary: `${value.visits.length} visits`,
        meta: value.visits
          .map((v) => `${new Date(v.date).toLocaleDateString('en-IN')} · ${v.officer}`)
          .join(' | '),
      }));
  }, [rangeInspections]);

  const { data: officers = [] } = useQuery({
    queryKey: ['admin-report-officers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('id, user_id, name')
        .eq('role', 'officer')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: districtMap = new Map<string, string>() } = useQuery({
    queryKey: ['admin-report-officer-districts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('district_assignments')
        .select('officer_id, district, user_roles:officer_id ( user_id )')
        .eq('is_primary', true);
      if (error) throw error;
      const map = new Map<string, string>();
      (data ?? []).forEach((row: {
        officer_id: string | null;
        district: string;
        user_roles?: { user_id?: string | null } | { user_id?: string | null }[] | null;
      }) => {
        if (!row.officer_id) return;
        const rel = Array.isArray(row.user_roles) ? row.user_roles[0] : row.user_roles;
        if (rel?.user_id) map.set(rel.user_id, row.district);
        map.set(row.officer_id, row.district);
      });
      return map;
    },
  });

  const { data: leaveRows = [] } = useQuery({
    queryKey: ['admin-officer-leave', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('officer_leave_log')
        .select('id, officer_name, leave_date, leave_type, marked_by, officer_id')
        .gte('leave_date', from)
        .lte('leave_date', to)
        .order('leave_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: onLeaveTodayCount = 0 } = useQuery({
    queryKey: ['admin-leave-today', today],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('officer_leave_log')
        .select('*', { count: 'exact', head: true })
        .eq('leave_date', today)
        .in('leave_type', ['absent', 'leave']);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const onLeaveToday = onLeaveTodayCount;

  const fetchLeaveCsvSection = async () => {
    const { data, error } = await supabase
      .from('officer_leave_log')
      .select('leave_date, officer_name, leave_type, officer_id')
      .gte('leave_date', from)
      .lte('leave_date', to)
      .order('leave_date');
    if (error) return { headers: ['Date', 'Officer', 'District', 'Leave type'], rows: [] as string[][] };
    const rows = (data ?? []).map(
      (row: { leave_date: string; officer_name: string; leave_type: string; officer_id?: string }) => [
        row.leave_date,
        row.officer_name,
        districtMap.get(row.officer_id ?? '') ?? '—',
        row.leave_type,
      ],
    );
    return { headers: ['Date', 'Officer', 'District', 'Leave type'], rows };
  };

  const addLeaveRecord = async () => {
    if (!leaveForm.officerId) {
      window.alert('Select an officer.');
      return;
    }
    const officer = officers.find((o: { id: string }) => o.id === leaveForm.officerId);
    const { data: authData } = await supabase.auth.getUser();
    const { error } = await supabase.from('officer_leave_log').insert({
      officer_id: officer?.user_id ?? null,
      officer_name: officer?.name ?? 'Unknown',
      leave_date: leaveForm.leaveDate,
      leave_type: leaveForm.leaveType,
      marked_by: authData.user?.id ?? null,
    });
    if (error) {
      window.alert(error.message);
      return;
    }
    void qc.invalidateQueries({ queryKey: ['admin-officer-leave'] });
    void qc.invalidateQueries({ queryKey: ['admin-leave-today'] });
    setLeaveForm((f) => ({ ...f, officerId: '' }));
  };

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [inspRes, usersRes, branchRes, filesRes] = await Promise.all([
        supabase.from('inspections').select('id', { count: 'exact', head: true }),
        supabase.from('user_roles').select('id', { count: 'exact', head: true }),
        supabase.from('branches').select('id', { count: 'exact', head: true }),
        supabase.from('inspection_files').select('id', { count: 'exact', head: true }),
      ]);
      return {
        inspections: inspRes.count ?? 0,
        users: usersRes.count ?? 0,
        branches: branchRes.count ?? 0,
        files: filesRes.count ?? 0,
      };
    },
  });

  const { data: dailyCounts = [] } = useQuery({
    queryKey: ['admin-daily'],
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 30);
      const { data } = await supabase
        .from('inspections')
        .select('created_at')
        .gte('created_at', since.toISOString());
      const map: Record<string, number> = {};
      (data ?? []).forEach((r: { created_at: string }) => {
        const d = r.created_at.split('T')[0];
        map[d] = (map[d] || 0) + 1;
      });
      return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
    },
  });

  const exportUnifiedReport = async () => {
    let q = supabase
      .from('inspections')
      .select(
        `id, inspection_date, submitted_at, compliance_score, risk_level, status,
        user_roles:officer_id ( name ),
        branches:branch_id ( branch_name, city, branch_types:branch_type_id ( type_name ) ),
        inspection_responses ( response, remarks, checklist_templates:checklist_item_id ( section, item_text ) ),
        inspection_files ( file_url ),
        inspection_answers ( photo_url )`,
      )
      .gte('inspection_date', from)
      .lte('inspection_date', to);
    if (status !== 'all') q = q.eq('status', status);
    const { data: exportRows, error } = await q;
    if (error || !exportRows) {
      window.alert(error?.message || 'Export failed.');
      return;
    }

    type ExportRow = {
      id: string;
      inspection_date?: string;
      submitted_at?: string | null;
      compliance_score?: number;
      risk_level?: string;
      status?: string;
      user_roles?: { name?: string } | null;
      branches?: {
        branch_name?: string;
        city?: string;
        branch_types?: { type_name?: string } | { type_name?: string }[] | null;
      } | null;
      inspection_responses?: {
        response?: string;
        remarks?: string;
        checklist_templates?: { section?: string; item_text?: string } | null;
      }[];
      inspection_files?: { file_url?: string }[];
      inspection_answers?: { photo_url?: string | null }[];
    };

    const detailRows: string[][] = [];
    const summaryRows: string[][] = [];
    let submittedCount = 0;
    const branchCounts = new Map<string, number>();
    let avgSum = 0;
    let scoredCount = 0;
    const riskCounts = { low: 0, medium: 0, critical: 0, other: 0 };

    (exportRows as ExportRow[]).forEach((insp) => {
      const branch = insp.branches;
      const typeRel = branch?.branch_types;
      const typeName = Array.isArray(typeRel) ? typeRel[0]?.type_name : typeRel?.type_name;
      if (branchType !== 'all' && typeName !== branchType) return;
      if (insp.status === 'submitted' || insp.status === 'approved') submittedCount += 1;
      const branchLabel = branch?.branch_name ?? 'Unknown';
      branchCounts.set(branchLabel, (branchCounts.get(branchLabel) ?? 0) + 1);

      if (typeof insp.compliance_score === 'number') {
        avgSum += insp.compliance_score;
        scoredCount += 1;
      }
      const risk = (insp.risk_level ?? '').toLowerCase();
      if (risk === 'low') riskCounts.low += 1;
      else if (risk === 'medium') riskCounts.medium += 1;
      else if (risk === 'critical') riskCounts.critical += 1;
      else riskCounts.other += 1;

      summaryRows.push([
        insp.id,
        insp.inspection_date ?? '',
        insp.submitted_at ? new Date(insp.submitted_at).toLocaleString('en-IN') : '',
        branchLabel,
        branch?.city ?? '',
        typeName ?? '',
        insp.user_roles?.name ?? '',
        typeof insp.compliance_score === 'number' ? `${insp.compliance_score.toFixed(1)}%` : '—',
        insp.risk_level ?? '',
        insp.status ?? '',
      ]);

      const fileUrls = (insp.inspection_files ?? []).map((f) => f.file_url).filter(Boolean);
      const answerUrls = (insp.inspection_answers ?? []).map((a) => a.photo_url).filter(Boolean);
      const files = String([...new Set([...fileUrls, ...answerUrls])].length);
      const base = [
        insp.id,
        insp.inspection_date ?? '',
        insp.submitted_at ? new Date(insp.submitted_at).toLocaleString('en-IN') : '',
        insp.user_roles?.name ?? '',
        branchLabel,
        typeName ?? '',
        branch?.city ?? '',
      ];

      const responses = insp.inspection_responses ?? [];
      if (responses.length === 0) {
        detailRows.push([
          ...base,
          '',
          '',
          '',
          '',
          String(insp.compliance_score ?? ''),
          insp.risk_level ?? '',
          insp.status ?? '',
          files,
        ]);
      } else {
        responses.forEach((r) => {
          const ct = r.checklist_templates;
          detailRows.push([
            ...base,
            ct?.section ?? '',
            ct?.item_text ?? '',
            r.response ?? '',
            r.remarks ?? '',
            String(insp.compliance_score ?? ''),
            insp.risk_level ?? '',
            insp.status ?? '',
            files,
          ]);
        });
      }
    });

    const leaveSection = await fetchLeaveCsvSection();
    const avgCompliance = scoredCount ? `${(avgSum / scoredCount).toFixed(1)}%` : '—';

    downloadAdminUnifiedReport({
      filters: { from, to, branchType, status },
      detailRows,
      summaryRows,
      submittedCount,
      branchCounts,
      riskCounts,
      avgCompliance,
      leaveHeaders: leaveSection.headers,
      leaveRows: leaveSection.rows,
    });
  };

  return (
    <div className="space-y-8">
      {/* Section A */}
      <div className="space-y-4">
        <h2 className="font-semibold text-lg">Export Data</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label">Branch Type</label>
            <select className="input" value={branchType} onChange={e => setBranchType(e.target.value)}>
              <option value="all">All</option>
              <option value="CFC">CFC</option>
              <option value="Store">Store</option>
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={exportUnifiedReport} className="btn-primary">
            Download Full Report
          </button>
        </div>
        <p className="text-xs text-gray-500">
          One file with executive summary, charts, all inspections, checklist detail, and officer leave data.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
          >
            <p className="text-3xl font-bold text-blue-600">{uniqueStoresVisited}</p>
            <p className="text-xs text-gray-500 mt-1">Unique Stores Visited</p>
          </button>
          <button
            type="button"
            onClick={() => setShowRevisitModal(true)}
            className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
          >
            <p className="text-3xl font-bold text-amber-600">{revisitInspections}</p>
            <p className="text-xs text-gray-500 mt-1">Revisit Inspections</p>
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-lg">Officer Attendance</h2>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2">
            <p className="text-xs text-gray-500">On Leave Today</p>
            <p className="text-2xl font-bold text-amber-600">{onLeaveToday}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="label">Officer</label>
            <select
              className="input w-full"
              value={leaveForm.officerId}
              onChange={(e) => setLeaveForm((f) => ({ ...f, officerId: e.target.value }))}
            >
              <option value="">Select officer…</option>
              {officers.map((o: { id: string; name: string }) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input w-full"
              value={leaveForm.leaveDate}
              onChange={(e) => setLeaveForm((f) => ({ ...f, leaveDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Leave type</label>
            <select
              className="input w-full"
              value={leaveForm.leaveType}
              onChange={(e) => setLeaveForm((f) => ({ ...f, leaveType: e.target.value }))}
            >
              <option value="absent">Absent</option>
              <option value="leave">Leave</option>
              <option value="holiday">Holiday</option>
            </select>
          </div>
        </div>
        <button type="button" onClick={() => void addLeaveRecord()} className="btn-primary">
          Add Leave
        </button>

        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {['Date', 'Officer Name', 'District', 'Leave Type', 'Marked By'].map((h) => (
                  <th key={h} className="th">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {leaveRows.map((row: { id: string; leave_date: string; officer_name: string; leave_type: string; officer_id?: string; marked_by?: string | null }) => (
                <tr key={row.id} className="tr">
                  <td className="td">{row.leave_date}</td>
                  <td className="td">{row.officer_name}</td>
                  <td className="td">{districtMap.get(row.officer_id ?? '') ?? '—'}</td>
                  <td className="td capitalize">{row.leave_type}</td>
                  <td className="td text-gray-500">{row.marked_by ? 'Admin' : '—'}</td>
                </tr>
              ))}
              {leaveRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="td text-center text-gray-400">
                    No leave records in selected range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section B */}
      <div className="space-y-4">
        <h2 className="font-semibold text-lg">System Stats</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Inspections', value: stats?.inspections },
            { label: 'Total Users', value: stats?.users },
            { label: 'Total Branches', value: stats?.branches },
            { label: 'Total Files', value: stats?.files },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
              <p className="text-3xl font-bold text-blue-600">{s.value ?? '—'}</p>
              <p className="text-xs text-gray-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <h3 className="font-medium">Last 30 Days — Daily Inspection Counts</h3>
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="th">Date</th>
                <th className="th">Inspections</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {dailyCounts.map(r => (
                <tr key={r.date} className="tr">
                  <td className="td">{r.date}</td>
                  <td className="td font-semibold">{r.count}</td>
                </tr>
              ))}
              {dailyCounts.length === 0 && (
                <tr><td colSpan={2} className="td text-center text-gray-400">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <KpiDetailModal
        open={showRevisitModal}
        title="Revisit Inspections"
        rows={revisitRows}
        onClose={() => setShowRevisitModal(false)}
      />
    </div>
  );
}
