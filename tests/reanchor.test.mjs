import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let boxIou;
let createFrameRing;
let cropRectFor;
let mapCropBoxToFrame;
let reconcileBox;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    boxIou,
    createFrameRing,
    cropRectFor,
    mapCropBoxToFrame,
    reconcileBox,
  } = await vite.ssrLoadModule("/src/lib/reanchor.ts"));
});

after(async () => {
  await vite?.close();
});

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

test("crop centers on the box and grows it", () => {
  const crop = cropRectFor({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, 2);
  near(crop.w, 0.2);
  near(crop.h, 0.2);
  // Same center as the box it came from.
  near(crop.x + crop.w / 2, 0.45);
  near(crop.y + crop.h / 2, 0.45);
});

test("crop stays inside the frame at an edge", () => {
  const crop = cropRectFor({ x: 0.95, y: 0.0, w: 0.08, h: 0.08 }, 2);
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.w <= 1 + 1e-9);
  assert.ok(crop.y + crop.h <= 1 + 1e-9);
});

test("a box round-trips through its own crop", () => {
  const box = { x: 0.4, y: 0.4, w: 0.1, h: 0.1 };
  const crop = cropRectFor(box, 2);
  // Where the box sits within that crop.
  const inCrop = {
    x: (box.x - crop.x) / crop.w,
    y: (box.y - crop.y) / crop.h,
    w: box.w / crop.w,
    h: box.h / crop.h,
  };
  const back = mapCropBoxToFrame(crop, inCrop);
  near(back.x, box.x);
  near(back.y, box.y);
  near(back.w, box.w);
  near(back.h, box.h);
});

test("small drift eases toward the correction instead of snapping", () => {
  const current = { x: 0, y: 0, w: 0.2, h: 0.2 };
  const corrected = { x: 0.02, y: 0.02, w: 0.2, h: 0.2 };
  assert.ok(boxIou(current, corrected) >= 0.5);
  const out = reconcileBox(current, corrected);
  assert.equal(out.mode, "blend");
  // Moved toward the correction but nowhere near all the way.
  assert.ok(out.box.x > current.x && out.box.x < corrected.x);
});

test("a sliding box is pulled harder than a drifting one", () => {
  const current = { x: 0, y: 0, w: 0.2, h: 0.2 };
  const loose = { x: 0.07, y: 0.07, w: 0.2, h: 0.2 };
  const iou = boxIou(current, loose);
  assert.ok(iou >= 0.2 && iou < 0.5, `iou ${iou} outside the loose band`);
  const out = reconcileBox(current, loose);
  assert.equal(out.mode, "blend");
  // Past the halfway point, unlike the gentle drift case above.
  assert.ok(out.box.x > loose.x / 2);
});

test("a tracker on the wrong object snaps outright", () => {
  const out = reconcileBox(
    { x: 0, y: 0, w: 0.1, h: 0.1 },
    { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
  );
  assert.equal(out.mode, "snap");
  near(out.box.x, 0.5);
});

test("an implausibly large correction is rejected", () => {
  const current = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 };
  const out = reconcileBox(current, { x: 0, y: 0, w: 0.9, h: 0.9 });
  assert.equal(out.mode, "hold");
  assert.deepEqual(out.box, current);
});

test("a degenerate correction is rejected", () => {
  const current = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 };
  for (const bad of [
    { x: 0.1, y: 0.1, w: 0, h: 0.1 },
    { x: 0.1, y: 0.1, w: 0.1, h: Number.NaN },
  ]) {
    assert.equal(reconcileBox(current, bad).mode, "hold");
  }
});

/** Minimal canvas stand-in — the ring only ever draws into it. */
function stubDocument() {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
    }),
  };
  return () => {
    globalThis.document = previous;
  };
}

test("the replay buffer returns wrapped-around frames in time order", () => {
  const restore = stubDocument();
  try {
    const ring = createFrameRing(4);
    for (let t = 1; t <= 6; t++) ring.capture({}, 640, 480, t);

    // Slots hold t = 5,6,3,4 after wrapping; replay must still be ordered.
    const replay = ring.since(3).map((f) => f.t);
    assert.deepEqual(replay, [4, 5, 6]);
    assert.deepEqual(ring.since(6), []);
    assert.equal(ring.nearest(5).t, 5);
    // Anchor timestamps land between captures; nearest picks the closer one.
    assert.equal(ring.nearest(5.4).t, 5);
    assert.equal(ring.nearest(100).t, 6);
    ring.dispose();
  } finally {
    restore();
  }
});

test("the replay buffer ignores frames with no dimensions", () => {
  const restore = stubDocument();
  try {
    const ring = createFrameRing(4);
    ring.capture({}, 0, 0, 1);
    assert.deepEqual(ring.since(0), []);
    ring.dispose();
  } finally {
    restore();
  }
});
