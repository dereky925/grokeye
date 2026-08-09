import { useDraggablePanel } from "../hooks/useDraggablePanel";
import type { StepReviewState } from "../types";

type Props = {
  state: StepReviewState;
  onChangePosition: (x: number, y: number) => void;
  onClose: () => void;
};

const VERDICT_LABEL: Record<string, string> = {
  correct: "Done right",
  minor_issues: "Close — watch this",
  incorrect: "Not right",
  not_visible: "Couldn't tell",
};

/**
 * Verdict panel for "how did I do on that step?".
 *
 * Sits under the steps overlay on the left and carries the answer visually —
 * the frames it judged plus a short written verdict. Nothing is spoken and
 * nothing goes in the voice bubble: the strip is the evidence, and a reviewer
 * wants to look at it rather than listen to it.
 */
export default function StepReviewPanel({
  state,
  onChangePosition,
  onClose,
}: Props) {
  const { review, strip, loading, stepNumber, stepText, x, y } = state;

  const { dragging, dragHandlers } = useDraggablePanel({
    x,
    y,
    onChange: onChangePosition,
    width: 320,
    height: 260,
  });

  const verdict = review?.verdict ?? "not_visible";

  return (
    <aside
      className={`step-review ${dragging ? "dragging" : ""} ${loading ? "is-loading" : ""}`}
      style={{ left: x, top: y }}
      {...dragHandlers}
      aria-label="Step review"
      aria-busy={loading}
    >
      <header className="step-review-head">
        <div className="step-review-kicker">
          {loading ? "Reviewing…" : `Step ${stepNumber} review`}
        </div>
        <button type="button" className="step-review-close" onClick={onClose}>
          Close
        </button>
      </header>

      {strip.length > 0 && (
        <div className="step-review-strip" aria-hidden>
          {strip.map((url, i) => (
            <img src={url} alt="" key={i} />
          ))}
        </div>
      )}

      {loading || !review ? (
        <div className="step-review-loading">
          <div className="step-review-loading-bar" aria-hidden>
            <span />
          </div>
          <p className="step-review-loading-copy">
            {stepText
              ? `Checking “${stepText}” against the frames.`
              : "Checking that step against the frames."}
          </p>
        </div>
      ) : (
        <>
          <div className={`step-review-verdict ${verdict}`}>
            <span className="step-review-dot" aria-hidden />
            <span>{VERDICT_LABEL[verdict] ?? "Reviewed"}</span>
          </div>
          <p className="step-review-copy">{review.description}</p>
          {review.issues.length > 0 && (
            <div className="step-review-fixes">
              <div className="step-review-fixes-label">Fix</div>
              <ol>
                {review.issues.map((issue) => (
                  <li key={issue.what}>{issue.fix || issue.what}</li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      <div className="step-review-hint">
        Say “how did I do” · drag to move
      </div>
    </aside>
  );
}
