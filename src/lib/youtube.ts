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
  | { type: "seek"; seconds: number }
  | null;

const WORD_NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  ninety: 90,
};

function parseAmount(raw: string): number | null {
  const t = raw.toLowerCase().replace(/,/g, "").trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (WORD_NUM[t] != null) return WORD_NUM[t];
  const compound = t.match(/^(twenty|thirty|forty|fifty|sixty)-?(one|two|three|four|five|six|seven|eight|nine)$/);
  if (compound) return (WORD_NUM[compound[1]] || 0) + (WORD_NUM[compound[2]] || 0);
  return null;
}

function toSeconds(amount: number, unit: string | undefined): number {
  const u = (unit || "seconds").toLowerCase();
  if (/^min/.test(u)) return Math.round(amount * 60);
  return Math.round(amount);
}

/**
 * Parse "skip 30 seconds", "go back 1 minute", "fast forward 15", etc.
 */
export function parseYoutubeSeek(message: string): number | null {
  const t = message
    .toLowerCase()
    .replace(/[’”']/g, "'")
    .trim();
  if (!t) return null;

  // Forward: skip/jump/seek/fast forward N [seconds|minutes]
  const fwd = t.match(
    /\b(?:skip|jump|seek|fast\s*forward|fastforward|ff|advance|move)\s+(?:ahead\s+|forward\s+|up\s+)?(?:by\s+)?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|sixty)(?:\s*(seconds?|secs?|s|minutes?|mins?|m))?\b/,
  );
  if (fwd) {
    const n = parseAmount(fwd[1]);
    if (n != null && n > 0) return toSeconds(n, fwd[2]);
  }

  // "forward 30 seconds" / "ahead 10 seconds"
  const fwd2 = t.match(
    /\b(?:forward|ahead)\s+(\d+|ten|fifteen|twenty|thirty|forty|fifty|sixty|one|two|three|five)(?:\s*(seconds?|secs?|minutes?|mins?))?\b/,
  );
  if (fwd2) {
    const n = parseAmount(fwd2[1]);
    if (n != null && n > 0) return toSeconds(n, fwd2[2]);
  }

  // Back: rewind / go back / skip back N
  const back = t.match(
    /\b(?:rewind|go\s+back|skip\s+back(?:wards?)?|seek\s+back|jump\s+back|back\s+up)\s+(?:by\s+)?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|sixty)(?:\s*(seconds?|secs?|s|minutes?|mins?|m))?\b/,
  );
  if (back) {
    const n = parseAmount(back[1]);
    if (n != null && n > 0) return -toSeconds(n, back[2]);
  }

  // "back 20 seconds"
  const back2 = t.match(
    /\bback\s+(\d+|ten|fifteen|twenty|thirty|forty|fifty|sixty)(?:\s*(seconds?|secs?|minutes?|mins?))?\b/,
  );
  if (back2) {
    const n = parseAmount(back2[1]);
    if (n != null && n > 0) return -toSeconds(n, back2[2]);
  }

  return null;
}

function cleanSearchQuery(q: string): string {
  return q
    .replace(/^(me\s+)?(some\s+)?/, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/^(for|about|of)\s+/i, "")
    .replace(/^(videos?\s+)?(on|about|of|for)\s+/i, "")
    .replace(/\s+on\s+youtube\.?$/i, "")
    .replace(/[?.!]+$/, "")
    .trim();
}

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

  // Seek must win over bare "skip" → next video
  const seekSecs = parseYoutubeSeek(t);
  if (seekSecs != null && (youtubeOpen || /\b(youtube|video)\b/.test(t))) {
    return { type: "seek", seconds: seekSecs };
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

  if (
    youtubeOpen &&
    /^(next|next\s+video)\.?$/.test(t)
  ) {
    return { type: "next" };
  }
  // Bare "skip" = next video only when no amount was parsed
  if (youtubeOpen && /^skip\.?$/.test(t)) {
    return { type: "next" };
  }
  if (youtubeOpen && /^(previous|prev|back|last\s+video)\.?$/.test(t)) {
    // "back" alone is prev video; "back 10 seconds" already handled above
    if (/^back\.?$/.test(t) || /^(previous|prev|last\s+video)\.?$/.test(t)) {
      return { type: "previous" };
    }
  }
  if (/\b(next\s+(youtube\s+)?video|youtube\s+next)\b/.test(t)) {
    return { type: "next" };
  }
  if (/\b(previous\s+(youtube\s+)?video|youtube\s+previous)\b/.test(t)) {
    return { type: "previous" };
  }

  // "show/play/watch (me) (a) youtube video on how to open a waterbottle"
  const ytVideoOn = t.match(
    /(?:show|play|watch|put on|pull up|find|get|open)(?:\s+me)?(?:\s+(?:a|an|the|some))?\s+youtube\s+videos?\s+(?:on|about|of|for|regarding)?\s*(.+)$/,
  );
  if (ytVideoOn) {
    const q = cleanSearchQuery(ytVideoOn[1]);
    if (q) return { type: "search", query: q };
  }

  // "youtube video on how to …" / "a youtube video about …"
  const ytVideoBare = t.match(
    /^(?:(?:a|an|the|some)\s+)?youtube\s+videos?\s+(?:on|about|of|for|regarding)?\s*(.+)$/,
  );
  if (ytVideoBare) {
    const q = cleanSearchQuery(ytVideoBare[1]);
    if (q && !/^(please|now)$/.test(q)) return { type: "search", query: q };
  }

  // "show me how to open a waterbottle on youtube"
  const howToOnYt = t.match(
    /(?:show|play|watch|find|search)(?:\s+me)?\s+(how\s+to\s+.+?)\s+on\s+youtube\.?$/,
  );
  if (howToOnYt) {
    const q = cleanSearchQuery(howToOnYt[1]);
    if (q) return { type: "search", query: q };
  }

  // "youtube cats" / "youtube search for lo-fi" / "youtube play ocean waves"
  const bare = t.match(/^youtube\s+(.+)$/);
  if (bare) {
    let q = bare[1]
      .replace(/^(search\s+for\s+|search\s+|find\s+|play\s+|watch\s+|look\s+up\s+|videos?\s+(?:on\s+|about\s+|of\s+|for\s+)?)/, "")
      .trim();
    q = cleanSearchQuery(q);
    if (q && !/^(please|now)$/.test(q)) return { type: "search", query: q };
    return { type: "open_youtube" };
  }

  // "search youtube for X" / "find on youtube X" / "look up X on youtube"
  const search = t.match(
    /(?:search|find|look\s+up)\s+(?:on\s+)?youtube\s+(?:for\s+)?(.+)$/,
  );
  if (search) {
    const q = cleanSearchQuery(search[1]);
    if (q) return { type: "search", query: q };
  }
  const searchEnd = t.match(
    /(?:search|find|look\s+up)\s+(.+?)\s+on\s+youtube\.?$/,
  );
  if (searchEnd) {
    const q = cleanSearchQuery(searchEnd[1]);
    if (q) return { type: "search", query: q };
  }

  // "play/watch/show X on youtube"
  const playOn = t.match(
    /^(?:play|watch|put on|show)(?:\s+me)?\s+(.+?)\s+on\s+youtube\.?$/,
  );
  if (playOn) {
    const q = cleanSearchQuery(playOn[1]);
    // Avoid treating "youtube video" itself as the query for "... on youtube"
    if (q && !/^youtube\b/.test(q)) return { type: "search", query: q };
  }

  // "watch X" / "show me how to X" → YouTube when it looks instructional
  const watch = t.match(
    /^(?:watch|find\s+videos?(?:\s+(?:of|about|for))?|search\s+videos?(?:\s+(?:of|about|for))?)\s+(.+)$/,
  );
  if (watch) {
    const q = cleanSearchQuery(watch[1]);
    if (q && !/\b(spotify|song|music|track|playlist)\b/.test(q)) {
      return { type: "search", query: q };
    }
  }
  const showHow = t.match(
    /^(?:show(?:\s+me)?|play)\s+(how\s+to\s+.+)$/,
  );
  if (showHow) {
    const q = cleanSearchQuery(showHow[1]);
    if (q) return { type: "search", query: q };
  }

  // Widget open: freeform play/search/find anything on YouTube
  if (youtubeOpen) {
    const openSearch = t.match(
      /^(?:(?:can you|could you|please)\s+)?(?:play|watch|search(?:\s+for)?|find|put on|show(?:\s+me)?)\s+(.+)$/,
    );
    if (openSearch) {
      const q = cleanSearchQuery(openSearch[1]);
      if (
        q &&
        !/^(it|this|that|next|previous|prev)$/.test(q) &&
        !/\b(spotify|song|music|track|playlist)\b/.test(q)
      ) {
        return { type: "search", query: q };
      }
    }
  }

  // Only open the empty widget when there's no topic after "youtube"
  if (/^(open|show|launch|pull up)(\s+me)?(\s+(the|my))?\s+youtube\.?$/.test(t)) {
    return { type: "open_youtube" };
  }
  if (/^youtube\.?$/.test(t)) return { type: "open_youtube" };

  // Last resort: any utterance that mentions youtube + a topic after it
  const anyYt = t.match(/\byoutube\b(?:\s+videos?)?\s+(?:on|about|of|for|regarding)?\s*(.+)$/);
  if (anyYt) {
    const q = cleanSearchQuery(anyYt[1]);
    if (q && q.length > 1 && !/^(please|now|app|widget|player)$/.test(q)) {
      return { type: "search", query: q };
    }
  }

  return null;
}
