import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let createLedger;
let nextEntryId;
let appendTurn;
let markRouted;
let attachAfterFrames;
let recordVerdict;
let isActionable;
let selectAuditItems;
let markEscalated;
let selectAfterFrame;
let MAX_LEDGER_ENTRIES;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    createLedger,
    nextEntryId,
    appendTurn,
    markRouted,
    attachAfterFrames,
    recordVerdict,
    isActionable,
    selectAuditItems,
    markEscalated,
    selectAfterFrame,
    MAX_LEDGER_ENTRIES,
  } = await vite.ssrLoadModule("/src/lib/sessionLedger.ts"));
});

after(async () => {
  await vite?.close();
});

function turn(overrides = {}) {
  return {
    question: "Where does this go?",
    answer: "Into the top PCIe slot — press until it clicks.",
    kind: "guidance",
    mediaTime: 65,
    askedAtT: 65_000,
    nowMs: 1_700_000_000_000,
    beforeFrame: "data:image/jpeg;base64,before",
    ...overrides,
  };
}

function frame(mediaTime, motion, url = `frame-${mediaTime}`, t = mediaTime * 1000) {
  return { url, t, mediaTime, motion };
}

test("appendTurn assigns sequential per-video ids and pre-announces them", () => {
  let ledger = createLedger("gpu");
  assert.equal(nextEntryId(ledger), "gpu#1");
  const first = appendTurn(ledger, turn());
  assert.equal(first.entryId, "gpu#1");
  const second = appendTurn(first.ledger, turn({ question: "And power?" }));
  assert.equal(second.entryId, "gpu#2");
  assert.equal(second.ledger.entries.length, 2);
});

test("ledger caps at MAX_LEDGER_ENTRIES with FIFO eviction and unique ids", () => {
  let ledger = createLedger("gpu");
  for (let i = 0; i < MAX_LEDGER_ENTRIES + 4; i += 1) {
    ({ ledger } = appendTurn(ledger, turn({ question: `q${i}` })));
  }
  assert.equal(ledger.entries.length, MAX_LEDGER_ENTRIES);
  assert.equal(ledger.entries[0].question, "q4");
  assert.equal(
    new Set(ledger.entries.map((entry) => entry.id)).size,
    MAX_LEDGER_ENTRIES,
  );
  // Sequence keeps climbing past evictions, so ids never repeat.
  assert.equal(nextEntryId(ledger), `gpu#${MAX_LEDGER_ENTRIES + 5}`);
});

test("only instructed-action kinds with a before frame are actionable", () => {
  const auditable = ["guidance", "highlight_route", "manual_step", "ghost"];
  const inert = ["chat", "web", "widget", "toolkit", "flip", "highlight", "verify", "audit"];
  for (const kind of auditable) {
    const { ledger, entryId } = appendTurn(createLedger("v"), turn({ kind }));
    const entry = ledger.entries.find((item) => item.id === entryId);
    assert.equal(isActionable(entry), true, kind);
  }
  for (const kind of inert) {
    const { ledger, entryId } = appendTurn(createLedger("v"), turn({ kind }));
    const entry = ledger.entries.find((item) => item.id === entryId);
    assert.equal(isActionable(entry), false, kind);
  }
  const { ledger } = appendTurn(
    createLedger("v"),
    turn({ kind: "guidance", beforeFrame: null }),
  );
  assert.equal(isActionable(ledger.entries[0]), false, "missing before frame");
});

test("markRouted upgrades a locate highlight into an auditable connection", () => {
  const { ledger, entryId } = appendTurn(
    createLedger("v"),
    turn({ kind: "highlight" }),
  );
  assert.equal(isActionable(ledger.entries[0]), false);
  const routed = markRouted(ledger, entryId);
  assert.equal(routed.entries[0].kind, "highlight_route");
  assert.equal(isActionable(routed.entries[0]), true);
  // Routing anything but a plain highlight is a no-op.
  const chat = appendTurn(createLedger("v"), turn({ kind: "chat" }));
  assert.equal(
    markRouted(chat.ledger, chat.entryId).entries[0].kind,
    "chat",
  );
});

test("verdicts map onto statuses and audit selection follows them", () => {
  let ledger = createLedger("v");
  const ids = [];
  for (const verdict of ["complete", "not_complete", "not_visible", "unsafe_to_judge", null]) {
    const appended = appendTurn(ledger, turn({ question: String(verdict) }));
    ledger = appended.ledger;
    ids.push(appended.entryId);
    if (verdict) {
      ledger = recordVerdict(ledger, appended.entryId, {
        verdict,
        spoken: "Looks seated.",
        source: "audit",
        nowMs: 1,
      });
    }
  }
  const statuses = ledger.entries.map((entry) => entry.status);
  assert.deepEqual(statuses, [
    "verified",
    "failed",
    "unverified",
    "unverified",
    "unaudited",
  ]);
  // failed + unaudited are re-checked; verified and unverified are settled.
  assert.deepEqual(
    selectAuditItems(ledger).map((entry) => entry.id),
    [ids[1], ids[4]],
  );
  // External verifiers write through the same seam.
  const external = recordVerdict(ledger, ids[4], {
    verdict: "complete",
    spoken: "",
    source: "external",
    nowMs: 2,
  });
  assert.equal(external.entries[4].status, "verified");
  assert.equal(external.entries[4].verification.source, "external");
});

test("markEscalated settles unverified entries and is idempotent", () => {
  let ledger = createLedger("v");
  const a = appendTurn(ledger, turn());
  ledger = recordVerdict(a.ledger, a.entryId, {
    verdict: "not_visible",
    spoken: "Hands were covering it.",
    source: "audit",
    nowMs: 1,
  });
  ledger = markEscalated(ledger, [a.entryId]);
  assert.equal(ledger.entries[0].status, "escalated");
  ledger = markEscalated(ledger, [a.entryId]);
  assert.equal(ledger.entries[0].status, "escalated");
  // A later verdict does not pull an escalated entry back into the pool.
  ledger = recordVerdict(ledger, a.entryId, {
    verdict: "not_visible",
    spoken: "",
    source: "audit",
    nowMs: 2,
  });
  assert.equal(ledger.entries[0].status, "escalated");
  assert.deepEqual(selectAuditItems(ledger), []);
});

test("attachAfterFrames stores after and mid frames on the entry", () => {
  const { ledger, entryId } = appendTurn(createLedger("v"), turn());
  const updated = attachAfterFrames(
    ledger,
    entryId,
    { url: "after", t: 70_000, mediaTime: 70 },
    { url: "mid", t: 67_000, mediaTime: 67 },
  );
  assert.equal(updated.entries[0].afterFrame.url, "after");
  assert.equal(updated.entries[0].midFrame.url, "mid");
});

test("selectAfterFrame picks the settled frame after the motion peak", () => {
  const history = [
    frame(64, 2),
    frame(66, 3),
    frame(67, 40, "peak"),
    frame(68, 20),
    frame(69, 4, "settled"),
    frame(70, 3, "later-settled"),
  ];
  const { after: settled, mid } = selectAfterFrame(history, 65_000);
  assert.equal(mid.url, "peak");
  assert.equal(settled.url, "later-settled");
});

test("selectAfterFrame ignores frames captured before the ask", () => {
  const history = [frame(60, 90, "pre-ask"), frame(66, 2, "post-ask")];
  const { after: settled, mid } = selectAfterFrame(history, 65_000);
  assert.equal(settled.url, "post-ask");
  assert.equal(mid, null);
  assert.deepEqual(selectAfterFrame([], 65_000), { after: null, mid: null });
});

test("selectAfterFrame without motion settles on the newest frame, no mid", () => {
  const history = [frame(66, 1), frame(67, 2), frame(68, 1, "newest")];
  const { after: settled, mid } = selectAfterFrame(history, 65_000);
  assert.equal(settled.url, "newest");
  assert.equal(mid, null);
});
