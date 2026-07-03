/** Render styled HTML report documents to multi-page PDF blobs in the browser. */

function extractBodyHtml(documentHtml: string): string {
  const match = documentHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match?.[1]?.trim() ?? documentHtml;
}

function extractStyles(documentHtml: string): string {
  const match = documentHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  return match?.[1]?.trim() ?? '';
}

type Html2CanvasFn = (
  element: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;

async function captureElement(
  element: HTMLElement,
  html2canvas: Html2CanvasFn,
  width: number,
): Promise<HTMLCanvasElement> {
  return html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#f8fafc',
    logging: false,
    width,
    windowWidth: width,
  });
}

function splitTableSection(section: HTMLElement): HTMLElement[] {
  const table = section.querySelector('table.report-table');
  if (!table) return [section];

  const thead = table.querySelector('thead');
  const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
  if (bodyRows.length <= 1) return [section];

  const sectionHead = section.querySelector('.section-head');
  const chunks: HTMLElement[] = [];
  const ROWS_PER_CHUNK = 4;

  for (let i = 0; i < bodyRows.length; i += ROWS_PER_CHUNK) {
    const chunk = document.createElement('div');
    chunk.className = section.className;
    chunk.style.cssText = section.style.cssText;

    if (sectionHead && i === 0) {
      chunk.appendChild(sectionHead.cloneNode(true));
    } else if (sectionHead) {
      const headClone = sectionHead.cloneNode(true) as HTMLElement;
      chunk.appendChild(headClone);
    }

    const tableClone = document.createElement('table');
    tableClone.className = table.className;
    if (thead) tableClone.appendChild(thead.cloneNode(true));

    const tbody = document.createElement('tbody');
    bodyRows.slice(i, i + ROWS_PER_CHUNK).forEach((row) => {
      tbody.appendChild(row.cloneNode(true));
    });
    tableClone.appendChild(tbody);
    chunk.appendChild(tableClone);
    chunks.push(chunk);
  }

  return chunks.length ? chunks : [section];
}

function collectPageSegments(shell: HTMLElement): HTMLElement[] {
  const segments: HTMLElement[] = [];

  const pushSegments = (selector: string, splitTables = false) => {
    shell.querySelectorAll(selector).forEach((node) => {
      const el = node as HTMLElement;
      if (splitTables && el.classList.contains('section-block') && el.querySelector('table.report-table')) {
        segments.push(...splitTableSection(el));
      } else {
        segments.push(el);
      }
    });
  };

  pushSegments(':scope > .report-hero');
  pushSegments(':scope > .report-part');
  pushSegments(':scope .report-body > .report-part');
  pushSegments(':scope .report-body .section-block', true);
  pushSegments(':scope .report-body .summary-strip');
  pushSegments(':scope > .report-footer');

  if (!segments.length) {
    segments.push(shell);
  }

  return segments;
}

async function addCanvasToPdf(
  pdf: import('jspdf').jsPDF,
  canvas: HTMLCanvasElement,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  startY: number,
): Promise<number> {
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const imgWidth = contentWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let offsetY = 0;
  let currentY = startY;

  while (offsetY < imgHeight) {
    const sliceHeight = Math.min(contentHeight - (currentY - margin), imgHeight - offsetY);
    if (currentY + sliceHeight > pageHeight - margin) {
      pdf.addPage();
      currentY = margin;
    }

    const sliceCanvas = document.createElement('canvas');
    const sliceScale = canvas.width / imgWidth;
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = Math.ceil(sliceHeight * sliceScale);
    const ctx = sliceCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(
        canvas,
        0,
        offsetY * sliceScale,
        canvas.width,
        sliceCanvas.height,
        0,
        0,
        canvas.width,
        sliceCanvas.height,
      );
      pdf.addImage(
        sliceCanvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        margin,
        currentY,
        imgWidth,
        sliceHeight,
      );
    }

    offsetY += sliceHeight;
    currentY += sliceHeight + 8;
  }

  return currentY;
}

export async function renderHtmlDocumentToPdfBlob(documentHtml: string): Promise<Blob> {
  const bodyHtml = extractBodyHtml(documentHtml);
  const styles = extractStyles(documentHtml);

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-12000px';
  host.style.top = '0';
  host.style.width = '920px';
  host.style.background = '#f8fafc';
  host.style.zIndex = '-1';
  host.innerHTML = `<style>${styles}</style>${bodyHtml}`;
  document.body.appendChild(host);

  try {
    const shell = host.querySelector('.report-shell') as HTMLElement | null;
    const target = shell ?? host;

    const [{ jsPDF }, html2canvasModule] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ]);
    const html2canvas = html2canvasModule.default;

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;

    const segments = collectPageSegments(target);
    let currentY = margin;

    for (const segment of segments) {
      const wrapper = document.createElement('div');
      wrapper.style.width = '920px';
      wrapper.style.background = '#f8fafc';
      wrapper.appendChild(segment.cloneNode(true));
      host.appendChild(wrapper);

      const canvas = await captureElement(wrapper, html2canvas, 920);
      wrapper.remove();

      const contentWidth = pageWidth - margin * 2;
      const segmentHeight = (canvas.height * contentWidth) / canvas.width;
      const available = pageHeight - margin - currentY;

      if (segmentHeight > available && currentY > margin) {
        pdf.addPage();
        currentY = margin;
      }

      currentY = await addCanvasToPdf(pdf, canvas, pageWidth, pageHeight, margin, currentY);
      currentY += 6;

      if (currentY > pageHeight - margin * 2) {
        pdf.addPage();
        currentY = margin;
      }
    }

    return pdf.output('blob');
  } finally {
    host.remove();
  }
}
