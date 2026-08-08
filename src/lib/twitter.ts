export type TwitterAction =
  | { type: "open_twitter" }
  | { type: "close_twitter" }
  | { type: "scroll_next" }
  | { type: "scroll_prev" }
  | { type: "open_account"; username: string }
  | { type: "search"; query: string }
  | { type: "play_starship" }
  | null;

/** Spoken names → X handles */
const ACCOUNT_ALIASES: Record<string, string> = {
  elon: "elonmusk",
  "elon musk": "elonmusk",
  musk: "elonmusk",
  "elonmusk": "elonmusk",
  spacex: "SpaceX",
  "space x": "SpaceX",
  "space-x": "SpaceX",
  nasa: "NASA",
  tesla: "Tesla",
  x: "X",
  twitter: "X",
};

function resolveAccount(raw: string): string | null {
  const key = raw
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!key || key === "my" || key === "me" || key === "mine") return null;
  if (ACCOUNT_ALIASES[key]) return ACCOUNT_ALIASES[key];
  // Collapse "elon musk" style already handled; allow bare handles
  if (/^[a-z0-9_]{1,15}$/.test(key)) return key;
  return null;
}

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
    /\b(twitter|tweet|tweets|\bx\b)\b/.test(t)
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

  // "my twitter feed" / "show my tweets" / "twitter feed" → default SpaceX
  if (
    /\bmy\b/.test(t) &&
    /\b(twitter|tweet|tweets|\bx\b|feed|timeline)\b/.test(t)
  ) {
    return { type: "open_twitter" };
  }
  if (
    /^(twitter|x)\s+(feed|timeline|tweets)\.?$/.test(t) ||
    /^(the\s+)?(twitter|x)\s+feed\.?$/.test(t)
  ) {
    return { type: "open_twitter" };
  }

  const at = t.match(
    /(?:(?:open|show|search|find|go to|pull up|get|load)\s+)?@([a-z0-9_]{1,15})\b/,
  );
  if (at) return { type: "open_account", username: at[1] };

  // "elon's twitter", "elon musk's feed", "show elon's tweets"
  const possessive = t.match(
    /\b(elon(?:\s+musk)?|musk|spacex|space\s*x|nasa|tesla|[a-z0-9_]{2,15})'s\s+(?:twitter|\bx\b|tweets?|feed|timeline)\b/,
  );
  if (possessive) {
    const user = resolveAccount(possessive[1]);
    if (user) return { type: "open_account", username: user };
  }

  // "elon twitter", "open elon musk twitter", "twitter for elon"
  const forPerson = t.match(
    /(?:twitter|\bx\b|tweets?|feed|timeline)\s+(?:for|of|from)\s+(elon(?:\s+musk)?|musk|spacex|nasa|tesla|[a-z0-9_]{2,15})\b/,
  );
  if (forPerson) {
    const user = resolveAccount(forPerson[1]);
    if (user) return { type: "open_account", username: user };
  }

  const personFirst = t.match(
    /(?:(?:open|show|pull up|go to|get|load|find)\s+)?(elon(?:\s+musk)?|musk|spacex|space\s*x|nasa|tesla)'?s?\s+(?:twitter|\bx\b|tweets?|feed|timeline)\b/,
  );
  if (personFirst) {
    const user = resolveAccount(personFirst[1]);
    if (user) return { type: "open_account", username: user };
  }

  // Bare aliases when twitter/x/feed context present: "elon feed", "show musk"
  const aliasBare = t.match(
    /\b(elon(?:\s+musk)?|musk)\b.*\b(twitter|\bx\b|tweets?|feed|timeline)\b|\b(twitter|\bx\b|tweets?|feed|timeline)\b.*\b(elon(?:\s+musk)?|musk)\b/,
  );
  if (aliasBare) {
    const name = aliasBare[1] || aliasBare[4];
    const user = resolveAccount(name);
    if (user) return { type: "open_account", username: user };
  }

  const account = t.match(
    /(?:(?:open|show|search|find|go to|pull up)\s+)(?:twitter\s+(?:account\s+|user\s+|for\s+)?|x\s+(?:account\s+|user\s+|for\s+)?)([a-z0-9_]{1,15})\b/,
  );
  if (account) {
    const user = resolveAccount(account[1]);
    if (user) return { type: "open_account", username: user };
  }

  const search = t.match(
    /(?:search|find)\s+(?:on\s+)?(?:twitter|x)\s+(?:for\s+)?(.+)$/,
  );
  if (search) {
    const q = search[1].replace(/^@/, "").trim();
    if (q) {
      const user = resolveAccount(q);
      if (user && /^[a-zA-Z0-9_]{1,15}$/.test(user) && !/\s/.test(q.replace(/^@/, ""))) {
        // "search twitter for elonmusk" or single-token handle
        if (/^[a-z0-9_]{1,15}$/.test(q) || ACCOUNT_ALIASES[q.toLowerCase()]) {
          return { type: "open_account", username: user };
        }
      }
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
