import { snapCommand } from "./commands";
import {
  findCatalogChoreography,
  type CatalogMotionCue,
} from "./choreography";
import { wantsGhost } from "./ghost";
import { wantsMotionGuidance } from "./guidance";
import { parseManualAction, type ManualAction } from "./manual";

export type InstructionRoute =
  | { kind: "catalog_motion"; utterance: string; cue: CatalogMotionCue }
  | { kind: "ghost"; utterance: string }
  | { kind: "manual"; action: Exclude<ManualAction, null> }
  | { kind: "motion"; utterance: string }
  | null;

type RouteInput = {
  primary: string;
  alternatives?: string[];
  manualOpen: boolean;
  toolsOpen?: boolean;
  videoId: string;
  currentTime: number;
  /** Recent grounded referent for a purely deictic utterance; never geometry. */
  subjectHint?: string | null;
};

/**
 * Resolve overlapping visible-instruction grammars in one place.
 *
 * A stable catalog scene is the most grounded answer, so it wins over both the
 * generic ghost demo and the broad manual "how do I" grammar. Unknown scenes
 * may still use Ghost, and a deictic motion ask that Ghost does not understand
 * falls through to the conservative /api/guide path instead of opening a manual.
 */
export function resolveInstructionRoute({
  primary,
  alternatives = [],
  manualOpen,
  toolsOpen = false,
  videoId,
  currentTime,
  subjectHint = null,
}: RouteInput): InstructionRoute {
  const candidates = Array.from(
    new Set(
      [primary, ...alternatives]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const motionUtterance = candidates.find(wantsMotionGuidance);

  if (motionUtterance) {
    const cue = findCatalogChoreography(
      videoId,
      currentTime,
      motionUtterance,
      subjectHint,
    );
    if (cue) return { kind: "catalog_motion", utterance: motionUtterance, cue };
  }

  const ghostUtterance = candidates.find(wantsGhost);
  if (ghostUtterance) return { kind: "ghost", utterance: ghostUtterance };

  const manualAction =
    parseManualAction(primary, manualOpen, toolsOpen) ??
    snapCommand(candidates, manualOpen);

  // Explicit controls for an existing panel remain authoritative. Only the
  // broad open-manual fallback yields to a visible-object motion question.
  if (manualAction && (manualAction.type !== "open_manual" || !motionUtterance)) {
    return { kind: "manual", action: manualAction };
  }

  if (motionUtterance) return { kind: "motion", utterance: motionUtterance };
  if (manualAction) return { kind: "manual", action: manualAction };
  return null;
}
