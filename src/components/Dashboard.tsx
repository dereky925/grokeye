import type { VideoItem } from "../types";

type Props = {
  videos: VideoItem[];
  loading: boolean;
  error: string | null;
  onSelect: (video: VideoItem) => void;
};

export default function Dashboard({
  videos,
  loading,
  error,
  onSelect,
}: Props) {
  return (
    <div className="page lp-library-page">
      {error && <div className="error-banner">{error}</div>}

      {(!loading || videos.some((v) => v.live)) && (
        <div className="video-grid">
          {videos.map((video, index) => (
            <button
              key={video.id}
              type="button"
              className={`video-card ${video.live ? "live" : ""} ${video.mode === "flip" ? "coach" : ""}`}
              style={{ animationDelay: `${index * 60}ms` }}
              onClick={() => onSelect(video)}
            >
              <div className="video-thumb">
                {video.live ? (
                  <div className="live-thumb" aria-hidden>
                    <span
                      className={
                        video.mode === "flip"
                          ? "flip-thumb-icon"
                          : "live-thumb-icon"
                      }
                    />
                  </div>
                ) : (
                  <img src={video.thumbnail} alt="" />
                )}
                {video.live && (
                  <span className="video-duration live">LIVE</span>
                )}
              </div>
              <div className="video-meta">
                <h2>{video.title}</h2>
                <p>{video.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {loading && <p className="loading">Loading videos…</p>}
    </div>
  );
}
