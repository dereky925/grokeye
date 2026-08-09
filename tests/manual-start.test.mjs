import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let preferredManualStartIndex;
let applyManualAction;
let fetchManual;
let parseManualAction;
let ESPRESSO_PREP_MANUAL;
let ESPRESSO_MANUAL_START_INDEX;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    preferredManualStartIndex,
    applyManualAction,
    fetchManual,
    parseManualAction,
    ESPRESSO_PREP_MANUAL,
    ESPRESSO_MANUAL_START_INDEX,
  } = await vite.ssrLoadModule("/src/lib/manual.ts"));
});

after(async () => {
  await vite?.close();
});

test("espresso video gets authored manual open on dose-at-grinder step 2", async () => {
  const doc = await fetchManual({
    topic: "coffee instructions",
    videoId: "pov-espresso-tamp",
    videoTitle: "POV Espresso Bar",
  });
  assert.equal(doc.title, ESPRESSO_PREP_MANUAL.title);
  assert.equal(doc.steps[0].n, 1);
  assert.match(doc.steps[0].text, /warm/i);
  assert.equal(doc.steps[ESPRESSO_MANUAL_START_INDEX].n, 2);
  assert.match(
    doc.steps[ESPRESSO_MANUAL_START_INDEX].text,
    /portafilter.*grind|grind.*dose/i,
  );
  assert.equal(
    preferredManualStartIndex(doc, { videoId: "pov-espresso-tamp" }),
    1,
  );
  const opened = applyManualAction(null, { type: "open_manual" }, doc, {
    startIndex: preferredManualStartIndex(doc, {
      videoId: "pov-espresso-tamp",
    }),
  });
  assert.equal(opened.state.stepIndex, 1);
  assert.match(opened.speak, /starting at step 2/i);
  assert.match(opened.speak, /grind/i);
  assert.notEqual(opened.state.stepIndex, 0);
});

test("show me the coffee manual i forgot the next step opens the authored checklist", async () => {
  const action = parseManualAction(
    "show me the coffee manual i forgot the next step",
    false,
  );
  assert.equal(action?.type, "open_manual");
  assert.match(String(action?.topic || ""), /espresso|coffee/i);

  // Bare "show me the next step" still must not open a manual cold.
  assert.equal(
    parseManualAction("show me the next step", false)?.type ?? null,
    null,
  );

  const doc = await fetchManual({
    topic: action.topic,
    videoId: "pov-espresso-tamp",
  });
  assert.equal(doc.title, ESPRESSO_PREP_MANUAL.title);
});

test("non-coffee manuals still start at step 1", () => {
  const doc = {
    title: "Desk",
    topic: "desk",
    mode: "steps",
    source: { title: "x", url: "https://x.ai", siteName: "x" },
    steps: [
      { n: 1, text: "Open the box." },
      { n: 2, text: "Attach the legs." },
    ],
  };
  assert.equal(preferredManualStartIndex(doc, { videoId: "ikea" }), 0);
});
