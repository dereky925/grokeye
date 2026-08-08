import type { TwitterTweet, TwitterUser } from "../hooks/useTwitterFeed";

type Props = {
  open: boolean;
  onClose: () => void;
  configured: boolean;
  loading: boolean;
  error: string | null;
  user: TwitterUser | null;
  queryLabel: string;
  current: TwitterTweet | null;
  index: number;
  total: number;
  playing: TwitterTweet | null;
  onStopVideo: () => void;
};

export default function MiniTwitter({
  open,
  onClose,
  configured,
  loading,
  error,
  user,
  queryLabel,
  current,
  index,
  total,
  playing,
  onStopVideo,
}: Props) {
  if (!open) return null;

  const tweet = playing || current;
  const videoUrl = playing?.video?.videoUrl || null;

  return (
    <aside className="mini-twitter" aria-label="X timeline">
      <header className="mini-twitter-bar">
        <div className="mini-twitter-brand">
          <span className="mini-twitter-logo" aria-hidden>
            𝕏
          </span>
          <div className="mini-twitter-copy">
            <p className="mini-twitter-title">{queryLabel}</p>
            <p className="mini-twitter-sub">
              {loading
                ? "Loading…"
                : total
                  ? `${index + 1} / ${total}`
                  : "Voice scroll · search · watch"}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="mini-twitter-close"
          onClick={onClose}
          aria-label="Close X"
        >
          ✕
        </button>
      </header>

      {!configured ? (
        <div className="mini-twitter-panel">
          <p className="mini-twitter-msg">
            Add <code>TWITTER_BEARER_TOKEN</code> to <code>.env</code> and restart
            the API.
          </p>
        </div>
      ) : videoUrl ? (
        <div className="mini-twitter-video-wrap">
          <video
            className="mini-twitter-video"
            src={videoUrl}
            poster={playing?.video?.preview || undefined}
            controls
            autoPlay
            playsInline
          />
          <div className="mini-twitter-video-meta">
            <p className="mini-twitter-tweet-text">{playing?.text}</p>
            <button type="button" className="mini-twitter-linkish" onClick={onStopVideo}>
              Back to feed
            </button>
          </div>
        </div>
      ) : tweet ? (
        <article className="mini-twitter-tweet">
          <div className="mini-twitter-author">
            {(tweet.author?.avatar || user?.avatar) && (
              <img
                src={tweet.author?.avatar || user?.avatar}
                alt=""
                className="mini-twitter-avatar"
              />
            )}
            <div>
              <p className="mini-twitter-name">
                {tweet.author?.name || user?.name || "X"}
              </p>
              <p className="mini-twitter-handle">
                @{tweet.author?.username || user?.username || "unknown"}
              </p>
            </div>
          </div>
          <p className="mini-twitter-tweet-text">{tweet.text}</p>
          {tweet.media?.[0]?.preview || tweet.media?.[0]?.url ? (
            <img
              className="mini-twitter-media"
              src={tweet.media[0].preview || tweet.media[0].url || ""}
              alt=""
            />
          ) : null}
          {tweet.video?.videoUrl ? (
            <p className="mini-twitter-hint">Say “play starship” or open video tweets</p>
          ) : null}
        </article>
      ) : (
        <div className="mini-twitter-panel">
          <p className="mini-twitter-msg">
            Say “show @SpaceX”, “next tweet”, or “play the latest Starship launch”.
          </p>
        </div>
      )}

      {error && <p className="mini-twitter-error">{error}</p>}
    </aside>
  );
}
