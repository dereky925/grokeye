import { useEffect, useRef } from "react";
import { buildYoutubeEmbedUrl, type YoutubeVideo } from "../lib/youtube";

export type YoutubeSeekRequest = {
  seq: number;
  seconds: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  queryLabel: string;
  current: YoutubeVideo | null;
  index: number;
  total: number;
  seekRequest?: YoutubeSeekRequest | null;
};

function ytCommand(
  win: Window | null | undefined,
  func: string,
  args: unknown[] = [],
) {
  win?.postMessage(
    JSON.stringify({ event: "command", func, args }),
    "*",
  );
}

export default function MiniYoutube({
  open,
  onClose,
  loading,
  error,
  queryLabel,
  current,
  index,
  total,
  seekRequest = null,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    timeRef.current = 0;
  }, [current?.id]);

  // Track playback time for seek + resume.
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
      const win = iframeRef.current?.contentWindow;
      ytCommand(win, "getCurrentTime", []);
    }, 500);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
  }, [open, current?.id]);

  // Voice seek: skip ±N seconds without remounting the iframe.
  useEffect(() => {
    if (!seekRequest || !open || !current) return;
    const win = iframeRef.current?.contentWindow;
    const next = Math.max(0, timeRef.current + seekRequest.seconds);
    timeRef.current = next;
    ytCommand(win, "seekTo", [next, true]);
    ytCommand(win, "playVideo", []);
  }, [seekRequest?.seq, open, current?.id]);

  if (!open) return null;

  const embedSrc = current
    ? buildYoutubeEmbedUrl(current.id, { controls: false, autoplay: true })
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
            Try “youtube lo-fi beats”, “watch MrBeast”, or “skip 30 seconds”.
          </p>
        </div>
      ) : current ? (
        <div className="mini-youtube-body">
          <div className="mini-youtube-frame-wrap">
            <iframe
              key={current.id}
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
