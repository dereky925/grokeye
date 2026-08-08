import { useEffect, useState } from "react";
import VoiceOrb from "./VoiceOrb";
import type { VoicePhase } from "../types";

type Props = {
  phase: VoicePhase;
  transcript: string;
  reply: string;
  error?: string | null;
  level?: number;
  usedVision?: boolean;
};

const EXIT_MS = 280;

export default function VoiceBubble({
  phase,
  transcript,
  reply,
  error,
  level = 0,
  usedVision = false,
}: Props) {
  const visible = phase !== "idle";
  const [mounted, setMounted] = useState(visible);
  const [leaving, setLeaving] = useState(false);
  const [renderPhase, setRenderPhase] = useState(phase);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setLeaving(false);
      setRenderPhase(phase);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const id = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [visible, phase, mounted]);

  useEffect(() => {
    if (visible) setRenderPhase(phase);
  }, [phase, visible]);

  if (!mounted) return null;

  const status =
    renderPhase === "listening"
      ? "Listening…"
      : renderPhase === "thinking"
        ? usedVision
          ? "Looking at the frame…"
          : "Thinking…"
        : renderPhase === "speaking"
          ? "Grok"
          : renderPhase === "error"
            ? "Something went wrong"
            : "";

  return (
    <div
      className={`voice-overlay ${leaving ? "is-leaving" : ""}`}
      aria-live="polite"
    >
      <div className="voice-stack">
        <div className={`voice-bubble phase-${renderPhase}`}>
          <VoiceOrb phase={renderPhase === "idle" ? "listening" : renderPhase} level={level} />
        </div>
        <div className="voice-copy">
          <p className="voice-status">{status}</p>
          {renderPhase === "listening" && (
            <p className="voice-transcript">
              {transcript || "Ask me anything"}
            </p>
          )}
          {renderPhase === "thinking" && (
            <p className="voice-transcript">{transcript}</p>
          )}
          {(renderPhase === "speaking" || renderPhase === "error") && (
            <p className={`voice-transcript ${reply ? "reply" : ""}`}>
              {error || reply}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
