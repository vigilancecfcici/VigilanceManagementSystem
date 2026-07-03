/** Per-option highlight colors for checklist response buttons. */

export type HighlightColor = 'RED' | 'GREEN' | 'YELLOW';

export type OptionColorMap = Partial<Record<string, HighlightColor>>;

export const HIGHLIGHT_PALETTE: Record<
  HighlightColor,
  { activeColor: string; activeBg: string }
> = {
  RED: { activeColor: '#dc2626', activeBg: '#fee2e2' },
  GREEN: { activeColor: '#16a34a', activeBg: '#dcfce7' },
  YELLOW: { activeColor: '#d97706', activeBg: '#fef3c7' },
};

export function normalizeOptionColorMap(
  raw: unknown,
): OptionColorMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: OptionColorMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const color = String(value ?? '').toUpperCase();
    if (color === 'RED' || color === 'GREEN' || color === 'YELLOW') {
      out[key.trim().toLowerCase()] = color;
    }
  }
  return Object.keys(out).length ? out : null;
}

export function defaultColorForOption(
  label: string,
  triggerOnNo: boolean,
): HighlightColor {
  const key = label.trim().toLowerCase();
  if (key === 'n/a') return 'YELLOW';
  if (key === 'yes') return triggerOnNo ? 'GREEN' : 'RED';
  if (key === 'no') return triggerOnNo ? 'RED' : 'GREEN';
  return 'GREEN';
}

export function resolveOptionHighlightColor(
  optionLabel: string,
  optionColors: OptionColorMap | null | undefined,
  triggerOnNo: boolean,
): HighlightColor {
  const key = optionLabel.trim().toLowerCase();
  return optionColors?.[key] ?? defaultColorForOption(optionLabel, triggerOnNo);
}

export function buildOptionColorPayload(
  rows: Array<{ label: string; color: HighlightColor }>,
): OptionColorMap {
  const out: OptionColorMap = {};
  for (const row of rows) {
    const label = row.label.trim();
    if (!label) continue;
    out[label.toLowerCase()] = row.color;
  }
  return out;
}

export type OptionRow = { label: string; color: HighlightColor };

export const STANDARD_RESPONSE_OPTIONS = ['Yes', 'No', 'N/A'] as const;

export function isStandardOptions(labels: string[]): boolean {
  if (labels.length !== 3) return false;
  const normalized = labels.map((l) => l.trim().toLowerCase());
  return (
    normalized.includes('yes') &&
    normalized.includes('no') &&
    (normalized.includes('n/a') || normalized.includes('na'))
  );
}

export function buildInitialOptionRows(
  item: ChecklistItemLike | undefined,
): { rows: OptionRow[]; useCustomLabels: boolean } {
  const triggerOnNo = item?.risk_classification?.trigger_on_no ?? false;
  const colorMap = normalizeOptionColorMap(item?.option_colors);
  const savedOptions = item?.options?.filter((o) => o.trim()) ?? [];

  if (savedOptions.length > 0 && !isStandardOptions(savedOptions)) {
    return {
      useCustomLabels: true,
      rows: savedOptions.map((label) => ({
        label,
        color:
          colorMap?.[label.toLowerCase()] ??
          defaultColorForOption(label, triggerOnNo),
      })),
    };
  }

  return {
    useCustomLabels: false,
    rows: STANDARD_RESPONSE_OPTIONS.map((label) => ({
      label,
      color:
        colorMap?.[label.toLowerCase()] ??
        defaultColorForOption(label, triggerOnNo),
    })),
  };
}

interface ChecklistItemLike {
  options?: string[] | null;
  option_colors?: unknown;
  risk_classification?: { trigger_on_no?: boolean } | null;
}
