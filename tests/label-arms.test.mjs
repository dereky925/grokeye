import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boxIou,
  collectLabelArms,
  fuseLabelResults,
} from "../server/labels.js";

const delay = (ms, value) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));
const failAfter = (ms) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error("arm failed")), ms));

const result = (labels, link = null, status = "clear") => ({
  labels,
  link,
  status,
});
const box = (x, y, w, h, extra = {}) => ({ text: "t", x, y, w, h, ...extra });

test("boxIou: identical boxes → 1, disjoint → 0", () => {
  const a = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
  assert.ok(Math.abs(boxIou(a, a) - 1) < 1e-9);
  assert.equal(boxIou(a, { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }), 0);
});

test("collectLabelArms: first valid result returns after the grace window", async () => {
  const t0 = performance.now();
  const results = await collectLabelArms(
    [delay(10, result([box(0.1, 0.1, 0.2, 0.2)])), delay(5000, result([]))],
    50,
  );
  const elapsed = performance.now() - t0;
  assert.equal(results.length, 1);
  assert.ok(elapsed < 1000, `waited ${elapsed}ms — grace window did not fire`);
});

test("collectLabelArms: two box-bearing results finish before the grace window", async () => {
  const results = await collectLabelArms(
    [
      delay(5, result([box(0.1, 0.1, 0.2, 0.2)])),
      delay(10, result([box(0.11, 0.1, 0.2, 0.2)])),
      delay(5000, result([])),
    ],
    2000,
  );
  assert.equal(results.length, 2);
});

test("collectLabelArms: a failed arm does not beat a later valid arm", async () => {
  const results = await collectLabelArms(
    [failAfter(5), delay(20, result([box(0.1, 0.1, 0.2, 0.2)]))],
    50,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].labels.length, 1);
});

test("collectLabelArms: all arms failing resolves to an empty array", async () => {
  const results = await collectLabelArms([failAfter(5), failAfter(10)], 50);
  assert.deepEqual(results, []);
});

test("fuseLabelResults: agreeing boxes are averaged", () => {
  const fused = fuseLabelResults(
    result([box(0.1, 0.1, 0.2, 0.2)]),
    result([box(0.14, 0.12, 0.22, 0.2)]),
  );
  assert.ok(Math.abs(fused.labels[0].x - 0.12) < 1e-9);
  assert.ok(Math.abs(fused.labels[0].y - 0.11) < 1e-9);
  assert.ok(Math.abs(fused.labels[0].w - 0.21) < 1e-9);
  assert.equal(fused.labels[0].h, 0.2);
  assert.equal(fused.labels[0].text, "t");
});

test("fuseLabelResults: disagreeing geometry keeps the first draw", () => {
  const first = result([box(0.1, 0.1, 0.2, 0.2)]);
  const fused = fuseLabelResults(first, result([box(0.7, 0.7, 0.2, 0.2)]));
  assert.deepEqual(fused.labels, first.labels);
});

test("fuseLabelResults: mismatched label counts or link-ness keep the first draw", () => {
  const first = result([box(0.1, 0.1, 0.2, 0.2)]);
  assert.deepEqual(
    fuseLabelResults(first, result([box(0.1, 0.1, 0.2, 0.2), box(0.5, 0.5, 0.2, 0.2)])),
    first,
  );
  assert.deepEqual(
    fuseLabelResults(
      first,
      result([box(0.1, 0.1, 0.2, 0.2)], { from: 0, to: 1 }),
    ),
    first,
  );
});

test("fuseLabelResults: kind mismatch keeps the first label; width/height aliases fuse", () => {
  const first = result([box(0.1, 0.1, 0.2, 0.2)]);
  const zoned = fuseLabelResults(
    first,
    result([box(0.1, 0.1, 0.2, 0.2, { kind: "zone" })]),
  );
  assert.deepEqual(zoned.labels, first.labels);

  const aliased = fuseLabelResults(
    first,
    result([{ text: "t", x: 0.1, y: 0.1, width: 0.2, height: 0.2 }]),
  );
  assert.equal(aliased.labels[0].x, 0.1);
  assert.equal(aliased.labels[0].w, 0.2);
});

test("fuseLabelResults: link answers fuse per index", () => {
  const fused = fuseLabelResults(
    result(
      [box(0.1, 0.1, 0.2, 0.2), box(0.6, 0.6, 0.2, 0.2)],
      { from: 0, to: 1 },
    ),
    result(
      [box(0.12, 0.1, 0.2, 0.2), box(0.62, 0.6, 0.2, 0.2)],
      { from: 0, to: 1 },
    ),
  );
  assert.equal(fused.labels[0].x, 0.11);
  assert.equal(fused.labels[1].x, 0.61);
  assert.deepEqual(fused.link, { from: 0, to: 1 });
});
