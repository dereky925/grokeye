# Catalog watch windows — proactive work verification

Hand-authored *attention* windows for the proactive work-watcher: when and what Grok
should watch for in each catalog clip, so a mistake can be called out without the user
asking. A window only arms the watcher and biases the `/api/watch` prompt with known
failure modes to check.

**Honesty contract** (same bar as `CHOREOGRAPHY.md`): a window never supplies a verdict,
a canned spoken line, or a claim about the footage. The live model judges real frames on
every check, and correct technique inside an armed window must come back as silence —
that silence is itself a demo beat (`pov-pc-build-cpu-ram` is correct on film and stays
armed). A malformed model reply is a 502 and stays silent; nothing scripted ever plays.

Runtime mirror: `src/lib/watchWindows.ts`. Keep ids, time ranges, and concern text
synchronized when either file changes. `tests/watch-windows.test.mjs` asserts every id
here exists in the runtime table and vice versa.

## How a window fires

1. The playhead enters `[start, end)` → the watcher arms and the idle chip shows the
   window's `label` ("Watching: …", never an outcome).
2. `fireOn: "settle"` (default): a motion boundary — the worker's hands finishing an
   action — triggers one `/api/watch` check, fired speculatively as motion settles and
   surfaced only after the settle confirms (~0.7 s), so nothing is judged mid-action.
   Actions straddling the window edge get a 5 s grace tail.
3. `fireOn: "window-end"`: one static-state check as the playhead crosses `end` — for
   mistakes that persist without a hand action (unrouted cables, parts left loose).
4. Budget: at most one check per 8 s and 6 per loop iteration, shared with the generic
   (un-windowed) path; generic checks yield to an upcoming window.

## `pov-pc-build-fail` (17 s — the hero mistake clip)

| Window id | Time | Severity | Concern / watch for |
| --- | --- | --- | --- |
| `pc-fail-esd-handling` | 0:00–0:05.5 | danger | ESD-safe handling during unpacking: board/components on fabric or towel, bare fingers on traces/contacts/pins, parts sliding loosely. Fires on settle. |
| `pc-fail-cable-prep` | 0:11.5–0:16 | warn | Case/cable prep state: unrouted cable tangle across the mounting area, parts balanced on the case edge. The camera whip-pans here, so this is a `window-end` static check. |

## `pov-pc-build-cpu-ram` (158 s — correct technique; honest-silence beats)

| Window id | Time | Severity | Concern / watch for |
| --- | --- | --- | --- |
| `cpu-ram-cpu-seating` | 0:54–1:41 | danger | LGA socket care while seating the CPU: sliding/dragging across contacts, dropping or forcing instead of lowering flat, fingers on the underside or pin bed, obvious notch mismatch. |
| `cpu-ram-ram-seating` | 1:58–2:35 | warn | RAM fully seated: a latch still open after pressing, one end sitting higher, key notch misaligned. |

## `pov-tuna-melt` (117 s)

| Window id | Time | Severity | Concern / watch for |
| --- | --- | --- | --- |
| `tuna-knife-safety` | 0:15–0:43 | danger | Knife safety over the board: fingertips in the blade path instead of tucked, cutting toward the holding hand, unstable food while cutting. |

## `pov-copper-plumbing` (160 s)

| Window id | Time | Severity | Concern / watch for |
| --- | --- | --- | --- |
| `plumbing-torch-safety` | 0:50–1:29 | danger | Torch handling while soldering: open flame at/near visibly flammable material, lit torch set down unattended. Heat/material state is invisible, so most checks here should come back `unclear` → silence. |

## Catalog verify rubrics

Hand-authored *process* checklists for explicit user asks like “did I do this
right?” / “check my work” / “did I miss a step?” on a catalog clip.

For `pov-espresso-tamp`, verification is **text/timeline only** (no frames, no
Grok vision round-trip): the playhead is matched to authored beats from
`CHOREOGRAPHY.md` so the intentional skip-tamp ask is instant and reliable.
Runtime: `src/lib/catalogVerify.ts` (`resolveCatalogVerifyLocal`).

### `pov-espresso-tamp`

**Goal:** Complete espresso portafilter prep: dose, tamp flat, then lock into the group head.

| Step | Correct process |
| --- | --- |
| 1 | Dose and grind espresso into the portafilter under the grinder |
| 2 | Tamp the puck flat and level with the tamper on the counter |
| 3 | Lock the tamped portafilter fully into the group head |

**Timeline beats (playhead → call):**

| Time | Verdict | Call |
| --- | --- | --- |
| 0:06–0:28 | not_complete | Locked without tamp; pull out and tamp |
| 0:28–0:33 | not_complete | On counter for tamp — tamp then lock |
| 0:33–0:42 | complete | Tamped and locked |

Pause in the ask window (~0:14–0:24) for the miss, or after the fix (~0:37) for the pass.

## Maintenance checklist

- Re-check timestamps after any video re-edit; windows drift with the footage.
- `watchFor` entries must be *visually checkable* failure modes — never anything that
  depends on torque, temperature, static, or other out-of-frame state.
- Keep `label` in the "Watching: …" shape; the chip must describe attention, not
  outcomes.
- Update `src/lib/watchWindows.ts` and this file together, then run
  `tests/watch-windows.test.mjs`.
