// Hedge-arm selection + consensus fusion for the /api/labels sidecar.
// Grounding draws are noisy frame-to-frame even at temperature 0.2, so two
// cheap agreeing draws beat one: averaging overlapping boxes cancels per-draw
// jitter, while disagreement falls back to the first arrival unchanged.

/**
 * Resolve with every valid hedge result that has landed by the time the first
 * valid result is `graceMs` old — or sooner, when two box-bearing results are
 * already in or every arm has settled. Never rejects; an empty array means
 * every arm failed (HTTP error or unparseable JSON).
 */
export function collectLabelArms(attempts, graceMs) {
  return new Promise((resolve) => {
    const good = [];
    let settledCount = 0;
    let timer = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve([...good]);
    };
    for (const attempt of attempts) {
      attempt
        .then(
          (result) => {
            if (done) return;
            good.push(result);
            if (good.filter((g) => g.labels.length > 0).length >= 2) {
              finish();
              return;
            }
            if (!timer) timer = setTimeout(finish, graceMs);
          },
          () => {},
        )
        .finally(() => {
          settledCount += 1;
          if (settledCount === attempts.length) finish();
        });
    }
  });
}

function boxOf(label) {
  const x = Number(label?.x);
  const y = Number(label?.y);
  const w = Number(label?.w ?? label?.width);
  const h = Number(label?.h ?? label?.height);
  return [x, y, w, h].every(Number.isFinite) ? { x, y, w, h } : null;
}

export function boxIou(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Fuse two independent draws of the same locate answer. Boxes average only
 * where the draws agree — same label count, same link-ness, same kind, and
 * overlapping geometry (label order is meaningful: index 0 is the source of a
 * link answer). Any disagreement keeps the first arrival's label untouched.
 */
export function fuseLabelResults(a, b) {
  if (a.labels.length !== b.labels.length) return a;
  if (!!a.link !== !!b.link) return a;
  const labels = a.labels.map((la, i) => {
    const lb = b.labels[i];
    if ((la?.kind === "zone") !== (lb?.kind === "zone")) return la;
    const boxA = boxOf(la);
    const boxB = boxOf(lb);
    if (!boxA || !boxB || boxIou(boxA, boxB) < 0.25) return la;
    return {
      ...la,
      x: (boxA.x + boxB.x) / 2,
      y: (boxA.y + boxB.y) / 2,
      w: (boxA.w + boxB.w) / 2,
      h: (boxA.h + boxB.h) / 2,
    };
  });
  return { ...a, labels };
}
