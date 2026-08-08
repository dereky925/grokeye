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
2. Trace the tight authored subject silhouette in about **290 ms**.
3. Move or morph that same outline through the physical gesture in a **1.65 s** loop.
4. Keep the spoken `/api/chat` request live and independent.
5. If no authored window matches, use the conservative frame-grounded `/api/guide`
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
| 0:00–0:28 | The Intel Core i5-12600KF is introduced and unboxed. | CPU package, box, motherboard nearby. | Live fallback only. |
| 0:28–0:52 | Socket/CPU orientation is explained and the motherboard is positioned. | Open LGA1700 area and orientation marks. | Live fallback; orientation claims stay frame-grounded. |
| 0:52–1:12 | The socket retention mechanism is opened. | Lever and load plate move around the empty socket. | Live fallback only. |
| 1:12–1:41 | The CPU is aligned over the socket, lowered flat, and retained. | CPU substrate directly above/inside socket; do not slide it across contacts. | `cpu-lower-into-socket`: trace CPU silhouette → lower straight down. |
| 1:41–1:58 | The RAM kit is opened and DIMM orientation is shown. | Two elongated DIMMs and keyed contacts. | Live fallback only. |
| 1:58–2:35 | DIMM keys are aligned with the slots and both ends are pressed until the latches seat. | Long RAM silhouette over the DIMM slots. | `ram-press-into-dimm`: trace DIMM → press evenly down. |
| 2:35–2:38 | The motherboard is shown with CPU/RAM installed. | Finished visible state. | Choreography ends; verification remains a separate live action. |

Good live phrasings: “How do I seat this CPU?” and “Which way do I press this RAM?”

## `pov-pc-build-gpu` — 0:00–2:05

| Time | What is actually happening | Visible anchors / caution | Authored cue |
| --- | --- | --- | --- |
| 0:00–0:28 | The XFX graphics card is unboxed and inspected. | Full card/fan side is visible over foam. | Live fallback only. |
| 0:28–0:36 | The graphics card is brought near the white case and the install location is established. | Card, open case, motherboard. | Live fallback only. |
| 0:36–1:04 | Rear PCIe slot covers are loosened and removed. | Two narrow rear covers beside the motherboard slots. | `gpu-remove-slot-cover`: trace covers → lift them out. |
| 1:04–1:54 | The GPU rear bracket and PCIe edge are aligned, then the card is pressed level into the x16 slot. | Large triple-fan card silhouette crossing the lower case opening. | `gpu-seat-card`: trace the actual card silhouette/fans → move level into the slot. |
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

## Maintenance checklist

- Re-sample frames after any video re-edit; timestamps and silhouettes will drift.
- Add a runtime cue only when the subject stays in roughly the authored place for the
  short 1.65-second loop.
- Keep dangerous or hidden-state actions on the live conservative path.
- Add every new catalog video here before claiming full catalog choreography coverage.

