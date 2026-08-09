import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let WATCH_MIN_QUIET_MS;
let WATCH_PROACTIVE_COOLDOWN_MS;
let WATCH_PENDING_TTL_MS;
let WATCH_MAX_FINDING_AGE_MS;
let WATCH_MAX_PLAYHEAD_DRIFT_S;
let decideProactiveSpeech;
let dedupeKey;
let isEchoSafeCallout;
let offerPending;
let parseWatchAction;
let takePending;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    WATCH_MIN_QUIET_MS,
    WATCH_PROACTIVE_COOLDOWN_MS,
    WATCH_PENDING_TTL_MS,
    WATCH_MAX_FINDING_AGE_MS,
    WATCH_MAX_PLAYHEAD_DRIFT_S,
    decideProactiveSpeech,
    dedupeKey,
    isEchoSafeCallout,
    offerPending,
    parseWatchAction,
    takePending,
  } = await vite.ssrLoadModule("/src/lib/watchSpeech.ts"));
});

after(async () => {
  await vite?.close();
});

const finding = (over = {}) => ({
  id: "pc-fail-esd-handling",
  videoId: "pov-pc-build-fail",
  spoken: "That board is resting on fabric.",
  attention: null,
  frame: null,
  playheadAtDetection: 4,
  detectedAt: 10_000,
  seekEpoch: 3,
  relatedToTask: false,
  ...over,
});

const gate = (over = {}) => ({
  now: 11_000,
  watchEnabled: true,
  live: false,
  flipMode: false,
  tabHidden: false,
  videoPaused: false,
  videoSeeking: false,
  videoId: "pov-pc-build-fail",
  playhead: 5,
  seekEpoch: 3,
  phase: "idle",
  turnInFlight: false,
  scanning: false,
  detecting: false,
  highlightHold: false,
  ghostActive: false,
  lastActivityAt: null,
  lastProactiveEndedAt: null,
  announced: new Set(),
  ...over,
});

test("speaks when idle, quiet, fresh, and unannounced", () => {
  assert.deepEqual(decideProactiveSpeech(finding(), gate()), {
    action: "speak",
  });
});

test("hard-drops for mode, hidden tab, error, paused, and seeking", () => {
  const cases = [
    [gate({ watchEnabled: false }), "disabled"],
    [gate({ live: true }), "mode"],
    [gate({ flipMode: true }), "mode"],
    [gate({ tabHidden: true }), "hidden"],
    [gate({ phase: "error" }), "error"],
    [gate({ videoPaused: true }), "paused"],
    [gate({ videoSeeking: true }), "seeking"],
  ];
  for (const [g, reason] of cases) {
    assert.deepEqual(decideProactiveSpeech(finding(), g), {
      action: "drop",
      reason,
    });
  }
});

test("drops findings from another video, seek epoch, or loop iteration", () => {
  assert.equal(
    decideProactiveSpeech(finding({ videoId: "ikea" }), gate()).reason,
    "wrong_video",
  );
  assert.equal(
    decideProactiveSpeech(finding({ seekEpoch: 2 }), gate()).reason,
    "seeked",
  );
  // Negative playhead drift means the clip looped or was rewound.
  assert.equal(
    decideProactiveSpeech(finding({ playheadAtDetection: 9 }), gate()).reason,
    "looped",
  );
});

test("staleness boundaries are exact: 6s drift, 8s age", () => {
  const atDriftLimit = gate({ playhead: 4 + WATCH_MAX_PLAYHEAD_DRIFT_S });
  assert.equal(decideProactiveSpeech(finding(), atDriftLimit).action, "speak");
  const pastDrift = gate({ playhead: 4 + WATCH_MAX_PLAYHEAD_DRIFT_S + 0.01 });
  assert.equal(decideProactiveSpeech(finding(), pastDrift).reason, "stale");

  const atAgeLimit = gate({ now: 10_000 + WATCH_MAX_FINDING_AGE_MS });
  assert.equal(decideProactiveSpeech(finding(), atAgeLimit).action, "speak");
  const pastAge = gate({ now: 10_000 + WATCH_MAX_FINDING_AGE_MS + 1 });
  assert.equal(decideProactiveSpeech(finding(), pastAge).reason, "stale");
});

test("an announced key never speaks again; the reset clears it", () => {
  const announced = new Set([dedupeKey(finding())]);
  assert.equal(
    decideProactiveSpeech(finding(), gate({ announced })).reason,
    "announced",
  );
  announced.clear();
  assert.equal(
    decideProactiveSpeech(finding(), gate({ announced })).action,
    "speak",
  );
});

test("cooldown blocks a second callout until 10s after the last one ended", () => {
  const g = gate({
    lastProactiveEndedAt: 11_000 - WATCH_PROACTIVE_COOLDOWN_MS + 1,
  });
  assert.equal(decideProactiveSpeech(finding(), g).reason, "cooldown");
  const clear = gate({
    lastProactiveEndedAt: 11_000 - WATCH_PROACTIVE_COOLDOWN_MS,
  });
  assert.equal(decideProactiveSpeech(finding(), clear).action, "speak");
});

test("a user-requested visual holding the stage drops the callout", () => {
  for (const key of ["highlightHold", "scanning", "detecting", "ghostActive"]) {
    assert.equal(
      decideProactiveSpeech(finding(), gate({ [key]: true })).reason,
      "stage_held",
    );
  }
});

test("user or Grok activity defers instead of dropping", () => {
  assert.deepEqual(decideProactiveSpeech(finding(), gate({ phase: "listening" })), {
    action: "defer",
    reason: "user_capturing",
  });
  for (const over of [
    { phase: "thinking" },
    { phase: "speaking" },
    { turnInFlight: true },
  ]) {
    assert.deepEqual(decideProactiveSpeech(finding(), gate(over)), {
      action: "defer",
      reason: "grok_busy",
    });
  }
  // Quiet window right after a turn ended.
  const justFinished = gate({ lastActivityAt: 11_000 - WATCH_MIN_QUIET_MS + 1 });
  assert.equal(decideProactiveSpeech(finding(), justFinished).action, "defer");
  const quietEnough = gate({ lastActivityAt: 11_000 - WATCH_MIN_QUIET_MS });
  assert.equal(decideProactiveSpeech(finding(), quietEnough).action, "speak");
});

test("a finding that is both stale and busy drops — staleness wins", () => {
  const g = gate({
    phase: "speaking",
    now: 10_000 + WATCH_MAX_FINDING_AGE_MS + 1,
  });
  assert.deepEqual(decideProactiveSpeech(finding(), g), {
    action: "drop",
    reason: "stale",
  });
});

test("pending slot holds one finding, newest wins, TTL from detection", () => {
  const first = finding({ id: "a", detectedAt: 10_000 });
  const second = finding({ id: "b", detectedAt: 10_500 });
  let slot = offerPending(null, first);
  slot = offerPending(slot, second);
  assert.equal(takePending(slot, 11_000)?.id, "b");
  assert.equal(slot.expiresAt, 10_500 + WATCH_PENDING_TTL_MS);
  // TTL anchors to detection time — re-offers never extend it.
  assert.equal(takePending(slot, 10_500 + WATCH_PENDING_TTL_MS), null);
  assert.equal(takePending(null, 0), null);
});

test("echo lint rejects command words and the wake phrase", () => {
  assert.equal(isEchoSafeCallout("That RAM latch is still up."), true);
  assert.equal(isEchoSafeCallout("The board is resting on fabric."), true);
  for (const bad of [
    "Stop, that board is on fabric.",
    "Show the latch first.",
    "Watch the blade near your fingers.",
    "Hey grok, the latch is open.",
    "Grok noticed the latch is open.",
    "Check where the cable goes.",
    "",
  ]) {
    assert.equal(isEchoSafeCallout(bad), false, bad);
  }
});

test("toggle grammar: on, off, reset — and no collisions", () => {
  for (const on of [
    "watch my work",
    "Watch the build.",
    "keep an eye on me",
    "verification on",
    "start watching",
  ]) {
    assert.equal(parseWatchAction(on), "watch_on", on);
  }
  for (const off of [
    "stop watching",
    "Stop watching me",
    "verification off",
    "stay quiet",
    "eyes off",
  ]) {
    assert.equal(parseWatchAction(off), "watch_off", off);
  }
  for (const reset of ["fresh eyes", "reset your watch", "call it out again"]) {
    assert.equal(parseWatchAction(reset), "watch_reset", reset);
  }
  // Must not shadow YouTube, verify, or ordinary questions.
  for (const miss of [
    "watch this video",
    "watch the starship launch",
    "check my work",
    "how do I check the RAM",
    "watch out for the knife",
    "",
  ]) {
    assert.equal(parseWatchAction(miss), null, miss);
  }
});
