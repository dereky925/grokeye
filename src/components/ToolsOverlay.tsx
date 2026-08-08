import { useState } from "react";
import { useDraggablePanel } from "../hooks/useDraggablePanel";
import type { ToolsState } from "../types";

type Props = {
  state: ToolsState;
  onChangePosition: (x: number, y: number) => void;
  onClose: () => void;
};

export default function ToolsOverlay({
  state,
  onChangePosition,
  onClose,
}: Props) {
  // Keyed by URL, not list index — indices repeat across refetches.
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const { tools, stepNumber, loading, x, y } = state;

  const { dragging, dragHandlers } = useDraggablePanel({
    x,
    y,
    onChange: onChangePosition,
    width: 184,
    height: 220,
  });

  const markFailed = (src: string) => {
    console.warn("[tools] image failed to load:", src);
    setFailed((prev) => {
      const next = new Set(prev);
      next.add(src);
      return next;
    });
  };

  return (
    <aside
      className={`tools-overlay ${dragging ? "dragging" : ""} ${loading ? "is-loading" : ""}`}
      style={{ left: x, top: y }}
      {...dragHandlers}
      aria-label="Tools for this step"
      aria-busy={loading}
    >
      <header className="tools-head">
        <div className="tools-kicker">
          {loading
            ? "Finding tools…"
            : stepNumber
              ? `Tools · step ${stepNumber}`
              : "Tools"}
        </div>
        <button type="button" className="tools-close" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="tools-strip">
        {loading && tools.length === 0
          ? Array.from({ length: 3 }).map((_, i) => (
              <div className="tool-card is-skeleton" key={`sk-${i}`}>
                <div className="tool-thumb" />
                <div className="tool-name-skel" />
              </div>
            ))
          : tools.map((tool, i) => {
              const src = tool.imageUrl
                ? `/api/img?url=${encodeURIComponent(tool.imageUrl)}`
                : "";
              return (
                <div className="tool-card" key={`${tool.name}-${i}`}>
                  <div className="tool-thumb">
                    {src && !failed.has(src) ? (
                      <img
                        src={src}
                        alt={tool.name}
                        onError={() => markFailed(src)}
                      />
                    ) : (
                      <svg
                        className="tool-thumb-fallback"
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <path
                          fill="currentColor"
                          d="M21.7 18.3l-7.1-7.1c.6-1.6.3-3.5-1-4.8-1.4-1.4-3.4-1.6-5.1-.9l3 3-2.1 2.1-3-3c-.7 1.7-.5 3.7.9 5.1 1.3 1.3 3.2 1.6 4.8 1l7.1 7.1c.4.4 1 .4 1.4 0l1.2-1.2c.4-.4.4-1 0-1.4z"
                        />
                      </svg>
                    )}
                  </div>
                  <div className="tool-name">{tool.name}</div>
                  {tool.note && <div className="tool-note">{tool.note}</div>}
                </div>
              );
            })}
      </div>
    </aside>
  );
}
