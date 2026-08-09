import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let vite;
let WATCH_WINDOWS;
let WATCH_WINDOW_GRACE_S;
let findWatchWindows;
let hasWatchWindows;
let nextWindowStart;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    WATCH_WINDOWS,
    WATCH_WINDOW_GRACE_S,
    findWatchWindows,
    hasWatchWindows,
    nextWindowStart,
  } = await vite.ssrLoadModule("/src/lib/watchWindows.ts"));
});

after(async () => {
  await vite?.close();
});

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "public", "videos", "manifest.json"), "utf8"),
);

test("every window points at a real clip and stays inside its duration", () => {
  const byId = new Map(manifest.map((v) => [v.id, v]));
  for (const w of WATCH_WINDOWS) {
    const clip = byId.get(w.videoId);
    assert.ok(clip, `unknown videoId ${w.videoId} (window ${w.id})`);
    assert.ok(w.start >= 0 && w.end > w.start, w.id);
    assert.ok(w.end <= clip.durationSeconds, `${w.id} ends past the clip`);
  }
});

test("windows carry judge context, never a verdict or scripted line", () => {
  const allowed = new Set([
    "id",
    "videoId",
    "start",
    "end",
    "concern",
    "watchFor",
    "region",
    "severity",
    "fireOn",
    "label",
  ]);
  const ids = new Set();
  for (const w of WATCH_WINDOWS) {
    for (const key of Object.keys(w)) {
      assert.ok(allowed.has(key), `${w.id} has forbidden field "${key}"`);
    }
    assert.ok(w.concern.length > 0, w.id);
    assert.ok(Array.isArray(w.watchFor) && w.watchFor.length > 0, w.id);
    assert.ok(["info", "warn", "danger"].includes(w.severity), w.id);
    if (w.label) {
      // The chip says what is being watched — never claims an outcome.
      assert.match(w.label, /^Watching: /, w.id);
    }
    assert.ok(!ids.has(w.id), `duplicate window id ${w.id}`);
    ids.add(w.id);
  }
});

test("the mirror doc documents every window", () => {
  const doc = fs.readFileSync(
    path.join(root, "public", "videos", "WATCH-WINDOWS.md"),
    "utf8",
  );
  for (const w of WATCH_WINDOWS) {
    assert.ok(doc.includes(w.id), `WATCH-WINDOWS.md is missing ${w.id}`);
  }
});

test("findWatchWindows is half-open and per-clip", () => {
  const hits = findWatchWindows("pov-pc-build-fail", 3);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "pc-fail-esd-handling");

  // end is exclusive; start is inclusive.
  assert.equal(findWatchWindows("pov-pc-build-fail", 5.5).length, 0);
  assert.equal(findWatchWindows("pov-pc-build-fail", 11.5)[0]?.id, "pc-fail-cable-prep");
  assert.equal(findWatchWindows("ikea", 3).length, 0);
});

test("hasWatchWindows and nextWindowStart guide the generic path", () => {
  assert.equal(hasWatchWindows("pov-pc-build-fail"), true);
  assert.equal(hasWatchWindows("tesla"), false);
  assert.equal(nextWindowStart("pov-pc-build-fail", 6), 11.5);
  assert.equal(nextWindowStart("pov-pc-build-fail", 12), null);
  assert.equal(nextWindowStart("tesla", 0), null);
  assert.ok(WATCH_WINDOW_GRACE_S > 0);
});

test("the demo hero clip is covered at its rehearsed moments", () => {
  // 0:01–0:03 motherboard on towel — the "Am I doing this right?" beat must
  // now also be reachable without the question.
  assert.equal(
    findWatchWindows("pov-pc-build-fail", 2)[0]?.severity,
    "danger",
  );
  // Correct-technique footage stays armed (honest silence beat).
  assert.equal(
    findWatchWindows("pov-pc-build-cpu-ram", 60)[0]?.id,
    "cpu-ram-cpu-seating",
  );
});
