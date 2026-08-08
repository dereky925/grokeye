import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let extractLocateTarget;
let echoMatchesTarget;
let filterLabelsByEcho;
let normalizeLabels;
let tightenBox;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    extractLocateTarget,
    echoMatchesTarget,
    filterLabelsByEcho,
    normalizeLabels,
  } = await vite.ssrLoadModule("/src/lib/highlights.ts"));
  ({ tightenBox } = await vite.ssrLoadModule("/src/lib/tighten.ts"));
});

after(async () => {
  await vite?.close();
});

test("locate target: rehearsal phrasings extract the noun phrase", () => {
  const cases = [
    ["Show me the fan cables.", "the fan cables"],
    ["Where's the salmon?", "the salmon"],
    ["Where is the rice", "the rice"],
    ["Hey Grok, can you show me where the fan cables are?", "the fan cables"],
    ["Tell me where the rice is", "the rice"],
    ["Where does the power cable go?", "the power cable"],
    ["Where do the fan cables plug in?", "the fan cables"],
    ["Highlight the GPU", "the gpu"],
    ["Point at the radiator please", "the radiator"],
    ["Find the allen key for me", "the allen key"],
    ["Where would the RAM stick be?", "the ram stick"],
    ["Which one is the allen key?", "the allen key"],
  ];
  for (const [utterance, expected] of cases) {
    assert.equal(extractLocateTarget(utterance), expected, utterance);
  }
});

test("locate target: deictic or unmatched asks fall back to null", () => {
  for (const utterance of [
    "What is this thing I'm holding?",
    "Where does this connect?",
    "Where is it?",
    "Am I doing this right?",
    "Show me where",
  ]) {
    assert.equal(extractLocateTarget(utterance), null, utterance);
  }
});

test("echo match: same object passes, different object fails", () => {
  assert.equal(echoMatchesTarget("salmon", "the salmon"), true);
  assert.equal(echoMatchesTarget("fan cables", "the fan cable"), true);
  assert.equal(echoMatchesTarget("cable", "the fan cables"), true);
  assert.equal(echoMatchesTarget("hand", "the salmon"), false);
  assert.equal(echoMatchesTarget("cutting board", "the tuna can"), false);
  // No comparable words on either side → pass (never over-drop).
  assert.equal(echoMatchesTarget("", "the salmon"), true);
});

test("echo filter drops off-target labels, keeps echoless ones", () => {
  const labels = [
    { text: "salmon", object: "salmon", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    { text: "hand", object: "hand", x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    { text: "mystery", x: 0.3, y: 0.3, w: 0.1, h: 0.1 },
  ];
  const kept = filterLabelsByEcho(labels, "the salmon");
  assert.deepEqual(
    kept.map((l) => l.text),
    ["salmon", "mystery"],
  );
  // Without a target nothing is dropped.
  assert.equal(filterLabelsByEcho(labels, null).length, 3);
});

test("normalizeLabels drops near-frame-sized boxes but keeps zones", () => {
  const labels = normalizeLabels([
    { text: "everything", kind: "box", x: 0, y: 0, w: 0.95, h: 0.9 },
    { text: "work area", kind: "zone", x: 0, y: 0, w: 0.95, h: 0.9 },
    { text: "gpu", kind: "box", x: 0.4, y: 0.4, w: 0.2, h: 0.15 },
  ]);
  assert.deepEqual(
    labels.map((l) => l.text),
    ["work area", "gpu"],
  );
});

/** Synthetic edge-energy field: zero everywhere except a bright rectangle. */
function energyField(gw, gh, rect) {
  const f = new Float32Array(gw * gh);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      f[y * gw + x] = 10;
    }
  }
  return f;
}

test("tightenBox shrinks a loose box onto the salient rectangle", () => {
  const gw = 320;
  const gh = 180;
  // Object occupies px (140..180, 70..100); the model box is ~3x too big.
  const edges = energyField(gw, gh, { x: 140, y: 70, w: 40, h: 30 });
  const loose = { x: 80 / gw, y: 30 / gh, w: 160 / gw, h: 110 / gh };
  const tight = tightenBox(edges, gw, gh, loose);

  assert.ok(tight.w < loose.w, "width shrank");
  assert.ok(tight.h < loose.h, "height shrank");
  // Caps: never below 40% of the original span.
  assert.ok(tight.w >= loose.w * 0.4 - 1e-6, "width floor respected");
  assert.ok(tight.h >= loose.h * 0.4 - 1e-6, "height floor respected");
  // The object stays inside the tightened box.
  assert.ok(tight.x * gw <= 141 && (tight.x + tight.w) * gw >= 179);
  assert.ok(tight.y * gh <= 71 && (tight.y + tight.h) * gh >= 99);
});

test("tightenBox center shift is capped for off-center content", () => {
  const gw = 320;
  const gh = 180;
  // Salient content hugs the far right edge of a wide box.
  const edges = energyField(gw, gh, { x: 190, y: 80, w: 20, h: 20 });
  const loose = { x: 40 / gw, y: 40 / gh, w: 180 / gw, h: 100 / gh };
  const tight = tightenBox(edges, gw, gh, loose);
  const origCx = loose.x + loose.w / 2;
  const tightCx = tight.x + tight.w / 2;
  assert.ok(
    Math.abs(tightCx - origCx) <= loose.w * 0.25 + 1e-6,
    "center shift capped at 25% of original width",
  );
});

test("tightenBox returns the box unchanged when there is no signal", () => {
  const gw = 320;
  const gh = 180;
  const edges = new Float32Array(gw * gh);
  const box = { x: 0.3, y: 0.3, w: 0.3, h: 0.3 };
  assert.deepEqual(tightenBox(edges, gw, gh, box), box);
});
