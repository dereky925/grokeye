export type SpotifyAction =
  | { type: "open_spotify" }
  | { type: "close_spotify" }
  | { type: "nudge_play" }
  | { type: "next_track" }
  | { type: "previous_track" }
  | { type: "play_query"; query: string }
  | null;

/**
 * Local voice router for Spotify playback / widget control.
 * Returns null when the utterance should fall through to Grok / manuals.
 */
export function parseSpotifyAction(
  message: string,
  spotifyOpen: boolean,
): SpotifyAction {
  const t = message
    .toLowerCase()
    .replace(/[’”']/g, "'")
    .trim();
  if (!t) return null;

  if (
    /\b(stop|pause|close|dismiss|hide|turn\s+off|shut\s+off)\b/.test(t) &&
    /\b(music|spotify|bowie|song|songs|playlist|tracks?)\b/.test(t)
  ) {
    return { type: "close_spotify" };
  }
  if (spotifyOpen && /^(stop|pause)(\s+it)?\.?$/.test(t)) {
    return { type: "close_spotify" };
  }

  // Skip / next song — avoid bare "next" (manual overlay uses that).
  if (
    /\b(next\s+(song|track|one)|skip(\s+(this|song|track|it))?|play\s+(the\s+)?next(\s+(song|track))?)\b/.test(
      t,
    ) ||
    (spotifyOpen && /^(skip|next\s+song|next\s+track)\.?$/.test(t))
  ) {
    return { type: "next_track" };
  }
  if (
    /\b(previous\s+(song|track|one)|last\s+(song|track)|go\s+back\s+(a\s+)?(song|track)|play\s+(the\s+)?previous(\s+(song|track))?)\b/.test(
      t,
    ) ||
    (spotifyOpen && /^(previous|prev|last\s+song|previous\s+track)\.?$/.test(t))
  ) {
    return { type: "previous_track" };
  }

  // Default Bowie → Starman (exact openers).
  if (
    /^(play|put\s+on|turn\s+on|start|open|launch)(\s+(some\s+)?)?(spotify|bowie|david\s+bowie|starman)(\s+(music|playlist|songs?))?\.?$/.test(
      t,
    )
  ) {
    return { type: "open_spotify" };
  }

  // Freeform: "play Space Oddity", "play joe rogan with elon", "put on Abbey Road"
  const playMatch = t.match(
    /^(?:(?:can you|could you|please)\s+)?(?:play|put on|queue|start)(?:\s+me)?(?:\s+some)?\s+(.+?)\.?$/,
  );
  if (playMatch) {
    let q = playMatch[1].trim();
    q = q.replace(/^(the\s+)?(song|track|album|artist|playlist)\s+/i, "");
    q = q.replace(/\s+on\s+spotify$/i, "").trim();
    // Bare "david bowie" / "bowie" still maps to Starman via open_spotify above.
    // Longer queries (guests, podcast titles) go to search.
    if (
      q &&
      !/^(it|music|song|the\s+song|spotify|bowie|david\s+bowie|starman)(\s+playlist)?$/i.test(
        q,
      )
    ) {
      return { type: "play_query", query: q };
    }
  }

  // Widget already open — bare “play”
  if (
    spotifyOpen &&
    /^(play|play\s+it|start|resume|go)(\s+(it|music|song|the\s+song))?\.?$/.test(
      t,
    )
  ) {
    return { type: "nudge_play" };
  }

  if (
    /\b(play|put\s+on|turn\s+on|start|queue|open|launch)\b/.test(t) &&
    /\b(spotify|bowie|david\s+bowie)\b/.test(t)
  ) {
    return { type: "open_spotify" };
  }
  if (
    /\b(spotify|bowie|david\s+bowie)\b/.test(t) &&
    /\b(music|playlist|songs?|tracks?)\b/.test(t)
  ) {
    return { type: "open_spotify" };
  }

  return null;
}
