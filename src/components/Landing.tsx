import type { MouseEvent } from "react";
import { navigate } from "../lib/router";

const THESES = [
  {
    title: "Help every worker",
    body: "Spoken, visual guidance grounded in the worker's own view — identify parts, catch mistakes, trace where things connect. Hands stay on the work.",
  },
  {
    title: "Learn from every problem",
    body: "When a fix is verified on camera, GrokEye keeps the question, the answer, and the source. That record becomes searchable operational memory.",
  },
  {
    title: "Improve the whole company",
    body: "Grok reasons across those sessions to rank recurring friction, missing documentation, and the downtime they cause — before they repeat.",
  },
];

const LOOP = ["Worker asks", "Grok sees", "Grok guides", "Result is verified", "Organization learns"];

const GROK_STACK: { name: string; body: string }[] = [
  {
    name: "Grok Vision",
    body: "Reads the worker's frames — identifies parts, judges progress, and grounds each highlight in what is actually visible.",
  },
  {
    name: "Grok Voice",
    body: "Answers out loud in a sentence or two, hands-free, while the work continues.",
  },
  {
    name: "Grok Agent Tools",
    body: "Runs live web search for how-to manuals and current specs, returned step-by-step with citations.",
  },
  {
    name: "X Search",
    body: "Pulls field reports and real-time signals from X to weigh against the official documentation.",
  },
  {
    name: "Grokipedia",
    body: "Supplies the deeper background behind a procedure when the manual falls short.",
  },
  {
    name: "Grok Reasoning",
    body: "Reads across verified sessions to rank bottlenecks, spot knowledge gaps, and estimate what they cost.",
  },
];

const TRUST = [
  {
    title: "Grounded answers",
    body: "Claims are tied to visible frames or cited sources. If Grok can't see it, it says so.",
  },
  {
    title: "Aggregated patterns",
    body: "Company reporting runs on anonymized, aggregated sessions. It measures systems and procedures; individuals are never scored.",
  },
  {
    title: "Private by default",
    body: "Footage and incidents stay inside the company. Posting anything to X takes an explicit one-tap approval.",
  },
];

export default function Landing() {
  const go = (path: string) => (e: MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };

  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="brand" href="/" onClick={go("/")}>
          <img src="/assets/grok-logo.png" alt="GrokEye" />
          <div className="brand-title">GrokEye</div>
        </a>
        <nav className="lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#grok">Powered by Grok</a>
          <a href="/organization" onClick={go("/organization")}>
            Organization Intelligence
          </a>
        </nav>
        <a className="lp-btn lp-btn-primary lp-btn-nav" href="/videos" onClick={go("/videos")}>
          Try GrokEye
        </a>
      </header>

      <main className="lp-main">
        {/* ---------- Hero ---------- */}
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <div className="lp-kicker">Grokathon 2026</div>
            <h1>
              Grok-powered intelligence
              <br />
              for the physical world.
            </h1>
            <p className="lp-thesis">
              GrokEye looks through the worker's eyes, speaks the fix, and points at the exact
              spot — hands-free.
            </p>
            <p className="lp-sub">
              Verified fixes feed an operational memory, and Grok reasons over it to surface
              recurring friction, missing documentation, and preventable downtime across the
              whole operation.
            </p>
            <div className="lp-cta-row">
              <a className="lp-btn lp-btn-primary" href="/videos" onClick={go("/videos")}>
                Try GrokEye
              </a>
              <a className="lp-btn lp-btn-ghost" href="/organization" onClick={go("/organization")}>
                Explore Organization Intelligence
              </a>
            </div>
            <div className="lp-stack-strip" aria-label="Built on the Grok stack">
              <span>Built on</span> Grok Vision · Grok Voice · Agent Tools · X Search · Grokipedia
            </div>
          </div>

          {/* AR preview — real demo frame with the player's overlay vocabulary */}
          <figure className="lp-preview" aria-label="GrokEye highlighting a PCIe slot in a worker's view">
            <div className="lp-preview-frame">
              <img src="/videos/pov-pc-build-gpu-thumb.jpg" alt="" />
              <div className="lp-preview-scan" aria-hidden />
              <svg className="lp-preview-overlay" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden>
                {/* source box — the GPU on the mat */}
                <g className="lp-ar-source">
                  <rect x="6" y="38" width="34" height="44" rx="2" />
                </g>
                {/* target reticle — the PCIe slot area */}
                <g className="lp-ar-target">
                  <path d="M 68 44 h 7 M 68 44 v 6" />
                  <path d="M 96 44 h -7 M 96 44 v 6" />
                  <path d="M 68 72 h 7 M 68 72 v -6" />
                  <path d="M 96 72 h -7 M 96 72 v -6" />
                </g>
                {/* tracked connection arrow, GPU → slot */}
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
                <span className="lp-voice-text">Line the card up with the x16 slot — the long one by your fingers.</span>
              </div>
            </div>
            <figcaption className="lp-preview-caption">
              A frame from the live demo — tracked highlight, connection arrow, spoken answer.
            </figcaption>
          </figure>
        </section>

        {/* ---------- Three theses ---------- */}
        <section className="lp-section" id="how">
          <div className="lp-section-head">
            <div className="lp-kicker">What it does</div>
            <h2>How one question becomes company knowledge.</h2>
          </div>
          <div className="lp-theses">
            {THESES.map((t, i) => (
              <article className="lp-thesis-card" key={t.title} style={{ animationDelay: `${i * 80}ms` }}>
                <div className="lp-thesis-num">{String(i + 1).padStart(2, "0")}</div>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
              </article>
            ))}
          </div>

          {/* learning loop */}
          <div className="lp-loop" role="list" aria-label="The learning loop">
            {LOOP.map((step, i) => (
              <div className="lp-loop-item" role="listitem" key={step}>
                <div className={`lp-loop-node ${i === LOOP.length - 1 ? "is-final" : ""}`}>
                  <span className="lp-loop-dot" aria-hidden />
                  {step}
                </div>
                {i < LOOP.length - 1 && (
                  <svg className="lp-loop-link" viewBox="0 0 40 8" aria-hidden>
                    <path d="M 1 4 H 33" />
                    <path d="M 33 4 l -5 -3 M 33 4 l -5 3" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Powered by Grok ---------- */}
        <section className="lp-section" id="grok">
          <div className="lp-section-head">
            <div className="lp-kicker">Powered by Grok</div>
            <h2>The whole pipeline is Grok.</h2>
            <p className="lp-section-sub">
              Perception, voice, retrieval, reasoning — the demo runs a Grok product at each
              stage.
            </p>
          </div>
          <div className="lp-grok-grid">
            {GROK_STACK.map((g, i) => (
              <article className="lp-grok-card" key={g.name} style={{ animationDelay: `${i * 60}ms` }}>
                <div className="lp-grok-card-top">
                  <h3>{g.name}</h3>
                  <span className="lp-tag lp-tag-live">
                    <span className="lp-tag-dot" aria-hidden />
                    Live in the demo
                  </span>
                </div>
                <p>{g.body}</p>
              </article>
            ))}
          </div>
          <p className="lp-grok-foot">
            Also in the demo: the X API — one tap posts a verified AR moment to X with a
            Grok-written caption.
          </p>
        </section>

        {/* ---------- Trust ---------- */}
        <section className="lp-section lp-trust-section">
          <div className="lp-section-head">
            <div className="lp-kicker">Trust</div>
            <h2>Built for trust on the floor.</h2>
          </div>
          <div className="lp-trust">
            {TRUST.map((t) => (
              <article className="lp-trust-card" key={t.title}>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------- Closing CTA ---------- */}
        <section className="lp-closing">
          <h2>Put Grok on the floor.</h2>
          <div className="lp-cta-row lp-cta-center">
            <a className="lp-btn lp-btn-primary" href="/videos" onClick={go("/videos")}>
              Try GrokEye
            </a>
            <a className="lp-btn lp-btn-ghost" href="/organization" onClick={go("/organization")}>
              Organization Intelligence
            </a>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <span>GrokEye · Grokathon 2026</span>
      </footer>
    </div>
  );
}
