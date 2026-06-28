/**
 * CLOSED-SET GUARD — the primitive set is FROZEN (makes a prose rule executable).
 *
 * FRAMEWORK.md: the leaves are a CLOSED set, and "if you can express it by combining
 * existing primitives in a definition, it is NOT an SDK change" (~95% of the time).
 * That rule was prose-only — so a new primitive (a `ChartView`, a `Loader`…) could be
 * added silently and nothing failed. This test makes it executable: `render.tsx` may
 * dispatch ONLY the allowlisted node types, and `primitives.tsx` may export ONLY the
 * allowlisted leaf views. Add one and the build breaks here.
 *
 * To add a primitive (rare — see the 3 gates in FRAMEWORK.md): prove it is a SINGLE
 * IRREDUCIBLE element that CANNOT be composed from existing primitives, then add it to
 * the allowlist below WITH a one-line reason. That edit is the deliberate, reviewable
 * gate — the whole point is that you cannot reach a green build without making it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// ── The FROZEN closed set (FRAMEWORK.md §"The closed set of primitives"). ──
// Each entry is IRREDUCIBLE: it cannot be built by composing other primitives.
const ALLOWED_TYPES = new Set([
  "Box", "Stack", "Row", "Column", // the generic container (one <div>)
  "Each", //                          control flow: map a bound array
  "ComponentSlot", "Timeline", //     store-backed slots (template plane)
  "Text", //                          <span> — a bound string
  "Image", //                         <img>
  "Button", //                        <button>
  "Input", //                         <input> — cannot be built from Box+Text
  "Markdown", //                      a markdown document — irreducible interpreter leaf
  "Skeleton", //                      loading placeholder
  "Icon", //                          a single served SVG glyph
]);

const ALLOWED_VIEWS = new Set([
  "BoxView", "TextView", "ImageView", "ButtonView",
  "UnknownView", //  the degenerate fallback for an unknown type (not a real primitive)
  "IconView", "SkeletonView", "InputView", "MarkdownView",
]);

const stop = (kind, extra) =>
  `CLOSED-SET VIOLATION — a primitive was added to the SDK without passing the gate.\n` +
  `New ${kind}: ${[...extra].join(", ")}\n\n` +
  `STOP. FRAMEWORK.md: "if you can express it by combining existing primitives in a\n` +
  `definition, it is NOT an SDK change." Before adding a primitive, prove it is a SINGLE\n` +
  `IRREDUCIBLE element that cannot be composed from Box/Text/Image/Each/etc. (e.g. a bar\n` +
  `chart IS composable from Box+Each → it is DATA, not a primitive). If it genuinely\n` +
  `passes the 3 gates, add it to the allowlist in test/closed-set.test.mjs WITH a one-line\n` +
  `reason — that edit is the deliberate, reviewable gate.`;

test("render.tsx dispatches ONLY the frozen closed set of node types", () => {
  const src = readFileSync(join(SRC, "render.tsx"), "utf8");
  const found = new Set();
  for (const m of src.matchAll(/node\.type === "([^"]+)"/g)) found.add(m[1]);
  for (const m of src.matchAll(/case "([^"]+)":/g)) found.add(m[1]);
  const extra = [...found].filter((t) => !ALLOWED_TYPES.has(t));
  assert.equal(extra.length, 0, stop("dispatched node type(s)", extra));
});

test("primitives.tsx exports ONLY the frozen closed set of leaf views", () => {
  const src = readFileSync(join(SRC, "primitives.tsx"), "utf8");
  const found = new Set();
  for (const m of src.matchAll(/export function (\w+View)\b/g)) found.add(m[1]);
  const extra = [...found].filter((v) => !ALLOWED_VIEWS.has(v));
  assert.equal(extra.length, 0, stop("primitive view(s)", extra));
});
