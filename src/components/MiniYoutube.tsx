import { useEffect, useRef, useState } from "react";
import { buildYoutubeEmbedUrl, type YoutubeVideo } from "../lib/youtube";

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  queryLabel: string;
  current: YoutubeVideo | null;
  index: number;
  total: number;
};

export default function MiniYoutube({
  open,
  onClose,
  loading,
  error,
  queryLabel,
  current,
  index,
  total,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeRef = useRef(0);
  const [hover, setHover] = useState(false);
  const [tick, setTick] = useState(0); // bump to remount iframe on hover edge

  useEffect(() => {
    timeRef.current = 0;
    setHover(false);
    setTick(0);
  }, [current?.id]);

  useEffect(() => {
    if (!open || !current) return;

    const onMessage = (event: MessageEvent) => {
      if (!String(event.origin || "").includes("youtube.com")) return;
      let data = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const t = data?.info?.currentTime;
      if (typeof t === "number" && Number.isFinite(t) && t >= 0) {
        timeRef.current = t;
      }
    };

    window.addEventListener("message", onMessage);
    const poll = window.setInterval(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({
          event: "command",
          func: "getCurrentTime",
          args: [],
        }),
        "*",
      );
    }, 700);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
  }, [open, current?.id, tick]);

  if (!open) return null;

  const start = Math.max(0, Math.floor(timeRef.current));
  const embedSrc = current
    ? buildYoutubeEmbedUrl(current.id, {
        controls: hover,
        autoplay: true,
        start: start > 0 ? start : undefined,
      })
    : "";

  return (
    <aside className="mini-youtube" aria-label="YouTube player">
      <header className="mini-youtube-bar">
        <div className="mini-youtube-brand">
          <span className="mini-youtube-logo" aria-hidden>
            ▶
          </span>
          <div className="mini-youtube-copy">
            <p className="mini-youtube-title">{queryLabel}</p>
            <p className="mini-youtube-sub">
              {loading
                ? "Searching…"
                : total
                  ? `${index + 1} / ${total}`
                  : "Say “youtube …” to search"}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="mini-youtube-close"
          onClick={onClose}
          aria-label="Close YouTube"
        >
          ✕
        </button>
      </header>

      {!current && !loading ? (
        <div className="mini-youtube-panel">
          <p className="mini-youtube-msg">
            Try “youtube lo-fi beats”, “play cats on youtube”, or “play last
            Starship launch”.
          </p>
        </div>
      ) : current ? (
        <div className="mini-youtube-body">
          <div
            className="mini-youtube-frame-wrap"
            onMouseEnter={() => {
              if (hover) return;
              setHover(true);
              setTick((n) => n + 1);
            }}
            onMouseLeave={() => {
              if (!hover) return;
              setHover(false);
              setTick((n) => n + 1);
            }}
          >
            <iframe
              key={`${current.id}-${tick}`}
              ref={iframeRef}
              className="mini-youtube-frame"
              src={embedSrc}
              title={current.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="mini-youtube-meta">
            <p className="mini-youtube-video-title">{current.title}</p>
            {current.channelTitle ? (
              <p className="mini-youtube-channel">{current.channelTitle}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mini-youtube-panel">
          <p className="mini-youtube-msg">Searching…</p>
        </div>
      )}

      {error && <p className="mini-youtube-error">{error}</p>}
    </aside>
  );
}
