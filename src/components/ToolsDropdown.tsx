import type { ToolkitState, ToolStatus } from "../types";

type Props = {
  toolkit: ToolkitState;
  onClose: () => void;
};

const STATUS_LABEL: Record<ToolStatus, string> = {
  in_view: "in view",
  missing: "get this",
  unknown: "check kit",
};

export default function ToolsDropdown({ toolkit, onClose }: Props) {
  const { doc, loading } = toolkit;

  return (
    <aside
      className={`tools-dropdown ${loading ? "is-loading" : ""}`}
      aria-label="Tool checklist"
      aria-busy={loading}
    >
      <header className="tools-head">
        <div className="tools-kicker">{loading ? "Checking" : "Toolkit"}</div>
        <button type="button" className="tools-close" onClick={onClose}>
          Close
        </button>
      </header>

      {loading || !doc ? (
        <div className="tools-loading">
          <span className="tools-loading-ring" aria-hidden />
          <p className="tools-loading-copy">
            Grok is checking what this job needs…
          </p>
        </div>
      ) : (
        <>
          <h2 className="tools-task">{doc.task}</h2>
          <ul className="tools-list">
            {doc.tools.map((tool, i) => (
              <li
                key={tool.name}
                className={`tools-item is-${tool.status}`}
                style={{ animationDelay: `${i * 45}ms` }}
              >
                <span className="tools-item-mark" aria-hidden />
                <span className="tools-item-body">
                  <span className="tools-item-name">
                    {tool.name}
                    {tool.essential && tool.status === "missing" && (
                      <span className="tools-item-flag">needed</span>
                    )}
                  </span>
                  {tool.purpose && (
                    <span className="tools-item-purpose">{tool.purpose}</span>
                  )}
                </span>
                <span className="tools-item-status">
                  {STATUS_LABEL[tool.status]}
                </span>
              </li>
            ))}
          </ul>
          <p className="tools-hint">Say “close the tool list”</p>
        </>
      )}
    </aside>
  );
}
