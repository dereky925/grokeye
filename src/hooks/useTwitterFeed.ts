import { useCallback, useEffect, useState } from "react";

export type TwitterUser = {
  id: string;
  name: string;
  username: string;
  avatar: string;
  bio?: string;
};

export type TwitterMedia = {
  key: string;
  type: string;
  url: string | null;
  preview: string | null;
  videoUrl: string | null;
};

export type TwitterTweet = {
  id: string;
  text: string;
  createdAt: string | null;
  url: string;
  author: TwitterUser | null;
  media: TwitterMedia[];
  video: TwitterMedia | null;
};

export function useTwitterFeed() {
  const [configured, setConfigured] = useState(false);
  const [user, setUser] = useState<TwitterUser | null>(null);
  const [tweets, setTweets] = useState<TwitterTweet[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState<TwitterTweet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"timeline" | "search" | "video">("timeline");
  const [queryLabel, setQueryLabel] = useState("SpaceX");

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/twitter/status");
      const data = await r.json();
      setConfigured(Boolean(data.configured));
      return Boolean(data.configured);
    } catch {
      setConfigured(false);
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const openAccount = useCallback(async (username: string) => {
    setLoading(true);
    setError(null);
    setPlaying(null);
    try {
      const r = await fetch(
        `/api/twitter/timeline?username=${encodeURIComponent(username.replace(/^@/, ""))}`,
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Could not load timeline");
      setUser(data.user || null);
      setTweets(data.tweets || []);
      setIndex(0);
      setMode("timeline");
      setQueryLabel(`@${data.user?.username || username}`);
      return data.tweets as TwitterTweet[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Timeline failed";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    setPlaying(null);
    try {
      const r = await fetch(`/api/twitter/search?q=${encodeURIComponent(q)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Search failed");
      setUser(null);
      setTweets(data.tweets || []);
      setIndex(0);
      setMode("search");
      setQueryLabel(q);
      return data.tweets as TwitterTweet[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Search failed";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const playStarship = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/twitter/starship");
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No Starship video found");
      const tweet = data.tweet as TwitterTweet;
      const list = (data.tweets as TwitterTweet[]) || [tweet];
      setTweets(list);
      setUser(tweet.author);
      setIndex(Math.max(0, list.findIndex((t) => t.id === tweet.id)));
      setPlaying(tweet);
      setMode("video");
      setQueryLabel("Starship launch");
      return tweet;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Starship search failed";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const scrollNext = useCallback(() => {
    setPlaying(null);
    setIndex((i) => Math.min(i + 1, Math.max(0, tweets.length - 1)));
  }, [tweets.length]);

  const scrollPrev = useCallback(() => {
    setPlaying(null);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const current = tweets[index] || null;

  return {
    configured,
    user,
    tweets,
    current,
    index,
    playing,
    loading,
    error,
    mode,
    queryLabel,
    refreshStatus,
    openAccount,
    search,
    playStarship,
    scrollNext,
    scrollPrev,
    setPlaying,
    clearError: () => setError(null),
  };
}
