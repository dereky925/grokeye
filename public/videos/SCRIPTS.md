# Authored clip scripts

Shot-by-shot scripts for catalog clips, written from frame-level analysis of the
actual footage. A script is the ground truth for what the person in the clip did.

Runtime mirror: `server/scripts/<videoId>.json`, loaded at server start. The
JSON's `segments` carry the per-step time ranges (`start`/`end` seconds) — the
long-term record that step-correctness reviews sample their frames from. Keep
this document and the JSON synchronized when either changes.

Where a script exists:

- **`/api/step-review`** ("how did I do on that step?") samples equispaced
  frames across the current step's time range and judges them against this
  script — the segment's `flags` list the known technique mistakes to check.
  The response includes a short `spoken` line for TTS plus a longer on-screen
  `description`.
- The per-video sections below are sent to the model as scenario context.

## `pov-pc-build-fail` — First PC Build (novice), 0:00–0:17

Setting: home office. Gigabyte Z390 AORUS MASTER on a red towel over the desk;
Intel LGA1151 CPU; Corsair 280mm AIO (H115i PLATINUM class, two ML140 fans);
gray mid-tower case. Head-cam POV with two brief tripod cutaways. The clip
intentionally shows novice technique — the script records what happened; it does
not bless it.

| Time | Action | Detail | Technique flags |
| --- | --- | --- | --- |
| 0.0–3.0 | Installs the CPU | Takes the CPU from its clamshell bare-fingered, lowers it into the open socket, nudges it flat, presses around the socket working the retention hardware. | No ESD strap; board on a towel; fingers on the heat spreader; pressing the CPU instead of letting the load plate seat it. |
| 3.0–3.5 | Shows the AIO box to camera | Tripod cutaway: grinning with the yellow-and-black Corsair cooler box. | — |
| 3.5–5.5 | AIO hardware prep | Holds the Intel X mounting bracket over the board while reading the Corsair leaflet; flips the board face-down and fits the backplate behind the socket. | Board flipped components-down onto the towel. |
| 5.5–7.5 | Case to the bench | Third-person beat at the open gray mid-tower with a screwdriver; then POV carrying/tilting the opened case across the room. | — |
| 7.5–10.5 | Fans onto the radiator | Joins the keyed fan-lead connectors above the 280mm radiator, then screws both ML140 fans to it. | Screws loose on the towel. |
| 10.5–12.0 | Pump/tube orientation | Grips the sleeved tubes and pump block against the case edge, turning the assembly to settle orientation. | — |
| 12.0–14.5 | Drawer rummage | Digs through a drawer of cable bins while the finished rad+fan assembly rests on the towel. | Cables left tangled across the workspace. |
| 14.5–17.0 | Offers the AIO into the case | Hoists the case and its vented top frame overhead one-handed, pump dangling from the tubes in the other hand, test-fitting the radiator location. | Pump dangling by its tubes; case held overhead one-handed. |

After the clip: mount the radiator into the case top with the fans screwed
through the tray, bolt the pump block onto the CPU using the X bracket over the
pre-applied paste, then install the motherboard in the case, add RAM, GPU, and
PSU, and connect front-panel, fan, and pump headers before first boot.
