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
    return {
      to: `translate(${(dest.cx - source.cx).toFixed(1)}px, ${(dest.cy - source.cy).toFixed(1)}px) scale(${scale.toFixed(3)})`,
      destCenter: { x: dest.cx, y: dest.cy },
    };
  }
  if (cue.delta) {
    return {
      to: `translate(${cue.delta[0]}px, ${cue.delta[1]}px)`,
      destCenter: { x: source.cx + cue.delta[0], y: source.cy + cue.delta[1] },
    };
  }
  if (cue.rotation) {
    return { to: `rotate(${cue.rotation.degrees}deg)`, destCenter: null };
  }
  return null;
}

export default function CatalogMotionOverlay({ cue, width, height }: Props) {
  const arrowId = `catalog-arrow-${cue.id}`;
  const source = pathBox(cue.outline);
  const ghost = ghostTransform(cue, source);

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
    ? cue.rotation && !cue.destination && !cue.delta
      ? ({
          transformBox: "view-box",
          transformOrigin: `${cue.rotation.cx}px ${cue.rotation.cy}px`,
          "--ghost-to": ghost.to,
        } as React.CSSProperties)
      : ({
          transformBox: "fill-box",
          transformOrigin: "50% 50%",
          "--ghost-to": ghost.to,
        } as React.CSSProperties)
    : undefined;

  return (
    <div className="catalog-motion" data-cue={cue.id} aria-hidden>
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
        </defs>

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

        {/* Source: solid polygon locked on the real object. */}
        <path className="catalog-motion-under" d={cue.outline} />
        <path className="catalog-motion-object" d={cue.outline} />

        {/* Ghost: rigid copy gliding source → destination on a loop. */}
        {ghost && (
          <g className="catalog-motion-ghost" style={ghostStyle}>
            <path className="catalog-motion-ghost-shape" d={cue.outline} />
          </g>
        )}

        {arrow && (
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
