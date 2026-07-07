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
    scrollY: 0,
    scrollX: 0,
  });
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
  const maxSliceHeight = pageHeight - margin * 2;
  const imgWidth = contentWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const sliceScale = canvas.width / imgWidth;

  let offsetY = 0;
  let currentY = startY;

  while (offsetY < imgHeight - 0.25) {
    let availableHeight = pageHeight - margin - currentY;
    if (availableHeight < 12) {
      pdf.addPage();
      currentY = margin;
      availableHeight = maxSliceHeight;
    }

    const remainingImgHeight = imgHeight - offsetY;
    const sliceHeight = Math.min(availableHeight, remainingImgHeight, maxSliceHeight);
    if (sliceHeight <= 0) {
      pdf.addPage();
      currentY = margin;
      continue;
    }

    const sourceY = Math.floor(offsetY * sliceScale);
    const sourceHeight = Math.max(1, Math.ceil(sliceHeight * sliceScale));
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sourceHeight;
    const ctx = sliceCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        sourceHeight,
        0,
        0,
        canvas.width,
        sourceHeight,
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
    currentY += sliceHeight;

    if (offsetY < imgHeight - 0.25 && currentY >= pageHeight - margin - 1) {
      pdf.addPage();
      currentY = margin;
    }
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

    const canvas = await captureElement(target, html2canvas, 920);
    await addCanvasToPdf(pdf, canvas, pageWidth, pageHeight, margin, margin);

    return pdf.output('blob');
  } finally {
    host.remove();
  }
}
