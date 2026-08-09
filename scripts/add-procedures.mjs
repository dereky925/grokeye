#!/usr/bin/env node
/**
 * Fill in the CORRECT PROCEDURE on baked step scripts.
 *
 * The baked `steps` record what the person in the clip did — which may itself
 * be the mistake. Grading against them can never catch a skipped or reordered
 * action (the espresso barista locking in an untamped puck read as "correct"
 * because the step said that is what happens). So each script also carries:
 *
 *   procedure  — the canonical ordered method for the task
 *   steps[].expected — what correct procedure requires at that point
 *
 * Text-only pass over the existing timeline; it never touches the bounds.
 *
 *   node scripts/add-procedures.mjs            # fill in what's missing
 *   node scripts/add-procedures.mjs --force    # redo them all
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "server", "scripts");
const force = process.argv.includes("--force");
const apiKey = process.env.XAI_API_KEY;
if (!apiKey) {
  console.error("Missing XAI_API_KEY in .env");
  process.exit(1);
}

let failures = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const p = path.join(dir, file);
  const doc = JSON.parse(fs.readFileSync(p, "utf8"));
  const done = Array.isArray(doc.procedure) && doc.steps.every((s) => s.expected);
  if (done && !force) {
    console.log(`- ${doc.videoId}: already has a procedure`);
    continue;
  }

  const prompt = [
    `Task: ${doc.task}.`,
    doc.setting ? `Scene: ${doc.setting}` : "",
    "",
    "Below is what the person in the clip ACTUALLY DID, step by step. Some of it may be wrong, skipped, or out of order — do not assume it is correct.",
    doc.steps
      .map(
        (s) =>
          `  ${s.n}. (${s.start}-${s.end}s) ${s.text} — ${s.detail}${
            s.flags?.length ? ` [concerns: ${s.flags.join("; ")}]` : ""
          }`,
      )
      .join("\n"),
    "",
    "Return ONLY valid JSON (no markdown):",
    JSON.stringify({
      procedure: ["the correct ordered method for this task, one action per entry"],
      expected: { 1: "what correct procedure requires at the time of step 1" },
    }),
    "",
    "`procedure` is how a competent professional does this task properly — from established practice, NOT copied from the steps above.",
    "`expected` has one entry per step number above. Each says what correct procedure requires at that point in the task.",
    "Where the person's action deviates from correct procedure, `expected` must state the requirement plainly (e.g. 'X must be done BEFORE Y; doing Y first is out of order'), so a reviewer comparing footage to it will catch the deviation.",
    "Where the action is correct, say so plainly.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        reasoning_effort: "high",
        messages: [
          {
            role: "system",
            content:
              "You state the correct professional procedure for hands-on tasks. Output JSON only. Never treat a demonstrated action as correct just because it was demonstrated.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || "upstream error");
    const parsed = JSON.parse(
      (data?.choices?.[0]?.message?.content || "")
        .replace(/^\s*```(?:json)?/m, "")
        .replace(/```\s*$/m, "")
        .trim(),
    );
    const procedure = (Array.isArray(parsed.procedure) ? parsed.procedure : [])
      .map((x) => String(x).trim())
      .filter(Boolean);
    if (procedure.length < 2) throw new Error("procedure too short");
    for (const s of doc.steps) {
      const e = parsed.expected?.[s.n] ?? parsed.expected?.[String(s.n)];
      if (!e) throw new Error(`no expected for step ${s.n}`);
      s.expected = String(e).trim();
    }
    doc.procedure = procedure;
    fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`+ ${doc.videoId}: ${procedure.length} procedure steps`);
  } catch (err) {
    failures += 1;
    console.error(`! ${doc.videoId}: ${err.message}`);
  }
}
process.exit(failures ? 1 : 0);
