import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Called on any manual transport action so auto-resume logic stands down. */
  onUserControl: () => void;
};

function formatTime(t: number, withTenths = false) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const base = `${m}:${String(s).padStart(2, "0")}`;
  if (!withTenths) return base;
  const tenths = Math.floor((t % 1) * 10);
  return `${base}.${tenths}`;
}

export default function PlayerTransport({ videoRef, onUserControl }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = videoRef.current;
      if (el) {
        if (!draggingRef.current) setCurrent(el.currentTime);
        setDuration(Number.isFinite(el.duration) ? el.duration : 0);
        setPaused(el.paused);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  const timeAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      const el = videoRef.current;
      if (!track || !el) return null;
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      if (!d) return null;
      const rect = track.getBoundingClientRect();
      const frac = Math.min(
        Math.max(0, (clientX - rect.left) / rect.width),
        1,
      );
      return { x: frac * rect.width, time: frac * d };
    },
    [videoRef],
  );

  const seekTo = useCallback(
    (clientX: number) => {
      const hit = timeAt(clientX);
      const el = videoRef.current;
      if (!hit || !el) return;
      el.currentTime = hit.time;
      setCurrent(hit.time);
      setHover(hit);
    },
    [timeAt, videoRef],
  );

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    onUserControl();
    if (el.paused) void el.play();
    else el.pause();
  }, [onUserControl, videoRef]);

  const frac = duration > 0 ? Math.min(current / duration, 1) : 0;

  return (
    <div className="player-transport">
      <button
        type="button"
        className="transport-play"
        onClick={togglePlay}
        title={paused ? "Play (Space)" : "Pause (Space)"}
        aria-label={paused ? "Play" : "Pause"}
      >
        {paused ? (
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden>
            <rect x="3.4" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" />
            <rect x="9.2" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" />
          </svg>
        )}
      </button>

      <span className="transport-time">{formatTime(current, dragging)}</span>

      <div
        ref={trackRef}
        className={`transport-track ${dragging ? "dragging" : ""}`}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={formatTime(current)}
        onPointerDown={(event) => {
          event.preventDefault();
          onUserControl();
          trackRef.current?.setPointerCapture(event.pointerId);
          draggingRef.current = true;
          setDragging(true);
          seekTo(event.clientX);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) seekTo(event.clientX);
          else setHover(timeAt(event.clientX));
        }}
        onPointerUp={(event) => {
          trackRef.current?.releasePointerCapture(event.pointerId);
          draggingRef.current = false;
          setDragging(false);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setDragging(false);
        }}
        onPointerLeave={() => {
          if (!draggingRef.current) setHover(null);
        }}
      >
        <div className="transport-rail" />
        <div
          className="transport-fill"
          style={{ width: `${frac * 100}%` }}
        />
        <div
          className="transport-thumb"
          style={{ left: `${frac * 100}%` }}
        />
        {hover && (
          <div className="transport-tooltip" style={{ left: hover.x }}>
            {formatTime(hover.time, true)}
          </div>
        )}
      </div>

      <span className="transport-time transport-duration">
        {formatTime(duration)}
      </span>
    </div>
  );
}
