import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let parsePostAction;
let computeCollageLayout;
let fallbackCaption;
let formatMediaTime;
let isCardActionable;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    parsePostAction,
    computeCollageLayout,
    fallbackCaption,
    formatMediaTime,
    isCardActionable,
  } = await vite.ssrLoadModule("/src/lib/xpost.ts"));
});

after(async () => {
  await vite?.close();
});

test("post/skip grammar matches only while a card is pending", () => {
  const posts = [
    "Post it.",
    "post",
    "yes, post it",
    "send it",
    "ship it",
    "ask X",
    "go ahead, post it",
    "go ahead",
  ];
  const skips = [
    "skip",
    "skip it",
    "don't post it",
    "no, don't post",
    "cancel the post",
    "dismiss",
    "never mind",
    "nevermind",
  ];
  for (const message of posts) {
    assert.equal(parsePostAction(message, true), "post", message);
    assert.equal(parsePostAction(message, false), null, `${message} (no card)`);
  }
  for (const message of skips) {
    assert.equal(parsePostAction(message, true), "skip", message);
    assert.equal(parsePostAction(message, false), null, `${message} (no card)`);
  }
});

test("post grammar rejects bare acknowledgements and near-misses", () => {
  for (const message of [
    "yes",
    "no",
    "okay",
    "post office hours",
    "send it to the manual",
    "where does this post go",
    "can you post it later",
    "skip to step three",
  ]) {
    assert.equal(parsePostAction(message, true), null, message);
  }
});

test("collage layout is a labeled horizontal strip", () => {
  const two = computeCollageLayout(2);
  assert.equal(two.width, 1024);
  assert.equal(two.height, 512);
  assert.deepEqual(
    two.cells.map((cell) => cell.label),
    ["BEFORE", "AFTER"],
  );

  const three = computeCollageLayout(3);
  assert.equal(three.width, 1536);
  assert.deepEqual(
    three.cells.map((cell) => cell.label),
    ["BEFORE", "DURING", "AFTER"],
  );
  // Cells advance left-to-right and stay inside the canvas.
  let lastRight = 0;
  for (const cell of three.cells) {
    assert.ok(cell.x >= lastRight - 4, `cell overlaps at ${cell.x}`);
    assert.ok(cell.x + cell.w <= three.width);
    lastRight = cell.x + cell.w;
  }
  // Out-of-range counts clamp to the supported band.
  assert.equal(computeCollageLayout(1).cells.length, 2);
  assert.equal(computeCollageLayout(7).cells.length, 3);
});

test("fallback caption is honest, short, and link-free", () => {
  const caption = fallbackCaption({
    question: "Is this RAM fully seated",
    videoTitle: "PC build — CPU & RAM",
    mediaTime: 125,
  });
  assert.ok(caption.includes("2:05"), caption);
  assert.ok(caption.includes("couldn't verify"), caption);
  assert.ok(caption.endsWith("#Grokathon"), caption);
  assert.ok(caption.includes("Is this RAM fully seated?"), caption);
  assert.ok(caption.length <= 280);
  assert.ok(!/https?:\/\//.test(caption));
  assert.equal(formatMediaTime(65), "1:05");
  assert.equal(formatMediaTime(Number.NaN), "0:00");
});

test("only pending and failed cards accept actions", () => {
  const card = (status) => ({
    clientToken: "t",
    question: "q",
    caption: "c",
    collageUrl: "data:image/jpeg;base64,x",
    status,
  });
  assert.equal(isCardActionable(card("pending")), true);
  assert.equal(isCardActionable(card("failed")), true);
  for (const status of ["composing", "posting", "posted"]) {
    assert.equal(isCardActionable(card(status)), false, status);
  }
  assert.equal(isCardActionable(null), false);
});
