import type { ReactNode } from "react";
import type { SpotifyTrackInfo } from "../hooks/useSpotifyPlayer";

type Props = {
  open: boolean;
  onClose: () => void;
  configured: boolean;
  authenticated: boolean;
  activated: boolean;
  isPlaying: boolean;
  track: SpotifyTrackInfo | null;
  error: string | null;
  onLogin: () => void;
  onEnable: () => void;
};

/** Custom mini Spotify surface — Web Playback SDK driven (not the embed). */
export default function MiniSpotify({
  open,
  onClose,
  configured,
  authenticated,
  activated,
  isPlaying,
  track,
  error,
  onLogin,
  onEnable,
}: Props) {
  if (!open) return null;

  let body: ReactNode;
  if (!configured) {
    body = (
      <div className="mini-spotify-panel">
        <p className="mini-spotify-msg">
          Add <code>SPOTIFY_CLIENT_ID</code> and <code>SPOTIFY_CLIENT_SECRET</code>{" "}
          to <code>.env</code>, then restart the API.
        </p>
      </div>
    );
  } else if (!authenticated) {
    body = (
      <div className="mini-spotify-panel">
        <p className="mini-spotify-msg">
          One-time Premium connect. After Enable, voice play is hands-free.
        </p>
        <button type="button" className="mini-spotify-cta" onClick={onLogin}>
          Connect Spotify
        </button>
      </div>
    );
  } else if (!activated) {
    body = (
      <div className="mini-spotify-panel">
        <p className="mini-spotify-msg">
          One tap to unlock browser audio — then voice controls Bowie.
        </p>
        <button type="button" className="mini-spotify-cta" onClick={onEnable}>
          Enable playback
        </button>
      </div>
    );
  } else {
    body = (
      <div className="mini-spotify-now">
        {track?.image ? (
          <img className="mini-spotify-art" src={track.image} alt="" />
        ) : (
          <div className="mini-spotify-art placeholder" />
        )}
        <div className="mini-spotify-meta">
          <p className="mini-spotify-track">{track?.name || "Ready to play"}</p>
          <p className="mini-spotify-artist">
            {track?.artists || (isPlaying ? "Playing…" : "Say “play …” or a podcast")}
          </p>
          <p className="mini-spotify-state">{isPlaying ? "Playing" : "Paused"}</p>
        </div>
      </div>
    );
  }

  return (
    <aside className="mini-spotify" aria-label="Spotify player">
      <header className="mini-spotify-bar">
        <div className="mini-spotify-brand">
          <span className="mini-spotify-logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path
                fill="currentColor"
                d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"
              />
            </svg>
          </span>
          <div className="mini-spotify-copy">
            <p className="mini-spotify-title">Spotify</p>
            <p className="mini-spotify-sub">Voice search + player</p>
          </div>
        </div>
        <button
          type="button"
          className="mini-spotify-close"
          onClick={onClose}
          aria-label="Close Spotify"
        >
          ✕
        </button>
      </header>
      {body}
      {error && <p className="mini-spotify-error">{error}</p>}
    </aside>
  );
}
