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

test("selectWatchFrames picks pre-action, peak, and the fresh settled frame", () => {
  const frames = Array.from({ length: 8 }, (_, i) => ({
    url: `data:f${i}`,
    t: i * 125,
    mediaTime: i * 0.5,
    motion: i === 4 ? 12 : 1,
  }));
  const picked = selectWatchFrames(
    frames,
    { actionStart: 1.6, peakTime: 2.0 },
    "data:fresh",
  );
  // Last frame before 1.6s is index 3 (1.5s); peak nearest 2.0s is index 4.
  assert.deepEqual(picked, ["data:f3", "data:f4", "data:fresh"]);
});

test("selectWatchFrames dedupes and tolerates an empty buffer", () => {
  const one = [{ url: "data:only", t: 0, mediaTime: 0, motion: 0 }];
  assert.deepEqual(
    selectWatchFrames(one, { actionStart: 5, peakTime: 5 }, "data:only"),
    ["data:only"],
  );
  assert.deepEqual(
    selectWatchFrames([], { actionStart: 0, peakTime: 0 }, "data:fresh"),
    ["data:fresh"],
  );
  assert.deepEqual(selectWatchFrames([], { actionStart: 0, peakTime: 0 }, null), []);
});
