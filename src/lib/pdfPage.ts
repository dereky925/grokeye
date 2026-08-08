/** Shared pdf.js helpers for rendering pamphlet pages. */

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
const pdfDocCache = new Map<string, import("pdfjs-dist").PDFDocumentProxy>();

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function getPdfDocument(url: string) {
  const cached = pdfDocCache.get(url);
  if (cached) return cached;
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument(url).promise;
  pdfDocCache.set(url, pdf);
  return pdf;
}
