import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let WATCH_TUNING;
let computeRegionMotion;
let createBoundaryTracker;
let createWatchBudget;
let selectWatchFrames;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    WATCH_TUNING,
    computeRegionMotion,
    createBoundaryTracker,
    createWatchBudget,
    selectWatchFrames,
  } = await vite.ssrLoadModule("/src/lib/workWatch.ts"));
});

after(async () => {
  await vite?.close();
});

/** Drive a tracker with (action, global) pairs at 10 Hz, collecting events. */
function run(tracker, pairs, { startTMs = 0, startMedia = 0 } = {}) {
  const events = [];
  pairs.forEach(([action, global = action], i) => {
    const event = tracker.push({
      tMs: startTMs + i * 100,
      mediaTime: startMedia + i * 0.1,
      global,
      center: action,
      border: 0,
      action,
    });
    if (event) events.push(event);
  });
  return events;
}

const quiet = (n) => Array.from({ length: n }, () => [0.3, 0.5]);
const busy = (n, level = 8) => Array.from({ length: n }, () => [level, level]);

test("a clean action emits start, settling, then settled with its boundary", () => {
  const tracker = createBoundaryTracker();
  const events = run(tracker, [
    ...quiet(3),
    ...busy(12), // 1.2s of hand work
    ...quiet(10), // settles
  ]);

  assert.deepEqual(
    events.map((e) => e.type),
    ["action_start", "settling", "settled"],
  );
  const settled = events.at(-1);
  // Action began where the entry streak began (sample 3 → mediaTime 0.3).
  assert.ok(Math.abs(settled.actionStart - 0.3) < 0.11, String(settled.actionStart));
  assert.ok(settled.actionEnd > settled.actionStart);
  assert.equal(settled.peak, 8);
  // Settle confirmation takes settleMs after the settling sample.
  assert.equal(tracker.state, "idle");
});

test("motion resuming during the settle window voids the boundary", () => {
  const tracker = createBoundaryTracker();
  const events = run(tracker, [
    ...quiet(2),
    ...busy(10),
    ...quiet(3), // starts settling (300ms < settleMs)
    ...busy(6), // picks the part back up
    ...quiet(10), // now really done
  ]);

  assert.deepEqual(
    events.map((e) => e.type),
    ["action_start", "settling", "action_resumed", "settling", "settled"],
  );
});

test("a sub-400ms blip never reaches settling", () => {
  const tracker = createBoundaryTracker();
  const events = run(tracker, [
    ...quiet(2),
    ...busy(3), // 300ms — camera jitter
    ...quiet(12),
  ]);

  assert.deepEqual(
    events.map((e) => e.type),
    ["action_start"],
  );
  assert.equal(tracker.state, "idle");
});

test("a head pan (global motion, no center excess) is not an action", () => {
  const tracker = createBoundaryTracker();
  // Pan: every pixel moves, so center ≈ border and action stays ~0.
  const events = run(
    tracker,
    Array.from({ length: 20 }, () => [0.4, 25]),
  );
  assert.deepEqual(events, []);
});

test("during a pan, entry needs a much stronger local action score", () => {
  const tracker = createBoundaryTracker();
  const needed = WATCH_TUNING.enter * WATCH_TUNING.panEnterMult;
  // Qualifies when calm, but not while the camera is sweeping.
  const duringPan = run(
    tracker,
    Array.from({ length: 6 }, () => [WATCH_TUNING.enter + 0.5, WATCH_TUNING.panGuard + 5]),
  );
  assert.deepEqual(duringPan, []);

  tracker.reset();
  const strongDuringPan = run(
    tracker,
    Array.from({ length: 6 }, () => [needed + 0.5, WATCH_TUNING.panGuard + 5]),
  );
  assert.equal(strongDuringPan[0]?.type, "action_start");
});

test("a sample gap (pause, hidden tab) resets mid-action tracking", () => {
  const tracker = createBoundaryTracker();
  run(tracker, [...quiet(2), ...busy(6)]);
  assert.equal(tracker.state, "action");

  // 2s gap, then one quiet sample: the old action is gone, no settle fires.
  const event = tracker.push({
    tMs: 800 + 2000,
    mediaTime: 2.8,
    global: 0.5,
    center: 0.3,
    border: 0,
    action: 0.3,
  });
  assert.equal(event, null);
  assert.equal(tracker.state, "idle");
});

test("computeRegionMotion separates hand work from camera motion", () => {
  const w = 48;
  const h = 36;
  const prev = new Uint8ClampedArray(w * h).fill(100);

  // Hands: change only a lower-center patch.
  const hands = Uint8ClampedArray.from(prev);
  for (let y = 20; y < 32; y += 1) {
    for (let x = 16; x < 32; x += 1) hands[y * w + x] = 180;
  }
  const handScore = computeRegionMotion(hands, prev, w, h);
  assert.ok(handScore.action > 2, String(handScore.action));

  // Pan: every pixel shifts equally.
  const pan = new Uint8ClampedArray(w * h).fill(140);
  const panScore = computeRegionMotion(pan, prev, w, h);
  assert.ok(panScore.global > 30);
  assert.ok(panScore.action < 1, String(panScore.action));

  // No previous frame → all zeros, never a spurious boundary.
  assert.deepEqual(computeRegionMotion(hands, null, w, h), {
    global: 0,
    center: 0,
    border: 0,
    action: 0,
  });
});

test("budget enforces spacing and the per-loop cap, and resets on loop", () => {
  const budget = createWatchBudget();
  assert.equal(budget.canFire(0).ok, true);
  budget.spend(0);
  assert.equal(budget.canFire(WATCH_TUNING.checkIntervalMs - 1).ok, false);
  assert.equal(budget.canFire(WATCH_TUNING.checkIntervalMs - 1).reason, "interval");
  assert.equal(budget.canFire(WATCH_TUNING.checkIntervalMs).ok, true);

  for (let i = 1; i < WATCH_TUNING.maxChecksPerLoop; i += 1) {
    budget.spend(i * WATCH_TUNING.checkIntervalMs);
  }
  const t = WATCH_TUNING.maxChecksPerLoop * WATCH_TUNING.checkIntervalMs;
  assert.equal(budget.canFire(t).reason, "loop_cap");

  budget.resetLoop();
  assert.equal(budget.canFire(t).ok, true);
});

test("selectWatchFrames sends a dense run of the action, not three sparse frames", () => {
  const frames = Array.from({ length: 8 }, (_, i) => ({
    url: `data:f${i}`,
    t: i * 125,
    mediaTime: i * 0.5,
    motion: i === 4 ? 12 : 1,
  }));
  const strip = selectWatchFrames(
    frames,
    { actionStart: 1.6, peakTime: 2.0 },
    "data:fresh",
  );
  // One pre-action frame (index 3 at 1.5s), then every frame from the action
  // onward, ending on the freshly captured settled frame.
  assert.deepEqual(strip.frames, [
    "data:f3",
    "data:f4",
    "data:f5",
    "data:f6",
    "data:f7",
    "data:fresh",
  ]);
  // Exactly one leading frame is stale context, so the server can forbid
  // reading current state off it.
  assert.equal(strip.preCount, 1);
  assert.equal(strip.frames.at(-1), "data:fresh");
});

test("selectWatchFrames thins a long action but keeps the peak frame", () => {
  const frames = Array.from({ length: 40 }, (_, i) => ({
    url: `data:g${i}`,
    t: i * 100,
    mediaTime: i * 0.25,
    motion: i === 22 ? 30 : 1,
  }));
  const strip = selectWatchFrames(
    frames,
    { actionStart: 1.0, peakTime: 5.5 },
    "data:settled",
  );
  // Budgeted, not unbounded: 1 pre + <=9 action frames + the settled frame.
  assert.ok(strip.frames.length <= 11, `got ${strip.frames.length}`);
  assert.ok(strip.frames.length >= 6, `got ${strip.frames.length}`);
  assert.equal(strip.preCount, 1);
  // The strongest-motion frame survives the thinning.
  assert.ok(strip.frames.includes("data:g22"));
  // Chronological, deduped.
  assert.equal(new Set(strip.frames).size, strip.frames.length);
});

test("selectWatchFrames never labels a lone frame as stale context", () => {
  const one = [{ url: "data:only", t: 0, mediaTime: 0, motion: 0 }];
  const single = selectWatchFrames(one, { actionStart: 5, peakTime: 5 }, "data:only");
  assert.deepEqual(single.frames, ["data:only"]);
  // Nothing covers the action, so the one frame must still count as state.
  assert.equal(single.preCount, 0);

  const freshOnly = selectWatchFrames([], { actionStart: 0, peakTime: 0 }, "data:fresh");
  assert.deepEqual(freshOnly.frames, ["data:fresh"]);
  assert.equal(freshOnly.preCount, 0);

  const empty = selectWatchFrames([], { actionStart: 0, peakTime: 0 }, null);
  assert.deepEqual(empty.frames, []);
  assert.equal(empty.preCount, 0);
});
