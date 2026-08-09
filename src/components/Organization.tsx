import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { navigate } from "../lib/router";

/**
 * Organization Intelligence — company-wide picture built from verified
 * assistance sessions.
 */

const KPIS: {
  label: string;
  value: string;
  delta?: string;
  spark?: number[];
}[] = [
  { label: "Assisted tasks", value: "1,284", delta: "+18% vs last quarter", spark: [12, 14, 13, 17, 19, 18, 22, 24, 23, 27, 30, 34] },
  { label: "First-time resolution", value: "91%", delta: "+6 pts vs last quarter", spark: [78, 80, 79, 82, 84, 83, 86, 85, 88, 89, 90, 91] },
  { label: "Downtime avoided", value: "146 h", delta: "this quarter" },
  { label: "Repeat incidents prevented", value: "37", delta: "this quarter" },
];

/* Productivity trajectory — tasks per tech per shift, indexed to 100 at rollout. */
const TREND = {
  months: ["Mar", "Apr", "May", "Jun", "Jul", "Aug"],
  values: [100, 104, 118, 131, 147, 158],
};

const IMPACT_ROWS = [
  { label: "Median time to resolution", before: "11.4 min", after: "4.2 min", delta: "−63%" },
  { label: "New-hire ramp to solo work", before: "6 weeks", after: "11 days", delta: "−74%" },
  { label: "Escalations to specialists", before: "31%", after: "13%", delta: "−58%" },
  { label: "Downtime from repeat incidents", before: "96 h", after: "22 h", delta: "−77%" },
];

const FRICTION = [
  { pattern: "Unclear cable destinations", n: 41, impact: "6.8 h lost" },
  { pattern: "Undocumented rack variations", n: 29, impact: "4.1 h lost" },
  { pattern: "Missing component labels", n: 23, impact: "18 repeat questions" },
  { pattern: "Wrong tool at hand", n: 17, impact: "1.9 h lost" },
  { pattern: "Skipped prep steps (ESD, staging)", n: 12, impact: "6 near-misses" },
];

const GAPS = [
  { topic: "Rack B12–B18 port layout", detail: "14 sessions · no internal doc", level: 0.95 },
  { topic: "12VHPWR seating check", detail: "9 repeat questions", level: 0.62 },
  { topic: "AIO cooler mounting orientation", detail: "7 manual lookups", level: 0.5 },
  { topic: "Spare-cable labeling convention", detail: "5 unresolved asks", level: 0.34 },
];

const SESSIONS = [
  {
    thumb: "/videos/pov-pc-build-fail-thumb.jpg",
    question: "Am I doing this right?",
    guidance: "Parts are resting on fabric with no ESD strap — move to a hard surface first.",
    verdict: "Corrected in session",
    source: "Internal ESD handling SOP",
  },
  {
    thumb: "/videos/pov-pc-build-gpu-thumb.jpg",
    question: "Where does this connect?",
    guidance: "Tracked arrow from the card to the PCIe x16 slot; seat until the latch clicks.",
    verdict: "Verified complete",
    source: "Motherboard manual, p. 24 — via Agent Tools",
  },
  {
    thumb: "/videos/pov-pc-build-cpu-ram-thumb.jpg",
    question: "Which way does this chip go in?",
    guidance: "Gold triangle to the socket's marked corner — zero force once aligned.",
    verdict: "Verified complete",
    source: "CPU install guide — via Agent Tools",
  },
  {
    thumb: "/videos/pov-copper-plumbing-thumb.jpg",
    question: "Is this joint ready to solder?",
    guidance: "Flux is on, but the fitting isn't fully seated — push it to the stop.",
    verdict: "Verified after retry",
    source: "Copper joint manual — via Agent Tools",
  },
];

const QA: { q: string; a: string; evidence: string[] }[] = [
  {
    q: "Why are installations taking longer at Site 3?",
    a: "Most delays trace to undocumented port-layout differences in racks B12–B18. The pattern appears in 14 verified assistance sessions and accounts for roughly 3.2 hours of repeated troubleshooting.",
    evidence: ["14 verified sessions", "x_search: 3 field reports on B-series rack revisions", "Agent Tools found no internal doc"],
  },
  {
    q: "What should we document first?",
    a: "The rack B12–B18 port layout. It generates the most questions with no internal source — Grok currently reconstructs the answer from vendor manuals and live frames each time.",
    evidence: ["Knowledge gap №1 — 14 sessions", "Grokipedia has the background, no site specifics"],
  },
  {
    q: "Where do new hires struggle most?",
    a: "Cable destinations. 41 assisted moments cluster in first-week tasks; a labeled harness diagram at the bench would remove most of them.",
    evidence: ["Friction №1 — 41 occurrences", "6.8 h lost this quarter"],
  },
  {
    q: "What did GrokEye save us this quarter?",
    a: "About 146 hours of downtime and 37 repeat incidents. Median time to resolution fell 63% since rollout — at your loaded labor rate that is roughly $412K annualized.",
    evidence: ["KPI ledger, Mar–Aug", "Impact model — Grok Reasoning"],
  },
];

const FALLBACK =
  "Grok Reasoning works over your organization's verified sessions. Try one of the questions above, or ask about friction, sites, or documentation.";

function Sparkline({ data }: { data: number[] }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => ({
    x: 2 + (i / (data.length - 1)) * 92,
    y: 22 - ((v - min) / range) * 18,
  }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="org-spark" viewBox="0 0 96 26" aria-hidden>
      <path d={path} />
      <circle cx={last.x} cy={last.y} r="2.6" />
    </svg>
  );
}

function TrendChart() {
  const W = 560;
  const H = 230;
  const PAD = { left: 34, right: 56, top: 26, bottom: 30 };
  const min = 92;
  const max = 166;
  const x = (i: number) =>
    PAD.left + (i / (TREND.values.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
  const pts = TREND.values.map((v, i) => ({ x: x(i), y: y(v) }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg
      className="org-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Tasks per technician per shift, indexed to 100 at rollout, rising to 158 over six months"
    >
      {/* baseline at index 100 */}
      <line className="org-chart-baseline" x1={PAD.left} y1={y(100)} x2={W - PAD.right} y2={y(100)} />
      <text className="org-chart-tick" x={PAD.left - 6} y={y(100) + 3} textAnchor="end">
        100
      </text>
      {/* month labels */}
      {TREND.months.map((m, i) => (
        <text key={m} className="org-chart-tick" x={x(i)} y={H - 10} textAnchor="middle">
          {m}
        </text>
      ))}
      <path className="org-chart-line" d={path} />
      <circle className="org-chart-dot" cx={last.x} cy={last.y} r="4" />
      <text className="org-chart-end" x={last.x + 10} y={last.y - 8}>
        158
      </text>
      <text className="org-chart-delta" x={last.x + 10} y={last.y + 8}>
        +58%
      </text>
    </svg>
  );
}

export default function Organization() {
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ a: string; evidence: string[] } | null>(null);
  const [typed, setTyped] = useState("");
  const [input, setInput] = useState("");
  const timerRef = useRef<number | null>(null);

  const go = (path: string) => (e: MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  const ask = (q: string) => {
    const match = QA.find((item) => item.q === q);
    const found =
      match ??
      QA.find((item) =>
        q
          .toLowerCase()
          .split(/\W+/)
          .some((w) => w.length > 4 && item.q.toLowerCase().includes(w)),
      );
    const next = found ?? { q, a: FALLBACK, evidence: ["Session ledger — 122 verified sessions"] };
    setAsked(q);
    setAnswer({ a: next.a, evidence: next.evidence });
    setTyped("");
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    let i = 0;
    timerRef.current = window.setInterval(() => {
      i += 3;
      setTyped(next.a.slice(0, i));
      if (i >= next.a.length && timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 24);
  };

  const maxN = Math.max(...FRICTION.map((f) => f.n));
  const done = answer !== null && typed.length >= answer.a.length;

  return (
    <div className="org">
      <header className="org-nav">
        <div className="org-nav-left">
          <a className="org-back" href="/" onClick={go("/")} aria-label="Back to overview">
            ←
          </a>
          <a className="brand" href="/" onClick={go("/")}>
            <img src="/assets/grok-logo.png" alt="" />
            <div className="brand-title">
              GrokEye <span className="org-brand-sub">Organization Intelligence</span>
            </div>
          </a>
        </div>
        <div className="org-nav-right">
          <a className="lp-btn lp-btn-primary lp-btn-nav" href="/videos" onClick={go("/videos")}>
            Try GrokEye
          </a>
        </div>
      </header>

      <main className="org-page">
        <section className="org-head">
          <h1>The company brain.</h1>
          <p>
            GrokEye turns verified worker sessions into an operational picture of the whole
            company: where time is lost, which knowledge is missing, and what fixing it is
            worth. The picture below is a mid-size datacenter team.
          </p>
        </section>

        {/* ---------- KPIs ---------- */}
        <section className="org-kpis" aria-label="Key metrics">
          {KPIS.map((k, i) => (
            <div className="org-kpi" key={k.label} style={{ animationDelay: `${i * 60}ms` }}>
              <div className="org-kpi-label">{k.label}</div>
              <div className="org-kpi-value">{k.value}</div>
              <div className="org-kpi-foot">
                {k.delta && <span className="org-kpi-delta">{k.delta}</span>}
                {k.spark && <Sparkline data={k.spark} />}
              </div>
            </div>
          ))}
        </section>

        {/* ---------- Productivity impact ---------- */}
        <section className="org-panel org-impact" aria-label="Productivity since rollout">
          <div className="org-panel-head">
            <h2>Productivity since rollout</h2>
            <span className="org-panel-sub">six-month trajectory · impact model by Grok Reasoning</span>
          </div>
          <div className="org-impact-grid">
            <div className="org-impact-chart">
              <div className="org-chart-title">Tasks per technician per shift, indexed to rollout = 100</div>
              <TrendChart />
            </div>
            <div className="org-impact-rows">
              {IMPACT_ROWS.map((r) => (
                <div className="org-impact-row" key={r.label}>
                  <div className="org-impact-label">{r.label}</div>
                  <div className="org-impact-vals">
                    <span className="org-impact-before">{r.before}</span>
                    <span className="org-impact-arrow" aria-hidden>
                      →
                    </span>
                    <span className="org-impact-after">{r.after}</span>
                    <span className="org-impact-chip">{r.delta}</span>
                  </div>
                </div>
              ))}
              <div className="org-impact-row org-impact-row-total">
                <div className="org-impact-label">Estimated annual saving</div>
                <div className="org-impact-vals">
                  <span className="org-impact-after org-impact-total">$412K</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="org-columns">
          {/* ---------- Friction ---------- */}
          <section className="org-panel" aria-label="Top operational friction">
            <div className="org-panel-head">
              <h2>Top operational friction</h2>
              <span className="org-panel-sub">ranked by Grok Reasoning across 122 verified sessions</span>
            </div>
            <div className="org-bars">
              {FRICTION.map((f) => (
                <div className="org-bar-row" key={f.pattern}>
                  <div className="org-bar-name">{f.pattern}</div>
                  <div className="org-bar-track">
                    <div className="org-bar-fill" style={{ width: `${(f.n / maxN) * 100}%` }} />
                    <span className="org-bar-value">{f.n}</span>
                  </div>
                  <div className="org-bar-impact">{f.impact}</div>
                </div>
              ))}
            </div>
            <div className="org-evidence-row">
              <span className="org-evidence">Occurrences from assisted sessions, this quarter</span>
              <span className="org-evidence">Impact estimated from session duration deltas</span>
            </div>
          </section>

          {/* ---------- Knowledge gaps ---------- */}
          <section className="org-panel" aria-label="Where knowledge is missing">
            <div className="org-panel-head">
              <h2>Where knowledge is missing</h2>
              <span className="org-panel-sub">Agent Tools found no internal source for these</span>
            </div>
            <ul className="org-gaps">
              {GAPS.map((g) => (
                <li className="org-gap" key={g.topic}>
                  <div className="org-gap-top">
                    <span className="org-gap-topic">{g.topic}</span>
                    <span className="org-gap-detail">{g.detail}</span>
                  </div>
                  <div className="org-gap-meter" role="img" aria-label={`Demand level ${Math.round(g.level * 100)} of 100`}>
                    <div className="org-gap-meter-fill" style={{ width: `${g.level * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="org-evidence-row">
              <span className="org-evidence">Ranked by questions with no internal answer</span>
            </div>
          </section>
        </div>

        {/* ---------- Verified resolutions ---------- */}
        <section className="org-panel org-feed-panel" aria-label="Verified resolutions">
          <div className="org-panel-head">
            <h2>Verified resolutions</h2>
            <span className="org-panel-sub">anonymized · outcomes verified by Grok Vision</span>
          </div>
          <div className="org-feed">
            {SESSIONS.map((s, i) => (
              <article className="org-session" key={s.question} style={{ animationDelay: `${i * 70}ms` }}>
                <div className="org-session-thumb">
                  <img src={s.thumb} alt="" />
                  <span className="org-session-reticle" aria-hidden />
                </div>
                <div className="org-session-body">
                  <div className="org-session-q">“{s.question}”</div>
                  <div className="org-session-a">{s.guidance}</div>
                  <div className="org-session-meta">
                    <span className={`org-verdict ${s.verdict === "Verified complete" ? "is-complete" : ""}`}>
                      ✓ {s.verdict}
                    </span>
                    <span className="org-session-source">{s.source}</span>
                  </div>
                  <div className="org-session-saved">Added to operational memory</div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ---------- Ask Grok ---------- */}
        <section className="org-panel org-ask" aria-label="Ask Grok about your organization">
          <div className="org-panel-head">
            <h2>Ask Grok about your organization</h2>
            <span className="org-panel-sub">Grok Reasoning over the session ledger</span>
          </div>
          <div className="org-ask-chips">
            {QA.map((item) => (
              <button
                key={item.q}
                type="button"
                className={`org-chip ${asked === item.q ? "is-active" : ""}`}
                onClick={() => ask(item.q)}
              >
                {item.q}
              </button>
            ))}
          </div>
          <form
            className="org-ask-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) {
                ask(input.trim());
                setInput("");
              }
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about friction, sites, or documentation…"
              aria-label="Ask Grok about your organization"
            />
            <button type="submit" className="lp-btn lp-btn-primary">
              Ask
            </button>
          </form>
          {answer && (
            <div className="org-answer">
              {asked && <div className="org-answer-q">{asked}</div>}
              <p className="org-answer-a">
                {typed}
                {!done && <span className="org-caret" aria-hidden />}
              </p>
              {done && (
                <div className="org-answer-evidence">
                  {answer.evidence.map((ev) => (
                    <span className="org-evidence" key={ev}>
                      {ev}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="org-foot">
          Organizational reporting is aggregated, anonymized, and opt-in.
        </footer>
      </main>
    </div>
  );
}
