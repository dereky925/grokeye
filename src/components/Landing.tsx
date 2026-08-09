import type { MouseEvent } from "react";

type Props = {
  onTry?: () => void;
};

export default function Landing({ onTry }: Props) {
  const scrollToLibrary = (e: MouseEvent) => {
    e.preventDefault();
    if (onTry) {
      onTry();
      return;
    }
    document.getElementById("library")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="lp-hero">
      <h1 className="lp-hero-title">Grok-Augmented Reality</h1>

      <div className="lp-hero-body">
        <div className="lp-hero-copy">
          <p className="lp-thesis">
            GrokEye augments physical workers hands-free with voice-controlled agentic tool
            calling.
          </p>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="#library" onClick={scrollToLibrary}>
              Try GrokEye
            </a>
          </div>
          <div className="lp-stack-strip" aria-label="Built on the Grok stack">
            <span>Built on</span> Grok Vision · Grok Voice · Agent Tools · X Search
          </div>
        </div>

        <figure className="lp-preview" aria-label="GrokEye highlighting a PCIe slot in a worker's view">
          <div className="lp-preview-frame">
            <img src="/videos/pov-pc-build-gpu-thumb.jpg" alt="" />
            <div className="lp-preview-scan" aria-hidden />
            <svg
              className="lp-preview-overlay"
              viewBox="0 0 160 90"
              preserveAspectRatio="none"
              aria-hidden
            >
              <g className="lp-ar-source">
                <rect x="6" y="38" width="34" height="44" rx="2" />
              </g>
              <g className="lp-ar-target">
                <path d="M 68 44 h 7 M 68 44 v 6" />
                <path d="M 96 44 h -7 M 96 44 v 6" />
                <path d="M 68 72 h 7 M 68 72 v -6" />
                <path d="M 96 72 h -7 M 96 72 v -6" />
              </g>
              <g className="lp-ar-arrow">
                <path d="M 42 60 C 52 54, 58 54, 65 56" />
                <path className="lp-ar-arrowhead" d="M 65 56 l -4.5 -1.6 M 65 56 l -3.4 3.4" />
              </g>
            </svg>
            <div className="lp-ar-label lp-ar-label-source">GPU · tracked</div>
            <div className="lp-ar-label lp-ar-label-target">PCIe x16 slot</div>
            <div className="lp-preview-question">“Where does this connect?”</div>
            <div className="lp-preview-voice">
              <span className="lp-voice-dot" aria-hidden />
              <span className="lp-voice-name">Grok</span>
              <span className="lp-voice-text">
                Line the card up with the x16 slot — the long one by your fingers.
              </span>
            </div>
          </div>
          <figcaption className="lp-preview-caption">
            A frame from the live demo — tracked highlight, connection arrow, spoken answer.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
