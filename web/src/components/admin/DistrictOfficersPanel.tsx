import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { DistrictAssignmentRow } from './KeralaBranchMap';
import { initials } from '../../lib/keralaDistricts';
import { StoreAssignmentModal } from './StoreAssignmentModal';
import { countOfficerStores } from '../../lib/storeAssignment';

interface OfficerOption {
  id: string;
  name: string;
  profile_photo_url: string | null;
}

function OfficerAvatar({
  name,
  photoUrl,
}: {
  name: string;
  photoUrl: string | null;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="w-8 h-8 rounded-full object-cover border border-slate-600"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-700 flex items-center justify-center text-xs font-bold text-white">
      {initials(name)}
    </div>
  );
}

function ReassignModal({
  district,
  currentOfficerId,
  onClose,
  onSaved,
}: {
  district: string;
  currentOfficerId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [officerId, setOfficerId] = useState(currentOfficerId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: officers = [] } = useQuery<OfficerOption[]>({
    queryKey: ['active-officers'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('user_roles')
        .select('id, name, profile_photo_url')
        .eq('role', 'officer')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');
      if (err) throw err;
      return data ?? [];
    },
  });

  const handleConfirm = async () => {
    if (!officerId) return;
    setSaving(true);
    setError('');
    try {
      const { data: authData } = await supabase.auth.getUser();
      const adminUserId = authData.user?.id ?? null;

      const { data: existing } = await supabase
        .from('district_assignments')
        .select('id, officer_id')
        .eq('district', district)
        .eq('is_primary', true)
        .maybeSingle();

      const previousOfficerId = existing?.officer_id ?? null;

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from('district_assignments')
          .update({ officer_id: officerId, assigned_at: new Date().toISOString(), assigned_by: adminUserId })
          .eq('id', existing.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from('district_assignments').insert({
          district,
          officer_id: officerId,
          is_primary: true,
          assigned_by: adminUserId,
        });
        if (insErr) throw insErr;
      }

      await supabase.from('district_assignment_audit').insert({
        district,
        previous_officer_id: previousOfficerId,
        new_officer_id: officerId,
        changed_by: adminUserId,
      });

      const { data: notif, error: notifErr } = await supabase
        .from('notifications')
        .insert({
          recipient_id: officerId,
          type: 'district_reassigned',
          title: 'New District Assigned',
          body: `You have been assigned to cover ${district} district.`,
          link: '/officer',
        })
        .select('id')
        .single();
      if (notifErr) throw notifErr;

      await supabase.functions.invoke('notify-officer', {
        body: {
          district_reassigned: {
            officer_role_id: officerId,
            district,
            notification_id: notif?.id,
          },
        },
      });

      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to reassign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full space-y-4">
        <h3 className="font-bold text-lg">Reassign — {district}</h3>
        <div>
          <label className="label">Officer</label>
          <select
            className="input w-full"
            value={officerId}
            onChange={(e) => setOfficerId(e.target.value)}
          >
            <option value="">Select officer…</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            type="button"
            disabled={!officerId || saving}
            onClick={() => void handleConfirm()}
            className="btn-primary flex-1"
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DistrictOfficersPanel() {
  const qc = useQueryClient();
  const [reassignDistrict, setReassignDistrict] = useState<string | null>(null);
  const [manageStores, setManageStores] = useState<{
    district: string;
    officerId: string;
    officerName: string;
    userId: string | null;
  } | null>(null);

  const { data: assignments = [], isLoading } = useQuery<DistrictAssignmentRow[]>({
    queryKey: ['district-assignments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('district_assignments')
        .select(
          `id, district, officer_id, is_on_leave,
           officer:user_roles!district_assignments_officer_id_fkey ( id, name, profile_photo_url )`,
        )
        .eq('is_primary', true)
        .order('district');
      if (error) throw error;
      return (data ?? []).map((row) => {
        const officer = Array.isArray(row.officer) ? row.officer[0] : row.officer;
        return { ...row, officer: officer ?? null };
      });
    },
  });

  const { data: branchAssignments = [] } = useQuery({
    queryKey: ['branch-officer-assignments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, region, assigned_officer_id')
        .eq('is_active', true)
        .is('deleted_at', null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const districtsWithStores = useMemo(() => {
    const set = new Set<string>();
    branchAssignments.forEach((b) => {
      if (b.region) set.add(b.region);
    });
    return set;
  }, [branchAssignments]);

  const visibleAssignments = useMemo(
    () => assignments.filter((a) => districtsWithStores.has(a.district)),
    [assignments, districtsWithStores],
  );

  const { data: officerProfiles = [] } = useQuery({
    queryKey: ['officer-user-ids'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('id, user_id, name')
        .eq('role', 'officer')
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const countAssignedStores = (district: string, officerRoleId: string | null) => {
    if (!officerRoleId) return 0;
    const profile = officerProfiles.find((o) => o.id === officerRoleId);
    return countOfficerStores(branchAssignments, district, profile?.user_id ?? null);
  };

  const toggleLeave = async (id: string, isOnLeave: boolean) => {
    await supabase
      .from('district_assignments')
      .update({ is_on_leave: !isOnLeave })
      .eq('id', id);
    void qc.invalidateQueries({ queryKey: ['district-assignments'] });
  };

  return (
    <div className="space-y-3">
      <h3 className="admin-section-heading">District Officers</h3>
      {isLoading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : (
        <div className="admin-table-wrap overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                {['District', 'Assigned Officer', 'Status', 'Assigned Stores', 'Action'].map((h) => (
                  <th key={h} className="th admin-col-header">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleAssignments.map((row) => {
                const name = row.officer?.name ?? 'Unassigned';
                const storeCount = countAssignedStores(row.district, row.officer_id);
                const officerProfile = officerProfiles.find((o) => o.id === row.officer_id);
                return (
                  <tr key={row.id} className="tr">
                    <td className="td font-medium">{row.district}</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <OfficerAvatar
                          name={name}
                          photoUrl={row.officer?.profile_photo_url ?? null}
                        />
                        <span>{name}</span>
                      </div>
                    </td>
                    <td className="td">
                      <button
                        type="button"
                        onClick={() => void toggleLeave(row.id, row.is_on_leave)}
                        className={`badge ${row.is_on_leave ? 'badge-amber' : 'badge-green'}`}
                      >
                        {row.is_on_leave ? 'On Leave' : 'Active'}
                      </button>
                    </td>
                    <td className="td">
                      <span className="badge badge-blue">{storeCount} stores</span>
                      {row.officer_id ? (
                        <button
                          type="button"
                          className="btn-xs btn-xs-blue ml-2"
                          onClick={() =>
                            setManageStores({
                              district: row.district,
                              officerId: row.officer_id!,
                              officerName: name,
                              userId: officerProfile?.user_id ?? null,
                            })
                          }
                        >
                          Manage
                        </button>
                      ) : null}
                    </td>
                    <td className="td">
                      <button
                        type="button"
                        className="btn-xs btn-xs-blue"
                        onClick={() => setReassignDistrict(row.district)}
                      >
                        Reassign
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {manageStores ? (
        <StoreAssignmentModal
          district={manageStores.district}
          officer={{
            id: manageStores.officerId,
            name: manageStores.officerName,
            user_id: manageStores.userId,
          }}
          onClose={() => setManageStores(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['branch-officer-assignments'] });
          }}
        />
      ) : null}

      {reassignDistrict && (
        <ReassignModal
          district={reassignDistrict}
          currentOfficerId={
            assignments.find((a) => a.district === reassignDistrict)?.officer_id ?? null
          }
          onClose={() => setReassignDistrict(null)}
          onSaved={() => {
            setReassignDistrict(null);
            void qc.invalidateQueries({ queryKey: ['district-assignments'] });
          }}
        />
      )}
    </div>
  );
}
