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

export type ChecklistResponse =
  | 'Yes'
  | 'No'
  | 'N/A'
  | 'Good'
  | 'Moderate'
  | 'Bad'
  | string
  | null;

/** When true, answering "No" indicates a violation. When false, "Yes" is the violation. */
export function isViolationResponse(
  response: ChecklistResponse,
  triggerOnNo: boolean,
): boolean {
  if (!response || response === 'N/A') return false;
  if (response === 'Bad') return true;
  if (response === 'Good' || response === 'Moderate') return false;
  if (response === 'Yes' || response === 'No') {
    return triggerOnNo ? response === 'No' : response === 'Yes';
  }
  return false;
}

export function isCompliantResponse(
  response: ChecklistResponse,
  triggerOnNo: boolean,
): boolean {
  if (!response || response === 'N/A') return false;
  return !isViolationResponse(response, triggerOnNo);
}

/** Button styling: highlight the answer that matches compliance vs violation. */
export function responseButtonColors(
  value: 'Yes' | 'No' | 'Good' | 'Moderate' | 'Bad',
  selected: ChecklistResponse,
  triggerOnNo: boolean,
): { activeColor: string; activeBg: string; inactiveColor: string } {
  const violation = value === 'Bad' ? true : isViolationResponse(value, triggerOnNo);
  const active = selected === value;
  if (active) {
    return violation
      ? { activeColor: '#dc2626', activeBg: '#fee2e2', inactiveColor: '#6b7280' }
      : { activeColor: '#16a34a', activeBg: '#dcfce7', inactiveColor: '#6b7280' };
  }
  return { activeColor: '#6b7280', activeBg: '#f8fafc', inactiveColor: '#6b7280' };
}

/** Button styling using per-option highlight colors when configured. */
export function optionHighlightButtonColors(
  optionLabel: string,
  selected: ChecklistResponse,
  optionColors: OptionColorMap | null | undefined,
  triggerOnNo: boolean,
): { activeColor: string; activeBg: string; inactiveColor: string } {
  const active =
    selected === optionLabel ||
    (typeof selected === 'string' &&
      selected.trim().toLowerCase() === optionLabel.trim().toLowerCase());
  const palette = HIGHLIGHT_PALETTE[
    resolveOptionHighlightColor(optionLabel, optionColors, triggerOnNo)
  ];
  if (active) {
    return { ...palette, inactiveColor: '#6b7280' };
  }
  return { activeColor: '#6b7280', activeBg: '#f8fafc', inactiveColor: '#6b7280' };
}
