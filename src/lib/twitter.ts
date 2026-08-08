export type TwitterAction =
  | { type: "open_twitter" }
  | { type: "close_twitter" }
  | { type: "scroll_next" }
  | { type: "scroll_prev" }
  | { type: "open_account"; username: string }
  | { type: "search"; query: string }
  | { type: "play_starship" }
  | null;

/**
 * Local voice router for the mini X / Twitter widget.
 */
export function parseTwitterAction(message: string, twitterOpen: boolean): TwitterAction {
  const t = message
    .toLowerCase()
    .replace(/[’”']/g, "'")
    .trim();
  if (!t) return null;

  if (
    /\b(stop|pause|close|dismiss|hide)\b/.test(t) &&
    /\b(twitter|tweet|tweets|x\b)\b/.test(t)
  ) {
    return { type: "close_twitter" };
  }
  if (twitterOpen && /^(stop|close)(\s+it)?\.?$/.test(t)) {
    return { type: "close_twitter" };
  }

  if (
    /\b(latest|last)?\s*starship\b/.test(t) &&
    /\b(play|watch|show|open|launch|stream|video|webcast|livestream)\b/.test(t)
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
    /\b(scroll|next)\b/.test(t) &&
    /\b(twitter|tweet|tweets|feed)\b/.test(t)
  ) {
    return { type: "scroll_next" };
  }
  if (twitterOpen && /^(next|scroll|scroll\s+down|down)\.?$/.test(t)) {
    return { type: "scroll_next" };
  }
  if (
    /\b(previous|prev|back|up)\b/.test(t) &&
    /\b(twitter|tweet|tweets|feed)\b/.test(t)
  ) {
    return { type: "scroll_prev" };
  }
  if (twitterOpen && /^(previous|prev|back|scroll\s+up|up)\.?$/.test(t)) {
    return { type: "scroll_prev" };
  }

  const at = t.match(
    /(?:(?:open|show|search|find|go to|pull up)\s+)?@([a-z0-9_]{1,15})\b/,
  );
  if (at) return { type: "open_account", username: at[1] };

  const account = t.match(
    /(?:(?:open|show|search|find|go to|pull up)\s+)(?:twitter\s+(?:account\s+|user\s+|for\s+)?|x\s+(?:account\s+|user\s+|for\s+)?)([a-z0-9_]{1,15})\b/,
  );
  if (account) return { type: "open_account", username: account[1] };

  const search = t.match(
    /(?:search|find)\s+(?:on\s+)?(?:twitter|x)\s+(?:for\s+)?(.+)$/,
  );
  if (search) {
    const q = search[1].replace(/^@/, "").trim();
    if (q) {
      if (/^[a-z0-9_]{1,15}$/.test(q)) return { type: "open_account", username: q };
      return { type: "search", query: q };
    }
  }

  if (
    /\b(open|show|launch|pull up)\b/.test(t) &&
    /\b(twitter|tweets|\bx\b)\b/.test(t)
  ) {
    return { type: "open_twitter" };
  }
  if (/^(twitter|tweets)\.?$/.test(t)) return { type: "open_twitter" };

  return null;
}
