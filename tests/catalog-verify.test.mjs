import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let vite;
let CATALOG_VERIFY_RUBRICS;
let getCatalogVerifyRubric;
let resolveCatalogVerifyLocal;
let parseVerifyAction;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    CATALOG_VERIFY_RUBRICS,
    getCatalogVerifyRubric,
    resolveCatalogVerifyLocal,
  } = await vite.ssrLoadModule("/src/lib/catalogVerify.ts"));
  ({ parseVerifyAction } = await vite.ssrLoadModule("/src/lib/verify.ts"));
});

after(async () => {
  await vite?.close();
});

test("did i do this right is a verify ask", () => {
  assert.equal(parseVerifyAction("did i do this right"), "verify");
  assert.equal(parseVerifyAction("Did I do this right?"), "verify");
  assert.equal(parseVerifyAction("did i miss a step"), "verify");
  assert.equal(parseVerifyAction("Did I miss a step?"), "verify");
});

test("wait did i miss a step is a verify ask", () => {
  assert.equal(parseVerifyAction("wait did i miss a step"), "verify");
  assert.equal(parseVerifyAction("Wait, did I miss a step?"), "verify");
});

test("espresso timeline catches skip-tamp without vision", () => {
  const miss = resolveCatalogVerifyLocal("pov-espresso-tamp", 14);
  assert.ok(miss);
  assert.equal(miss.verdict, "not_complete");
  assert.match(miss.spoken, /tamp/i);

  const mid = resolveCatalogVerifyLocal("pov-espresso-tamp", 30);
  assert.ok(mid);
  assert.equal(mid.verdict, "not_complete");

  const done = resolveCatalogVerifyLocal("pov-espresso-tamp", 36);
  assert.ok(done);
  assert.equal(done.verdict, "complete");

  assert.equal(resolveCatalogVerifyLocal("pov-espresso-tamp", 2), null);
});

test("espresso rubric mirrors the WATCH-WINDOWS process checklist", () => {
  const rubric = getCatalogVerifyRubric("pov-espresso-tamp");
  assert.ok(rubric);
  assert.equal(rubric.steps.length, 3);
  assert.match(rubric.steps[0], /dose/i);
  assert.match(rubric.steps[1], /tamp/i);
  assert.match(rubric.steps[2], /lock/i);
  assert.ok(rubric.timeline?.length);

  const doc = fs.readFileSync(
    path.join(root, "public", "videos", "WATCH-WINDOWS.md"),
    "utf8",
  );
  assert.match(doc, /### `pov-espresso-tamp`/);
  assert.match(doc, /text\/timeline only|timeline only/i);
  for (const step of rubric.steps) {
    assert.ok(doc.includes(step), `doc missing step: ${step}`);
  }
});

test("every catalog verify rubric points at a real manifest clip", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, "public", "videos", "manifest.json"),
      "utf8",
    ),
  );
  const ids = new Set(manifest.map((v) => v.id));
  for (const rubric of CATALOG_VERIFY_RUBRICS) {
    assert.ok(ids.has(rubric.videoId), rubric.videoId);
    assert.ok(rubric.goal.length > 0, rubric.videoId);
    assert.ok(rubric.steps.length >= 2, rubric.videoId);
  }
});
