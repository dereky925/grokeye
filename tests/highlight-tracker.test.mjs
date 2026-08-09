import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";

let vite;
let createHighlightTracker;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ createHighlightTracker } = await vite.ssrLoadModule(
    "/src/lib/highlights.ts",
  ));
});

after(async () => {
  await vite?.close();
});

// TRACK_W is 320; a 320×240 video keeps the tracker's grid 1:1 with the
// synthetic frames, so box coordinates map straight back to pixels.
const W = 320;
const H = 240;
const SIZE = 40;

/**
 * Paint a patterned square. Texture matters: the tracker matches by normalized
 * cross-correlation, and a flat block has no variance to correlate against.
 *
 * The two patterns are photographic negatives of each other — a bright ring
 * around a dark core, and the reverse — so their correlation is strongly
 * negative rather than merely different. That is what makes "did reanchor
 * actually replace the template?" a question the tests can answer: a stale
 * template scores below MIN_SCORE against the other pattern and finds nothing.
 * Both are non-periodic, so a match localizes unambiguously under motion.
 */
function paint(data, x0, y0, pattern) {
  const outer = pattern === 0 ? 220 : 70;
  const inner = pattern === 0 ? 70 : 220;
  const lo = SIZE / 4;
  const hi = SIZE - SIZE / 4;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = x0 + x;
      const py = y0 + y;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const o = (py * W + px) * 4;
      const core = x >= lo && x < hi && y >= lo && y < hi;
      const v = core ? inner : outer;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
}

/** A frame is just the RGBA the stub canvas will hand back. */
function frame(blocks = []) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    data[o] = 40;
    data[o + 1] = 44;
    data[o + 2] = 48;
    data[o + 3] = 255;
  }
  for (const b of blocks) paint(data, b.x, b.y, b.pattern ?? 0);
  return { data };
}

/** Canvas stand-in that replays whatever frame was last "drawn" into it. */
function stubDocument() {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => {
      let current = null;
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (source) => {
            current = source;
          },
          getImageData: () => ({
            data: current ? current.data : new Uint8ClampedArray(W * H * 4),
          }),
        }),
      };
    },
  };
  return () => {
    globalThis.document = previous;
  };
}

const video = { videoWidth: W, videoHeight: H, paused: false };

const labelAt = (x, y) => ({
  id: "a",
  text: "block",
  kind: "box",
  x: x / W,
  y: y / H,
  w: SIZE / W,
  h: SIZE / H,
});

/** Tracked top-left in pixels. */
const px = (tracker) => {
  const b = tracker.boxes(true)[0];
  return { x: b.x * W, y: b.y * H };
};

let restore;
beforeEach(() => {
  restore?.();
  restore = stubDocument();
});
after(() => restore?.());

test("advance follows a moving object across frames", () => {
  const start = frame([{ x: 100, y: 100 }]);
  const tracker = createHighlightTracker(video, [labelAt(100, 100)], start);
  assert.ok(tracker);

  for (let i = 1; i <= 10; i++) {
    tracker.advance(frame([{ x: 100 + i * 4, y: 100 }]));
  }

  const { x, y } = px(tracker);
  assert.ok(Math.abs(x - 140) < 10, `x drifted to ${x}, expected ~140`);
  assert.ok(Math.abs(y - 100) < 10, `y drifted to ${y}, expected ~100`);
  tracker.dispose();
});

test("reanchor moves the box and re-templates onto the new object", () => {
  // Two distinct blocks; the tracker starts locked on the left one.
  const both = (leftX, rightX) =>
    frame([
      { x: leftX, y: 100, pattern: 0 },
      { x: rightX, y: 160, pattern: 1 },
    ]);

  const tracker = createHighlightTracker(
    video,
    [labelAt(100, 100)],
    both(100, 220),
  );
  assert.ok(tracker);
  tracker.advance(both(100, 220));
  assert.ok(Math.abs(px(tracker).x - 100) < 10);

  // Correct it onto the right-hand block.
  tracker.reanchor(both(100, 220), {
    a: { x: 220 / W, y: 160 / H, w: SIZE / W, h: SIZE / H },
  });
  const jumped = px(tracker);
  assert.ok(Math.abs(jumped.x - 220) < 2, `snapped to ${jumped.x}`);
  assert.ok(Math.abs(jumped.y - 160) < 2, `snapped to ${jumped.y}`);

  // Now move the right block only. Following it proves the templates were
  // replaced — a stale template would pull back toward the left block.
  for (let i = 1; i <= 8; i++) tracker.advance(both(100, 220 + i * 4));

  const after = px(tracker);
  assert.ok(Math.abs(after.x - 252) < 12, `x is ${after.x}, expected ~252`);
  assert.ok(Math.abs(after.y - 160) < 12, `y is ${after.y}, expected ~160`);
  tracker.dispose();
});

test("a lost target leaves boxes() but stays visible to boxes(true)", () => {
  const tracker = createHighlightTracker(
    video,
    [labelAt(100, 100)],
    frame([{ x: 100, y: 100 }]),
  );
  assert.ok(tracker);

  // The object leaves: nothing to match, so misses accumulate past MAX_MISSES.
  for (let i = 0; i < 45; i++) tracker.advance(frame([]));

  assert.equal(tracker.boxes().length, 0, "lost target should stop publishing");
  assert.equal(
    tracker.boxes(true).length,
    1,
    "re-anchoring needs to still see the lost target",
  );
  tracker.dispose();
});

test("reanchor resurrects a target the local search gave up on", () => {
  const tracker = createHighlightTracker(
    video,
    [labelAt(100, 100)],
    frame([{ x: 100, y: 100 }]),
  );
  assert.ok(tracker);
  for (let i = 0; i < 45; i++) tracker.advance(frame([]));
  assert.equal(tracker.boxes().length, 0);

  // The object comes back somewhere else and Grok says where.
  const back = frame([{ x: 40, y: 60 }]);
  tracker.reanchor(back, {
    a: { x: 40 / W, y: 60 / H, w: SIZE / W, h: SIZE / H },
  });

  assert.equal(tracker.boxes().length, 1, "should publish again after anchor");
  for (let i = 1; i <= 6; i++) tracker.advance(frame([{ x: 40 + i * 4, y: 60 }]));
  const { x } = px(tracker);
  assert.ok(Math.abs(x - 64) < 12, `x is ${x}, expected ~64`);
  tracker.dispose();
});

test("a paused video holds its boxes instead of stepping", () => {
  const tracker = createHighlightTracker(
    video,
    [labelAt(100, 100)],
    frame([{ x: 100, y: 100 }]),
  );
  assert.ok(tracker);
  const before = px(tracker);
  const held = tracker.update({ ...video, paused: true });
  assert.equal(held.length, 1);
  assert.equal(held[0].x * W, before.x);
  tracker.dispose();
});
