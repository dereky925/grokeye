import { useEffect, useRef, useState } from "react";
import { useDraggablePanel } from "../hooks/useDraggablePanel";
import type { ManualOverlayState } from "../types";

type Props = {
  manual: ManualOverlayState;
  onChangePosition: (x: number, y: number) => void;
  onClose: () => void;
};

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
// Cache the loaded PDF so page flips don't re-download.
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

async function getPdf(url: string) {
  const cached = pdfDocCache.get(url);
  if (cached) return cached;
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument(url).promise;
  pdfDocCache.set(url, pdf);
  return pdf;
}

export default function ManualOverlay({
  manual,
  onChangePosition,
  onClose,
}: Props) {
  const isPdf = manual.doc.mode === "pdf" && Boolean(manual.doc.pdfUrl);
  const { dragging, dragHandlers } = useDraggablePanel({
    x: manual.x,
    y: manual.y,
    onChange: onChangePosition,
    width: isPdf ? 440 : 280,
    height: isPdf ? 560 : 160,
  });
  const step = manual.doc.steps[manual.stepIndex];
  const total = manual.doc.steps.length;
  const current = manual.stepIndex + 1;
  const loading = Boolean(manual.loading);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pageRendering, setPageRendering] = useState(false);

  useEffect(() => {
    if (!isPdf || !manual.doc.pdfUrl || loading) return;
    let cancelled = false;

    (async () => {
      try {
        setPageRendering(true);
        setPdfError(null);
        const pdf = await getPdf(manual.doc.pdfUrl!);
        if (cancelled) return;
        const pageNum = Math.min(Math.max(1, current), pdf.numPages);
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;

        // Canvas mounts after loading ends — wait a frame if needed.
        let canvas = canvasRef.current;
        if (!canvas) {
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          canvas = canvasRef.current;
        }
        if (!canvas || cancelled) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const base = page.getViewport({ scale: 1 });
        const width = canvas.parentElement?.clientWidth || 400;
        const scale = Math.min(2.2, width / base.width);
        const viewport = page.getViewport({ scale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        ctx.fillStyle = "#f7f7f5";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (err) {
        if (!cancelled) {
          setPdfError(
            err instanceof Error ? err.message : "Could not render pamphlet page",
          );
        }
      } finally {
        if (!cancelled) setPageRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPdf, manual.doc.pdfUrl, current, loading]);

  return (
    <aside
      className={`manual-overlay ${isPdf ? "is-pdf" : ""} ${dragging ? "dragging" : ""} ${loading ? "is-loading" : ""}`}
      style={{ left: manual.x, top: manual.y }}
      {...dragHandlers}
      aria-label="Instruction manual"
      aria-busy={loading || pageRendering}
    >
      <header className="manual-head">
        <div className="manual-kicker">
          {loading ? "Loading" : isPdf ? "IKEA pamphlet" : "Manual"}
        </div>
        <button type="button" className="manual-close" onClick={onClose}>
          Close
        </button>
      </header>

      {loading ? (
        <div className="manual-loading">
          <div className="manual-loader" aria-hidden>
            <span className="manual-loader-ring" />
            <span className="manual-loader-ring delay" />
            <img
              className="manual-loader-mark"
              src="/assets/grok-logo.png"
              alt=""
            />
          </div>
          <h2 className="manual-title">Opening the IKEA pamphlet…</h2>
          <p className="manual-loading-copy">
            Loading official MICKE assembly pages.
          </p>
          <div className="manual-loading-bar" aria-hidden>
            <span />
          </div>
        </div>
      ) : (
        <>
          <h2 className="manual-title">{manual.doc.title}</h2>

          <a
            className="manual-source"
            href={manual.doc.source.url}
            target="_blank"
            rel="noreferrer"
            title={manual.doc.source.title}
          >
            <span className="manual-source-label">
              {isPdf ? "Official PDF" : "Source"}
            </span>
            <span className="manual-source-site">
              {manual.doc.source.siteName}
            </span>
          </a>

          <div className="manual-step-meta">
            <span>
              {isPdf ? "Page" : "Step"} {current} / {total}
            </span>
            {!isPdf && (
              <div className="manual-dots" aria-hidden>
                {manual.doc.steps.map((_, i) => (
                  <span
                    key={manual.doc.steps[i].n}
                    className={`manual-dot ${i === manual.stepIndex ? "on" : ""} ${i < manual.stepIndex ? "done" : ""}`}
                  />
                ))}
              </div>
            )}
          </div>

          {isPdf ? (
            <div className="manual-pdf-wrap">
              {pdfError ? (
                <p className="manual-pdf-error">
                  Couldn’t draw the pamphlet page.{" "}
                  <a href={manual.doc.pdfUrl} target="_blank" rel="noreferrer">
                    Open the official PDF
                  </a>
                </p>
              ) : (
                <canvas ref={canvasRef} className="manual-pdf-canvas" />
              )}
            </div>
          ) : (
            <p className="manual-step-text" key={manual.stepIndex}>
              <span className="manual-step-num">{current}.</span> {step?.text}
            </p>
          )}

          <p className="manual-hint">
            Say “next page”, “flip”, or “previous page” · drag to move
          </p>
        </>
      )}
    </aside>
  );
}
