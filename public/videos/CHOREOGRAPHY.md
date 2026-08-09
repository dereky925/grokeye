# Catalog scene choreography

This is GrokEye's deliberately small, hand-authored scene memory for the hackathon
catalog. It lets visible “how do I move this?” questions render immediately instead of
waiting for a vision model to rediscover geometry that is already known from the clip.

The footage is still honest prerecorded POV, and normal answers remain live. This file
only supplies **presentation geometry** for known clip/time windows. It never supplies a
prerecorded answer, a hidden completion verdict, or a claim about state outside the
frame.

Runtime mirror: `src/lib/choreography.ts`. Keep the cue IDs, time ranges, scene text,
and intent meaning synchronized when either file changes.

## Rendering contract

1. Match the selected `video.id` and current playhead time.
2. Pause the video and snap the playhead to the cue's `previewAt` frame — the exact
   frame the silhouettes were traced against — and hold it there while the cue is on
   screen. Playback resumes when the cue exits. (POV camera motion inside a window is
   otherwise enough to leave a static outline hanging mid-air.)
3. Trace the tight authored subject silhouette immediately, resolving it in about **0.2 s**.
4. Then run the gesture in a **3.2 s** loop with distinct beats: hold the locked
   outline on the object (~0.8 s), ease it onto the destination silhouette (~0.9 s),
   hold there (~1.1 s), then fade out and restart — the return leg happens entirely
   inside the faded-out tail, so the outline never visibly travels backwards. The
   dashed destination outline stays visible throughout. No sparks or glow blobs ride
   the motion path; the moving silhouette is the demonstration.
5. Keep the spoken `/api/chat` request live; pass the authored cue as UI context so the
   visible reply and Carina voice explicitly tell the worker to follow the animation.
6. When the voice response returns to `idle`, begin the same **280 ms** exit fade as the
   `VoiceBubble`, then unmount the authored animation with it. Normal tracked callouts
   retain their longer voice-synced holds.
7. If no authored window matches, use the conservative frame-grounded `/api/guide`
   fallback. Never stretch a cue into another scene.

All runtime coordinates use a 1280 × 720 authoring plane. The overlay is scaled into
the existing letterbox-aware video-content rectangle.

## `sushi` — 0:00–0:20

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:04 | The cook puts on/adjusts food-service gloves and reaches toward the prep area. | Hands and prep board; no stable instructional object yet. | Live fallback only. |
| 0:04–0:08 | Nori is positioned on the bamboo rolling mat and rice application begins. | Nori rectangle on the lower-center mat. | `sushi-spread-rice` begins. |
| 0:08–0:18 | Rice is spread and pressed across the nori. | The authored irregular rice silhouette expands toward the nori edges; it is not a box around the whole mat. | `sushi-spread-rice`: trace → spread. |
| 0:18–0:20 | The cook finishes the rice layer and reaches off-frame for the next ingredient. | Subject starts leaving the stable composition. | Cue ends with the clip. |

Good live phrasings: “How do I spread this?”, “How should I press the rice?”, “Which
way should I move it?”

## `pov-copper-plumbing` — 0:00–2:40

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:12 | A straight copper tube is seated in a **lever pipe bender** and pulled around the former. | Copper tube across center; circular former below it; long black handle upward. This is not a tubing cutter. | `plumbing-bend-copper`: trace the copper tube, then morph the same tube outline into a bend. |
| 0:12–0:19 | The bent tube is released, inspected, and laid beside the tool. | Finished bend is visible but the active bending gesture has ended. | The bend cue remains available briefly for questions about the just-shown action. |
| 0:19–0:41 | The worker opens the plumbing bag and selects fittings/tools. | Tool inventory changes rapidly; do not hardcode one object position. | Live fallback only. |
| 0:41–0:50 | Wall openings and the vertical copper stub are prepared. | Pipe end and wall chase are visible. | Live fallback only. |
| 0:50–1:29 | A torch heats copper joints and soldering work is performed. | Flame, hot copper, gas cylinder. Motion correctness depends on heat/material state. | No authored gesture; `/api/guide` should be allowed to return `unsafe_to_show`. |
| 1:29–1:43 | A spirit level is held across pipe penetrations to check alignment. | Yellow level and two protruding copper ends. | Live grounding; no fake “level” motion. |
| 1:43–2:06 | Copper lengths are routed through the opened floor/ceiling run. | Long copper run and open cavity. | `plumbing-fit-run`: trace the visible copper length → feed toward the run. |
| 2:06–2:30 | Elbows and cut lengths are selected/sized around the open joists. | Loose copper elbows and long lengths move through the frame. | `plumbing-fit-run` continues while the run stays visible. |
| 2:30–2:40 | The worker inspects/reaches into the overhead cavity. | Hands and partially hidden route; hidden seating cannot be verified. | Cue ends; use live fallback. |

Good live phrasings: “How do I bend this pipe?”, “Show me how to pull it around the
former,” and later “How do I feed this into the run?”

## `pov-pc-build-fail` — 0:00–0:16

This clip intentionally shows a novice and imperfect handling. The catalog memory says
what is visible; it does not bless the technique.

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:05.5 | The novice handles the motherboard/accessory packaging on a towel-covered table. | Loose bags and board handling; ESD-safe technique is not established. | Live fallback only. |
| 0:05.5–0:11.5 | Small AIO/fan lead connectors are compared above a radiator/fan assembly. | Keyed plug faces are near the hands; the radiator is below. | `pc-fan-connector`: trace the plug silhouette → align toward its mate. |
| 0:11.5–0:16 | The camera swings toward the open case and unrouted cable area. | Fast viewpoint change and occlusion. | Cue ends; live fallback only. |

Good live phrasing: “How do I connect this fan plug?” The visual says to match the keyed
edges; the spoken model remains responsible for any pinout/safety qualification.

## `pov-pc-build-cpu-ram` — 0:00–2:38

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:06.4 | The boxed Intel Core i5-12600KF is held over the motherboard. | The carton and hands fully hide the socket, so a socket pointer here would be fabricated. | `cpu-unbox-before-placement`: trace the real carton → move it aside; “Unbox first—socket is hidden.” |
| 0:06.4–0:54.4 | The CPU is unboxed, inspected, and the LGA1700 retention mechanism is opened. | Package, bare CPU, socket cover, lever, and contact bed appear in changing close-ups. | Live fallback; do not reuse geometry across these fast cuts. |
| 0:54.4–0:55.45 | The bare CPU is held beside the fully exposed contact bed. | Both CPU and open socket are simultaneously visible. | `cpu-align-to-open-socket`: morph the CPU silhouette onto the socket target. |
| 0:55.45–0:57.8 | The bare CPU is held beside the open socket (silhouettes traced at 0:55.6). | Both the CPU in hand and the exposed contact bed are visible. | `cpu-lower-over-socket`: morph the CPU silhouette onto the socket target — answers "where do I put it?". |
| 0:57.8–1:12 | Orientation marks and socket contacts are shown in close-up. | Viewpoint and scale change rapidly. | Live fallback only. |
| 1:12–1:24 | The CPU is aligned over the socket and lowered flat. | CPU substrate directly above/inside socket; do not slide it across contacts. | `cpu-lower-into-socket`: trace CPU silhouette → lower straight down. |
| 1:24–1:41 | The load plate and lever are closed over the seated CPU. | The CPU is already seated; retention hardware now moves. | Live fallback; do not keep replaying the lowering cue. |
| 1:41–1:58 | The RAM kit is opened and DIMM orientation is shown. | Two elongated DIMMs and keyed contacts. | Live fallback only. |
| 1:58–2:35 | DIMM keys are aligned with the slots and both ends are pressed until the latches seat. | Long RAM silhouette over the DIMM slots. | `ram-press-into-dimm`: trace DIMM → press evenly down. |
| 2:35–2:38 | The motherboard is shown with CPU/RAM installed. | Finished visible state. | Choreography ends; verification remains a separate live action. |

Good live phrasings: “Where do I put it?”, “Where to put the CPU?”, “How do I seat
this CPU?”, and “Which way do I press this RAM?”

## `pov-pc-build-gpu` — 0:00–2:05

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:28 | The XFX graphics card is unboxed and inspected. | Full card/fan side is visible over foam. | Live fallback only. |
| 0:28–0:36 | The graphics card is brought near the white case and the install location is established. | Card, open case, motherboard. | Live fallback only. |
| 0:36–1:04 | Rear PCIe slot covers are loosened and removed. | Two narrow rear covers beside the motherboard slots. | `gpu-remove-slot-cover`: trace covers → lift them out. |
| 1:04–1:28 | The GPU is oriented near the rear bracket; the viewpoint and card face change too quickly for a fixed silhouette. | Card, rear bracket, and motherboard remain live-grounded. | Live fallback only. |
| 1:28–1:54 | The GPU rear bracket and PCIe edge are aligned, then the card is pressed level into the x16 slot. | Long edge-on card silhouette crossing the lower case opening. | `gpu-seat-card`: trace the actual card edge → move level into the slot. |
| 1:54–2:05 | The installed area and power-cable side are inspected. | Card is largely seated; cable visibility changes. | Cue ends; live fallback for power questions. |

Good live phrasings: “How do I put this GPU in?”, “Which slot does it go into?”, and
“How do I remove these covers?”

## `pov-tuna-melt` — 0:00–1:57

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:15 | The tuna can is opened/drained and tuna is transferred to the prep container. | Can, board, tuna container. | Live fallback only. |
| 0:15–0:43 | Celery stalks are cut into small pieces on the board. | Knife silhouette and celery stalks in the center. | `tuna-slice-celery`: trace the knife → short rocking slice; label reminds the user to keep fingers back. |
| 0:43–1:08 | Mayonnaise/seasoning and celery are added and mixed with tuna. | Mixing container and spoon. | Live fallback only. |
| 1:08–1:22 | Bread, cheese, and tuna filling are assembled into the sandwich. | Bread on the board and filling container. | `tuna-lower-sandwich` begins near the end of this interval as the sandwich is lifted. |
| 1:22–1:39 | The assembled sandwich is lowered into the skillet and positioned flat. | Bread silhouette over the dark circular pan. | `tuna-lower-sandwich`: trace sandwich → lower flat into pan. |
| 1:39–1:47 | The sandwich is fried/turned in the skillet. | Hot pan and utensil; heat state is not inferred. | Live fallback; no authored burn/doneness claim. |
| 1:47–1:57 | The sandwich is plated/finished. | Plate and finished sandwich. | Choreography ends. |

Good live phrasings: “How do I chop this?”, “Show me the knife motion,” and “How do I
put this into the pan?”

## `tesla` — 0:00–6:34

This is safety-critical vehicle work. The scene memory describes what is visible but
does not infer high-voltage isolation, vehicle support, torque, or readiness to remove
the drive unit.

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:25 | Rear of the car, removed drive unit, jack stands, and tools are established. | Heavy vehicle/drive-unit support state is not provable from one frame. | Live fallback; unsafe states may refuse motion. |
| 0:25–1:15 | Work continues under the rear subframe around cables, brackets, and support points. | Viewpoint changes under the raised vehicle. | Live fallback only. |
| 1:15–2:05 | Rear suspension links and hub-area fasteners are inspected/worked. | Suspension arms, hub, damper, and brake lines. | Live fallback; no authored torque motion. |
| 2:05–3:35 | The camera moves between the rear bumper and close suspension/hub views. | Components are visible, but load and isolation are hidden. | Live fallback only. |
| 3:35–4:00 | A red-locked electrical connector is clearly exposed near the rear hub assembly. | Connector body and red secondary lock are visible. | `tesla-release-connector`: trace connector → release lock/pull straight. Spoken guidance must still qualify isolation/safety. |
| 4:00–6:34 | Additional suspension/underbody components are disconnected or inspected and the camera returns to wider under-car views. | Fasteners and heavy components; correctness depends on hidden support/torque state. | Live fallback only. |

Good live phrasing in the authored window: “How do I unplug this connector?”

## `ikea` — 0:00–1:00

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:04.8 | White MICKE end frames and the upside-down desktop are established. | One end frame is already installed; the second is picked up. | Live fallback while the loose frame enters view. |
| 0:04.8–0:08.15 | The second rectangular end/leg frame is held nearly edge-on beside the desktop's free short end. | Holed mounting rail and the matching free-end seam are both visible. | `ikea-place-leg-frame`: trace the held frame → pivot its holed rail onto the free end. |
| 0:08.15–0:15 | The loose end frame rotates rapidly toward the near edge. | Camera and silhouette change too quickly for the 0:06 authored path. | Live `/api/guide` fallback only. |
| 0:15–0:29 | The second end/leg frame is aligned and seated on the free short end. | Its white mounting rail runs diagonally across the lower POV frame. | `ikea-seat-leg-frame`: trace the mounting rail → seat the end frame square/flush. |
| 0:29–0:40 | The frame is repositioned around the desktop panel. | Assembly orientation changes. | Live fallback only. |
| 0:40–1:00 | Hardware/tools are selected and prepared for the next fastener steps. | Bit kit, small hardware, and instruction material. | Live fallback; the official hosted MICKE PDF remains the manual source. |

Good live phrasings: “Where to build the leg?”, “Where do I put this leg?”, “Where does
this leg go?”, and “How do I attach this end frame?”

## `pov-espresso-tamp` — 0:00–0:42

Filmed at the hackathon venue. Audio is live for the first 5 seconds (grinder
ambience), silenced after — no speech bleed into the recognizer during asks.

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:06 | The barista doses and grinds espresso into the portafilter under the grinder. | Portafilter, grinder, knock box, syrup bottles; hands move quickly. | Live fallback only. |
| 0:06–0:14 | The grounds-filled portafilter is carried to the La Marzocco and locked into the group head **without being tamped**; the tamper stays unused on the counter. | The mistake window — loose mounded grounds visible en route. | Live fallback; verification asks are answered from the frame, never from this file. |
| 0:14–0:24 | The barista pauses, hand resting near the knock box. | Stable composition; the locked-in portafilter is off to the right. | Live fallback only (the demo ask window). |
| 0:24–0:28 | The portafilter is pulled back out and brought over the counter. | Subject re-enters the lower-center frame. | Live fallback while it moves. |
| 0:28–0:33 | The tamper is picked up and pressed into the portafilter against the counter edge. | Tamper knob over the basket, lower-center; portafilter handle toward the viewer. | `espresso-tamp-press`: trace the tamper → press straight down, level. |
| 0:33–0:37 | The now-tamped portafilter is locked back into the group head. | Rapid arm motion toward the machine. | Live fallback only. |
| 0:37–0:42 | Hands come to rest; the corrected setup is in place. | End state. | Live fallback only. |

Good live phrasings: “How do I tamp this?”, “Show me how to press the puck,” “How
should I pack the grounds?” (Verification asks like “Did she do that right?” stay on
the live `/api/chat` frame path by design.)

## Maintenance checklist

- Re-sample frames after any video re-edit; timestamps and silhouettes will drift.
- Trace `outline`/`destination` against the exact `previewAt` frame (the player snaps
  to it and holds while the cue shows, so that frame is what the outline lands on).
- A morph `destination` must repeat its `outline`'s SVG command sequence exactly, or
  the SMIL `d` interpolation snaps instead of gliding.
- Keep dangerous or hidden-state actions on the live conservative path.
- Add every new catalog video here before claiming full catalog choreography coverage.
