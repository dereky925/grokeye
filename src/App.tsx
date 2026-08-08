import { useEffect, useState } from "react";
import Dashboard from "./components/Dashboard";
import VideoPlayer from "./components/VideoPlayer";
import type { VideoItem } from "./types";

export default function App() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<VideoItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/videos");
        if (!res.ok) throw new Error("Could not load video library");
        const data = (await res.json()) as VideoItem[];
        if (!cancelled) setVideos(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      {!active && (
        <header className="topbar">
          <a className="brand" href="/">
            <img src="/assets/grok-logo.png" alt="GrokEye" />
            <div className="brand-title">GrokEye</div>
          </a>
        </header>
      )}

      {active ? (
        <VideoPlayer video={active} onBack={() => setActive(null)} />
      ) : (
        <Dashboard
          videos={videos}
          loading={loading}
          error={error}
          onSelect={setActive}
        />
      )}
    </div>
  );
}
