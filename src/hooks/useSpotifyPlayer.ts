import { useCallback, useEffect, useRef, useState } from "react";

export const BOWIE_CONTEXT_URI = "spotify:playlist:37i9dQZF1DZ06evO0auErC";
const ACTIVATED_KEY = "grokeye_spotify_activated";

export type SpotifyTrackInfo = {
  name: string;
  artists: string;
  image: string | null;
};

type SpotifyStatus = {
  configured: boolean;
  authenticated: boolean;
};

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (opts: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
  }
}

type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (state: any) => void) => void;
  removeListener: (event: string, cb?: (state: any) => void) => void;
  getCurrentState: () => Promise<any>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlay: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  activateElement: () => Promise<void>;
};

/** Survives VideoPlayer remounts (leaving/re-entering a video). */
const shared = {
  player: null as SpotifyPlayer | null,
  deviceId: null as string | null,
  connecting: null as Promise<SpotifyPlayer> | null,
  activated: false,
  readyWaiters: [] as Array<(id: string) => void>,
  listeners: new Set<() => void>(),
  track: null as SpotifyTrackInfo | null,
  isPlaying: false,
  error: null as string | null,
  sessionOk: true,
};

try {
  shared.activated = sessionStorage.getItem(ACTIVATED_KEY) === "1";
} catch {
  shared.activated = false;
}

function notifyShared() {
  for (const l of shared.listeners) l();
}

function setSharedActivated(value: boolean) {
  shared.activated = value;
  try {
    if (value) sessionStorage.setItem(ACTIVATED_KEY, "1");
    else sessionStorage.removeItem(ACTIVATED_KEY);
  } catch {
    /* private mode */
  }
  notifyShared();
}

function setError(msg: string | null) {
  shared.error = msg;
  notifyShared();
}

let sdkPromise: Promise<void> | null = null;

function loadSdk() {
  if (window.Spotify) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const prev = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      prev?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load Spotify SDK"));
    document.body.appendChild(script);
  });
  return sdkPromise;
}

async function fetchAccessToken(): Promise<string> {
  const r = await fetch("/api/spotify/token", { credentials: "include" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Not connected to Spotify");
  return String(data.access_token);
}

function waitForDeviceId(timeoutMs: number) {
  if (shared.deviceId) return Promise.resolve(shared.deviceId);
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      shared.readyWaiters = shared.readyWaiters.filter((w) => w !== onReady);
      reject(new Error("Spotify device never became ready — tap Enable again"));
    }, timeoutMs);
    const onReady = (id: string) => {
      window.clearTimeout(timer);
      resolve(id);
    };
    shared.readyWaiters.push(onReady);
  });
}

async function ensurePlayer(): Promise<SpotifyPlayer> {
  if (shared.player) return shared.player;
  if (shared.connecting) return shared.connecting;

  shared.connecting = (async () => {
    await loadSdk();
    if (!window.Spotify) throw new Error("Spotify SDK unavailable");

    const player = new window.Spotify.Player({
      name: "GrokEye",
      getOAuthToken: (cb) => {
        void fetchAccessToken()
          .then((token) => cb(token))
          .catch(() => cb(""));
      },
      volume: 0.9,
    });

    player.addListener("ready", ({ device_id }: { device_id: string }) => {
      shared.deviceId = device_id;
      setError(null);
      const waiters = shared.readyWaiters.splice(0);
      for (const w of waiters) w(device_id);
      notifyShared();
    });
    player.addListener("not_ready", () => {
      shared.deviceId = null;
      notifyShared();
    });
    player.addListener("initialization_error", ({ message }: { message: string }) => {
      setError(message || "Spotify player failed to initialize");
    });
    player.addListener("authentication_error", ({ message }: { message: string }) => {
      shared.sessionOk = false;
      setSharedActivated(false);
      setError(message || "Spotify auth error — Connect again");
    });
    player.addListener("account_error", ({ message }: { message: string }) => {
      setError(message || "Spotify Premium is required for in-browser playback");
    });
    player.addListener("playback_error", ({ message }: { message: string }) => {
      setError(message || "Spotify playback error");
    });
    player.addListener("player_state_changed", (state: any) => {
      if (!state) {
        shared.isPlaying = false;
        notifyShared();
        return;
      }
      shared.isPlaying = !state.paused;
      const current = state.track_window?.current_track;
      if (current) {
        shared.track = {
          name: String(current.name || "Unknown"),
          artists: (current.artists || [])
            .map((a: { name: string }) => a.name)
            .join(", "),
          image: current.album?.images?.[0]?.url || null,
        };
      }
      notifyShared();
    });

    const ok = await player.connect();
    if (!ok) throw new Error("Could not connect Spotify player");
    shared.player = player;
    return player;
  })();

  try {
    return await shared.connecting;
  } catch (err) {
    shared.player = null;
    shared.deviceId = null;
    throw err;
  } finally {
    shared.connecting = null;
  }
}

async function resetPlayer() {
  try {
    shared.player?.disconnect();
  } catch {
    /* ignore */
  }
  shared.player = null;
  shared.deviceId = null;
  shared.connecting = null;
  shared.readyWaiters = [];
  return ensurePlayer();
}

async function getDeviceId(): Promise<string> {
  if (shared.deviceId) return shared.deviceId;

  // Dead instance (player exists, no device) — reconnect once.
  if (shared.player && !shared.deviceId) {
    await resetPlayer();
  } else {
    await ensurePlayer();
  }

  if (shared.deviceId) return shared.deviceId;
  return waitForDeviceId(8000);
}

async function playOnDevice(
  deviceId: string,
  playPayload: { context_uri?: string; uri?: string; uris?: string[] },
) {
  const player = shared.player;
  try {
    await player?.activateElement();
  } catch {
    /* voice path may lack a user gesture */
  }
  try {
    await player?.setVolume(1);
  } catch {
    /* ignore */
  }

  const r = await fetch("/api/spotify/play", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, ...playPayload }),
  });
  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg = String(data.error || "Could not start playback");
    if (r.status === 404 || /device/i.test(msg)) {
      await resetPlayer();
      const freshId = await getDeviceId();
      const r2 = await fetch("/api/spotify/play", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: freshId, ...playPayload }),
      });
      const data2 = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(data2.error || msg);
    } else {
      throw new Error(msg);
    }
  }

  try {
    await player?.setVolume(1);
    await player?.resume();
  } catch {
    /* ignore */
  }
  shared.isPlaying = true;
  setError(null);
}

export function useSpotifyPlayer() {
  const [status, setStatus] = useState<SpotifyStatus>({
    configured: false,
    authenticated: false,
  });
  const [, bump] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const onShared = () => {
      if (mounted.current) bump((n) => n + 1);
    };
    shared.listeners.add(onShared);
    return () => {
      mounted.current = false;
      shared.listeners.delete(onShared);
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/spotify/status", { credentials: "include" });
      const data = await r.json();
      setStatus({
        configured: Boolean(data.configured),
        authenticated: Boolean(data.authenticated),
      });
      if (data.authenticated) shared.sessionOk = true;
      return data as SpotifyStatus & { bowieUri?: string };
    } catch {
      setStatus({ configured: false, authenticated: false });
      return { configured: false, authenticated: false };
    }
  }, []);

  useEffect(() => {
    void refreshStatus().then((st) => {
      // Warm the Web Playback device early so voice play isn't stuck connecting.
      if (st.authenticated && shared.activated) {
        void ensurePlayer().catch(() => {});
      }
    });
    const params = new URLSearchParams(window.location.search);
    if (params.get("spotify") === "connected") {
      params.delete("spotify");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }
  }, [refreshStatus]);

  const requireReady = useCallback(async () => {
    const st = await refreshStatus();
    if (!st.configured) {
      throw new Error("Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env");
    }
    if (!st.authenticated) {
      throw new Error("Connect Spotify once on the widget");
    }
    if (!shared.activated) {
      throw new Error("Tap Enable once on the Spotify widget");
    }
  }, [refreshStatus]);

  /** Must run from a real click once (browser autoplay). */
  const enablePlayback = useCallback(async () => {
    setError(null);
    try {
      const player = await ensurePlayer();
      await player.activateElement();
      const id = await getDeviceId();
      setSharedActivated(true);
      await playOnDevice(id, { context_uri: BOWIE_CONTEXT_URI });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not enable Spotify";
      setError(msg);
      throw err;
    }
  }, []);

  const playBowie = useCallback(async () => {
    setError(null);
    try {
      await requireReady();
      const id = await getDeviceId();
      await playOnDevice(id, { context_uri: BOWIE_CONTEXT_URI });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not start Bowie";
      if (/never became ready/i.test(msg)) setSharedActivated(false);
      setError(msg);
      throw err;
    }
  }, [requireReady]);

  const playQuery = useCallback(
    async (query: string) => {
      setError(null);
      const q = query.trim();
      if (!q) throw new Error("Say what to play");
      try {
        await requireReady();
        const id = await getDeviceId();

        const search = await fetch(
          `/api/spotify/search?q=${encodeURIComponent(q)}`,
          { credentials: "include" },
        );
        const found = await search.json().catch(() => ({}));
        if (!search.ok) throw new Error(found.error || `Nothing found for “${q}”`);
        const result = found.result as {
          kind: string;
          uri: string;
          name: string;
          subtitle?: string;
          image?: string | null;
        };
        if (!result?.uri) throw new Error(`Nothing found for “${q}”`);

        shared.track = {
          name: result.name,
          artists: result.subtitle || result.kind,
          image: result.image || null,
        };
        notifyShared();

        await playOnDevice(
          id,
          result.kind === "track" || result.kind === "episode"
            ? { uri: result.uri }
            : { context_uri: result.uri },
        );
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not play that";
        if (/never became ready/i.test(msg)) setSharedActivated(false);
        setError(msg);
        throw err;
      }
    },
    [requireReady],
  );

  const pause = useCallback(async () => {
    setError(null);
    const id = shared.deviceId;
    if (id) {
      const r = await fetch("/api/spotify/pause", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: id }),
      });
      if (r.ok) {
        shared.isPlaying = false;
        notifyShared();
        return;
      }
    }
    await shared.player?.pause();
    shared.isPlaying = false;
    notifyShared();
  }, []);

  const nextTrack = useCallback(async () => {
    setError(null);
    try {
      await requireReady();
      const id = await getDeviceId();
      try {
        await shared.player?.nextTrack();
        return;
      } catch {
        /* API fallback */
      }
      const r = await fetch("/api/spotify/next", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Could not skip track");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not skip track";
      setError(msg);
      throw err;
    }
  }, [requireReady]);

  const previousTrack = useCallback(async () => {
    setError(null);
    try {
      await requireReady();
      const id = await getDeviceId();
      try {
        await shared.player?.previousTrack();
        return;
      } catch {
        /* API fallback */
      }
      const r = await fetch("/api/spotify/previous", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Could not go to previous track");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not go to previous track";
      setError(msg);
      throw err;
    }
  }, [requireReady]);

  const login = useCallback(() => {
    window.location.href = "/api/spotify/login";
  }, []);

  return {
    configured: status.configured,
    authenticated: status.authenticated && shared.sessionOk,
    activated: shared.activated,
    deviceId: shared.deviceId,
    isPlaying: shared.isPlaying,
    track: shared.track,
    error: shared.error,
    refreshStatus,
    login,
    enablePlayback,
    playBowie,
    playQuery,
    pause,
    nextTrack,
    previousTrack,
  };
}
