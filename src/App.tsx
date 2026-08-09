import { useEffect, useState } from "react";
import Dashboard from "./components/Dashboard";
import Landing from "./components/Landing";
import VideoPlayer from "./components/VideoPlayer";
import { navigate } from "./lib/router";
import type { VideoItem } from "./types";

/**
 * Not in the server manifest — there is no file behind it. The player swaps the
 * <video> source for the USB webcam when it sees `live`.
 */
const LIVE_CAMERA: VideoItem = {
  id: "live",
  title: "Live Camera",
  description: "Point the webcam at whatever you're doing.",
  src: "",
  thumbnail: "",
  durationSeconds: 0,
  live: true,
};

const FLIP_COACH: VideoItem = {
  id: "flip",
  title: "Bottle Flip Coach",
  description: "Flip a bottle — Grok grades the physics.",
  src: "",
  thumbnail: "",
  durationSeconds: 0,
  live: true,
  mode: "flip",
};

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

  if (active) {
    return (
      <div className="app-shell">
        <VideoPlayer video={active} onBack={() => setActive(null)} />
      </div>
    );
  }

  return (
    <div className="lp">
      <header className="lp-nav">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <img src="/assets/grok-logo.png" alt="GrokEye" />
          <div className="brand-title">GrokEye</div>
        </a>
        <a
          className="lp-btn lp-btn-primary lp-btn-nav"
          href="#library"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("library")?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          Try GrokEye
        </a>
      </header>

      <main className="lp-main">
        <Landing />
        <section className="lp-library" id="library">
          <Dashboard
            videos={[LIVE_CAMERA, FLIP_COACH, ...videos]}
            loading={loading}
            error={error}
            onSelect={setActive}
          />
        </section>
      </main>
    </div>
  );
}
