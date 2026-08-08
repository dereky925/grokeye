import { useDraggablePanel } from "../hooks/useDraggablePanel";
import type { FlipReviewState } from "../types";

type Props = {
  state: FlipReviewState;
  onChangePosition: (x: number, y: number) => void;
  onClose: () => void;
};

export default function FlipReview({
  state,
  onChangePosition,
  onClose,
}: Props) {
  const { review, strip, loading, x, y } = state;

  const { dragging, dragHandlers } = useDraggablePanel({
    x,
    y,
    onChange: onChangePosition,
    width: 320,
    height: 240,
  });

  const verdict =
    review?.landed === true
      ? "landed"
      : review?.landed === false
        ? "missed"
        : "unknown";

  return (
    <aside
      className={`flip-review ${dragging ? "dragging" : ""} ${loading ? "is-loading" : ""}`}
      style={{ left: x, top: y }}
      {...dragHandlers}
      aria-label="Flip review"
      aria-busy={loading}
    >
      <header className="flip-head">
        <div className="flip-kicker">
          {loading ? "Reviewing the flip…" : "Flip review"}
        </div>
        <button type="button" className="flip-close" onClick={onClose}>
          Close
        </button>
      </header>

      {strip.length > 0 && (
        <div className="flip-strip" aria-hidden>
          {strip.map((url, i) => (
            <img src={url} alt="" key={i} />
          ))}
        </div>
      )}

      {loading || !review ? (
        <div className="flip-loading">
          <div className="flip-loading-bar" aria-hidden>
            <span />
          </div>
          <p className="flip-loading-copy">
            Grok is tracking the rotation and the water.
          </p>
        </div>
      ) : (
        <>
          <div className={`flip-verdict ${verdict}`}>
            <span className="flip-verdict-dot" aria-hidden />
            <span className="flip-outcome">{review.outcome}</span>
          </div>

          {review.factors.length > 0 && (
            <dl className="flip-factors">
              {review.factors.map((f) => (
                <div className="flip-factor" key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.detail}</dd>
                </div>
              ))}
            </dl>
          )}

          {review.fixes.length > 0 && (
            <div className="flip-fixes">
              <div className="flip-fixes-label">Next throw</div>
              <ol>
                {review.fixes.map((fix) => (
                  <li key={fix}>{fix}</li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      <div className="flip-hint">Say "how did I do" after a flip · drag to move</div>
    </aside>
  );
}
