/** Shared colorful report design tokens — web PDF, HTML exports, and on-screen views. */

export const REPORT_BRAND = {
  navy: '#1e3a8a',
  indigo: '#4f46e5',
  teal: '#0d9488',
  emerald: '#059669',
  amber: '#d97706',
  rose: '#e11d48',
  violet: '#7c3aed',
  sky: '#0284c7',
  slate: '#334155',
  muted: '#64748b',
  border: '#cbd5e1',
  paper: '#ffffff',
  canvas: '#f8fafc',
} as const;

export const SECTION_PALETTE = [
  { bg: '#eef2ff', border: '#6366f1', text: '#3730a3', accent: '#4f46e5' },
  { bg: '#ecfeff', border: '#06b6d4', text: '#0e7490', accent: '#0891b2' },
  { bg: '#ecfdf5', border: '#10b981', text: '#047857', accent: '#059669' },
  { bg: '#fffbeb', border: '#f59e0b', text: '#b45309', accent: '#d97706' },
  { bg: '#f5f3ff', border: '#8b5cf6', text: '#6d28d9', accent: '#7c3aed' },
  { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c', accent: '#dc2626' },
  { bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8', accent: '#2563eb' },
  { bg: '#fdf2f8', border: '#ec4899', text: '#be185d', accent: '#db2777' },
] as const;

export function sectionTheme(section: string) {
  let hash = 0;
  for (let i = 0; i < section.length; i++) hash = (hash + section.charCodeAt(i) * (i + 1)) % SECTION_PALETTE.length;
  return SECTION_PALETTE[hash];
}

export function responseTheme(response: string | null | undefined, violation = false) {
  const value = (response ?? '').trim().toLowerCase();
  if (violation || value === 'no') {
    return { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c', pill: '#fee2e2' };
  }
  if (value === 'yes') {
    return { bg: '#f0fdf4', border: '#86efac', text: '#166534', pill: '#dcfce7' };
  }
  if (value === 'n/a' || !value) {
    return { bg: '#f8fafc', border: '#cbd5e1', text: '#475569', pill: '#f1f5f9' };
  }
  return { bg: '#fffbeb', border: '#fcd34d', text: '#b45309', pill: '#fef3c7' };
}

export function scoreTheme(score: number | null | undefined) {
  if (score == null || Number.isNaN(score)) {
    return { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569' };
  }
  if (score >= 80) return { bg: '#ecfdf5', border: '#6ee7b7', text: '#047857' };
  if (score >= 60) return { bg: '#fffbeb', border: '#fcd34d', text: '#b45309' };
  return { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' };
}

export function riskTheme(risk: string | null | undefined) {
  const value = (risk ?? 'low').toLowerCase();
  if (value.includes('critical') || value.includes('high')) {
    return { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' };
  }
  if (value.includes('medium') || value.includes('moderate')) {
    return { bg: '#fffbeb', border: '#fcd34d', text: '#b45309' };
  }
  return { bg: '#ecfdf5', border: '#6ee7b7', text: '#047857' };
}

export const REPORT_HTML_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: Calibri, Helvetica, Arial, sans-serif;
    color: #0f172a;
    background: #f8fafc;
    margin: 0;
    padding: 24px;
    font-size: 12px;
    line-height: 1.45;
  }
  .report-shell {
    max-width: 920px;
    margin: 0 auto;
    background: #ffffff;
    border: 2px solid #1e3a8a;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 12px 30px rgba(30, 58, 138, 0.12);
  }
  .report-hero {
    background: linear-gradient(135deg, #1e3a8a 0%, #4f46e5 45%, #0d9488 100%);
    color: #ffffff;
    padding: 22px 24px 18px;
  }
  .report-hero h1 {
    margin: 0;
    font-size: 24px;
    letter-spacing: 0.4px;
    font-weight: 800;
  }
  .report-hero p {
    margin: 6px 0 0;
    font-size: 12px;
    color: rgba(255,255,255,0.88);
  }
  .report-meta-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    padding: 16px 18px;
    background: #f8fafc;
    border-bottom: 2px solid #dbeafe;
  }
  .meta-card {
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    background: #ffffff;
    padding: 10px 12px;
    min-height: 58px;
  }
  .meta-card.accent-score { border-color: #6ee7b7; background: #ecfdf5; }
  .meta-card.accent-risk { border-color: #fcd34d; background: #fffbeb; }
  .meta-card.accent-status { border-color: #93c5fd; background: #eff6ff; }
  .meta-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #64748b;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .meta-value {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
  }
  .report-time {
    padding: 10px 18px 14px;
    border-bottom: 1px solid #e2e8f0;
    color: #334155;
    font-weight: 600;
  }
  .report-body { padding: 14px 18px 20px; }
  .section-block {
    margin-bottom: 16px;
    border: 1.5px solid #cbd5e1;
    border-radius: 12px;
    overflow: hidden;
    background: #ffffff;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .section-head {
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    border-bottom: 1.5px solid;
  }
  table.report-table {
    width: 100%;
    border-collapse: collapse;
  }
  .report-table th {
    text-align: left;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 10px;
  }
  .report-table td {
    padding: 9px 10px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
  }
  .report-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .report-table thead {
    display: table-header-group;
  }
  .report-table tr.violation { background: #fef2f2; }
  .report-table tr.compliant { background: #f8fffb; }
  .resp-badge {
    display: inline-block;
    min-width: 52px;
    text-align: center;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    border: 1.5px solid;
  }
  .resp-yes { color: #166534; background: #dcfce7; border-color: #86efac; }
  .resp-no { color: #b91c1c; background: #fee2e2; border-color: #fca5a5; }
  .resp-na { color: #475569; background: #f1f5f9; border-color: #cbd5e1; }
  .resp-other { color: #b45309; background: #fef3c7; border-color: #fcd34d; }
  .photos {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 12px 14px 14px;
  }
  .photo {
    width: 150px;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    overflow: hidden;
    background: #fff;
  }
  .photo img {
    width: 100%;
    height: 118px;
    object-fit: cover;
    display: block;
  }
  .photo p {
    margin: 0;
    padding: 6px 8px;
    font-size: 9px;
    color: #64748b;
    word-break: break-word;
  }
  .report-footer {
    margin-top: 8px;
    padding: 14px 18px 18px;
    border-top: 2px solid #dbeafe;
    background: #f8fafc;
    text-align: center;
    font-size: 10px;
    color: #64748b;
  }
  .summary-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
    padding: 12px 14px;
    border: 1.5px solid #93c5fd;
    border-radius: 10px;
    background: #eff6ff;
    margin-top: 4px;
    font-weight: 700;
    color: #1e3a8a;
  }
  .report-part {
    margin-bottom: 20px;
    padding-top: 4px;
  }
  .report-part-title {
    margin: 0 0 12px;
    padding: 0 0 8px 12px;
    border-left: 4px solid #1e3a8a;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: #1e3a8a;
  }
  .section-head-board {
    background: #1e3a8a !important;
    border-bottom-color: #1e3a8a !important;
    color: #ffffff !important;
  }
  .chart-panel {
    margin-bottom: 16px;
    padding: 14px;
    border: 1.5px solid #cbd5e1;
    border-radius: 12px;
    background: #ffffff;
  }
  .chart-panel-title {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #3730a3;
    margin: 0 0 12px;
    padding-bottom: 8px;
    border-bottom: 1.5px solid #c7d2fe;
  }
  .chart-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .chart-label {
    width: 28%;
    font-size: 10px;
    font-weight: 700;
    color: #334155;
  }
  .chart-track {
    flex: 1;
    height: 16px;
    background: #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #cbd5e1;
  }
  .chart-fill {
    height: 100%;
    border-radius: 7px;
    min-width: 2%;
  }
  .chart-value {
    width: 42px;
    text-align: right;
    font-size: 10px;
    font-weight: 800;
    color: #1e3a8a;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .kpi-box {
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    padding: 10px 12px;
    background: #ffffff;
    text-align: center;
  }
  .kpi-box-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: #64748b;
    font-weight: 700;
  }
  .kpi-box-value {
    margin-top: 4px;
    font-size: 18px;
    font-weight: 800;
    color: #1e3a8a;
  }
`;
