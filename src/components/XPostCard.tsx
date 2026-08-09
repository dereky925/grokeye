import type { XPostCardState } from "../lib/xpost";

type Props = {
  card: XPostCardState;
  onPost: () => void;
  onSkip: () => void;
};

/**
 * One-tap approval for an "ask X" escalation. WYSIWYG: the thumbnail is the
 * exact collage that will be posted. Never auto-posts; a pending card sits
 * quietly and never blocks new questions.
 */
export default function XPostCard({ card, onPost, onSkip }: Props) {
  const busy = card.status === "posting" || card.status === "composing";

  return (
    <div className="xpost-card" role="status" aria-live="polite">
      <div className="xpost-head">
        <span className="xpost-kicker">
          {card.origin === "user"
            ? "✕ asking X — human check"
            : "✕ couldn't verify — ask X?"}
        </span>
        <button
          type="button"
          className="xpost-close"
          onClick={onSkip}
          disabled={card.status === "posting"}
          aria-label="Skip this post"
        >
          ✕
        </button>
      </div>
      <p className="xpost-question">{card.question}</p>
      {card.collageUrl ? (
        <img
          className="xpost-collage"
          src={card.collageUrl}
          alt="Frame collage that will be posted"
        />
      ) : (
        <div className="xpost-collage is-loading">Preparing frames…</div>
      )}
      {card.status === "posted" ? (
        <div className="xpost-result">
          Posted — X is on it.{" "}
          <a href={card.postedUrl} target="_blank" rel="noreferrer">
            View post
          </a>
        </div>
      ) : (
        <>
          <p className="xpost-caption">{card.caption || "Writing caption…"}</p>
          {card.status === "failed" && (
            <p className="xpost-error">{card.error || "Posting failed."}</p>
          )}
          <div className="xpost-actions">
            <button
              type="button"
              className="xpost-post"
              onClick={onPost}
              disabled={busy || !card.collageUrl || !card.caption}
            >
              {card.status === "posting"
                ? "Posting…"
                : card.status === "failed"
                  ? "Retry"
                  : "Post"}
            </button>
            <button
              type="button"
              className="xpost-skip"
              onClick={onSkip}
              disabled={card.status === "posting"}
            >
              Skip
            </button>
          </div>
          <p className="xpost-hint">say “post it” or “skip”</p>
        </>
      )}
    </div>
  );
}
