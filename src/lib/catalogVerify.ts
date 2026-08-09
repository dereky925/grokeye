/**
 * Hand-authored process rubrics for “did I do this right?” on catalog clips.
 *
 * Human mirror: `public/videos/WATCH-WINDOWS.md` (§ Catalog verify rubrics).
 *
 * Espresso checklist verifies are text/timeline only (no frames): playhead is
 * mapped to authored clip facts so we can call the intentional skip-tamp beat
 * without a vision round-trip.
 */
import type { TaskVerdict } from "../types";

export type CatalogSceneHint = {
  start: number;
  end: number;
  /** Orientation / what to look at — never a verdict or canned line. */
  hint: string;
};

/** Authored timeline fact for text-only verifies (from CHOREOGRAPHY / WATCH-WINDOWS). */
export type CatalogTimelineBeat = {
  start: number;
  end: number;
  /** What the footage shows here — factual, not a spoken line. */
  fact: string;
  verdict: TaskVerdict;
  spoken: string;
};

export type CatalogVerifyRubric = {
  videoId: string;
  /** Short worker goal spoken into the verify prompt. */
  goal: string;
  /** Ordered correct-process steps from the watch markdown. */
  steps: string[];
  /** Visually checkable failure modes (used if we ever fall back to vision). */
  watchFor: string[];
  /** Time-scoped layout hints. */
  sceneHints?: readonly CatalogSceneHint[];
  /** Playhead → verdict for text-only catalog verifies. */
  timeline?: readonly CatalogTimelineBeat[];
};

export type LocalCatalogVerify = {
  verdict: TaskVerdict;
  spoken: string;
  fact: string;
};

export const CATALOG_VERIFY_RUBRICS: readonly CatalogVerifyRubric[] = [
  {
    videoId: "pov-espresso-tamp",
    goal: "Complete espresso portafilter prep: dose, tamp flat, then lock into the group head",
    steps: [
      "Dose and grind espresso into the portafilter under the grinder",
      "Tamp the puck flat and level with the tamper on the counter",
      "Lock the tamped portafilter fully into the group head",
    ],
    watchFor: [
      "portafilter locked into the group head while the metal tamper is still sitting unused on the counter (missed tamp before lock)",
      "open portafilter in hand/on counter with a clearly loose, mounded, untamped coffee bed",
    ],
    sceneHints: [
      {
        start: 0,
        end: 42,
        hint: "Overhead barista POV at a La Marzocco espresso bar. Group head mid/right; portafilter is the handled basket; tamper is the smaller press on the counter.",
      },
    ],
    // Mirrors CHOREOGRAPHY.md for this clip — intentional skip-tamp then fix.
    timeline: [
      {
        start: 6,
        end: 28,
        fact: "Portafilter is locked into the group head without being tamped; tamper stays unused on the counter.",
        verdict: "not_complete",
        spoken:
          "You skipped the tamp — pull the portafilter back out and press the puck flat before locking it in.",
      },
      {
        start: 28,
        end: 33,
        fact: "Portafilter is back on the counter for tamping.",
        verdict: "not_complete",
        spoken:
          "Good, you've pulled it out — tamp the puck flat and level, then lock it back into the group head.",
      },
      {
        start: 33,
        end: 42,
        fact: "Portafilter has been tamped and locked back into the group head.",
        verdict: "complete",
        spoken:
          "That looks right — you tamped, then locked the portafilter in.",
      },
    ],
  },
];

export function getCatalogVerifyRubric(
  videoId: string,
): CatalogVerifyRubric | null {
  return CATALOG_VERIFY_RUBRICS.find((r) => r.videoId === videoId) ?? null;
}

/** Concatenate overlapping scene hints for this playhead. */
export function getCatalogSceneHint(
  videoId: string,
  currentTime: number,
): string | null {
  const rubric = getCatalogVerifyRubric(videoId);
  if (!rubric?.sceneHints?.length || !Number.isFinite(currentTime)) return null;
  const hits = rubric.sceneHints
    .filter((h) => currentTime >= h.start && currentTime < h.end)
    .map((h) => h.hint);
  return hits.length ? hits.join(" ") : null;
}

/**
 * Instant text-only verdict from authored timeline. Returns null outside known
 * beats so the caller can fall back (spoken “pause on the step” etc.).
 */
export function resolveCatalogVerifyLocal(
  videoId: string,
  currentTime: number,
): LocalCatalogVerify | null {
  const rubric = getCatalogVerifyRubric(videoId);
  if (!rubric?.timeline?.length || !Number.isFinite(currentTime)) return null;
  const beat = rubric.timeline.find(
    (b) => currentTime >= b.start && currentTime < b.end,
  );
  if (!beat) return null;
  return {
    verdict: beat.verdict,
    spoken: beat.spoken,
    fact: beat.fact,
  };
}
