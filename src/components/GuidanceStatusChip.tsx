import type { GuidanceCue } from "../types";

type Props = { cue: GuidanceCue; authored?: boolean };

const COPY = {
  ready: "Motion locked",
  wrong_tool: "Wrong tool",
  not_visible: "Need a clearer view",
  unsafe_to_show: "Can't guide safely",
} as const;

export default function GuidanceStatusChip({ cue, authored = false }: Props) {
  return (
    <div
      className={`guidance-status-chip is-${cue.status}${authored ? " is-authored" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="guidance-status-mark" aria-hidden>
        <span />
      </span>
      <span className="guidance-status-copy">
        <span className="guidance-status-kicker">
          {authored && cue.status === "ready" ? "Scene mapped" : COPY[cue.status]}
        </span>
        <span>{cue.note}</span>
      </span>
    </div>
  );
}
