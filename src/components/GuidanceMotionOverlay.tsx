import type { GuidanceMotion, HighlightLabel } from "../types";

type Props = {
  motion: GuidanceMotion;
  labels: HighlightLabel[];
  width: number;
  height: number;
};

type Point = { x: number; y: number };

function center(label: HighlightLabel, width: number, height: number): Point {
  return {
    x: (label.x + label.w / 2) * width,
    y: (label.y + label.h / 2) * height,
  };
}

function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.min(width - 22, Math.max(22, point.x)),
    y: Math.min(height - 22, Math.max(22, point.y)),
  };
}

function rotate(point: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function buildMotionPath(
  motion: GuidanceMotion,
  pivot: Point,
  moving: Point,
  width: number,
  height: number,
) {
  const start = clampPoint(moving, width, height);
  let end: Point;
  let control: Point;

  if (motion.type === "line") {
    const toPivot = { x: pivot.x - start.x, y: pivot.y - start.y };
    const distance = Math.hypot(toPivot.x, toPivot.y) || 1;
    const toward = { x: toPivot.x / distance, y: toPivot.y / distance };
    const directions: Record<string, Point> = {
      toward,
      away: { x: -toward.x, y: -toward.y },
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };
    const unit = directions[motion.direction] ?? toward;
    const length = Math.min(190, Math.max(90, Math.min(width, height) * 0.24));
    end = clampPoint(
      { x: start.x + unit.x * length, y: start.y + unit.y * length },
      width,
      height,
    );
    const normal = { x: -unit.y, y: unit.x };
    control = clampPoint(
      {
        x: (start.x + end.x) / 2 + normal.x * 18,
        y: (start.y + end.y) / 2 + normal.y * 18,
      },
      width,
      height,
    );
  } else {
    let radial = { x: start.x - pivot.x, y: start.y - pivot.y };
    let radius = Math.hypot(radial.x, radial.y);
    if (radius < 42) {
      radius = Math.min(120, Math.max(72, Math.min(width, height) * 0.16));
      radial = { x: radius, y: 0 };
    }
    const clockwise = motion.direction !== "counterclockwise";
    const angle = (motion.sweep * Math.PI) / 180 * (clockwise ? 1 : -1);
    const endVector = rotate(radial, angle);
    const halfVector = rotate(radial, angle / 2);
    const bulge = 1 / Math.max(0.3, Math.cos(Math.abs(angle) / 2));
    end = clampPoint(
      { x: pivot.x + endVector.x, y: pivot.y + endVector.y },
      width,
      height,
    );
    control = clampPoint(
      {
        x: pivot.x + halfVector.x * bulge,
        y: pivot.y + halfVector.y * bulge,
      },
      width,
      height,
    );
  }

  const path = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  const labelPoint = {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
  };
  return { start, end, path, labelPoint };
}

export default function GuidanceMotionOverlay({
  motion,
  labels,
  width,
  height,
}: Props) {
  const pivotLabel = labels.find((label) => label.id === motion.pivotId);
  const movingLabel = labels.find((label) => label.id === motion.movingId);
  if (!pivotLabel || !movingLabel) return null;

  const pivot = center(pivotLabel, width, height);
  const moving = center(movingLabel, width, height);
  const geometry = buildMotionPath(motion, pivot, moving, width, height);

  return (
    <>
      <svg
        className="guidance-motion-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
      >
        <defs>
          <linearGradient id="guidance-flow-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#dfffe6" stopOpacity="0.28" />
            <stop offset="0.48" stopColor="#9dffb0" />
            <stop offset="1" stopColor="#69f4ff" />
          </linearGradient>
          <filter id="guidance-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker
            id="guidance-arrowhead"
            markerWidth="11"
            markerHeight="10"
            refX="8.5"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L11,5 L0,10 Z" className="guidance-motion-arrowhead" />
          </marker>
        </defs>

        <g className="guidance-pivot" transform={`translate(${pivot.x} ${pivot.y})`}>
          <circle className="guidance-pivot-wave wave-one" r="19" />
          <circle className="guidance-pivot-wave wave-two" r="19" />
          <circle className="guidance-pivot-core" r="5" />
          <line x1="-10" y1="0" x2="10" y2="0" />
          <line x1="0" y1="-10" x2="0" y2="10" />
        </g>

        <path className="guidance-motion-glow" d={geometry.path} />
        <path className="guidance-motion-rail" d={geometry.path} />
        <path
          className="guidance-motion-flow"
          d={geometry.path}
          markerEnd="url(#guidance-arrowhead)"
        />

        {[0, 1, 2].map((index) => (
          <circle
            key={index}
            className={`guidance-motion-particle particle-${index + 1}`}
            r={index === 0 ? 4.2 : 3.2}
          >
            <animateMotion
              dur="1.55s"
              begin={`${index * -0.5}s`}
              repeatCount="indefinite"
              path={geometry.path}
            />
          </circle>
        ))}

        <g
          className="guidance-motion-ghost"
          transform={`translate(${geometry.end.x} ${geometry.end.y})`}
        >
          <circle r="13" />
          <circle r="5" />
        </g>
      </svg>

      <div
        className="guidance-motion-label"
        style={{
          left: Math.min(width - 170, Math.max(12, geometry.labelPoint.x - 72)),
          top: Math.min(height - 52, Math.max(12, geometry.labelPoint.y - 48)),
        }}
      >
        <span className="guidance-motion-label-kicker">Motion guide</span>
        <span>{motion.label}</span>
      </div>
    </>
  );
}
