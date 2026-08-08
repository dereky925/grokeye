export type YoutubeVideo = {
  id: string;
  title: string;
  description?: string;
  publishedAt?: string | null;
  thumbnail?: string | null;
  url: string;
  embedUrl: string;
  channelTitle?: string;
};

/** Build an embed URL; hide native HUD unless `controls` is true. */
export function buildYoutubeEmbedUrl(
  videoId: string,
  opts: { controls?: boolean; start?: number; autoplay?: boolean } = {},
): string {
  const u = new URL(`https://www.youtube.com/embed/${videoId}`);
  u.searchParams.set("autoplay", opts.autoplay === false ? "0" : "1");
  u.searchParams.set("controls", opts.controls ? "1" : "0");
  u.searchParams.set("modestbranding", "1");
  u.searchParams.set("rel", "0");
  u.searchParams.set("iv_load_policy", "3");
  u.searchParams.set("playsinline", "1");
  u.searchParams.set("enablejsapi", "1");
  if (typeof window !== "undefined" && window.location?.origin) {
    u.searchParams.set("origin", window.location.origin);
  }
  const start = Math.floor(opts.start || 0);
  if (start > 0) u.searchParams.set("start", String(start));
  return u.toString();
}

export type YoutubeAction =
  | { type: "open_youtube" }
  | { type: "close_youtube" }
  | { type: "search"; query: string }
  | { type: "play_starship" }
  | { type: "next" }
  | { type: "previous" }
  | null;

/**
 * Voice router for the mini YouTube widget.
 */
export function parseYoutubeAction(
  message: string,
  youtubeOpen: boolean,
): YoutubeAction {
  const t = message
    .toLowerCase()
    .replace(/[’”']/g, "'")
    .trim();
  if (!t) return null;

  if (
    /\b(stop|pause|close|dismiss|hide)\b/.test(t) &&
    /\b(youtube|video|videos)\b/.test(t)
  ) {
    return { type: "close_youtube" };
  }
  if (youtubeOpen && /^(stop|close)(\s+it)?\.?$/.test(t)) {
    return { type: "close_youtube" };
  }

  // Starship launch — prefer YouTube official webcast
  if (
    /\b(latest|last)?\s*starship\b/.test(t) &&
    /\b(play|watch|show|open|launch|stream|video|webcast|livestream|youtube)\b/.test(
      t,
    )
  ) {
    return { type: "play_starship" };
  }
  if (
    /^(play|watch)\s+(the\s+)?(latest|last)?\s*(starship)(\s+launch)?/.test(t) ||
    /\bplay\s+(the\s+)?(latest|last)\s+starship\b/.test(t)
  ) {
    return { type: "play_starship" };
  }

  if (youtubeOpen && /^(next|next\s+video|skip)\.?$/.test(t)) {
    return { type: "next" };
  }
  if (youtubeOpen && /^(previous|prev|back|last\s+video)\.?$/.test(t)) {
    return { type: "previous" };
  }
  if (
    /\b(next\s+(youtube\s+)?video|youtube\s+next)\b/.test(t)
  ) {
    return { type: "next" };
  }

  // "youtube cats" / "youtube search for lo-fi"
  const bare = t.match(/^youtube\s+(.+)$/);
  if (bare) {
    const q = bare[1].replace(/^(search\s+for\s+|search\s+|find\s+|play\s+)/, "").trim();
    if (q && !/^(please|now)$/.test(q)) return { type: "search", query: q };
    return { type: "open_youtube" };
  }

  // "search youtube for X" / "find on youtube X"
  const search = t.match(
    /(?:search|find|look\s+up)\s+(?:on\s+)?youtube\s+(?:for\s+)?(.+)$/,
  );
  if (search) {
    const q = search[1].trim();
    if (q) return { type: "search", query: q };
  }

  // "play X on youtube" / "watch X on youtube"
  const playOn = t.match(
    /^(?:play|watch|put on|show)\s+(.+?)\s+on\s+youtube\.?$/,
  );
  if (playOn) {
    const q = playOn[1].replace(/^(me\s+)?(some\s+)?/, "").trim();
    if (q) return { type: "search", query: q };
  }

  if (
    /\b(open|show|launch|pull up)\b/.test(t) &&
    /\byoutube\b/.test(t)
  ) {
    return { type: "open_youtube" };
  }
  if (/^youtube\.?$/.test(t)) return { type: "open_youtube" };

  return null;
}
