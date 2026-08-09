import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let parseAuditAction;
let runAudit;
let summarizeAudit;
let buildEscalationPayloads;
let parseVerifyAction;
let ledgerLib;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ parseAuditAction, runAudit, summarizeAudit, buildEscalationPayloads } =
    await vite.ssrLoadModule("/src/lib/audit.ts"));
  ({ parseVerifyAction } = await vite.ssrLoadModule("/src/lib/verify.ts"));
  ledgerLib = await vite.ssrLoadModule("/src/lib/sessionLedger.ts");
});

after(async () => {
  await vite?.close();
});

const AUDIT_POSITIVES = [
  "Did I do everything right?",
  "did i do everything correctly",
  "Check everything!",
  "check all my work",
  "check all of my work",
  "Review my work.",
  "review my session",
  "did I get everything right?",
];

const VERIFY_POSITIVES = [
  "check my work",
  "verify this",
  "verify that",
  "verify it",
  "did i do that right",
  "did i do it right",
];

test("session audit grammar matches its phrasings", () => {
  for (const message of AUDIT_POSITIVES) {
    assert.equal(parseAuditAction(message), "audit", message);
  }
});

test("audit grammar rejects near-misses and flip-review phrasing", () => {
  for (const message of [
    "how did I do?",
    "did I do the RAM right",
    "check the work order",
    "review my code",
    "is everything okay",
    "everything",
    "check everything twice tomorrow",
  ]) {
    assert.equal(parseAuditAction(message), null, message);
  }
});

test("audit and single-task verify grammars are pairwise disjoint", () => {
  for (const message of VERIFY_POSITIVES) {
    assert.equal(parseAuditAction(message), null, message);
    assert.equal(parseVerifyAction(message), "verify", message);
  }
  for (const message of AUDIT_POSITIVES) {
    assert.equal(parseVerifyAction(message), null, message);
  }
});

function item(entryId) {
  return {
    entryId,
    goal: "seat the RAM",
    instruction: "Press both ends until the clips snap.",
    beforeFrame: "data:before",
    afterFrame: "data:after",
  };
}

test("runAudit bounds concurrency and streams results in order of completion", async () => {
  let inFlight = 0;
  let peak = 0;
  const streamed = [];
  const results = await runAudit(
    [item("a"), item("b"), item("c"), item("d"), item("e")],
    {
      concurrency: 2,
      onResult: (result) => streamed.push(result.entryId),
      verify: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { verdict: "complete", spoken: "Done.", attention: null };
      },
    },
  );
  assert.equal(peak, 2);
  assert.equal(results.length, 5);
  assert.equal(streamed.length, 5);
  assert.ok(results.every((result) => result.ok && result.verdict === "complete"));
});

test("a rejected verify neither sinks the batch nor fabricates a verdict", async () => {
  let calls = 0;
  const results = await runAudit([item("good"), item("bad")], {
    verify: async () => {
      calls += 1;
      if (calls === 1) {
        return { verdict: "complete", spoken: "Done.", attention: null };
      }
      throw new Error("upstream 502");
    },
    concurrency: 1,
  });
  assert.deepEqual(results, [
    { entryId: "good", ok: true, verdict: "complete", spoken: "Done." },
    { entryId: "bad", ok: false },
  ]);
});

test("summarizeAudit templates stay within three sentences", () => {
  const ok = (entryId) => ({ entryId, ok: true, verdict: "complete", spoken: "" });
  const fail = (entryId, spoken) => ({ entryId, ok: true, verdict: "not_complete", spoken });
  const blind = (entryId) => ({ entryId, ok: true, verdict: "not_visible", spoken: "Hands in the way." });

  assert.equal(summarizeAudit([ok("a")]), "That one looks right.");
  assert.equal(summarizeAudit([ok("a"), ok("b"), ok("c")]), "All 3 look right.");

  const mixed = summarizeAudit(
    [ok("a"), fail("b", "The RAM clip on the left is still open."), blind("c")],
    { escalations: 1 },
  );
  assert.ok(mixed.startsWith("1 of 3 look right."), mixed);
  assert.ok(mixed.includes("RAM clip"), mixed);
  assert.ok(mixed.includes("post it"), mixed);
  assert.ok(mixed.split(/[.!?]+\s|[.!?]+$/).filter(Boolean).length <= 3, mixed);

  const missed = summarizeAudit([ok("a"), { entryId: "b", ok: false }]);
  assert.ok(missed.includes("couldn't check 1"), missed);
  assert.equal(summarizeAudit([]), "Nothing to check yet.");
});

test("buildEscalationPayloads exports only unqueued unverified entries with 2-3 frames", () => {
  const { createLedger, appendTurn, recordVerdict, attachAfterFrames, markEscalated } = ledgerLib;
  let ledger = createLedger("gpu");

  const seed = (question, verdict, { after = true, mid = true } = {}) => {
    const appended = appendTurn(ledger, {
      question,
      answer: "Slot it into the top PCIe.",
      kind: "guidance",
      mediaTime: 65,
      askedAtT: 65_000,
      nowMs: 1,
      beforeFrame: `data:image/jpeg;base64,${question}-before`,
    });
    ledger = appended.ledger;
    ledger = attachAfterFrames(
      ledger,
      appended.entryId,
      after ? { url: `${question}-after`, t: 70_000, mediaTime: 70 } : null,
      mid ? { url: `${question}-mid`, t: 67_000, mediaTime: 67 } : null,
    );
    if (verdict) {
      ledger = recordVerdict(ledger, appended.entryId, {
        verdict,
        spoken: "Couldn't see the slot.",
        source: "audit",
        nowMs: 2,
      });
    }
    return appended.entryId;
  };

  seed("verified", "complete");
  const unverifiedId = seed("blind", "not_visible");
  const escalatedId = seed("already", "unsafe_to_judge");
  seed("frameless", "not_visible", { after: false, mid: false });
  ledger = markEscalated(ledger, [escalatedId]);

  const payloads = buildEscalationPayloads(ledger, "PC build — GPU");
  assert.equal(payloads.length, 1);
  const [payload] = payloads;
  assert.equal(payload.entryId, unverifiedId);
  assert.equal(payload.question, "blind");
  assert.equal(payload.instruction, "Slot it into the top PCIe.");
  assert.equal(payload.verdict, "not_visible");
  assert.equal(payload.verdictSpoken, "Couldn't see the slot.");
  assert.equal(payload.videoTitle, "PC build — GPU");
  assert.deepEqual(payload.frames, [
    "data:image/jpeg;base64,blind-before",
    "blind-mid",
    "blind-after",
  ]);
});
