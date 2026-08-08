import { useCallback, useEffect, useState } from "react";
import type { YoutubeVideo } from "../lib/youtube";

export function useYoutubePlayer() {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [videos, setVideos] = useState<YoutubeVideo[]>([]);
  const [index, setIndex] = useState(0);
  const [queryLabel, setQueryLabel] = useState("YouTube");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/youtube/status");
      const data = await r.json();
      setHasApiKey(Boolean(data.hasApiKey));
      return Boolean(data.hasApiKey);
    } catch {
      setHasApiKey(false);
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const applyResult = useCallback(
    (video: YoutubeVideo, list: YoutubeVideo[], label: string) => {
      const videosList = list.length ? list : [video];
      const idx = Math.max(
        0,
        videosList.findIndex((v) => v.id === video.id),
      );
      setVideos(videosList);
      setIndex(idx === -1 ? 0 : idx);
      setQueryLabel(label);
      setError(null);
      return video;
    },
    [],
  );

  const search = useCallback(
    async (query: string) => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/youtube/search?q=${encodeURIComponent(query.trim())}`,
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "YouTube search failed");
        return applyResult(data.video, data.videos || [], query.trim());
      } catch (err) {
        const msg = err instanceof Error ? err.message : "YouTube search failed";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [applyResult],
  );

  const playStarship = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/youtube/starship");
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No Starship webcast found");
      return applyResult(data.video, data.videos || [], "SpaceX Starship");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Starship search failed";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyResult]);

  const next = useCallback(() => {
    setIndex((i) => Math.min(i + 1, Math.max(0, videos.length - 1)));
  }, [videos.length]);

  const previous = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const current = videos[index] || null;

  return {
    hasApiKey,
    videos,
    current,
    index,
    queryLabel,
    loading,
    error,
    refreshStatus,
    search,
    playStarship,
    next,
    previous,
    clearError: () => setError(null),
  };
}
