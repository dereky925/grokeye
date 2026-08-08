import type { GhostMotion, GhostPrimitive, NormBox } from "../types";

/**
 * True when the user wants to be *shown a motion* for something on screen,
 * rather than a written procedure.
 *
 * This is checked before the manual router, which would otherwise swallow
 * "how do I use this jack?" as a request to open a step-by-step guide. The
 * distinction is deixis: a ghost demo is about a specific visible object
 * ("this", "it"), while a manual is about a task ("replace the drive unit").
 */
export function wantsGhost(message: string): boolean {
  const t = message.toLowerCase().replace(/[’”']/g, "'");

  // Whole procedures belong to the manual, not a single-object demo.
  if (
    /\b(replace|install|remove|repair|fix|rebuild|make|build|cook|bake|assemble|disassemble)\b/.test(
      t,
    )
  ) {
    return false;
  }
  // Panel and playback controls happen to use motion verbs too.
  if (/\b(panel|pane|overlay|volume|louder|quieter|mute)\b/.test(t)) {
    return false;
  }

  if (/\b(demonstrate|show me the (motion|movement|path)|animate it)\b/.test(t)) {
    return true;
  }
  if (
    /\bwhere (does|do|should) (it|this|that|they)\b/.test(t) ||
    /\b(which way|what direction)\b/.test(t)
  ) {
    return true;
  }

  const motionVerb =
    /\b(use|using|hold|holding|position|place|angle|aim|move|swing|turn|rotate|slide|insert|attach|operate|maneuver|manoeuvre)\b/.test(
      t,
    );
  const deictic = /\b(this|that|it|here|these|those)\b/.test(t);
  const asking = /\b(how|show me|which way)\b/.test(t);
  return motionVerb && deictic && asking;
}

/**
 * "Animate what I should do next" — a ghost demo aimed at the NEXT action
 * rather than an object the user pointed at. Only meaningful on clips with an
 * authored script; the server resolves what "next" is from the playhead.
 *
 * Deliberately narrower than wantsGhost: a demo verb plus a forward-looking
 * phrase. Bare "next step" stays with the manual pager.
 */
export function wantsNextDemo(message: string): boolean {
  const t = message.toLowerCase().replace(/[’”']/g, "'");
  if (/\b(panel|pane|overlay|volume|louder|quieter|mute)\b/.test(t)) {
    return false;
  }
  const demoVerb =
    /\b(animate|demonstrate|act out|play out|preview|show me|walk me through)\b/.test(
      t,
    );
  const forward =
    /\b(what (to do|i (should |need to )?do|comes?|happens?) next|what'?s next|next (move|action|bit|part)|the next step looks like|how to do the next (step|part|bit|one))\b/.test(
      t,
    ) || /\banimate\b[^.?!]*\bnext\b/.test(t);
  return demoVerb && forward;
}

export async function fetchGhost(input: {
  question: string;
  frame: string;
  videoTitle?: string;
  stepText?: string;
  /** Catalog id — lets the server ground the demo in the authored script. */
  videoId?: string;
  /** Playhead seconds, for resolving "next" against the script timeline. */
  currentTime?: number;
  /** Plan the script's NEXT action instead of an object in the question. */
  wantNext?: boolean;
}): Promise<{
  label: string;
  caption: string;
  box: NormBox | null;
  motion: GhostMotion;
}> {
  const res = await fetch("/api/ghost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Ghost lookup failed");
  return data;
}

/**
 * Cut the object's own pixels out of the current frame so the ghost looks like
 * the real thing. Padding keeps a little context around the box, which the
 * CSS feather then softens.
 */
export function cropSprite(
  video: HTMLVideoElement,
  box: NormBox,
  pad = 0.12,
): string {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return "";

  const sx = Math.max(0, (box.x - box.w * pad) * vw);
  const sy = Math.max(0, (box.y - box.h * pad) * vh);
  const sw = Math.min(vw - sx, box.w * (1 + pad * 2) * vw);
  const sh = Math.min(vh - sy, box.h * (1 + pad * 2) * vh);
  if (sw < 2 || sh < 2) return "";

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export type GhostAnimation = {
  keyframes: Keyframe[];
  durationMs: number;
  /** Dashed trail endpoints in normalized coords, or null when not linear. */
  trail: { x1: number; y1: number; x2: number; y2: number } | null;
};

const DURATION: Record<GhostPrimitive, number> = {
  slide: 2300,
  lift: 2000,
  insert: 2400,
  rotate: 2200,
  press: 1500,
  pull: 1500,
};

/** A translation the user can actually see, even if the model gave us nothing. */
function resolveDelta(
  box: NormBox,
  motion: GhostMotion,
  plane: { width: number; height: number },
) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let ndx = motion.to.x - cx;
  let ndy = motion.to.y - cy;

  const tiny = Math.hypot(ndx, ndy) < 0.02;
  if (tiny) {
    // Fall back to a nudge along the natural axis of the primitive.
    if (motion.primitive === "lift") {
      ndx = 0;
      ndy = -0.18;
    } else {
      ndx = 0.16;
      ndy = 0;
    }
  }

  return {
    cx,
    cy,
    ndx,
    ndy,
    dx: ndx * plane.width,
    dy: ndy * plane.height,
  };
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * Turn a primitive plus endpoints into Web Animations keyframes. The model
 * never authors easing — that stays here so every motion reads smoothly.
 */
export function motionKeyframes(
  box: NormBox,
  motion: GhostMotion,
  plane: { width: number; height: number },
): GhostAnimation {
  const { cx, cy, ndx, ndy, dx, dy } = resolveDelta(box, motion, plane);
  const durationMs = DURATION[motion.primitive] ?? DURATION.slide;
  const trail = {
    x1: cx,
    y1: cy,
    x2: Math.min(1, Math.max(0, cx + ndx)),
    y2: Math.min(1, Math.max(0, cy + ndy)),
  };

  const start = (opacity: number): Keyframe => ({
    offset: 0,
    opacity,
    transform: "translate(0px, 0px) rotate(0deg) scale(1)",
    easing: "cubic-bezier(0.33, 0, 0.2, 1)",
  });

  switch (motion.primitive) {
    case "rotate": {
      const deg = motion.rotateDeg || 90;
      return {
        durationMs,
        trail: null,
        keyframes: [
          start(0.15),
          { offset: 0.12, opacity: 0.62, transform: "rotate(0deg)" },
          {
            offset: 0.62,
            opacity: 0.62,
            transform: `rotate(${deg}deg)`,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          },
          { offset: 0.88, opacity: 0.5, transform: `rotate(${deg}deg)` },
          { offset: 1, opacity: 0, transform: "rotate(0deg)" },
        ],
      };
    }

    case "lift": {
      return {
        durationMs,
        trail,
        keyframes: [
          start(0.15),
          { offset: 0.14, opacity: 0.62, transform: "translate(0px, 0px) scale(1)" },
          {
            offset: 0.78,
            opacity: 0.62,
            transform: `translate(${px(dx)}, ${px(dy)}) scale(1.04)`,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          },
          {
            offset: 1,
            opacity: 0,
            transform: `translate(${px(dx)}, ${px(dy)}) scale(1.04)`,
          },
        ],
      };
    }

    case "insert": {
      // Overshoot slightly, then seat back — reads as "push it home".
      return {
        durationMs,
        trail,
        keyframes: [
          start(0.15),
          { offset: 0.12, opacity: 0.62, transform: "translate(0px, 0px)" },
          {
            offset: 0.66,
            opacity: 0.62,
            transform: `translate(${px(dx * 1.05)}, ${px(dy * 1.05)})`,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          },
          {
            offset: 0.8,
            opacity: 0.62,
            transform: `translate(${px(dx)}, ${px(dy)})`,
          },
          { offset: 1, opacity: 0, transform: `translate(${px(dx)}, ${px(dy)})` },
        ],
      };
    }

    case "press":
    case "pull": {
      // Short there-and-back along the axis; pull just reverses direction.
      const sign = motion.primitive === "pull" ? -1 : 1;
      const ax = dx * 0.4 * sign;
      const ay = dy * 0.4 * sign;
      return {
        durationMs,
        trail: {
          ...trail,
          x2: Math.min(1, Math.max(0, cx + ndx * 0.4 * sign)),
          y2: Math.min(1, Math.max(0, cy + ndy * 0.4 * sign)),
        },
        keyframes: [
          start(0.2),
          { offset: 0.18, opacity: 0.62, transform: "translate(0px, 0px)" },
          {
            offset: 0.5,
            opacity: 0.68,
            transform: `translate(${px(ax)}, ${px(ay)})`,
            easing: "cubic-bezier(0.3, 0, 0.2, 1)",
          },
          { offset: 0.82, opacity: 0.5, transform: "translate(0px, 0px)" },
          { offset: 1, opacity: 0, transform: "translate(0px, 0px)" },
        ],
      };
    }

    case "slide":
    default: {
      return {
        durationMs,
        trail,
        keyframes: [
          start(0.15),
          { offset: 0.12, opacity: 0.62, transform: "translate(0px, 0px)" },
          {
            offset: 0.82,
            opacity: 0.62,
            transform: `translate(${px(dx)}, ${px(dy)})`,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          },
          { offset: 1, opacity: 0, transform: `translate(${px(dx)}, ${px(dy)})` },
        ],
      };
    }
  }
}
