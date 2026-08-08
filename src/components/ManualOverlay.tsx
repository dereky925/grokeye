import { useDraggablePanel } from "../hooks/useDraggablePanel";
import type { ManualOverlayState } from "../types";

type Props = {
  manual: ManualOverlayState;
  onChangePosition: (x: number, y: number) => void;
  onClose: () => void;
};

export default function ManualOverlay({
  manual,
  onChangePosition,
  onClose,
}: Props) {
  const { dragging, dragHandlers } = useDraggablePanel({
    x: manual.x,
    y: manual.y,
    onChange: onChangePosition,
    width: 280,
    height: 160,
  });
  const step = manual.doc.steps[manual.stepIndex];
  const total = manual.doc.steps.length;
  const current = manual.stepIndex + 1;
  const loading = Boolean(manual.loading);

  return (
    <aside
      className={`manual-overlay ${dragging ? "dragging" : ""} ${loading ? "is-loading" : ""}`}
      style={{ left: manual.x, top: manual.y }}
      {...dragHandlers}
      aria-label="Instruction manual"
      aria-busy={loading}
    >
      <header className="manual-head">
        <div className="manual-kicker">{loading ? "Searching" : "Manual"}</div>
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
          <h2 className="manual-title">Searching the web…</h2>
          <p className="manual-loading-copy">
            Grok is finding a trusted source and writing steps.
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
            <span className="manual-source-label">Source</span>
            <span className="manual-source-site">
              {manual.doc.source.siteName}
            </span>
          </a>

          <div className="manual-step-meta">
            <span>
              Step {current} / {total}
            </span>
            <div className="manual-dots" aria-hidden>
              {manual.doc.steps.map((_, i) => (
                <span
                  key={manual.doc.steps[i].n}
                  className={`manual-dot ${i === manual.stepIndex ? "on" : ""} ${i < manual.stepIndex ? "done" : ""}`}
                />
              ))}
            </div>
          </div>

          <p className="manual-step-text" key={manual.stepIndex}>
            <span className="manual-step-num">{current}.</span> {step?.text}
          </p>

          <p className="manual-hint">Say “next step” or “previous step” · drag to move</p>
        </>
      )}
    </aside>
  );
}
