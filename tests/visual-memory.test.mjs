import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let createVisualMemory;
let hasDeicticVisualReferent;
let hasExplicitVisualSubject;
let isVisualMemoryFresh;
let resolveVisualSubjectHint;
let updateVisualMemory;
let ttlMs;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    VISUAL_MEMORY_TTL_MS: ttlMs,
    createVisualMemory,
    hasDeicticVisualReferent,
    hasExplicitVisualSubject,
    isVisualMemoryFresh,
    resolveVisualSubjectHint,
    updateVisualMemory,
  } = await vite.ssrLoadModule("/src/lib/visualMemory.ts"));
});

after(async () => {
  await vite?.close();
});

const CPU_GROUNDING = {
  videoId: "pov-pc-build-cpu-ram",
  subject: "CPU",
  source: "catalog",
  cueId: "cpu-align-over-socket",
  videoTimeSeconds: 55,
};

test("creates a normalized ten-second grounded referent snapshot", () => {
  const memory = createVisualMemory(
    { ...CPU_GROUNDING, subject: "  Intel   CPU  " },
    1_000,
  );

  assert.deepEqual(memory, {
    videoId: "pov-pc-build-cpu-ram",
    subject: "Intel CPU",
    rememberedAtMs: 1_000,
    expiresAtMs: 1_000 + ttlMs,
    provenance: {
      source: "catalog",
      cueId: "cpu-align-over-socket",
      videoTimeSeconds: 55,
    },
  });
  assert.equal(ttlMs, 10_000);
  assert.equal(Object.isFrozen(memory), true);
  assert.equal(Object.isFrozen(memory.provenance), true);
});

test("updates from a new grounding and ignores invalid refreshes", () => {
  const cpu = createVisualMemory(CPU_GROUNDING, 2_000);
  const leg = updateVisualMemory(
    cpu,
    {
      videoId: "ikea",
      subject: "leg frame",
      source: "highlight",
      videoTimeSeconds: 6,
    },
    2_500,
  );
  assert.equal(leg.subject, "leg frame");
  assert.equal(leg.videoId, "ikea");
  assert.equal(leg.rememberedAtMs, 2_500);

  assert.equal(
    updateVisualMemory(leg, { ...CPU_GROUNDING, subject: "   " }, 3_000),
    leg,
  );
  assert.equal(updateVisualMemory(leg, null, 2_500 + ttlMs), null);
});

test("resolves only deictic-only questions in the same video", () => {
  const memory = createVisualMemory(CPU_GROUNDING, 5_000);
  for (const message of [
    "Where do I put it?",
    "Where should this go?",
    "Which way do I turn that?",
    "How do I lower it into the socket?",
  ]) {
    assert.equal(
      resolveVisualSubjectHint(memory, {
        message,
        videoId: CPU_GROUNDING.videoId,
        nowMs: 5_200,
      }),
      "CPU",
      message,
    );
  }

  assert.equal(
    resolveVisualSubjectHint(memory, {
      message: "Where do I put it?",
      videoId: "ikea",
      nowMs: 5_200,
    }),
    null,
  );
  assert.equal(
    resolveVisualSubjectHint(memory, {
      message: "Where is the CPU socket?",
      videoId: CPU_GROUNDING.videoId,
      nowMs: 5_200,
    }),
    null,
  );
});

test("an explicitly named subject overrides memory", () => {
  const memory = createVisualMemory(CPU_GROUNDING, 8_000);
  for (const message of [
    "Where do I put this leg?",
    "How do I install the RAM while holding it?",
    "Where do I put it—the leg?",
  ]) {
    assert.equal(hasExplicitVisualSubject(message), true, message);
    assert.equal(
      resolveVisualSubjectHint(memory, {
        message,
        videoId: CPU_GROUNDING.videoId,
        nowMs: 8_100,
      }),
      null,
      message,
    );
  }

  assert.equal(
    resolveVisualSubjectHint(memory, {
      message: "Where do I put it?",
      videoId: CPU_GROUNDING.videoId,
      nowMs: 8_100,
      explicitSubject: "RAM stick",
    }),
    null,
  );
});

test("expires at the TTL boundary and rejects backwards clocks", () => {
  const memory = createVisualMemory(CPU_GROUNDING, 10_000);
  assert.equal(isVisualMemoryFresh(memory, 10_000 + ttlMs - 1), true);
  assert.equal(isVisualMemoryFresh(memory, 10_000 + ttlMs), false);
  assert.equal(isVisualMemoryFresh(memory, 9_999), false);
  assert.equal(
    resolveVisualSubjectHint(memory, {
      message: "Where do I put it?",
      videoId: CPU_GROUNDING.videoId,
      nowMs: 10_000 + ttlMs,
    }),
    null,
  );
});

test("keeps old geometry out of memory and returns only a subject hint", () => {
  const memory = createVisualMemory(
    {
      ...CPU_GROUNDING,
      outline: "M 0 0 L 1 1",
      destination: "M 2 2 L 3 3",
      motionPath: "M 0 0 L 3 3",
      box: { x: 0, y: 0, w: 1, h: 1 },
    },
    12_000,
  );

  assert.equal("outline" in memory, false);
  assert.equal("destination" in memory, false);
  assert.equal("motionPath" in memory, false);
  assert.equal("box" in memory, false);
  assert.equal(
    resolveVisualSubjectHint(memory, {
      message: "Where do I put it?",
      videoId: CPU_GROUNDING.videoId,
      nowMs: 12_001,
    }),
    "CPU",
  );
});

test("deictic detection excludes contractions and named demonstratives", () => {
  assert.equal(hasDeicticVisualReferent("Where do I put it?"), true);
  assert.equal(hasDeicticVisualReferent("This goes where?"), true);
  assert.equal(hasDeicticVisualReferent("It's already installed"), false);
  assert.equal(hasDeicticVisualReferent("Where does the CPU go?"), false);
  assert.equal(hasExplicitVisualSubject("Where does this CPU go?"), true);
  assert.equal(hasExplicitVisualSubject("Where should this go?"), false);
});
