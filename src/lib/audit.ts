import type { TaskVerdict } from "../types";
import type { VerifyResult } from "./verify";
import type { LedgerEntry, SessionLedger } from "./sessionLedger";

export type AuditAction = "audit" | null;

/**
 * Narrow local grammar for a whole-session review. Deliberately disjoint from
 * `parseVerifyAction` (which owns the single active task) and from flip
 * review's "how did I do" — see .context/13-known-issues.md before widening.
 */
export function parseAuditAction(message: string): AuditAction {
  const text = String(message || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.!?]+$/g, "")
    .trim();

  if (/^did i do everything (?:right|correctly|ok|okay)$/.test(text)) {
    return "audit";
  }
  if (text === "check everything") return "audit";
  if (/^check all (?:of )?my work$/.test(text)) return "audit";
  if (/^review my (?:work|session)$/.test(text)) return "audit";
  if (text === "did i get everything right") return "audit";
  return null;
}

export type AuditItem = {
  entryId: string;
  goal: string;
  instruction: string;
  beforeFrame: string;
  afterFrame: string;
  manualStepText?: string;
};

export type AuditItemResult =
  | { entryId: string; ok: true; verdict: TaskVerdict; spoken: string }
  | { entryId: string; ok: false };

export type RunAuditDeps = {
  verify: (input: {
    goal: string;
    instruction: string;
    beforeFrame: string;
    afterFrame: string;
    videoTitle?: string;
    manualStepText?: string;
  }) => Promise<VerifyResult>;
  videoTitle?: string;
  concurrency?: number;
  /** Fires as each item resolves so barge-in can keep partial verdicts. */
  onResult?: (result: AuditItemResult) => void;
};

/**
 * Judge every item with a bounded worker pool. A failed call yields
 * `{ok: false}` — the entry stays unaudited for a later retry; a verdict is
 * never fabricated.
 */
export async function runAudit(
  items: readonly AuditItem[],
  deps: RunAuditDeps,
): Promise<AuditItemResult[]> {
  const concurrency = Math.max(1, deps.concurrency ?? 3);
  const results: AuditItemResult[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      let result: AuditItemResult;
      try {
        const verdict = await deps.verify({
          goal: item.goal,
          instruction: item.instruction,
          beforeFrame: item.beforeFrame,
          afterFrame: item.afterFrame,
          videoTitle: deps.videoTitle,
          manualStepText: item.manualStepText,
        });
        result = {
          entryId: item.entryId,
          ok: true,
          verdict: verdict.verdict,
          spoken: verdict.spoken,
        };
      } catch {
        result = { entryId: item.entryId, ok: false };
      }
      results[index] = result;
      deps.onResult?.(result);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

/**
 * Deterministic spoken verdict, hard ceiling three sentences. Failed items
 * reuse the model's own fix line (already written for TTS by /api/verify).
 */
export function summarizeAudit(
  results: readonly AuditItemResult[],
  options: { escalations?: number } = {},
): string {
  const judged = results.filter(
    (result): result is Extract<AuditItemResult, { ok: true }> => result.ok,
  );
  const missed = results.length - judged.length;
  const good = judged.filter((result) => result.verdict === "complete");
  const failed = judged.filter((result) => result.verdict === "not_complete");
  const escalations = options.escalations ?? 0;

  const sentences: string[] = [];
  if (!results.length) return "Nothing to check yet.";

  if (good.length === results.length) {
    sentences.push(
      results.length === 1
        ? "That one looks right."
        : `All ${results.length} look right.`,
    );
  } else {
    sentences.push(`${good.length} of ${results.length} look right.`);
  }

  if (failed.length) {
    const fix = failed[0].spoken.trim();
    if (fix) sentences.push(fix.replace(/[.!?]+$/g, ""));
    if (failed.length > 1) {
      sentences.push(`${failed.length - 1} more need another look`);
    }
  }

  if (escalations > 0) {
    sentences.push(
      escalations === 1
        ? `I couldn't verify one — say "post it" to ask X`
        : `I couldn't verify ${escalations} — say "post it" to ask X`,
    );
  } else if (missed > 0) {
    sentences.push(`I couldn't check ${missed}, ask me again in a moment`);
  }

  return sentences
    .slice(0, 3)
    .map((sentence) => `${sentence.replace(/[.!?]+$/g, "")}.`)
    .join(" ");
}

/** The contract handed to the X-posting half — structured, no baked copy. */
export type EscalationPayload = {
  entryId: string;
  question: string;
  instruction: string;
  verdict: TaskVerdict;
  verdictSpoken: string;
  videoTitle: string;
  mediaTime: number;
  /** Chronological, 2–3 ≤512px JPEG data URLs: before, mid?, after. */
  frames: string[];
};

/**
 * Escalation candidates: unverified entries not yet queued. Caller must
 * `markEscalated` the returned ids so a re-audit never double-posts.
 */
export function buildEscalationPayloads(
  ledger: SessionLedger,
  videoTitle: string,
): EscalationPayload[] {
  return ledger.entries
    .filter(
      (entry): entry is LedgerEntry & { verification: NonNullable<LedgerEntry["verification"]> } =>
        entry.status === "unverified" && entry.verification != null,
    )
    .map((entry) => {
      const frames = [
        entry.beforeFrame,
        entry.midFrame?.url ?? null,
        entry.afterFrame?.url ?? null,
      ].filter((url): url is string => Boolean(url));
      return {
        entryId: entry.id,
        question: entry.question,
        instruction: entry.answer,
        verdict: entry.verification.verdict,
        verdictSpoken: entry.verification.spoken,
        videoTitle,
        mediaTime: entry.mediaTime,
        frames: [...new Set(frames)].slice(0, 3),
      };
    })
    .filter((payload) => payload.frames.length >= 2);
}
