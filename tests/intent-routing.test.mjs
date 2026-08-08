import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let needsVideoContext;
let needsWebSearch;
let wantsMotionGuidance;
let normalizeGuidance;
let parseToolsAction;
let wantsHighlight;
let findCatalogChoreography;
let catalogMotionCues;
let resolveInstructionRoute;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ needsVideoContext, needsWebSearch } = await vite.ssrLoadModule(
    "/src/hooks/useVoice.ts",
  ));
  ({ wantsMotionGuidance, normalizeGuidance } = await vite.ssrLoadModule(
    "/src/lib/guidance.ts",
  ));
  ({ parseToolsAction } = await vite.ssrLoadModule("/src/lib/tools.ts"));
  ({ wantsHighlight } = await vite.ssrLoadModule("/src/lib/highlights.ts"));
  ({ resolveInstructionRoute } = await vite.ssrLoadModule(
    "/src/lib/instructionRouting.ts",
  ));
  ({
    findCatalogChoreography,
    CATALOG_MOTION_CUES: catalogMotionCues,
  } = await vite.ssrLoadModule("/src/lib/choreography.ts"));
});

after(async () => {
  await vite?.close();
});

test("hands-on instructions attach the current frame", () => {
  for (const message of [
    "How do I bend it?",
    "How should I bend this?",
    "How to bend it without kinking it",
    "How can I connect these?",
  ]) {
    assert.equal(needsVideoContext(message), true, message);
  }
});

test("visible result checks attach the current frame", () => {
  for (const message of [
    "Did I bend it right?",
    "Have I bent this enough?",
    "Is this bent correctly?",
    "Does that look properly seated?",
  ]) {
    assert.equal(needsVideoContext(message), true, message);
  }
});

test("general how-to questions remain text-only", () => {
  for (const message of [
    "How do I bend copper pipe?",
    "How does annealing work?",
    "Did I tell you about copper?",
    "Is copper safe for drinking water?",
  ]) {
    assert.equal(needsVideoContext(message), false, message);
  }
});

test("fresh-fact questions route to web search", () => {
  for (const message of [
    "Search the web for RTX 5090 stock",
    "Look that up for me",
    "Google the torque spec",
    "What's the latest price on this CPU?",
    "What's the weather like?",
    "Who won the game last night?",
    "Any recent news on DDR6?",
  ]) {
    assert.equal(needsWebSearch(message), true, message);
  }
});

test("screen and how-to questions stay off the web path", () => {
  for (const message of [
    "What's happening right now?",
    "How do I bend this?",
    "What is this on screen?",
    "Highlight the salmon",
    "Is this seated correctly?",
    "How does annealing work?",
  ]) {
    assert.equal(needsWebSearch(message), false, message);
  }
});

test("explicit visible how-to requests trigger motion guidance", () => {
  for (const message of [
    "How do I bend it?",
    "Show me how to turn this",
    "Which way should I pull it?",
    "What motion should I use here?",
  ]) {
    assert.equal(wantsMotionGuidance(message), true, message);
  }
  for (const message of [
    "How do I bend copper pipe?",
    "How does annealing work?",
    "What is the pipe made of?",
  ]) {
    assert.equal(wantsMotionGuidance(message), false, message);
  }
});

test("visible part-placement questions trigger motion guidance", () => {
  for (const message of [
    "Where to build the leg?",
    "Where do I put this leg?",
    "Where should I place the leg?",
    "Where does this leg go?",
  ]) {
    assert.equal(wantsMotionGuidance(message), true, message);
  }
  for (const message of [
    "Where is the leg?",
    "Where can I buy replacement legs?",
    "How do I build an IKEA desk?",
  ]) {
    assert.equal(wantsMotionGuidance(message), false, message);
  }
});

test("catalog motion wins over broad manual and ghost grammars", () => {
  for (const message of [
    "How do I bend it?",
    "Show me how to turn this",
    "Which way should I pull it?",
  ]) {
    const route = resolveInstructionRoute({
      primary: message,
      alternatives: [],
      manualOpen: true,
      toolsOpen: false,
      videoId: "pov-copper-plumbing",
      currentTime: 1,
    });
    assert.equal(route?.kind, "catalog_motion", message);
    assert.equal(route?.cue.id, "plumbing-bend-copper", message);
  }
});

test("IKEA leg placement resolves to the authored scene at speech onset", () => {
  for (const message of [
    "Where to build the leg?",
    "Where do I put this leg?",
    "Where should I place the leg?",
    "Where does this leg go?",
  ]) {
    const route = resolveInstructionRoute({
      primary: message,
      alternatives: [],
      manualOpen: true,
      toolsOpen: false,
      videoId: "ikea",
      currentTime: 6,
    });
    assert.equal(route?.kind, "catalog_motion", message);
    assert.equal(route?.cue.id, "ikea-place-leg-frame", message);
  }
});

test("IKEA placement stays object- and scene-grounded", () => {
  assert.equal(
    findCatalogChoreography("ikea", 6, "Where do the screws go?"),
    null,
  );
  assert.equal(
    findCatalogChoreography("ikea", 14.999, "Where do I put the leg?")?.id,
    "ikea-place-leg-frame",
  );
  assert.equal(
    findCatalogChoreography("ikea", 15, "Where do I put the leg?")?.id,
    "ikea-seat-side-rail",
  );

  const general = resolveInstructionRoute({
    primary: "How do I build an IKEA desk?",
    alternatives: [],
    manualOpen: false,
    videoId: "ikea",
    currentTime: 6,
  });
  assert.equal(general?.kind, "manual");
  assert.equal(general?.action.type, "open_manual");
});

test("unknown visible motion avoids accidental manual opening", () => {
  const route = resolveInstructionRoute({
    primary: "How do I bend it?",
    alternatives: [],
    manualOpen: false,
    toolsOpen: false,
    videoId: "unknown-video",
    currentTime: 1,
  });
  assert.equal(route?.kind, "motion");
});

test("a correct speech alternative can recover the catalog motion route", () => {
  const route = resolveInstructionRoute({
    primary: "How do I bend",
    alternatives: ["How do I bend it?"],
    manualOpen: false,
    videoId: "pov-copper-plumbing",
    currentTime: 1,
  });
  assert.equal(route?.kind, "catalog_motion");
  assert.equal(route?.cue.id, "plumbing-bend-copper");
});

test("general procedures and existing manual controls stay manual", () => {
  const open = resolveInstructionRoute({
    primary: "How do I bend copper pipe?",
    alternatives: [],
    manualOpen: false,
    videoId: "pov-copper-plumbing",
    currentTime: 1,
  });
  assert.equal(open?.kind, "manual");
  assert.equal(open?.action.type, "open_manual");

  const next = resolveInstructionRoute({
    primary: "Next step",
    alternatives: [],
    manualOpen: true,
    videoId: "pov-copper-plumbing",
    currentTime: 1,
  });
  assert.equal(next?.kind, "manual");
  assert.equal(next?.action.type, "next_step");
});

test("toolkit questions open the tools dropdown", () => {
  for (const message of [
    "What tools do I need for this job?",
    "Which tools should I use?",
    "What equipment do I need?",
    "What will I need for this?",
    "Am I missing anything?",
    "Do I have everything I need?",
    "Show me the tool list",
  ]) {
    assert.deepEqual(
      parseToolsAction(message, false),
      { type: "open_tools" },
      message,
    );
  }
});

test("toolkit grammar leaves other intents alone", () => {
  for (const message of [
    "How do I bend it?",
    "Where is the torque wrench?",
    "What do I need to do next?",
    "Close the manual",
    "Highlight the tools",
  ]) {
    assert.equal(parseToolsAction(message, false), null, message);
  }
  // Toolkit asks must not leak into the highlight router either.
  for (const message of [
    "What tools do I need for this job?",
    "Am I missing anything?",
  ]) {
    assert.equal(wantsHighlight(message), false, message);
  }
});

test("closing the tools dropdown", () => {
  assert.deepEqual(parseToolsAction("Close the tool list", true), {
    type: "close_tools",
  });
  assert.deepEqual(parseToolsAction("put away the tools", true), {
    type: "close_tools",
  });
  assert.deepEqual(parseToolsAction("close it", true), {
    type: "close_tools",
  });
  assert.equal(parseToolsAction("close it", false), null);
});

test("motion geometry resolves only through sanitized tracked labels", () => {
  const labels = [
    { id: "pivot", text: "Pivot", kind: "box", x: 0.2, y: 0.3, w: 0.1, h: 0.1 },
    { id: "handle", text: "Handle", kind: "box", x: 0.5, y: 0.4, w: 0.1, h: 0.2 },
  ];
  const ready = normalizeGuidance(
    {
      status: "ready",
      note: "Pull around the former",
      labels: [],
      motion: {
        type: "arc",
        pivot: 0,
        moving: 1,
        direction: "clockwise",
        sweep: 90,
        label: "Pull steadily",
      },
    },
    labels,
  );
  assert.equal(ready.status, "ready");
  assert.equal(ready.motion?.pivotId, "pivot");
  assert.equal(ready.motion?.movingId, "handle");

  const ungrounded = normalizeGuidance(
    {
      status: "ready",
      note: "Guess a path",
      labels: [],
      motion: {
        type: "arc",
        pivot: 0,
        moving: 2,
        direction: "clockwise",
      },
    },
    labels,
  );
  assert.equal(ungrounded.status, "not_visible");
  assert.equal(ungrounded.motion, null);
});

test("known plumbing scene bypasses model geometry with a pipe silhouette", () => {
  const cue = findCatalogChoreography(
    "pov-copper-plumbing",
    2,
    "How do I bend this pipe?",
  );
  assert.equal(cue?.id, "plumbing-bend-copper");
  assert.equal(cue?.mode, "morph");
  assert.match(cue?.scene || "", /lever pipe bender/i);
  assert.ok(cue?.outline.length > 150);
  assert.ok(cue?.destination.length > 150);
  assert.notEqual(cue?.outline, cue?.destination);
});

test("authored choreography covers every catalog video and is documented", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../public/videos/manifest.json", import.meta.url), "utf8"),
  );
  const markdown = readFileSync(
    new URL("../public/videos/CHOREOGRAPHY.md", import.meta.url),
    "utf8",
  );
  const covered = new Set(catalogMotionCues.map((cue) => cue.videoId));

  for (const cue of catalogMotionCues) {
    assert.ok(
      cue.previewAt >= cue.start && cue.previewAt < cue.end,
      `${cue.id} preview is inside its scene window`,
    );
    assert.match(cue.outline, /^M\s/, `${cue.id} has an authored silhouette`);
    assert.match(cue.motionPath, /^M\s/, `${cue.id} has an authored motion rail`);
    if (cue.mode === "morph") {
      assert.ok(cue.destination, `${cue.id} has a destination silhouette`);
    }
  }

  for (const video of manifest) {
    assert.equal(covered.has(video.id), true, `${video.id} has an authored cue`);
    assert.equal(markdown.includes("## `" + video.id + "`"), true);
  }
  assert.equal(findCatalogChoreography("unknown-video", 2, "move this"), null);
});
