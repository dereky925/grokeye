import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let selectContextFrames;
let lightweightOptions;
let wantsRecentVisualHistory;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ selectContextFrames, wantsRecentVisualHistory } = await vite.ssrLoadModule(
    "/src/lib/frameMemory.ts",
  ));
  ({ LIGHTWEIGHT_FRAME_BUFFER_OPTIONS: lightweightOptions } =
    await vite.ssrLoadModule("/src/hooks/useFrameBuffer.ts"));
});

after(async () => {
  await vite?.close();
});

function frame(mediaTime, motion, url = `frame-${mediaTime}`, t = mediaTime * 1000) {
  return { url, t, mediaTime, motion };
}

test("lightweight frame memory is explicitly configurable as 1 fps for 10 seconds", () => {
  assert.deepEqual(lightweightOptions, { fps: 1, seconds: 10 });
});

test("only retrospective questions opt into buffered visual history", () => {
  for (const message of [
    "What just happened?",
    "What did I do before?",
    "How did I place it?",
    "Show me what happened a moment ago",
  ]) {
    assert.equal(wantsRecentVisualHistory(message), true, message);
  }
  for (const message of [
    "Where do I put it?",
    "Where to put the CPU?",
    "How do I bend this?",
    "What is on screen?",
  ]) {
    assert.equal(wantsRecentVisualHistory(message), false, message);
  }
});

test("verification asks opt into buffered visual history", () => {
  for (const message of [
    "Did she do that right?",
    "Am I doing this right?",
    "What did she do wrong?",
    "Did I make a mistake?",
    "Did she mess up?",
    "Has she missed a step?",
  ]) {
    assert.equal(wantsRecentVisualHistory(message), true, message);
  }
  for (const message of [
    "Is this the right tool?",
    "Where does this go?",
    "Did I tell you about copper?",
  ]) {
    assert.equal(wantsRecentVisualHistory(message), false, message);
  }
});

test("context selection keeps lookback, motion peak, and pinned frame chronologically", () => {
  const pinned = frame(10, 0, "speech", 10_000);
  const selected = selectContextFrames(
    [
      frame(3, 4),
      frame(5, 30),
      frame(8.1, 6),
      frame(9.4, 8),
      frame(10.2, 99, "after-speech", 10_200),
    ],
    pinned,
  );

  assert.deepEqual(
    selected.map(({ mediaTime, url }) => ({ mediaTime, url })),
    [
      { mediaTime: 5, url: "frame-5" },
      { mediaTime: 8.1, url: "frame-8.1" },
      { mediaTime: 10, url: "speech" },
    ],
  );
});

test("context selection never leaks frames captured after speech onset", () => {
  const pinned = frame(20, 0, "speech", 20_000);
  const selected = selectContextFrames(
    [
      frame(18, 3, "before", 18_000),
      // Media time is earlier, but wall-clock capture happened after speech.
      frame(19, 100, "late-capture", 20_100),
      // Wall-clock is earlier, but media time is beyond the pinned playhead.
      frame(21, 100, "future-media", 19_000),
    ],
    pinned,
  );

  assert.deepEqual(
    selected.map((item) => item.url),
    ["before", "speech"],
  );
});

test("context selection deduplicates roles, media moments, and JPEG content", () => {
  const pinned = frame(10, 0, "same-jpeg", 10_000);
  const selected = selectContextFrames(
    [
      frame(7.9, 20, "peak"),
      frame(8, 1, "peak"),
      frame(8.0005, 99, "duplicate-time"),
      frame(9, 4, "same-jpeg"),
    ],
    pinned,
  );

  assert.ok(selected.length <= 3);
  assert.equal(new Set(selected.map((item) => item.url)).size, selected.length);
  assert.equal(selected.at(-1).url, "same-jpeg");
  assert.deepEqual(
    selected.map((item) => item.mediaTime),
    [...selected.map((item) => item.mediaTime)].sort((a, b) => a - b),
  );
});
