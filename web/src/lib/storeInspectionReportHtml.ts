import type { InspectionPdfData } from '../components/InspectionPdfReport';
import { isCompliantResponse } from './checklistScoring';
import { REPORT_HTML_CSS, riskTheme, scoreTheme } from './reportTheme';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function responseBadgeClass(response: string | null | undefined): string {
  const value = (response ?? '').trim().toLowerCase();
  if (value === 'yes') return 'resp-yes';
  if (value === 'no') return 'resp-no';
  if (value === 'n/a' || !value) return 'resp-na';
  return 'resp-other';
}

function formatReportTime(value: string | null | undefined): string {
  if (!value) return '—';
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function computeSectionStats(data: InspectionPdfData) {
  const grouped = new Map<string, { pass: number; fail: number; total: number }>();
  for (const response of data.responses) {
    const section = response.section || 'General';
    const bucket = grouped.get(section) ?? { pass: 0, fail: 0, total: 0 };
    const trigger = response.trigger_on_no ?? true;
    if (!response.response || response.response === 'N/A') {
      grouped.set(section, bucket);
      continue;
    }
    bucket.total += 1;
    if (isCompliantResponse(response.response, trigger)) bucket.pass += 1;
    else bucket.fail += 1;
    grouped.set(section, bucket);
  }
  return Array.from(grouped.entries()).map(([section, counts]) => {
    const scored = counts.pass + counts.fail;
    const compliance = scored ? Math.round((counts.pass / scored) * 100) : 0;
    return { section, ...counts, compliance };
  });
}

function buildComplianceChartHtml(stats: ReturnType<typeof computeSectionStats>): string {
  if (!stats.length) return '';
  const rows = stats
    .map((row) => {
      const color = row.compliance >= 80 ? '#047857' : row.compliance >= 60 ? '#b45309' : '#b91c1c';
      return `
      <div class="chart-row">
        <div class="chart-label">${escapeHtml(row.section)}</div>
        <div class="chart-track">
          <div class="chart-fill" style="width:${row.compliance}%;background:${color};"></div>
        </div>
        <div class="chart-value">${row.compliance}%</div>
      </div>`;
    })
    .join('');

  return `
    <div class="chart-panel">
      <p class="chart-panel-title">Section Compliance Overview</p>
      ${rows}
    </div>`;
}

function buildKpiStrip(data: InspectionPdfData): string {
  const failCount = data.responses.filter((r) => {
    const trigger = r.trigger_on_no ?? true;
    return r.response && r.response !== 'N/A' && !isCompliantResponse(r.response, trigger);
  }).length;
  const passCount = data.responses.filter((r) => {
    const trigger = r.trigger_on_no ?? true;
    return r.response && isCompliantResponse(r.response, trigger);
  }).length;
  const score = scoreTheme(data.complianceScore);
  const risk = riskTheme(data.riskLevel);

  return `
    <div class="kpi-grid">
      <div class="kpi-box" style="border-color:${score.border};background:${score.bg};">
        <div class="kpi-box-label">Compliance</div>
        <div class="kpi-box-value" style="color:${score.text};">${data.complianceScore.toFixed(1)}%</div>
      </div>
      <div class="kpi-box" style="border-color:${risk.border};background:${risk.bg};">
        <div class="kpi-box-label">Risk Level</div>
        <div class="kpi-box-value" style="color:${risk.text};font-size:14px;">${escapeHtml(data.riskLevel.toUpperCase())}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-box-label">Compliant Items</div>
        <div class="kpi-box-value">${passCount}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-box-label">Non-Conformance</div>
        <div class="kpi-box-value">${failCount}</div>
      </div>
    </div>`;
}

export function buildStoreInspectionReportHtml(
  data: InspectionPdfData,
  options?: { documentTitle?: string },
): string {
  const title = options?.documentTitle ?? 'STORE INSPECTION REPORT';
  const score = scoreTheme(data.complianceScore);
  const risk = riskTheme(data.riskLevel);
  const sectionStats = computeSectionStats(data);

  const grouped = new Map<string, typeof data.responses>();
  for (const response of data.responses) {
    const section = response.section || 'General';
    if (!grouped.has(section)) grouped.set(section, []);
    grouped.get(section)!.push(response);
  }

  const sectionHtml = Array.from(grouped.entries())
    .map(([sec, items]) => `
    <div class="section-block report-section">
      <div class="section-head section-head-board section-header">${escapeHtml(sec)}</div>
      <table class="report-table checklist-table">
        <thead>
          <tr>
            <th style="width:6%">#</th>
            <th style="width:52%">Checklist item</th>
            <th style="width:14%">Response</th>
            <th style="width:28%">Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((r, idx) => {
              const trigger = r.trigger_on_no ?? true;
              const violation = r.response && r.response !== 'N/A' && !isCompliantResponse(r.response, trigger);
              const rowClass = violation ? 'violation' : r.response === 'Yes' ? 'compliant' : '';
              return `
            <tr class="${rowClass}">
              <td style="font-weight:700;color:#1e3a8a;text-align:center;">${idx + 1}</td>
              <td>${escapeHtml(r.item_text)}</td>
              <td style="text-align:center;"><span class="resp-badge ${responseBadgeClass(r.response)}">${escapeHtml(r.response ?? '—')}</span></td>
              <td>${escapeHtml(r.remarks ?? '')}</td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`)
    .join('');

  const allPhotos = [
    ...(data.photos ?? []),
    ...data.responses.flatMap((r) => (r.attachments ?? []).filter((a) => a.type !== 'document')),
  ];
  const seenUrls = new Set<string>();
  const uniquePhotos = allPhotos.filter((p) => {
    if (seenUrls.has(p.url)) return false;
    seenUrls.add(p.url);
    return true;
  });

  const photoHtml = uniquePhotos.length
    ? `
    <div class="report-part">
      <p class="report-part-title">04 · Supporting Evidence</p>
      <div class="section-block">
        <div class="section-head section-head-board">Photographic Evidence</div>
        <div class="photos">
          ${uniquePhotos
            .map(
              (photo) => `
          <div class="photo">
            <img src="${photo.url}" crossorigin="anonymous" />
            <p>${escapeHtml(photo.name ?? 'Inspection evidence')}</p>
          </div>`,
            )
            .join('')}
        </div>
      </div>
    </div>`
    : '';

  const remarksHtml = data.generalRemark
    ? `<div class="section-block report-section">
        <div class="section-head section-head-board section-header">General Remarks</div>
        <div style="padding:12px 14px;">${escapeHtml(data.generalRemark).split('\n').map((line) => `<p style="margin:0 0 8px;">${line}</p>`).join('')}</div>
      </div>`
    : '';

  const headCommentHtml = data.headComment
    ? `<div class="section-block report-section">
        <div class="section-head section-head-board section-header">Supervisor Review</div>
        <div style="padding:12px 14px;">${escapeHtml(data.headComment)}</div>
      </div>`
    : '';

  const timeLine =
    data.timeIn || data.timeOut
      ? `<div class="report-time">Inspection Time: ${formatReportTime(data.timeIn)} – ${formatReportTime(data.timeOut)}</div>`
      : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${REPORT_HTML_CSS}</style></head><body>
  <div class="report-shell report-page">
    <div class="report-hero">
      <h1>${escapeHtml(title)}</h1>
      <p>Official Field Inspection Document · Vigilance Management System</p>
    </div>

    <div class="report-part" style="padding-top:16px;">
      <p class="report-part-title" style="margin-left:18px;">01 · Executive Summary</p>
      <div class="report-meta-grid">
        <div class="meta-card"><div class="meta-label">Location</div><div class="meta-value">${escapeHtml(data.branchName)}</div></div>
        <div class="meta-card"><div class="meta-label">Date</div><div class="meta-value">${escapeHtml(data.inspectionDate)}</div></div>
        <div class="meta-card"><div class="meta-label">Officer</div><div class="meta-value">${escapeHtml(data.officerName)}</div></div>
        <div class="meta-card accent-status"><div class="meta-label">Status</div><div class="meta-value">${escapeHtml(data.status.toUpperCase())}</div></div>
        <div class="meta-card accent-score" style="border-color:${score.border};background:${score.bg};"><div class="meta-label">Compliance</div><div class="meta-value" style="color:${score.text};">${data.complianceScore.toFixed(1)}%</div></div>
        <div class="meta-card accent-risk" style="border-color:${risk.border};background:${risk.bg};"><div class="meta-label">Risk Level</div><div class="meta-value" style="color:${risk.text};">${escapeHtml(data.riskLevel.toUpperCase())}</div></div>
      </div>
      ${timeLine}
    </div>

    <div class="report-body">
      <div class="report-part">
        <p class="report-part-title">02 · Compliance Analysis</p>
        ${buildKpiStrip(data)}
        ${buildComplianceChartHtml(sectionStats)}
      </div>

      <div class="report-part">
        <p class="report-part-title section-03-header">03 · Field Inspection Findings</p>
        ${headCommentHtml}
        ${sectionHtml}
        ${remarksHtml}
      </div>

      ${photoHtml}

      <div class="summary-strip">
        <span>Overall Compliance: ${data.complianceScore.toFixed(1)}%</span>
        <span>Risk Level: ${escapeHtml(data.riskLevel.toUpperCase())}</span>
        <span>Inspector: ${escapeHtml(data.officerName)}</span>
        <span>Store Type: ${escapeHtml(data.branchType)}</span>
      </div>
    </div>

    <div class="report-footer">
      Confidential — For internal management review and board presentation.
      Generated on ${escapeHtml(data.inspectionDate)} |
      ${escapeHtml(data.branchName)} · Officer: ${escapeHtml(data.officerName)}
    </div>
  </div>
  </body></html>`;
}
