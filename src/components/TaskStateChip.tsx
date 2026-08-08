import type { TaskSession } from "../types";

type Props = {
  task: TaskSession;
};

export default function TaskStateChip({ task }: Props) {
  const verificationActive =
    task.stage === "verifying" ||
    task.stage === "resolved" ||
    Boolean(task.verdict);
  const verdictClass = task.verdict ? `is-${task.verdict}` : "";

  return (
    <div
      className={`task-state-chip ${verdictClass}`}
      role="status"
      aria-live="polite"
      aria-label={`Task status: ${task.stage.replace("_", " ")}${task.verdict ? `, ${task.verdict.replaceAll("_", " ")}` : ""}`}
    >
      <span className="task-state-segment is-active">Observed</span>
      <span className="task-state-segment is-active">Guided</span>
      <span
        className={`task-state-segment ${verificationActive ? "is-active" : ""} ${task.stage === "verifying" ? "is-verifying" : ""}`}
      >
        Verified
      </span>
    </div>
  );
}
