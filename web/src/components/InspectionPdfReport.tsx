import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
  pdf,
} from '@react-pdf/renderer';
import { isCompliantResponse } from '../lib/checklistScoring';
import { resolveInspectionMediaUrl } from '../lib/inspectionMedia';
import { REPORT_BRAND, riskTheme, scoreTheme, sectionTheme } from '../lib/reportTheme';
import { buildStoreInspectionReportHtml } from '../lib/storeInspectionReportHtml';
import { renderHtmlDocumentToPdfBlob } from '../lib/htmlToPdf';

Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    paddingTop: 0,
    paddingBottom: 48,
    paddingHorizontal: 0,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  pageInner: {
    marginHorizontal: 32,
    marginTop: 0,
    marginBottom: 16,
  },
  shell: {
    borderWidth: 2,
    borderColor: REPORT_BRAND.navy,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  coverBand: {
    backgroundColor: REPORT_BRAND.navy,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
  },
  coverTitle: { fontSize: 20, fontWeight: 700, color: '#ffffff', letterSpacing: 0.6 },
  coverSubtitle: { fontSize: 10, color: '#dbeafe', marginTop: 5 },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 14,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 2,
    borderBottomColor: '#dbeafe',
  },
  metaCard: {
    width: '31%',
    marginRight: '2%',
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#ffffff',
    minHeight: 46,
  },
  metaLabel: { fontSize: 7, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 },
  metaValue: { fontSize: 11, fontWeight: 700, color: '#0f172a', marginTop: 3 },
  timeLine: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    fontSize: 9,
    fontWeight: 600,
    color: '#334155',
  },
  bodyPad: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  sectionBlock: {
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  sectionHead: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    borderBottomWidth: 1.5,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableHeaderCell: { fontSize: 7, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableRowFail: { backgroundColor: '#fef2f2' },
  tableRowPass: { backgroundColor: '#f8fffb' },
  colNum: { width: '6%' },
  colItem: { width: '52%', paddingRight: 6 },
  colResp: { width: '16%' },
  colRemark: { width: '26%' },
  itemText: { fontSize: 8.5, lineHeight: 1.35 },
  respPill: {
    fontSize: 7.5,
    fontWeight: 700,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    textAlign: 'center',
  },
  remark: { fontSize: 7.5, color: '#64748b', lineHeight: 1.35 },
  summaryStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginTop: 6,
    padding: 10,
    borderWidth: 1.5,
    borderColor: '#93c5fd',
    borderRadius: 8,
    backgroundColor: '#eff6ff',
  },
  summaryText: { fontSize: 8.5, fontWeight: 700, color: REPORT_BRAND.navy },
  photoSection: { padding: 12 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap' },
  photo: {
    width: 110,
    height: 78,
    objectFit: 'cover',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    marginRight: 6,
    marginBottom: 6,
  },
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 32,
    right: 32,
    borderTopWidth: 2,
    borderTopColor: '#dbeafe',
    paddingTop: 8,
    fontSize: 7,
    color: '#64748b',
    textAlign: 'center',
    backgroundColor: '#f8fafc',
  },
  h2: { fontSize: 10, fontWeight: 700, marginTop: 8, marginBottom: 4, color: '#334155' },
  body: { fontSize: 9, lineHeight: 1.5, color: '#334155' },
  noteBox: {
    marginBottom: 10,
    padding: 10,
    borderWidth: 1.5,
    borderColor: '#f9a8d4',
    borderRadius: 8,
    backgroundColor: '#fdf2f8',
  },
});

export interface InspectionPdfAttachment {
  url: string;
  name?: string;
  type?: 'image' | 'document';
}

export interface InspectionPdfResponse {
  section: string;
  item_text: string;
  response: 'Yes' | 'No' | 'N/A' | string;
  remarks?: string | null;
  risk_level?: 'RED' | 'YELLOW' | 'GREEN' | null;
  trigger_on_no?: boolean;
  attachments?: InspectionPdfAttachment[];
}

export interface InspectionPdfData {
  id: string;
  branchName: string;
  branchType: string;
  officerName: string;
  city?: string | null;
  inspectionDate: string;
  submittedAt?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  complianceScore: number;
  riskLevel: string;
  status: string;
  headComment?: string | null;
  generalRemark?: string | null;
  responses: InspectionPdfResponse[];
  /** Legacy flat photo list — prefer per-response attachments */
  photos?: { url: string; name?: string }[];
}

export interface GenerateInspectionPdfOptions {
  filenamePrefix?: string;
  documentTitle?: string;
}

function statusForItem(r: InspectionPdfResponse): 'pass' | 'fail' | 'na' {
  if (!r.response || r.response === 'N/A') return 'na';
  const trigger = r.trigger_on_no ?? true;
  return isCompliantResponse(r.response, trigger) ? 'pass' : 'fail';
}

function computeSectionChartData(responses: InspectionPdfResponse[]) {
  const grouped = new Map<string, { pass: number; fail: number; na: number }>();
  for (const response of responses) {
    const section = response.section || 'General';
    const bucket = grouped.get(section) ?? { pass: 0, fail: 0, na: 0 };
    const status = statusForItem(response);
    if (status === 'pass') bucket.pass += 1;
    else if (status === 'fail') bucket.fail += 1;
    else bucket.na += 1;
    grouped.set(section, bucket);
  }
  return Array.from(grouped.entries()).map(([section, counts]) => {
    const scored = counts.pass + counts.fail;
    const compliance = scored ? Math.round((counts.pass / scored) * 100) : 0;
    return { section, ...counts, compliance };
  });
}

function responsePillStyle(status: 'pass' | 'fail' | 'na') {
  if (status === 'pass') return { backgroundColor: '#dcfce7', color: '#166534', borderColor: '#86efac' };
  if (status === 'fail') return { backgroundColor: '#fee2e2', color: '#b91c1c', borderColor: '#fca5a5' };
  return { backgroundColor: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' };
}

function ReportMetaGrid({ data }: { data: InspectionPdfData }) {
  const score = scoreTheme(data.complianceScore);
  const risk = riskTheme(data.riskLevel);
  const cards = [
    { label: 'Location', value: data.branchName, style: {} },
    { label: 'Date', value: data.inspectionDate, style: {} },
    { label: 'Officer', value: data.officerName, style: {} },
    { label: 'Status', value: data.status.toUpperCase(), style: { borderColor: '#93c5fd', backgroundColor: '#eff6ff' } },
    {
      label: 'Compliance',
      value: `${data.complianceScore.toFixed(1)}%`,
      style: { borderColor: score.border, backgroundColor: score.bg },
      valueColor: score.text,
    },
    {
      label: 'Risk Level',
      value: data.riskLevel.toUpperCase(),
      style: { borderColor: risk.border, backgroundColor: risk.bg },
      valueColor: risk.text,
    },
  ];

  return (
    <View style={styles.metaGrid}>
      {cards.map((card) => (
        <View key={card.label} style={[styles.metaCard, card.style]}>
          <Text style={styles.metaLabel}>{card.label}</Text>
          <Text style={[styles.metaValue, card.valueColor ? { color: card.valueColor } : {}]}>{card.value}</Text>
        </View>
      ))}
    </View>
  );
}

function SectionTable({
  section,
  items,
}: {
  section: string;
  items: InspectionPdfResponse[];
}) {
  const theme = sectionTheme(section);
  return (
    <View style={styles.sectionBlock} wrap>
      <View
        wrap={false}
        style={[styles.sectionHead, { backgroundColor: theme.bg, borderBottomColor: theme.border }]}
      >
        <Text style={{ color: theme.text }}>{section}</Text>
      </View>
      <View style={styles.tableHeader} wrap={false}>
        <Text style={[styles.tableHeaderCell, styles.colNum]}>#</Text>
        <Text style={[styles.tableHeaderCell, styles.colItem]}>Checklist item</Text>
        <Text style={[styles.tableHeaderCell, styles.colResp]}>Response</Text>
        <Text style={[styles.tableHeaderCell, styles.colRemark]}>Remarks</Text>
      </View>
      {items.map((r, idx) => {
        const status = statusForItem(r);
        const pill = responsePillStyle(status);
        return (
          <View
            key={`${section}-${idx}`}
            style={[
              styles.tableRow,
              status === 'fail' ? styles.tableRowFail : status === 'pass' ? styles.tableRowPass : {},
            ]}
          >
            <Text style={[styles.itemText, styles.colNum, { color: theme.accent, fontWeight: 700 }]}>{idx + 1}</Text>
            <Text style={[styles.itemText, styles.colItem]}>{r.item_text}</Text>
            <View style={styles.colResp}>
              <Text style={[styles.respPill, { backgroundColor: pill.backgroundColor, color: pill.color, borderColor: pill.borderColor }]}>
                {r.response}
              </Text>
            </View>
            <Text style={[styles.remark, styles.colRemark]}>{r.remarks ?? ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

function PdfSectionChart({ responses }: { responses: InspectionPdfResponse[] }) {
  const rows = computeSectionChartData(responses);
  if (!rows.length) return null;
  const theme = sectionTheme('Section compliance overview');

  return (
    <View style={[styles.sectionBlock, { marginBottom: 10 }]}>
      <View style={[styles.sectionHead, { backgroundColor: theme.bg, borderBottomColor: theme.border }]}>
        <Text style={{ color: theme.text }}>Section compliance overview</Text>
      </View>
      <View style={{ padding: 10 }}>
        {rows.map((row) => {
          const pct = row.compliance;
          const barColor = pct >= 80 ? '#059669' : pct >= 60 ? '#d97706' : '#dc2626';
          return (
            <View key={row.section} style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 8, fontWeight: 700, color: '#334155', marginBottom: 3 }}>{row.section}</Text>
              <View style={{ height: 10, backgroundColor: '#e2e8f0', borderRadius: 5, overflow: 'hidden', width: '100%' }}>
                <View style={{ height: 10, backgroundColor: barColor, borderRadius: 5, width: `${pct}%` }} />
              </View>
              <Text style={{ fontSize: 7, color: '#64748b', marginTop: 2 }}>
                {row.compliance}% compliant · {row.pass} OK · {row.fail} NC · {row.na} N/A
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function sanitizePdfText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizePdfData(data: InspectionPdfData): InspectionPdfData {
  return {
    ...data,
    branchName: sanitizePdfText(data.branchName) || 'Unknown',
    branchType: sanitizePdfText(data.branchType) || '—',
    officerName: sanitizePdfText(data.officerName) || '—',
    city: data.city ? sanitizePdfText(data.city) : data.city,
    inspectionDate: sanitizePdfText(data.inspectionDate),
    riskLevel: sanitizePdfText(data.riskLevel) || 'low',
    status: sanitizePdfText(data.status) || 'submitted',
    headComment: data.headComment ? sanitizePdfText(data.headComment) : null,
    generalRemark: data.generalRemark ? sanitizePdfText(data.generalRemark) : null,
    responses: data.responses.map((response) => ({
      ...response,
      section: sanitizePdfText(response.section) || 'General',
      item_text: sanitizePdfText(response.item_text) || 'Checklist item',
      response: sanitizePdfText(response.response) || '—',
      remarks: response.remarks ? sanitizePdfText(response.remarks) : null,
    })),
  };
}

export function InspectionReportDoc({ data }: { data: InspectionPdfData }) {
  const grouped = new Map<string, InspectionPdfResponse[]>();
  for (const r of data.responses) {
    if (!grouped.has(r.section)) grouped.set(r.section, []);
    grouped.get(r.section)!.push(r);
  }

  const hasAnyEvidence = data.responses.some((r) => (r.attachments?.length ?? 0) > 0);
  const timeLine =
    data.timeIn || data.timeOut
      ? `Inspection Time: ${data.timeIn ?? '—'} – ${data.timeOut ?? '—'}`
      : null;

  return (
    <Document
      title={`Store Audit — ${data.branchName} — ${data.inspectionDate}`}
      author="Vigilance Management System"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={[styles.pageInner, { marginTop: 24 }]}>
          <View style={styles.shell}>
            <View style={styles.coverBand}>
              <Text style={styles.coverTitle}>STORE INSPECTION REPORT</Text>
              <Text style={styles.coverSubtitle}>Official Field Inspection Document</Text>
            </View>

            <ReportMetaGrid data={data} />
            {timeLine ? <Text style={styles.timeLine}>{timeLine}</Text> : null}

            <View style={styles.bodyPad}>
              <PdfSectionChart responses={data.responses} />

              {data.headComment ? (
                <View style={styles.noteBox}>
                  <Text style={styles.h2}>Supervisor review</Text>
                  <Text style={styles.body}>{data.headComment}</Text>
                </View>
              ) : null}

              {data.generalRemark ? (
                <View style={[styles.noteBox, { borderColor: '#fcd34d', backgroundColor: '#fffbeb' }]}>
                  <Text style={styles.h2}>General observations</Text>
                  <Text style={styles.body}>{data.generalRemark}</Text>
                </View>
              ) : null}

              {Array.from(grouped.entries()).map(([section, items]) => (
                <SectionTable key={section} section={section} items={items} />
              ))}

              <View style={styles.summaryStrip}>
                <Text style={styles.summaryText}>Overall Compliance: {data.complianceScore.toFixed(1)}%</Text>
                <Text style={styles.summaryText}>Risk Level: {data.riskLevel.toUpperCase()}</Text>
                <Text style={styles.summaryText}>Inspector: {data.officerName}</Text>
              </View>
            </View>
          </View>
        </View>

        {!hasAnyEvidence && data.photos && data.photos.length > 0 && (
          <View style={[styles.pageInner, { marginTop: 16 }]} break>
            <View style={styles.shell}>
              <View style={[styles.sectionHead, { backgroundColor: '#eff6ff', borderBottomColor: '#93c5fd', padding: 12 }]}>
                <Text style={{ color: '#1d4ed8' }}>Photo Evidence</Text>
              </View>
              <View style={styles.photoSection}>
                <View style={styles.photoRow}>
                  {data.photos.slice(0, 12).map((p, i) => (
                    <Image key={i} src={p.url} style={styles.photo} />
                  ))}
                </View>
              </View>
            </View>
          </View>
        )}

        <Text style={styles.footer} fixed>
          This report is an official field inspection document. Generated on {data.inspectionDate} · {data.branchName} Store · Officer: {data.officerName} · System: Store Monitoring Division
        </Text>
      </Page>
    </Document>
  );
}

function BrowserInspectionReportDoc({
  data,
  documentTitle = 'STORE INSPECTION REPORT',
}: {
  data: InspectionPdfData;
  documentTitle?: string;
}) {
  const grouped = new Map<string, InspectionPdfResponse[]>();
  for (const r of data.responses) {
    const section = r.section || 'General';
    if (!grouped.has(section)) grouped.set(section, []);
    grouped.get(section)!.push(r);
  }

  const photoEvidence = data.photos ?? [];
  const timeLine =
    data.timeIn || data.timeOut
      ? `Inspection Time: ${data.timeIn ?? '—'} – ${data.timeOut ?? '—'}`
      : null;

  return (
    <Document
      title={`${documentTitle} — ${data.branchName} — ${data.inspectionDate}`}
      author="Vigilance Management System"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={[styles.pageInner, { marginTop: 24 }]}>
          <View style={styles.shell}>
            <View style={styles.coverBand}>
              <Text style={styles.coverTitle}>{documentTitle}</Text>
              <Text style={styles.coverSubtitle}>Official Field Inspection Document</Text>
            </View>

            <ReportMetaGrid data={data} />
            {timeLine ? <Text style={styles.timeLine}>{timeLine}</Text> : null}

            <View style={styles.bodyPad}>
              <PdfSectionChart responses={data.responses} />

              {data.headComment ? (
                <View style={styles.noteBox}>
                  <Text style={styles.h2}>Supervisor review</Text>
                  <Text style={styles.body}>{data.headComment}</Text>
                </View>
              ) : null}

              {data.generalRemark ? (
                <View style={[styles.noteBox, { borderColor: '#fcd34d', backgroundColor: '#fffbeb' }]}>
                  <Text style={styles.h2}>General observations</Text>
                  <Text style={styles.body}>{data.generalRemark}</Text>
                </View>
              ) : null}

              {Array.from(grouped.entries()).map(([section, items]) => (
                <SectionTable key={section} section={section} items={items} />
              ))}

              <View style={styles.summaryStrip}>
                <Text style={styles.summaryText}>Overall Compliance: {data.complianceScore.toFixed(1)}%</Text>
                <Text style={styles.summaryText}>Risk Level: {data.riskLevel.toUpperCase()}</Text>
                <Text style={styles.summaryText}>Inspector: {data.officerName}</Text>
              </View>
            </View>
          </View>
        </View>

        {photoEvidence.length > 0 ? (
          <View style={[styles.pageInner, { marginTop: 16 }]} break>
            <View style={styles.shell}>
              <View style={[styles.sectionHead, { backgroundColor: '#eff6ff', borderBottomColor: '#93c5fd', padding: 12 }]}>
                <Text style={{ color: '#1d4ed8' }}>Photo Evidence</Text>
              </View>
              <View style={styles.photoSection}>
                <View style={styles.photoRow}>
                  {photoEvidence.map((photo, index) => (
                    <Image
                      key={`${photo.url.slice(0, 48)}-${index}`}
                      src={photo.url}
                      style={styles.photo}
                    />
                  ))}
                </View>
              </View>
            </View>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          This report is an official field inspection document. Generated on {data.inspectionDate} · {data.branchName} Store · Officer: {data.officerName} · System: Store Monitoring Division
        </Text>
      </Page>
    </Document>
  );
}

function MinimalInspectionReportDoc({ data }: { data: InspectionPdfData }) {
  const grouped = new Map<string, InspectionPdfResponse[]>();
  for (const r of data.responses) {
    const section = r.section || 'General';
    if (!grouped.has(section)) grouped.set(section, []);
    grouped.get(section)!.push(r);
  }

  return (
    <Document title={`Audit Report - ${data.branchName}`}>
      <Page size="A4" style={styles.page} wrap>
        <View style={[styles.pageInner, { marginTop: 24 }]}>
          <View style={styles.shell}>
            <View style={styles.coverBand}>
              <Text style={styles.coverTitle}>STORE INSPECTION REPORT</Text>
              <Text style={styles.coverSubtitle}>Official Field Inspection Document</Text>
            </View>
            <ReportMetaGrid data={data} />
            <View style={styles.bodyPad}>
              {Array.from(grouped.entries()).map(([section, items]) => (
                <SectionTable key={section} section={section} items={items} />
              ))}
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

function withoutImageEvidence(data: InspectionPdfData): InspectionPdfData {
  return {
    ...data,
    responses: data.responses.map((response) => ({
      ...response,
      attachments: (response.attachments ?? []).filter((item) => item.type === 'document'),
    })),
    photos: [],
  };
}

const PDF_ATTEMPT_TIMEOUT_MS = 25_000;
const PDF_IMAGE_FETCH_TIMEOUT_MS = 8_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PDF_IMAGE_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(await resolveInspectionMediaUrl(url), { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function embedImagesForPdf(data: InspectionPdfData): Promise<InspectionPdfData> {
  const embeddedPhotos: NonNullable<InspectionPdfData['photos']> = [];
  const seenPhotoUrls = new Set<string>();

  for (const photo of data.photos ?? []) {
    const embedded = await fetchImageAsDataUrl(photo.url);
    if (!embedded || seenPhotoUrls.has(embedded)) continue;
    seenPhotoUrls.add(embedded);
    embeddedPhotos.push({ ...photo, url: embedded });
  }

  const responses = await Promise.all(
    data.responses.map(async (response) => {
      const attachments: InspectionPdfAttachment[] = [];
      for (const attachment of response.attachments ?? []) {
        if (attachment.type === 'document') {
          attachments.push(attachment);
          continue;
        }
        const embedded = await fetchImageAsDataUrl(attachment.url);
        if (embedded) attachments.push({ ...attachment, url: embedded });
      }
      return { ...response, attachments };
    }),
  );

  return { ...data, photos: embeddedPhotos, responses };
}

async function renderPdfBlob(
  data: InspectionPdfData,
  options?: GenerateInspectionPdfOptions,
): Promise<Blob> {
  return pdf(<BrowserInspectionReportDoc data={data} documentTitle={options?.documentTitle} />).toBlob();
}

async function renderMinimalPdfBlob(data: InspectionPdfData): Promise<Blob> {
  return pdf(<MinimalInspectionReportDoc data={data} />).toBlob();
}

function downloadBlob(
  blob: Blob,
  data: InspectionPdfData,
  filenamePrefix = 'store-inspection-report',
): string {
  const safeBranch = data.branchName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `${filenamePrefix}-${safeBranch}-${data.inspectionDate}.pdf`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
  return filename;
}

export async function generateInspectionPdf(
  data: InspectionPdfData,
  options?: GenerateInspectionPdfOptions,
): Promise<string> {
  const sanitized = sanitizePdfData(data);
  let withImages = sanitized;

  try {
    withImages = await embedImagesForPdf(sanitized);
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[PDF] Could not embed images, continuing with text-only export:', error);
  }

  const attempts: Array<{ label: string; timeoutMs: number; run: () => Promise<Blob> }> = [
    {
      label: 'browser-layout-text-only',
      timeoutMs: PDF_ATTEMPT_TIMEOUT_MS,
      run: () => renderPdfBlob(withoutImageEvidence(sanitized), options),
    },
    {
      label: 'browser-layout-with-images',
      timeoutMs: PDF_ATTEMPT_TIMEOUT_MS,
      run: () => renderPdfBlob(withImages, options),
    },
    {
      label: 'minimal-layout-text-only',
      timeoutMs: PDF_ATTEMPT_TIMEOUT_MS,
      run: () => renderMinimalPdfBlob(withoutImageEvidence(sanitized)),
    },
    {
      label: 'html-color-layout-text-only',
      timeoutMs: 45_000,
      run: async () => {
        const html = buildStoreInspectionReportHtml(withoutImageEvidence(sanitized), {
          documentTitle: options?.documentTitle ?? 'STORE INSPECTION REPORT',
        });
        return renderHtmlDocumentToPdfBlob(html);
      },
    },
    {
      label: 'html-color-layout-with-images',
      timeoutMs: 45_000,
      run: async () => {
        const html = buildStoreInspectionReportHtml(withImages, {
          documentTitle: options?.documentTitle ?? 'STORE INSPECTION REPORT',
        });
        return renderHtmlDocumentToPdfBlob(html);
      },
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const blob = await withTimeout(attempt.run(), attempt.timeoutMs, attempt.label);
      if (!blob || blob.size === 0) {
        throw new Error(`PDF engine "${attempt.label}" returned an empty file.`);
      }
      return downloadBlob(blob, sanitized, options?.filenamePrefix);
    } catch (error) {
      lastError = error;
      if (import.meta.env.DEV) console.error(`[PDF] ${attempt.label} failed:`, error);
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : 'Failed to generate PDF. Please try again.';
  throw new Error(message);
}
