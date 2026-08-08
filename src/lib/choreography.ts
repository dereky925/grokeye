/**
 * Fast, authored AR choreography for the tiny hackathon video catalog.
 *
 * This mirrors public/videos/CHOREOGRAPHY.md. The markdown is the human source
 * of truth; these SVG silhouettes are the runtime form. Coordinates use the
 * 1280 × 720 video plane shared by every catalog clip (including clips whose
 * source pixels are lower resolution).
 */

export type CatalogMotionMode = "morph" | "translate" | "slice" | "rotate";

export type CatalogMotionCue = {
  id: string;
  videoId: string;
  start: number;
  end: number;
  scene: string;
  note: string;
  label: string;
  mode: CatalogMotionMode;
  /** Tight subject silhouette on the real frame. Never an axis-aligned box. */
  outline: string;
  /** Final silhouette for a bend/spread morph. Must share the command shape. */
  destination?: string;
  /** Translation applied after the outline-lock beat. */
  delta?: [number, number];
  /** Rotation applied after the outline-lock beat. */
  rotation?: { degrees: number; cx: number; cy: number };
  /** Visible direction rail used by particles and the terminal arrow. */
  motionPath: string;
  /** Optional interior silhouette details (fans, contacts, rice edge, etc.). */
  detailPaths?: string[];
  /** Label position in the authored 1280 × 720 plane. */
  labelAt: [number, number];
  keywords: string[];
};

export const CATALOG_MOTION_CUES: readonly CatalogMotionCue[] = [
  {
    id: "sushi-spread-rice",
    videoId: "sushi",
    start: 4,
    end: 20,
    scene: "Rice is being spread across the nori on a bamboo rolling mat.",
    note: "Trace → spread to the edges",
    label: "Spread edge-to-edge",
    mode: "morph",
    outline:
      "M 374 384 Q 417 348 485 355 Q 552 350 614 380 Q 647 414 634 493 Q 622 568 584 624 Q 519 652 431 620 Q 377 580 366 501 Q 357 430 374 384 Z",
    destination:
      "M 350 338 Q 420 324 492 330 Q 566 326 642 342 Q 666 398 660 478 Q 656 560 636 642 Q 558 658 468 650 Q 388 646 350 624 Q 338 548 340 474 Q 338 396 350 338 Z",
    motionPath:
      "M 392 404 C 470 378 558 384 624 408 C 552 432 452 438 382 466 C 464 490 564 496 628 520 C 548 548 454 556 392 586",
    detailPaths: ["M 371 448 C 438 426 560 430 641 450", "M 361 530 C 446 508 555 514 644 538"],
    labelAt: [672, 520],
    keywords: ["spread", "rice", "nori", "sushi", "press", "roll"],
  },
  {
    id: "plumbing-bend-copper",
    videoId: "pov-copper-plumbing",
    start: 0,
    end: 19,
    scene: "A straight copper tube is seated in a lever pipe bender and bent around its former.",
    note: "Trace → bend around the former",
    label: "Bend to the angle mark",
    mode: "morph",
    outline:
      "M 487 311 C 540 315 594 319 647 322 C 680 324 720 327 760 329 C 785 331 806 332 828 333 C 842 334 842 347 828 348 C 806 347 785 345 760 344 C 720 341 680 338 647 337 C 594 334 540 331 487 327 C 478 325 478 313 487 311 Z",
    destination:
      "M 487 311 C 540 315 594 319 647 322 C 676 324 691 338 697 365 C 704 399 725 426 760 445 C 783 458 805 465 826 470 C 839 474 835 487 821 483 C 798 477 774 469 752 457 C 710 435 682 405 675 369 C 670 348 664 340 644 337 C 594 334 540 331 487 327 C 478 325 478 313 487 311 Z",
    motionPath:
      "M 493 319 C 578 324 637 326 675 337 C 696 346 691 397 724 429 C 752 456 792 470 826 476",
    detailPaths: ["M 676 337 C 688 349 691 364 692 381"],
    labelAt: [780, 408],
    keywords: ["bend", "bender", "pipe", "tube", "copper", "angle"],
  },
  {
    id: "plumbing-fit-run",
    videoId: "pov-copper-plumbing",
    start: 104,
    end: 160,
    scene: "Cut copper lengths and elbow fittings are being routed through the open floor/ceiling run.",
    note: "Trace → feed into the run",
    label: "Feed square into fitting",
    mode: "translate",
    outline:
      "M 433 269 C 455 255 486 251 507 263 L 730 549 C 739 561 731 574 718 570 L 487 287 C 473 274 450 277 433 286 Z",
    delta: [92, -52],
    motionPath: "M 566 414 C 621 390 678 362 744 324",
    labelAt: [744, 354],
    keywords: ["fit", "feed", "insert", "route", "pipe", "elbow", "connect"],
  },
  {
    id: "pc-fan-connector",
    videoId: "pov-pc-build-fail",
    start: 5.5,
    end: 11.5,
    scene: "The novice builder is matching the AIO/fan lead connectors above the radiator.",
    note: "Trace → match the keyed plug",
    label: "Align the keyed edges",
    mode: "translate",
    outline:
      "M 603 270 L 644 278 L 659 305 L 647 338 L 617 345 L 594 322 L 591 289 Z M 612 283 L 636 288 L 644 306 L 636 327 L 618 331 L 605 316 L 604 294 Z",
    delta: [62, 44],
    motionPath: "M 628 306 C 648 316 668 332 689 351",
    labelAt: [690, 292],
    keywords: ["plug", "connector", "fan", "cable", "aio", "connect"],
  },
  {
    id: "cpu-lower-into-socket",
    videoId: "pov-pc-build-cpu-ram",
    start: 72,
    end: 101,
    scene: "The Intel CPU is aligned over the open LGA1700 socket, lowered flat, then retained.",
    note: "Trace → lower straight down",
    label: "Lower flat—do not slide",
    mode: "translate",
    outline:
      "M 677 279 L 786 274 Q 810 279 817 300 L 814 522 Q 808 553 783 563 L 685 556 Q 656 548 650 520 L 653 313 Q 657 288 677 279 Z",
    delta: [0, 42],
    motionPath: "M 735 328 C 735 363 735 401 735 450",
    detailPaths: ["M 680 313 L 786 309 L 783 525 L 682 520 Z"],
    labelAt: [832, 394],
    keywords: ["cpu", "processor", "socket", "seat", "lower", "install"],
  },
  {
    id: "ram-press-into-dimm",
    videoId: "pov-pc-build-cpu-ram",
    start: 118,
    end: 155,
    scene: "DDR4 DIMMs are aligned with the keyed slots and pressed evenly until the latches click.",
    note: "Trace → press both ends evenly",
    label: "Press until both latches click",
    mode: "translate",
    outline:
      "M 309 330 L 904 330 L 921 346 L 914 378 L 641 378 L 629 388 L 614 378 L 322 378 L 302 361 Z",
    delta: [0, 62],
    motionPath: "M 612 356 C 612 378 612 404 612 435",
    detailPaths: ["M 329 348 L 598 348", "M 650 348 L 893 348"],
    labelAt: [744, 430],
    keywords: ["ram", "memory", "dimm", "press", "seat", "install"],
  },
  {
    id: "gpu-remove-slot-cover",
    videoId: "pov-pc-build-gpu",
    start: 36,
    end: 64,
    scene: "The rear PCIe slot covers are loosened and removed before the graphics card is installed.",
    note: "Trace → lift the slot cover out",
    label: "Remove matching slot covers",
    mode: "translate",
    outline:
      "M 435 207 L 468 201 L 487 483 L 455 491 Z M 478 199 L 510 196 L 529 477 L 497 484 Z",
    delta: [-38, -76],
    motionPath: "M 480 344 C 467 314 453 282 442 246",
    labelAt: [534, 242],
    keywords: ["cover", "slot", "screw", "remove", "pcie", "bracket"],
  },
  {
    id: "gpu-seat-card",
    videoId: "pov-pc-build-gpu",
    start: 64,
    end: 114,
    scene: "The XFX graphics card is aligned with the PCIe x16 slot and rear bracket, then seated evenly.",
    note: "Trace → seat into the PCIe slot",
    label: "Press level into the slot",
    mode: "translate",
    outline:
      "M 294 424 Q 309 408 334 406 L 938 410 Q 968 414 981 435 L 978 536 Q 966 559 939 565 L 337 558 Q 307 553 296 532 Z",
    delta: [0, -48],
    motionPath: "M 638 512 C 638 486 638 455 638 423",
    detailPaths: [
      "M 418 435 A 50 50 0 1 0 418 535 A 50 50 0 1 0 418 435",
      "M 635 435 A 50 50 0 1 0 635 535 A 50 50 0 1 0 635 435",
      "M 852 435 A 50 50 0 1 0 852 535 A 50 50 0 1 0 852 435",
    ],
    labelAt: [684, 348],
    keywords: ["gpu", "graphics", "card", "pcie", "seat", "install", "slot"],
  },
  {
    id: "tuna-slice-celery",
    videoId: "pov-tuna-melt",
    start: 15,
    end: 43,
    scene: "Celery is being cut into small pieces on the wooden board for the tuna mixture.",
    note: "Trace → slice with a short rock",
    label: "Rock the blade—fingers back",
    mode: "slice",
    outline:
      "M 581 437 L 610 430 L 707 616 L 700 648 L 680 650 L 665 620 Z",
    delta: [-28, -72],
    motionPath: "M 681 603 C 667 566 649 526 629 486",
    detailPaths: ["M 492 286 L 694 286", "M 512 342 L 656 342"],
    labelAt: [728, 478],
    keywords: ["cut", "slice", "chop", "knife", "celery"],
  },
  {
    id: "tuna-lower-sandwich",
    videoId: "pov-tuna-melt",
    start: 68,
    end: 99,
    scene: "The assembled tuna sandwich is lowered into the skillet and positioned flat for frying.",
    note: "Trace → lower flat into the pan",
    label: "Set it flat in the skillet",
    mode: "translate",
    outline:
      "M 647 233 Q 687 216 746 224 Q 779 239 786 278 L 775 342 Q 742 362 681 352 Q 648 330 640 288 Z",
    delta: [18, 54],
    motionPath: "M 711 268 C 715 294 718 324 724 356",
    detailPaths: ["M 665 260 Q 710 243 762 258", "M 660 302 Q 710 319 773 304"],
    labelAt: [806, 320],
    keywords: ["sandwich", "pan", "skillet", "lower", "place", "fry"],
  },
];

function keywordScore(cue: CatalogMotionCue, message: string): number {
  const text = message.toLowerCase();
  return cue.keywords.reduce(
    (score, keyword) => score + (text.includes(keyword) ? 1 : 0),
    0,
  );
}

/** Resolve instantly from clip + playhead; no network round trip or model box. */
export function findCatalogChoreography(
  videoId: string,
  currentTime: number,
  message: string,
): CatalogMotionCue | null {
  const matches = CATALOG_MOTION_CUES.filter(
    (cue) =>
      cue.videoId === videoId &&
      currentTime >= cue.start &&
      currentTime < cue.end,
  );
  if (!matches.length) return null;
  return matches
    .map((cue) => ({ cue, score: keywordScore(cue, message) }))
    .sort((a, b) => b.score - a.score)[0].cue;
}

