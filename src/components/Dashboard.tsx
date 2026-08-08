import type { VideoItem } from "../types";

type Props = {
  videos: VideoItem[];
  loading: boolean;
  error: string | null;
  onSelect: (video: VideoItem) => void;
};

function formatDuration(seconds: number) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Dashboard({
  videos,
  loading,
  error,
  onSelect,
}: Props) {
  return (
    <div className="page">
      <section className="hero">
        <h1>Grok-Enhanced Reality.</h1>
      </section>

      {loading && <p className="loading">Loading videos…</p>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && (
        <div className="video-grid">
          {videos.map((video, index) => (
            <button
              key={video.id}
              type="button"
              className="video-card"
              style={{ animationDelay: `${index * 60}ms` }}
              onClick={() => onSelect(video)}
            >
              <div className="video-thumb">
                <img src={video.thumbnail} alt="" />
                <span className="video-duration">
                  {formatDuration(video.durationSeconds)}
                </span>
              </div>
              <div className="video-meta">
                <h2>{video.title}</h2>
                <p>{video.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
