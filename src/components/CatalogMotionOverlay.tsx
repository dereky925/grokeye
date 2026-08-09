import type { CatalogMotionCue } from "../lib/choreography";

type Props = {
  cue: CatalogMotionCue;
  width: number;
  height: number;
};

/**
 * Loop beats: lock onto the object (hold), glide to the destination (eased),
 * lock onto the destination (hold), then fade out and restart. The return leg
 * happens entirely inside the faded-out tail so the outline never visibly
 * sloshes backwards.
 */
const LOOP_SECONDS = 3.2;
const MOTION_START_SECONDS = 0.18;
const MOTION_KEY_TIMES = "0;0.26;0.55;0.96;1";
const MOTION_KEY_SPLINES = "0 0 1 1;0.4 0 0.2 1;0 0 1 1;0 0 1 1";
const FADE_KEY_TIMES = "0;0.26;0.55;0.9;0.96;1";
const FADE_VALUES = "1;1;1;1;0;0";

function fadeAnimate() {
  return (
    <animate
      attributeName="opacity"
      begin={`${MOTION_START_SECONDS}s`}
      dur={`${LOOP_SECONDS}s`}
      repeatCount="indefinite"
      values={FADE_VALUES}
      keyTimes={FADE_KEY_TIMES}
    />
  );
}

function destinationTransform(cue: CatalogMotionCue): string | undefined {
  if (cue.delta) return `translate(${cue.delta[0]} ${cue.delta[1]})`;
  if (cue.rotation) {
    const { degrees, cx, cy } = cue.rotation;
    return `rotate(${degrees} ${cx} ${cy})`;
  }
  return undefined;
}

export default function CatalogMotionOverlay({ cue, width, height }: Props) {
  const gradientId = `catalog-flow-${cue.id}`;
  const glowId = `catalog-glow-${cue.id}`;
  const arrowId = `catalog-arrow-${cue.id}`;
  const targetTransform = destinationTransform(cue);

  const animatedObject = (
    <>
      <path
        className="catalog-motion-object"
        d={cue.outline}
        pathLength="1"
      >
        {cue.mode === "morph" && cue.destination && (
          <>
            <animate
              attributeName="d"
              begin={`${MOTION_START_SECONDS}s`}
              dur={`${LOOP_SECONDS}s`}
              repeatCount="indefinite"
              calcMode="spline"
              keySplines={MOTION_KEY_SPLINES}
              values={`${cue.outline};${cue.outline};${cue.destination};${cue.destination};${cue.outline}`}
              keyTimes={MOTION_KEY_TIMES}
            />
            {fadeAnimate()}
          </>
        )}
      </path>
      {cue.detailPaths?.map((path, index) => (
        <path
          key={path}
          className="catalog-motion-detail"
          d={path}
          pathLength="1"
          style={{ animationDelay: `${90 + index * 45}ms` }}
        />
      ))}
    </>
  );

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
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f2fff3" />
            <stop offset="0.42" stopColor="#9dffb0" />
            <stop offset="1" stopColor="#55eaff" />
          </linearGradient>
          <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker
            id={arrowId}
            markerWidth="13"
            markerHeight="11"
            refX="10"
            refY="5.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L13,5.5 L0,11 Z" className="catalog-motion-arrowhead" />
          </marker>
        </defs>

        <path
          className="catalog-motion-target"
          d={cue.destination ?? cue.outline}
          transform={cue.destination ? undefined : targetTransform}
        />

        {cue.mode === "morph" ? (
          animatedObject
        ) : (
          <g className={`catalog-motion-moving is-${cue.mode}`}>
            {cue.delta && (
              <animateTransform
                attributeName="transform"
                type="translate"
                begin={`${MOTION_START_SECONDS}s`}
                dur={`${LOOP_SECONDS}s`}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines={MOTION_KEY_SPLINES}
                values={`0 0;0 0;${cue.delta[0]} ${cue.delta[1]};${cue.delta[0]} ${cue.delta[1]};0 0`}
                keyTimes={MOTION_KEY_TIMES}
              />
            )}
            {cue.rotation && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                begin={`${MOTION_START_SECONDS}s`}
                dur={`${LOOP_SECONDS}s`}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines={MOTION_KEY_SPLINES}
                values={`0 ${cue.rotation.cx} ${cue.rotation.cy};0 ${cue.rotation.cx} ${cue.rotation.cy};${cue.rotation.degrees} ${cue.rotation.cx} ${cue.rotation.cy};${cue.rotation.degrees} ${cue.rotation.cx} ${cue.rotation.cy};0 ${cue.rotation.cx} ${cue.rotation.cy}`}
                keyTimes={MOTION_KEY_TIMES}
              />
            )}
            {fadeAnimate()}
            {animatedObject}
          </g>
        )}

        <path className="catalog-motion-rail-glow" d={cue.motionPath} />
        <path
          className="catalog-motion-rail"
          d={cue.motionPath}
          markerEnd={`url(#${arrowId})`}
          style={{ stroke: `url(#${gradientId})`, filter: `url(#${glowId})` }}
        />

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
