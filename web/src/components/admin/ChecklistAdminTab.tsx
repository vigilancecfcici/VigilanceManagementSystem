import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../../lib/supabase';
import { resolvePrimaryStoreBranchTypeId } from '../../lib/branchTypes';
import {
  buildInitialOptionRows,
  buildOptionColorPayload,
  defaultColorForOption,
  normalizeOptionColorMap,
  type OptionColorMap,
  type OptionRow,
} from '../../lib/checklistOptionColors';

type RiskLevel = 'RED' | 'YELLOW' | 'GREEN';

interface BranchTypeRow {
  id: string;
  type_name: string;
}

interface RiskClassificationRow {
  id?: string;
  checklist_item_id: string;
  risk_level: RiskLevel;
  trigger_on_no: boolean;
  requires_photo: boolean;
  min_remark_chars: number;
}

interface ChecklistItem {
  id: string;
  section: string;
  item_text: string;
  item_order: number;
  branch_type_id: string | null;
  is_active: boolean;
  options: string[] | null;
  option_colors: OptionColorMap | null;
  risk_classification?: RiskClassificationRow | null;
}

const RISK_PILL: Record<RiskLevel, string> = {
  RED: 'bg-red-100 text-red-700 border border-red-200',
  YELLOW: 'bg-amber-100 text-amber-700 border border-amber-200',
  GREEN: 'bg-green-100 text-green-700 border border-green-200',
};

interface RiskFieldsValue {
  riskLevel: RiskLevel;
  triggerOnNo: boolean;
  requiresPhoto: boolean;
  minRemarkChars: number;
}

function buildRiskPayload(checklistItemId: string, fields: RiskFieldsValue) {
  return {
    checklist_item_id: checklistItemId,
    risk_level: fields.riskLevel,
    trigger_on_no: fields.triggerOnNo,
    requires_photo: fields.requiresPhoto,
    min_remark_chars: Math.max(0, Number(fields.minRemarkChars) || 0),
    statutory_act: null,
    legal_notes: null,
  };
}

async function applyGlobalItemOrders(
  sectionsInOrder: string[],
  items: ChecklistItem[],
): Promise<void> {
  let nextOrder = 1;
  for (const section of sectionsInOrder) {
    const sectionItems = items
      .filter((item) => item.section === section)
      .sort((a, b) => a.item_order - b.item_order);
    for (const item of sectionItems) {
      if (item.item_order !== nextOrder) {
        const { error } = await supabase
          .from('checklist_templates')
          .update({ item_order: nextOrder })
          .eq('id', item.id);
        if (error) throw error;
      }
      nextOrder += 1;
    }
  }
}

async function nextItemOrderForSection(
  section: string,
  items: ChecklistItem[],
  sectionsInOrder: string[],
): Promise<number> {
  const sorted = [...items].sort((a, b) => a.item_order - b.item_order);
  const sectionItems = sorted.filter((item) => item.section === section);
  if (sectionItems.length > 0) {
    return sectionItems[sectionItems.length - 1].item_order + 1;
  }

  const sectionIndex = sectionsInOrder.indexOf(section);
  if (sectionIndex > 0) {
    for (let i = sectionIndex - 1; i >= 0; i -= 1) {
      const prevSectionItems = sorted.filter((item) => item.section === sectionsInOrder[i]);
      if (prevSectionItems.length > 0) {
        return prevSectionItems[prevSectionItems.length - 1].item_order + 1;
      }
    }
  }

  return (sorted[sorted.length - 1]?.item_order ?? 0) + 1;
}

async function insertItemAtOrder(
  insertOrder: number,
  items: ChecklistItem[],
  payload: Record<string, unknown>,
): Promise<string> {
  const toBump = items
    .filter((item) => item.item_order >= insertOrder)
    .sort((a, b) => b.item_order - a.item_order);
  for (const item of toBump) {
    const { error } = await supabase
      .from('checklist_templates')
      .update({ item_order: item.item_order + 1 })
      .eq('id', item.id);
    if (error) throw error;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('checklist_templates')
    .insert({ ...payload, item_order: insertOrder })
    .select('id')
    .single();
  if (insertErr || !inserted) throw insertErr ?? new Error('Insert failed');
  return inserted.id as string;
}

function SortableSectionHeader({
  id,
  section,
  count,
  collapsed,
  onToggle,
}: {
  id: string;
  section: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-gray-50 dark:bg-gray-800 px-4 py-2 font-semibold text-sm flex items-center gap-2"
    >
      <button
        type="button"
        className="cursor-grab text-gray-400 hover:text-gray-200 px-1"
        aria-label="Drag to reorder section"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <button
        type="button"
        className="flex-1 flex items-center gap-2 text-left"
        onClick={onToggle}
      >
        <span>{collapsed ? '▸' : '▾'}</span>
        <span>{section}</span>
        <span className="text-xs font-normal text-gray-500">({count})</span>
      </button>
    </div>
  );
}

function ChecklistItemModal({
  mode,
  item,
  sections,
  items,
  storeTypeId,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit';
  item?: ChecklistItem;
  sections: string[];
  items: ChecklistItem[];
  storeTypeId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [section, setSection] = useState(item?.section ?? sections[0] ?? '');
  const [sectionInput, setSectionInput] = useState(item?.section ?? '');
  const [itemText, setItemText] = useState(item?.item_text ?? '');
  const rc = item?.risk_classification;
  const [risk, setRisk] = useState<RiskFieldsValue>({
    riskLevel: rc?.risk_level ?? 'GREEN',
    triggerOnNo: rc?.trigger_on_no ?? false,
    requiresPhoto: rc?.requires_photo ?? false,
    minRemarkChars: rc?.min_remark_chars ?? 0,
  });
  const initialOptionState = buildInitialOptionRows(item);
  const [useCustomLabels, setUseCustomLabels] = useState(initialOptionState.useCustomLabels);
  const [optionRows, setOptionRows] = useState<OptionRow[]>(initialOptionState.rows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sectionOptions = useMemo(() => {
    const set = new Set(sections);
    if (sectionInput.trim()) set.add(sectionInput.trim());
    return [...set].sort();
  }, [sections, sectionInput]);

  const handleSave = async () => {
    const finalSection = sectionInput.trim() || section;
    if (!finalSection || !itemText.trim()) {
      setError('Section and item text are required');
      return;
    }
    const trimmedRows = optionRows
      .map((row) => ({ label: row.label.trim(), color: row.color }))
      .filter((row) => row.label);
    if (!trimmedRows.length) {
      setError('Add at least one response option');
      return;
    }
    const savedOptions = useCustomLabels ? trimmedRows.map((row) => row.label) : null;
    const savedOptionColors = buildOptionColorPayload(trimmedRows);
    setLoading(true);
    setError('');
    try {
      const branchTypeId = storeTypeId ?? null;

      if (mode === 'edit' && item) {
        const { error: itemErr } = await supabase
          .from('checklist_templates')
          .update({
            section: finalSection,
            item_text: itemText.trim(),
            branch_type_id: branchTypeId,
            options: savedOptions,
            option_colors: savedOptionColors,
          })
          .eq('id', item.id);
        if (itemErr) throw itemErr;
        const { error: rcErr } = await supabase
          .from('risk_classifications')
          .upsert(buildRiskPayload(item.id, risk), { onConflict: 'checklist_item_id' });
        if (rcErr) throw rcErr;
      } else {
        const insertOrder = await nextItemOrderForSection(finalSection, items, sections);
        const insertedId = await insertItemAtOrder(insertOrder, items, {
          section: finalSection,
          item_text: itemText.trim(),
          branch_type_id: branchTypeId,
          is_active: true,
          options: savedOptions,
          option_colors: savedOptionColors,
        });

        const { error: rcErr } = await supabase
          .from('risk_classifications')
          .upsert(buildRiskPayload(insertedId, risk), { onConflict: 'checklist_item_id' });
        if (rcErr) throw rcErr;
      }
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-lg">
          {mode === 'add' ? 'Add Checklist Item' : 'Edit Checklist Item'}
        </h3>

        <div>
          <label className="label">Section</label>
          <input
            className="input w-full"
            list="checklist-sections"
            placeholder="Select or type new section…"
            value={sectionInput}
            onChange={(e) => {
              setSectionInput(e.target.value);
              setSection(e.target.value);
            }}
          />
          <datalist id="checklist-sections">
            {sectionOptions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label">Item Text</label>
          <textarea
            className="input w-full h-24"
            value={itemText}
            onChange={(e) => setItemText(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Risk Level</label>
          <div className="space-y-1.5 text-sm">
            {(
              [
                ['GREEN', 'Informational'],
                ['YELLOW', 'Warning'],
                ['RED', 'Critical'],
              ] as const
            ).map(([level, label]) => (
              <label key={level} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="riskLevel"
                  checked={risk.riskLevel === level}
                  onChange={() => setRisk({ ...risk, riskLevel: level })}
                />
                <span className={level === 'RED' ? 'text-red-500' : level === 'YELLOW' ? 'text-amber-500' : 'text-green-500'}>
                  {level} — {label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={risk.triggerOnNo}
            onChange={(e) => setRisk({ ...risk, triggerOnNo: e.target.checked })}
          />
          Fire alert when officer answers NO
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={risk.requiresPhoto}
            onChange={(e) => setRisk({ ...risk, requiresPhoto: e.target.checked })}
          />
          Requires photo evidence
        </label>

        <div>
          <label className="label">Min Remark Characters</label>
          <input
            className="input w-full"
            type="number"
            min={0}
            value={risk.minRemarkChars}
            onChange={(e) =>
              setRisk({ ...risk, minRemarkChars: Number(e.target.value) || 0 })
            }
          />
        </div>

        <div className="space-y-2">
          <label className="label">Response Options &amp; Highlight Colors</label>
          <p className="text-xs text-gray-500">
            Choose the color shown on the officer app when each option is selected.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useCustomLabels}
              onChange={(e) => {
                const on = e.target.checked;
                setUseCustomLabels(on);
                if (on) {
                  setOptionRows(
                    optionRows.length
                      ? optionRows
                      : [{ label: 'Option 1', color: 'GREEN' }],
                  );
                } else {
                  setOptionRows(
                    ['Yes', 'No', 'N/A'].map((label) => ({
                      label,
                      color:
                        optionRows.find(
                          (row) => row.label.toLowerCase() === label.toLowerCase(),
                        )?.color ?? defaultColorForOption(label, risk.triggerOnNo),
                    })),
                  );
                }
              }}
            />
            Use custom option labels (instead of Yes / No / N/A)
          </label>
          {optionRows.map((row, idx) => (
            <div key={idx} className="flex flex-wrap gap-2 items-center border border-gray-200 dark:border-gray-600 rounded-lg p-2">
              <input
                className="input flex-1 min-w-[120px]"
                placeholder={`Option ${idx + 1}`}
                value={row.label}
                readOnly={!useCustomLabels}
                onChange={(e) => {
                  const next = [...optionRows];
                  next[idx] = { ...next[idx], label: e.target.value };
                  setOptionRows(next);
                }}
              />
              <div className="flex gap-1.5">
                {(['GREEN', 'YELLOW', 'RED'] as const).map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={`Highlight ${color.toLowerCase()}`}
                    className={`px-2 py-1 rounded text-xs font-bold border ${
                      row.color === color
                        ? color === 'RED'
                          ? 'bg-red-100 text-red-700 border-red-300'
                          : color === 'YELLOW'
                            ? 'bg-amber-100 text-amber-700 border-amber-300'
                            : 'bg-green-100 text-green-700 border-green-300'
                        : 'bg-gray-50 text-gray-400 border-gray-200'
                    }`}
                    onClick={() => {
                      const next = [...optionRows];
                      next[idx] = { ...next[idx], color };
                      setOptionRows(next);
                    }}
                  >
                    {color}
                  </button>
                ))}
              </div>
              {useCustomLabels && optionRows.length > 1 && (
                <button
                  type="button"
                  className="btn-xs btn-xs-red shrink-0"
                  aria-label="Remove option"
                  onClick={() => setOptionRows(optionRows.filter((_, i) => i !== idx))}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {useCustomLabels && (
            <button
              type="button"
              className="btn-xs"
              onClick={() =>
                setOptionRows([...optionRows, { label: '', color: 'GREEN' }])
              }
            >
              + Add Option
            </button>
          )}
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !itemText.trim()}
            onClick={() => void handleSave()}
            className="btn-primary flex-1"
          >
            {loading ? 'Saving…' : mode === 'add' ? 'Add Item' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChecklistAdminTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editingItem, setEditingItem] = useState<ChecklistItem | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: branchTypes = [] } = useQuery<BranchTypeRow[]>({
    queryKey: ['admin-branch-types'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('branch_types').select('id, type_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const storeTypeId = resolvePrimaryStoreBranchTypeId(branchTypes);

  const { data: items = [] } = useQuery<ChecklistItem[]>({
    queryKey: ['admin-checklist', storeTypeId],
    enabled: !!storeTypeId,
    queryFn: async () => {
      const query = supabase
        .from('checklist_templates')
        .select(
          `id, section, item_text, item_order, branch_type_id, is_active, options, option_colors,
          risk_classifications:risk_classifications!risk_classifications_checklist_item_id_fkey (
            id, risk_level, trigger_on_no, requires_photo, min_remark_chars
          )`,
        )
        .eq('is_active', true)
        .is('deleted_at', null)
        .eq('branch_type_id', storeTypeId!);

      const { data, error } = await query
        .order('section', { ascending: true })
        .order('item_order', { ascending: true });
      if (error) throw error;

      return (data ?? []).map((i: Record<string, unknown>): ChecklistItem => {
        const rcRaw = i.risk_classifications;
        const rc = Array.isArray(rcRaw) ? rcRaw[0] : rcRaw;
        return {
          id: i.id as string,
          section: i.section as string,
          item_text: i.item_text as string,
          item_order: i.item_order as number,
          branch_type_id: i.branch_type_id as string | null,
          is_active: i.is_active as boolean,
          options: Array.isArray(i.options) ? (i.options as string[]) : null,
          option_colors: normalizeOptionColorMap(i.option_colors),
          risk_classification: rc
            ? {
                id: (rc as RiskClassificationRow).id,
                checklist_item_id: i.id as string,
                risk_level: (rc as RiskClassificationRow).risk_level,
                trigger_on_no: !!(rc as RiskClassificationRow).trigger_on_no,
                requires_photo: !!(rc as RiskClassificationRow).requires_photo,
                min_remark_chars: (rc as RiskClassificationRow).min_remark_chars ?? 0,
              }
            : null,
        };
      });
    },
  });

  const sectionsFromItems = useMemo(
    () => [...new Set(items.map((i) => i.section))],
    [items],
  );

  const orderedSections = useMemo(() => {
    if (sectionOrder.length === 0) return sectionsFromItems;
    const extra = sectionsFromItems.filter((s) => !sectionOrder.includes(s));
    return [...sectionOrder.filter((s) => sectionsFromItems.includes(s)), ...extra];
  }, [sectionsFromItems, sectionOrder]);

  React.useEffect(() => {
    if (sectionsFromItems.length && sectionOrder.length === 0) {
      setSectionOrder(sectionsFromItems);
    }
  }, [sectionsFromItems, sectionOrder.length]);

  const softDelete = async (id: string) => {
    if (!window.confirm('Delete this item? It will be hidden from future inspections.')) return;
    await supabase
      .from('checklist_templates')
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('id', id);
    void qc.invalidateQueries({ queryKey: ['admin-checklist'] });
  };

  const handleSectionDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedSections.indexOf(String(active.id));
    const newIndex = orderedSections.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(orderedSections, oldIndex, newIndex);
    setSectionOrder(next);
    try {
      await applyGlobalItemOrders(next, items);
      void qc.invalidateQueries({ queryKey: ['admin-checklist'] });
    } catch (err) {
      console.error('[ChecklistAdminTab] section reorder failed', err);
    }
  };

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button type="button" onClick={() => setShowAdd(true)} className="btn-primary">
          + Add Item
        </button>
      </div>
      <p className="admin-checklist-notice">⚠ Changes only affect future inspections.</p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleSectionDragEnd(e)}>
        <SortableContext items={orderedSections} strategy={verticalListSortingStrategy}>
          {orderedSections.map((section) => {
            const sectionItems = items
              .filter((i) => i.section === section)
              .sort((a, b) => a.item_order - b.item_order);
            const collapsed = collapsedSections.has(section);
            return (
              <div
                key={section}
                className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-3"
              >
                <SortableSectionHeader
                  id={section}
                  section={section}
                  count={sectionItems.length}
                  collapsed={collapsed}
                  onToggle={() => toggleSection(section)}
                />
                {!collapsed && (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                    {sectionItems.map((item, index) => (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="text-gray-400 w-6 text-right">{index + 1}</span>
                        <span className="flex-1">
                          {item.item_text}
                          {item.options && item.options.length > 0 && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                              {item.options.length} option{item.options.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </span>
                        <span className="w-24 text-center">
                          {item.risk_classification?.risk_level ? (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${RISK_PILL[item.risk_classification.risk_level]}`}
                            >
                              {item.risk_classification.risk_level}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400 uppercase">unset</span>
                          )}
                        </span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingItem(item)}
                            className="btn-xs"
                            aria-label="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => void softDelete(item.id)}
                            className="btn-xs btn-xs-red"
                            aria-label="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </SortableContext>
      </DndContext>

      {showAdd && (
        <ChecklistItemModal
          mode="add"
          sections={orderedSections}
          items={items}
          storeTypeId={storeTypeId}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            void qc.invalidateQueries({ queryKey: ['admin-checklist'] });
          }}
        />
      )}

      {editingItem && (
        <ChecklistItemModal
          mode="edit"
          item={editingItem}
          sections={orderedSections}
          items={items}
          storeTypeId={storeTypeId}
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            setEditingItem(null);
            void qc.invalidateQueries({ queryKey: ['admin-checklist'] });
          }}
        />
      )}
    </div>
  );
}
