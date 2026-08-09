import type { CatalogMotionCue } from "../lib/choreography";

type Props = {
  cue: CatalogMotionCue;
  width: number;
  height: number;
};

type Box = { cx: number; cy: number; w: number; h: number };

/**
 * Approximate bounding box of an authored silhouette by pairing every numeric
 * token in the path string. Control points inflate the box slightly, which is
 * fine — it only anchors the ghost glide and the arrow, not the drawn shape.
 */
function pathBox(d: string): Box {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const x = Number(numbers[i]);
    const y = Number(numbers[i + 1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

/**
 * The ghost is a rigid copy of the source polygon — it never morphs. It only
 * translates (and uniformly scales toward a differently-sized destination),
 * which keeps the motion crisp instead of interpolating bezier mush.
 */
function ghostTransform(cue: CatalogMotionCue, source: Box) {
  if (cue.destination) {
    const dest = pathBox(cue.destination);
    const scale = Math.min(
      1.6,
      Math.max(0.4, (dest.w / source.w + dest.h / source.h) / 2),
    );
    const tx = dest.cx - source.cx;
    const ty = dest.cy - source.cy;
    return {
      to: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale.toFixed(3)})`,
      // 6% over-travel for the hero "press until it clicks" settle.
      past: `translate(${(tx * 1.06).toFixed(1)}px, ${(ty * 1.06).toFixed(1)}px) scale(${scale.toFixed(3)})`,
      destCenter: { x: dest.cx, y: dest.cy },
    };
  }
  if (cue.delta) {
    return {
      to: `translate(${cue.delta[0]}px, ${cue.delta[1]}px)`,
      past: `translate(${(cue.delta[0] * 1.1).toFixed(1)}px, ${(cue.delta[1] * 1.1).toFixed(1)}px)`,
      destCenter: { x: source.cx + cue.delta[0], y: source.cy + cue.delta[1] },
    };
  }
  if (cue.rotation) {
    return {
      to: `rotate(${cue.rotation.degrees}deg)`,
      past: null,
      destCenter: null,
    };
  }
  return null;
}

/**
 * The 1:31 GPU-seat beat is the demo money shot and gets a one-off hero
 * treatment (trace draw-on, glass ghost with card details, latch flash,
 * sheen). `gpu-seat-card-late` is the same beat's edge-on twin for asks
 * after 1:36. Every other cue keeps the plain-polygon look on purpose.
 */
const HERO_CUE_IDS = new Set(["gpu-seat-card", "gpu-seat-card-late"]);

/**
 * The ~0:05 IKEA leg-frame beat gets its own hero treatment, built for a
 * morph cue with a real throw: the leg outline traces itself, a curved
 * conduit rail (the same language as the tracked connection arrows) streams
 * energy toward the free end, and a glass ghost of the leg lifts, arcs, and
 * seats onto the desktop edge with a latch flash and impact rings. Shared
 * 3.6s / 0.6s-delay clock keeps every layer locked to the seat beat.
 */
const ARC_HERO_CUE_ID = "ikea-place-leg-frame";

/**
 * Curved conduit geometry for the arc hero: lifted cubic from p1 to p2.
 *
 * The leg silhouette is long enough that its bounding box overlaps the
 * destination, so a center-to-center rail collapses into a cramped hook.
 * Anchor the rail at the source corner farthest from the target instead —
 * on the traced frame that is the leg's held tip — pulled 15% inward so it
 * still starts on the object, giving the conduit a real runway.
 */
function arcRail(
  source: Box,
  dest: Box,
): {
  d: string;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  headAngle: number;
  lift: number;
} {
  const corners = [
    { x: source.cx - source.w / 2, y: source.cy - source.h / 2 },
    { x: source.cx + source.w / 2, y: source.cy - source.h / 2 },
    { x: source.cx - source.w / 2, y: source.cy + source.h / 2 },
    { x: source.cx + source.w / 2, y: source.cy + source.h / 2 },
  ];
  const tip = corners.reduce((far, corner) =>
    Math.hypot(corner.x - dest.cx, corner.y - dest.cy) >
    Math.hypot(far.x - dest.cx, far.y - dest.cy)
      ? corner
      : far,
  );
  const anchor = {
    x: tip.x + (source.cx - tip.x) * 0.15,
    y: tip.y + (source.cy - tip.y) * 0.15,
  };
  const dx = dest.cx - anchor.x;
  const dy = dest.cy - anchor.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  // Perpendicular pointing toward the top of the frame — the leg lifts up
  // and over, never through the desktop.
  let nx = -uy;
  let ny = ux;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const lift = Math.min(96, Math.max(48, dist * 0.28));
  const startPad = Math.min(46, dist * 0.12);
  const endPad = Math.min(40, dist * 0.1);
  const p1 = { x: anchor.x + ux * startPad, y: anchor.y + uy * startPad };
  const p2 = { x: dest.cx - ux * endPad, y: dest.cy - uy * endPad };
  const c1x = p1.x + ux * dist * 0.28 + nx * lift;
  const c1y = p1.y + uy * dist * 0.28 + ny * lift;
  const c2x = p2.x - ux * dist * 0.2 + nx * lift * 0.85;
  const c2y = p2.y - uy * dist * 0.2 + ny * lift * 0.85;
  return {
    d: `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
    p1,
    p2,
    headAngle: (Math.atan2(p2.y - c2y, p2.x - c2x) * 180) / Math.PI,
    lift,
  };
}

/** Energy packets riding the arc rail (staggered phases, mirrors hl-conn). */
const ARC_COMETS = [
  { dur: 1.5, begin: -0.35, r: 2.7, tail: 10 },
  { dur: 1.75, begin: -1.0, r: 2.0, tail: 8 },
  { dur: 1.6, begin: -1.5, r: 2.4, tail: 9 },
];

export default function CatalogMotionOverlay({ cue, width, height }: Props) {
  const arrowId = `catalog-arrow-${cue.id}`;
  const source = pathBox(cue.outline);
  const ghost = ghostTransform(cue, source);
  const hero = HERO_CUE_IDS.has(cue.id);
  const arcHero = cue.id === ARC_HERO_CUE_ID && Boolean(cue.destination);
  const arcDest = arcHero ? pathBox(cue.destination!) : null;
  const rail = arcDest ? arcRail(source, arcDest) : null;

  const targetTransform =
    !cue.destination && cue.delta
      ? `translate(${cue.delta[0]} ${cue.delta[1]})`
      : !cue.destination && cue.rotation
        ? `rotate(${cue.rotation.degrees} ${cue.rotation.cx} ${cue.rotation.cy})`
        : undefined;

  // One straight arrow from the object toward where it goes, trimmed off both
  // centers. Short throws skip it — the ghost glide alone reads clearly.
  let arrow: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (ghost?.destCenter) {
    const dx = ghost.destCenter.x - source.cx;
    const dy = ghost.destCenter.y - source.cy;
    const dist = Math.hypot(dx, dy);
    if (dist >= 70) {
      const ux = dx / dist;
      const uy = dy / dist;
      const startPad = Math.min(38, dist * 0.3);
      const endPad = Math.min(30, dist * 0.24);
      arrow = {
        x1: source.cx + ux * startPad,
        y1: source.cy + uy * startPad,
        x2: ghost.destCenter.x - ux * endPad,
        y2: ghost.destCenter.y - uy * endPad,
      };
    }
  }

  const ghostStyle = ghost
    ? ({
        ...(cue.rotation && !cue.destination && !cue.delta
          ? {
              transformBox: "view-box",
              transformOrigin: `${cue.rotation.cx}px ${cue.rotation.cy}px`,
            }
          : { transformBox: "fill-box", transformOrigin: "50% 50%" }),
        "--ghost-to": ghost.to,
        // Hero glide overshoots 10% past the slot and settles back — the
        // "press until it clicks" beat — then a sheen sweeps the seated card.
        ...(hero && ghost.past
          ? {
              "--ghost-past": ghost.past,
              "--sheen-sweep": `${Math.round(source.w + 380)}px`,
            }
          : {}),
        // Arc-hero waypoints: every keyframe keeps the same
        // translate/scale/rotate function list so the browser interpolates
        // each function instead of falling back to matrix mush.
        ...(arcDest && rail
          ? (() => {
              const dx = arcDest.cx - source.cx;
              const dy = arcDest.cy - source.cy;
              // The ghost's hop height scales with its own throw, not the
              // rail's (the rail is anchored at the leg's far tip).
              const hop = Math.min(80, Math.max(40, Math.hypot(dx, dy) * 0.5));
              const s = Math.min(
                1.6,
                Math.max(
                  0.4,
                  (arcDest.w / source.w + arcDest.h / source.h) / 2,
                ),
              );
              const mid = (1 + s) / 2;
              return {
                "--arc-rest": "translate(0px, 0px) scale(1) rotate(0deg)",
                "--arc-lift": `translate(${(dx * 0.42).toFixed(1)}px, ${(dy * 0.42 - hop).toFixed(1)}px) scale(${mid.toFixed(3)}) rotate(-8deg)`,
                "--arc-past": `translate(${(dx * 1.02).toFixed(1)}px, ${(dy * 1.02 + 3).toFixed(1)}px) scale(${(s * 0.985).toFixed(3)}) rotate(0deg)`,
                "--arc-seat": `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(0deg)`,
              };
            })()
          : {}),
      } as unknown as React.CSSProperties)
    : undefined;

  return (
    <div className="catalog-motion" data-cue={cue.id} aria-hidden>
      {/* Soft vignette pulls the eye onto the leg → free-end choreography. */}
      {arcHero && <div className="catalog-arc-vignette" />}
      <svg
        className="catalog-motion-svg"
        width={width}
        height={height}
        viewBox="0 0 1280 720"
        preserveAspectRatio="none"
      >
        <defs>
          <marker
            id={arrowId}
            markerWidth="12"
            markerHeight="10"
            refX="9.5"
            refY="5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L12,5 L0,10 Z" className="catalog-motion-arrowhead" />
          </marker>
          {(hero || arcHero) && (
            <linearGradient id="catalog-hero-glass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#9dffb0" stopOpacity="0.28" />
              <stop offset="0.55" stopColor="#9dffb0" stopOpacity="0.1" />
              <stop offset="1" stopColor="#9dffb0" stopOpacity="0.18" />
            </linearGradient>
          )}
          {hero && (
            <>
              <clipPath id="catalog-hero-clip">
                <path d={cue.outline} />
              </clipPath>
              <linearGradient
                id="catalog-hero-sheen-grad"
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.28" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </>
          )}
          {arcHero && rail && arcDest && (
            <>
              <filter
                id="catalog-arc-blur"
                x="-40%"
                y="-40%"
                width="180%"
                height="180%"
              >
                <feGaussianBlur stdDeviation="3.2" />
              </filter>
              <linearGradient
                id="catalog-arc-rail-grad"
                gradientUnits="userSpaceOnUse"
                x1={rail.p1.x}
                y1={rail.p1.y}
                x2={rail.p2.x}
                y2={rail.p2.y}
              >
                <stop offset="0" stopColor="#f5f8ff" stopOpacity="0.9" />
                <stop offset="1" stopColor="#9dffb0" />
              </linearGradient>
              <linearGradient
                id="catalog-arc-comet-grad"
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0" stopColor="#9dffb0" stopOpacity="0" />
                <stop offset="0.55" stopColor="#9dffb0" stopOpacity="0.45" />
                <stop offset="1" stopColor="#eafff0" stopOpacity="0.95" />
              </linearGradient>
              <radialGradient id="catalog-arc-pool-grad">
                <stop offset="0" stopColor="#9dffb0" stopOpacity="0.5" />
                <stop offset="1" stopColor="#9dffb0" stopOpacity="0" />
              </radialGradient>
            </>
          )}
        </defs>

        {/* Arc hero: soft landing-pad fill that brightens to "call" the leg
            in just before it seats. */}
        {arcHero && (
          <path className="catalog-arc-pad" d={cue.destination!} />
        )}

        {/* Destination: dashed static polygon where the object should end up. */}
        <path
          className="catalog-motion-under"
          d={cue.destination ?? cue.outline}
          transform={cue.destination ? undefined : targetTransform}
        />
        <path
          className="catalog-motion-target"
          d={cue.destination ?? cue.outline}
          transform={cue.destination ? undefined : targetTransform}
        />
        {/* Heroes: white "latch click" flash on the target outline, timed to
            the moment the ghost seats. */}
        {hero && (
          <path
            className="catalog-hero-latch"
            d={cue.destination ?? cue.outline}
            transform={cue.destination ? undefined : targetTransform}
          />
        )}
        {arcHero && (
          <path className="catalog-arc-latch" d={cue.destination!} />
        )}

        {/* Arc hero: curved conduit rail streaming energy from the held leg
            to the free end — drawn under the ghost so the glass leg flies
            over its own guide. */}
        {arcHero && rail && arcDest && (
          <g className="catalog-arc-conduit">
            <path className="catalog-arc-under" d={rail.d} pathLength={1} />
            <path
              className="catalog-arc-glow"
              d={rail.d}
              pathLength={1}
              filter="url(#catalog-arc-blur)"
            />
            <path
              id="catalog-arc-rail"
              className="catalog-arc-core"
              d={rail.d}
              pathLength={1}
              stroke="url(#catalog-arc-rail-grad)"
            />
            <path className="catalog-arc-flow" d={rail.d} pathLength={1} />
            <g
              transform={`translate(${rail.p2.x} ${rail.p2.y}) rotate(${rail.headAngle})`}
            >
              <path
                className="catalog-arc-head"
                d="M3,0 L-14,-6.8 L-9.5,0 L-14,6.8 Z"
              />
            </g>
            <g className="catalog-arc-comets">
              {ARC_COMETS.map((c, i) => (
                <g key={i}>
                  <ellipse
                    cx={-c.tail * 0.62}
                    rx={c.tail}
                    ry={c.r * 0.75}
                    fill="url(#catalog-arc-comet-grad)"
                  />
                  <circle
                    className="catalog-arc-comet-head"
                    r={c.r}
                    fill="#eafff0"
                  />
                  <animateMotion
                    dur={`${c.dur}s`}
                    begin={`${c.begin}s`}
                    repeatCount="indefinite"
                    rotate="auto"
                    calcMode="spline"
                    keyPoints="0;1"
                    keyTimes="0;1"
                    keySplines="0.3 0.08 0.35 1"
                  >
                    <mpath href="#catalog-arc-rail" />
                  </animateMotion>
                  <animate
                    attributeName="opacity"
                    values="0;1;1;0"
                    keyTimes="0;0.1;0.82;1"
                    dur={`${c.dur}s`}
                    begin={`${c.begin}s`}
                    repeatCount="indefinite"
                  />
                </g>
              ))}
            </g>
            {/* Impact: light pool + rings at the seat point, fired on the
                same 3.6s clock as the ghost's landing. */}
            <g transform={`translate(${arcDest.cx} ${arcDest.cy})`}>
              <circle
                className="catalog-arc-pool"
                r="16"
                fill="url(#catalog-arc-pool-grad)"
              />
              <circle className="catalog-arc-ring" />
              <circle className="catalog-arc-ring r2" />
            </g>
          </g>
        )}

        {/* Source: solid polygon locked on the real object. pathLength lets
            the hero trace draw itself on; inert for the plain cues. */}
        <path
          className="catalog-motion-under catalog-motion-under--object"
          d={cue.outline}
          pathLength={1}
        />
        <path className="catalog-motion-object" d={cue.outline} pathLength={1} />

        {/* Ghost: rigid copy gliding source → destination on a loop. */}
        {ghost && (
          <g className="catalog-motion-ghost" style={ghostStyle}>
            {(hero || arcHero) && (
              <path className="catalog-hero-ghost-glow" d={cue.outline} />
            )}
            <path className="catalog-motion-ghost-shape" d={cue.outline} />
            {hero &&
              cue.detailPaths?.map((d) => (
                <path key={d} className="catalog-hero-detail" d={d} />
              ))}
            {hero && (
              <g clipPath="url(#catalog-hero-clip)">
                <rect
                  className="catalog-hero-sheen"
                  x={source.cx - source.w / 2 - 190}
                  y={source.cy - source.h}
                  width="170"
                  height={source.h * 2}
                  fill="url(#catalog-hero-sheen-grad)"
                />
              </g>
            )}
          </g>
        )}

        {/* The arc hero's conduit rail replaces the plain straight arrow. */}
        {arrow && !arcHero && (
          <>
            <line
              className="catalog-motion-arrow-under"
              x1={arrow.x1}
              y1={arrow.y1}
              x2={arrow.x2}
              y2={arrow.y2}
            />
            <line
              className="catalog-motion-arrow"
              x1={arrow.x1}
              y1={arrow.y1}
              x2={arrow.x2}
              y2={arrow.y2}
              markerEnd={`url(#${arrowId})`}
            />
          </>
        )}
      </svg>

      <div
        className="catalog-motion-label"
        style={{
          left: `${(cue.labelAt[0] / 1280) * 100}%`,
          top: `${(cue.labelAt[1] / 720) * 100}%`,
        }}
      >
        <span className="catalog-motion-label-kicker">
          <i /> Outline locked
        </span>
        <span>{cue.label}</span>
      </div>
    </div>
  );
}
