/** Render styled HTML report documents to multi-page PDF blobs in the browser. */

/** A4 content width at 96dpi — matches print layout for consistent pagination. */
export const PDF_A4_CONTENT_WIDTH_PX = 794;

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

function canvasToImageHeight(canvas: HTMLCanvasElement, imgWidth: number): number {
  return (canvas.height * imgWidth) / canvas.width;
}

async function addWholeCanvasToPdf(
  pdf: import('jspdf').jsPDF,
  canvas: HTMLCanvasElement,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  startY: number,
  atomic: boolean,
): Promise<number> {
  const contentWidth = pageWidth - margin * 2;
  const maxSliceHeight = pageHeight - margin * 2;
  const imgWidth = contentWidth;
  const imgHeight = canvasToImageHeight(canvas, imgWidth);

  let currentY = startY;

  if (atomic) {
    const availableHeight = pageHeight - margin - currentY;
    if (imgHeight > availableHeight && currentY > margin + 4) {
      pdf.addPage();
      currentY = margin;
    }
  }

  if (atomic && imgHeight <= maxSliceHeight) {
    pdf.addImage(
      canvas.toDataURL('image/jpeg', 0.92),
      'JPEG',
      margin,
      currentY,
      imgWidth,
      imgHeight,
    );
    return currentY + imgHeight + 8;
  }

  return addSlicedCanvasToPdf(pdf, canvas, pageWidth, pageHeight, margin, currentY);
}

async function addSlicedCanvasToPdf(
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
  const imgHeight = canvasToImageHeight(canvas, imgWidth);
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

  return currentY + 8;
}

type PdfCaptureBlock = {
  element: HTMLElement;
  atomic: boolean;
};

function isAtomicSectionBlock(element: HTMLElement): boolean {
  return (
    element.classList.contains('section-block') ||
    element.classList.contains('report-section') ||
    element.classList.contains('summary-strip') ||
    element.classList.contains('report-footer') ||
    element.classList.contains('pdf-capture-group')
  );
}

/**
 * Build ordered capture blocks so html2canvas never slices mid-section.
 * Section blocks are captured individually; large hero/summary parts stay atomic.
 */
function collectPdfCaptureBlocks(shell: HTMLElement): PdfCaptureBlock[] {
  const blocks: PdfCaptureBlock[] = [];
  const temporaryGroups: HTMLElement[] = [];

  const pushBlock = (element: HTMLElement | null | undefined, atomic = true) => {
    if (element) blocks.push({ element, atomic });
  };

  pushBlock(shell.querySelector('.report-hero') as HTMLElement | null, true);

  shell.querySelectorAll(':scope > .report-part').forEach((part) => {
    pushBlock(part as HTMLElement, true);
  });

  const body = shell.querySelector('.report-body');
  if (body) {
    body.querySelectorAll(':scope > .report-part').forEach((part) => {
      const partEl = part as HTMLElement;
      const sectionBlocks = Array.from(partEl.querySelectorAll(':scope > .section-block'));
      const partTitle = partEl.querySelector(':scope > .report-part-title');

      if (sectionBlocks.length > 0) {
        if (partTitle) {
          const group = document.createElement('div');
          group.className = 'pdf-capture-group';
          group.style.background = '#ffffff';
          group.style.marginBottom = '0';
          partEl.insertBefore(group, sectionBlocks[0]);
          group.appendChild(partTitle);
          group.appendChild(sectionBlocks[0]);
          temporaryGroups.push(group);
          pushBlock(group, true);
          sectionBlocks.slice(1).forEach((section) => pushBlock(section as HTMLElement, true));
        } else {
          sectionBlocks.forEach((section) => pushBlock(section as HTMLElement, true));
        }
        return;
      }

      pushBlock(partEl, true);
    });

    pushBlock(body.querySelector('.summary-strip') as HTMLElement | null, true);
  }

  pushBlock(shell.querySelector('.report-footer') as HTMLElement | null, true);

  if (blocks.length === 0) {
    pushBlock(shell, false);
  }

  (shell as HTMLElement & { __pdfTemporaryGroups?: HTMLElement[] }).__pdfTemporaryGroups =
    temporaryGroups;

  return blocks;
}

function cleanupPdfCaptureGroups(shell: HTMLElement | null) {
  const groups =
    (shell as HTMLElement & { __pdfTemporaryGroups?: HTMLElement[] } | null)?.__pdfTemporaryGroups ??
    [];
  for (const group of groups) {
    const parent = group.parentElement;
    if (!parent) continue;
    while (group.firstChild) {
      parent.insertBefore(group.firstChild, group);
    }
    group.remove();
  }
}

export async function renderHtmlDocumentToPdfBlob(documentHtml: string): Promise<Blob> {
  const bodyHtml = extractBodyHtml(documentHtml);
  const styles = extractStyles(documentHtml);

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-12000px';
  host.style.top = '0';
  host.style.width = `${PDF_A4_CONTENT_WIDTH_PX}px`;
  host.style.background = '#f8fafc';
  host.style.zIndex = '-1';
  host.innerHTML = `<style>${styles}</style>${bodyHtml}`;
  document.body.appendChild(host);

  let shell: HTMLElement | null = null;
  try {
    shell = host.querySelector('.report-shell') as HTMLElement | null;
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

    const captureBlocks = collectPdfCaptureBlocks(target);
    let currentY = margin;

    for (const block of captureBlocks) {
      const canvas = await captureElement(block.element, html2canvas, PDF_A4_CONTENT_WIDTH_PX);
      const imgHeight = canvasToImageHeight(canvas, pageWidth - margin * 2);
      const maxSliceHeight = pageHeight - margin * 2;
      const atomic = block.atomic || isAtomicSectionBlock(block.element);

      if (atomic && imgHeight > maxSliceHeight && currentY > margin + 4) {
        pdf.addPage();
        currentY = margin;
      }

      currentY = await addWholeCanvasToPdf(
        pdf,
        canvas,
        pageWidth,
        pageHeight,
        margin,
        currentY,
        atomic,
      );

      if (currentY >= pageHeight - margin - 12) {
        pdf.addPage();
        currentY = margin;
      }
    }

    return pdf.output('blob');
  } finally {
    cleanupPdfCaptureGroups(shell);
    host.remove();
  }
}
