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
  /** Representative frame used by the visual regression preview. */
  previewAt: number;
  scene: string;
  /** Canonical grounded referent retained briefly for follow-up pronouns. */
  subject: string;
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
  /**
   * Legacy curved rail — no longer rendered. The overlay draws its own straight
   * trimmed arrow between the outline and destination centers.
   */
  motionPath: string;
  /** Legacy interior details — no longer rendered (simple-polygon overlay). */
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
    previewAt: 12,
    scene: "Rice is being spread across the nori on a bamboo rolling mat.",
    subject: "rice",
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
    previewAt: 2,
    scene: "A straight copper tube is seated in a lever pipe bender and bent around its former.",
    subject: "copper pipe",
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
    end: 150,
    previewAt: 135,
    scene: "Cut copper lengths and elbow fittings are being routed through the open floor/ceiling run.",
    subject: "copper pipe",
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
    previewAt: 8,
    scene: "The novice builder is matching the AIO/fan lead connectors above the radiator.",
    subject: "fan connector",
    note: "Trace → match the keyed plug",
    label: "Align the keyed edges",
    mode: "translate",
    outline:
      "M 603 170 L 644 178 L 659 205 L 647 238 L 617 245 L 594 222 L 591 189 Z M 612 183 L 636 188 L 644 206 L 636 227 L 618 231 L 605 216 L 604 194 Z",
    delta: [42, 58],
    motionPath: "M 628 206 C 642 222 655 240 670 262",
    labelAt: [686, 248],
    keywords: ["plug", "connector", "fan", "cable", "aio", "connect"],
  },
  {
    id: "cpu-unbox-before-placement",
    videoId: "pov-pc-build-cpu-ram",
    start: 0,
    end: 6.4,
    previewAt: 4,
    scene: "The Intel CPU is still in its retail carton, which covers the motherboard socket.",
    subject: "CPU",
    note: "Trace → move the package aside first",
    label: "Unbox first—socket is hidden",
    mode: "translate",
    outline:
      "M 621 269 L 783 294 Q 826 300 845 309 L 845 325 L 806 489 L 801 490 L 598 477 Q 583 470 583 448 L 601 319 Q 608 276 621 269 Z",
    delta: [225, -8],
    motionPath: "M 710 382 C 774 370 843 372 935 382",
    detailPaths: ["M 642 294 L 810 320 L 779 466 L 611 448 Z"],
    labelAt: [858, 510],
    keywords: [
      "cpu",
      "processor",
      "chip",
      "box",
      "socket",
      "unbox",
      "put",
      "place",
      "install",
    ],
  },
  {
    id: "cpu-align-to-open-socket",
    videoId: "pov-pc-build-cpu-ram",
    // Ask window opens at 0:34 — the bare CPU is in hand over the board for
    // the rehearsed 0:36–0:50 "which way does this chip go in?" ask.
    start: 34,
    end: 55.45,
    previewAt: 55,
    scene: "The bare Intel CPU is held beside the exposed LGA1700 contact bed.",
    subject: "CPU",
    note: "Trace → align over the open socket",
    label: "CPU goes here—lower flat",
    mode: "morph",
    outline:
      "M 921 474 L 1059 513 Q 1075 518 1073 536 L 1034 673 Q 1031 684 1017 681 L 891 637 Q 876 631 881 612 L 912 493 Q 916 480 921 474 Z",
    destination:
      "M 648 338 L 769 340 Q 778 341 778 352 L 775 473 Q 774 483 764 484 L 648 479 Q 639 478 639 467 L 641 349 Q 641 341 648 338 Z",
    motionPath: "M 972 574 C 904 550 817 496 709 411",
    labelAt: [800, 316],
    keywords: [
      "cpu",
      "processor",
      "chip",
      "socket",
      "place",
      "put",
      "align",
      "lower",
      "seat",
      "install",
    ],
  },
  {
    id: "cpu-lower-over-socket",
    videoId: "pov-pc-build-cpu-ram",
    start: 55.45,
    end: 57.8,
    previewAt: 55.6,
    scene: "The bare Intel CPU is held beside the open LGA1700 socket.",
    subject: "CPU",
    note: "Trace → seat the CPU in the open socket",
    label: "Seat it in this socket",
    mode: "morph",
    outline:
      "M 770 341 L 876 328 Q 884 327 885 336 L 898 516 Q 899 526 889 527 L 772 522 Q 763 522 763 512 L 762 350 Q 762 342 770 341 Z",
    destination:
      "M 672 378 L 786 365 Q 794 364 795 373 L 807 491 Q 808 501 798 502 L 689 525 Q 680 526 679 516 L 664 388 Q 663 379 672 378 Z",
    motionPath: "M 838 420 C 810 398 780 402 752 434",
    labelAt: [590, 285],
    keywords: [
      "cpu",
      "processor",
      "chip",
      "socket",
      "place",
      "put",
      "align",
      "lower",
      "seat",
      "install",
    ],
  },
  {
    id: "cpu-lower-into-socket",
    videoId: "pov-pc-build-cpu-ram",
    start: 72,
    end: 84,
    previewAt: 82,
    scene: "The Intel CPU is aligned over the open LGA1700 socket, lowered flat, then retained.",
    subject: "CPU",
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
    // Ask window opens at 1:42 — the RAM package is in hand from ~1:45 for the
    // rehearsed "where does this stick go?" ask.
    start: 102,
    end: 155,
    previewAt: 140,
    scene: "DDR4 DIMMs are aligned with the keyed slots and pressed evenly until the latches click.",
    subject: "RAM stick",
    note: "Trace → press both ends evenly",
    label: "Press until both latches click",
    mode: "translate",
    outline:
      "M 544 157 L 584 158 L 586 294 L 596 307 L 586 321 L 589 431 L 548 430 L 545 321 L 535 307 L 545 294 Z",
    delta: [0, 36],
    motionPath: "M 566 228 C 566 275 566 326 568 382",
    detailPaths: ["M 554 178 L 574 179 L 575 286", "M 556 333 L 558 411"],
    labelAt: [640, 360],
    keywords: ["ram", "memory", "dimm", "stick", "press", "seat", "install"],
  },
  {
    id: "gpu-remove-slot-cover",
    videoId: "pov-pc-build-gpu",
    start: 36,
    end: 64,
    previewAt: 48,
    scene: "The rear PCIe slot covers are loosened and removed before the graphics card is installed.",
    subject: "PCIe slot cover",
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
    // Ask window opens at 1:04, right after the slot covers are out — the card
    // is in hand at the case from then on (the rehearsed 1:05–1:15 money shot).
    // Silhouettes are traced at previewAt; the player snaps there.
    start: 64,
    end: 114,
    previewAt: 100,
    scene: "The XFX graphics card is aligned with the PCIe x16 slot and rear bracket, then seated evenly.",
    subject: "graphics card",
    note: "Trace → seat into the PCIe slot",
    label: "Press level into the slot",
    mode: "translate",
    outline:
      "M 346 374 Q 364 365 389 368 L 934 376 Q 954 379 962 392 L 958 444 Q 949 457 929 461 L 380 462 Q 356 458 348 445 Z",
    delta: [0, -36],
    motionPath: "M 652 438 C 652 420 652 399 652 379",
    detailPaths: [
      "M 375 397 L 925 402",
      "M 374 431 L 927 435",
      "M 404 383 L 404 448 M 890 390 L 890 451",
    ],
    labelAt: [710, 330],
    keywords: ["gpu", "graphics", "card", "pcie", "seat", "install", "slot"],
  },
  {
    id: "tuna-slice-celery",
    videoId: "pov-tuna-melt",
    start: 15,
    end: 43,
    previewAt: 24,
    scene: "Celery is being cut into small pieces on the wooden board for the tuna mixture.",
    subject: "celery",
    note: "Trace → slice with a short rock",
    label: "Rock the blade—fingers back",
    mode: "slice",
    outline:
      "M 650 360 L 668 352 L 755 515 L 752 548 L 731 552 L 716 522 Z",
    delta: [-24, -62],
    motionPath: "M 736 518 C 721 477 702 435 677 392",
    detailPaths: ["M 492 286 L 694 286", "M 512 342 L 656 342"],
    labelAt: [806, 446],
    keywords: ["cut", "slice", "chop", "knife", "celery"],
  },
  {
    id: "tuna-lower-sandwich",
    videoId: "pov-tuna-melt",
    start: 68,
    end: 99,
    previewAt: 88,
    scene: "The assembled tuna sandwich is lowered into the skillet and positioned flat for frying.",
    subject: "sandwich",
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
  {
    id: "tesla-release-connector",
    videoId: "tesla",
    start: 215,
    end: 240,
    previewAt: 225,
    scene: "A locked electrical connector is exposed beside the rear hub/suspension assembly.",
    subject: "electrical connector",
    note: "Trace → release lock, pull straight",
    label: "Release the red lock first",
    mode: "translate",
    outline:
      "M 558 318 L 666 307 L 716 340 L 782 344 L 835 376 L 829 466 L 782 492 L 713 474 L 670 449 L 590 452 L 551 414 Z M 611 334 L 676 330 L 702 352 L 662 377 L 604 371 Z",
    delta: [88, 4],
    motionPath: "M 708 401 C 758 401 811 403 870 405",
    detailPaths: ["M 630 320 L 695 320 L 708 348 L 646 365 Z"],
    labelAt: [860, 350],
    keywords: ["connector", "plug", "unplug", "disconnect", "harness", "tesla"],
  },
  {
    id: "ikea-place-leg-frame",
    videoId: "ikea",
    start: 4.8,
    end: 8.15,
    previewAt: 6,
    scene: "The second white rectangular desk end/leg frame is held beside the free short end of the upside-down desktop; the matching end frame is already installed at the far end.",
    subject: "leg frame",
    note: "Trace → pivot the holed rail onto the free end",
    label: "Match this rail to the free end",
    mode: "morph",
    outline:
      "M 277 155 L 315 152 L 448 314 L 566 458 L 681 598 Q 693 611 693 630 L 694 668 Q 694 683 681 689 Q 665 689 657 676 L 655 638 L 572 595 L 462 462 L 370 330 L 296 215 Z M 461 356 L 480 350 L 681 581 L 670 600 Z",
    destination:
      "M 526 360 L 548 341 L 615 420 L 657 470 L 718 545 Q 725 552 725 559 L 723 569 Q 720 577 710 578 Q 700 579 695 571 L 692 563 L 643 508 L 582 434 L 552 397 L 533 372 Z M 566 386 L 580 374 L 698 516 L 686 530 Z",
    motionPath: "M 455 370 C 535 372 585 408 622 448",
    labelAt: [770, 470],
    keywords: [
      "leg",
      "legs",
      "end frame",
      "side frame",
      "frame",
      "upright",
      "desk",
      "table",
    ],
  },
  {
    id: "ikea-seat-leg-frame",
    videoId: "ikea",
    start: 15,
    end: 29,
    previewAt: 20,
    scene: "The second white MICKE end/leg frame is aligned and seated on the free short end of the upside-down desktop.",
    subject: "leg frame",
    note: "Trace → seat the mounting rail square",
    label: "Seat the end frame flush",
    mode: "translate",
    outline:
      "M 86 344 L 641 218 Q 660 215 679 232 L 667 260 L 112 379 Q 92 374 79 361 Z",
    delta: [42, -16],
    motionPath: "M 604 253 C 632 244 660 234 691 222",
    detailPaths: ["M 329 302 A 7 7 0 1 0 329 316 A 7 7 0 1 0 329 302"],
    labelAt: [690, 280],
    keywords: [
      "rail",
      "leg",
      "legs",
      "end frame",
      "side frame",
      "frame",
      "desk",
      "ikea",
    ],
  },
  {
    id: "espresso-tamp-press",
    videoId: "pov-espresso-tamp",
    start: 28,
    end: 33,
    previewAt: 30,
    scene:
      "The barista presses the tamper into the grounds-filled portafilter held against the counter edge.",
    subject: "tamper",
    note: "Trace → press straight down, level",
    label: "Tamp flat—firm, level press",
    mode: "translate",
    outline:
      "M 574 512 Q 576 480 608 476 Q 641 480 644 512 L 646 542 Q 640 556 609 558 Q 580 556 573 542 Z",
    delta: [0, 30],
    motionPath: "M 604 432 C 606 468 609 504 613 542",
    detailPaths: ["M 590 566 Q 622 578 662 568"],
    labelAt: [742, 500],
    keywords: [
      "tamp",
      "tamper",
      "stamp",
      "pack",
      "puck",
      "portafilter",
      "grounds",
      "coffee",
    ],
  },
];

const ACTION_ONLY_KEYWORDS = new Set([
  "align",
  "assemble",
  "attach",
  "bend",
  "build",
  "chop",
  "connect",
  "cut",
  "disconnect",
  "feed",
  "fit",
  "fry",
  "insert",
  "install",
  "lower",
  "place",
  "position",
  "press",
  "pull",
  "put",
  "remove",
  "roll",
  "route",
  "seat",
  "slice",
  "spread",
  "unbox",
  "unplug",
]);

function keywordScore(cue: CatalogMotionCue, message: string): number {
  const text = message.toLowerCase();
  return cue.keywords.reduce(
    (score, keyword) =>
      score +
      (!ACTION_ONLY_KEYWORDS.has(keyword) && text.includes(keyword) ? 1 : 0),
    0,
  );
}

/** Resolve instantly from clip + playhead; no network round trip or model box. */
export function findCatalogChoreography(
  videoId: string,
  currentTime: number,
  message: string,
  subjectHint?: string | null,
): CatalogMotionCue | null {
  const matches = CATALOG_MOTION_CUES.filter(
    (cue) =>
      cue.videoId === videoId &&
      currentTime >= cue.start &&
      currentTime < cue.end,
  );
  if (!matches.length) return null;
  // Named-object placement must agree with the authored subject. Purely
  // deictic asks ("move this", "where does this connect?") may still use the
  // only grounded scene cue — the lookahead must skip placement verbs that
  // directly follow the pronoun, or "this go/connect/fit" reads as "this
  // <noun>" and the deictic path never fires.
  const namedReferent =
    /\b(?:this|that|these|those|the|my|our)\s+(?!(?:one|thing|object|part|piece|stuff|way|around|over|under|up|down|left|right|in|out|into|onto|away|here|there|clockwise|counterclockwise|go|goes|fit|fits|sit|sits|attach|attaches|connect|connects|mount|mounts|belong|belongs|plug|plugs)\b)[a-z][\w-]*/i.test(
      message,
    );
  const deictic =
    /\b(this|that|it|these|those|here)\b/i.test(message) && !namedReferent;
  const scoringText =
    deictic && subjectHint ? `${message} ${subjectHint}` : message;
  const best = matches
    .map((cue) => ({ cue, score: keywordScore(cue, scoringText) }))
    .sort((a, b) => b.score - a.score)[0];
  return best.score > 0 || deictic ? best.cue : null;
}
