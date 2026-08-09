import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let preferredManualStartIndex;
let applyManualAction;
let parseManualAction;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ preferredManualStartIndex, applyManualAction, parseManualAction } =
    await vite.ssrLoadModule("/src/lib/manual.ts"));
});

after(async () => {
  await vite?.close();
});

/** The steps the overlay shows are the clip's baked script, verbatim. */
function espressoDoc() {
  const script = JSON.parse(
    readFileSync(
      new URL("../server/scripts/pov-espresso-tamp.json", import.meta.url),
      "utf8",
    ),
  );
  return {
    title: script.title,
    topic: script.task,
    mode: "steps",
    source: script.source,
    steps: script.steps.map((s) => ({
      n: s.n,
      text: s.text,
      start: s.start,
      end: s.end,
    })),
  };
}

test("the steps window opens on the step containing the playhead", () => {
  const doc = espressoDoc();
  for (const step of doc.steps) {
    const mid = step.start + (step.end - step.start) / 2;
    assert.equal(
      preferredManualStartIndex(doc, { currentTime: mid }) + 1,
      step.n,
      `t=${mid}s should open step ${step.n}`,
    );
    // A boundary belongs to the step that starts there, not the one ending.
    assert.equal(
      preferredManualStartIndex(doc, { currentTime: step.start }) + 1,
      step.n,
      `t=${step.start}s (boundary) should open step ${step.n}`,
    );
  }

  // Past the end holds on the final step; no playhead opens at the top.
  assert.equal(
    preferredManualStartIndex(doc, { currentTime: 10_000 }),
    doc.steps.length - 1,
  );
  assert.equal(preferredManualStartIndex(doc, {}), 0);
});

test("opening the manual mid-clip lands on that step, silently", () => {
  const doc = espressoDoc();
  // 29s is inside "Tamp the grounds level and firm".
  const startIndex = preferredManualStartIndex(doc, { currentTime: 29 });
  const opened = applyManualAction(null, { type: "open_manual" }, doc, {
    startIndex,
  });
  assert.equal(opened.state.stepIndex, startIndex);
  assert.match(opened.state.doc.steps[startIndex].text, /tamp/i);
  assert.notEqual(opened.state.stepIndex, 0);
});

test("steps come from the clip, never a web manual", () => {
  const doc = espressoDoc();
  // The old build served a hardcoded checklist citing a machine vendor's site.
  assert.doesNotMatch(JSON.stringify(doc), /lamarzocco/i);
  assert.match(doc.source.siteName, /catalog/i);
  // Every step carries the bounds the correctness review numbers against.
  for (const step of doc.steps) {
    assert.equal(typeof step.start, "number");
    assert.equal(typeof step.end, "number");
  }
});

test("coffee manual phrasing still opens a manual", () => {
  const action = parseManualAction(
    "show me the coffee manual i forgot the next step",
    false,
  );
  assert.equal(action?.type, "open_manual");

  // Bare "show me the next step" still must not open a manual cold.
  assert.equal(
    parseManualAction("show me the next step", false)?.type ?? null,
    null,
  );
});

test("manuals without bounds still start at step 1", () => {
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
  assert.equal(preferredManualStartIndex(doc, { currentTime: 42 }), 0);
});
