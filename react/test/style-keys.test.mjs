/**
 * STYLE-VOCAB GUARD — the style interpreter's key set is FROZEN.
 *
 * The closed-set guard freezes PRIMITIVES, but the other way per-UX creep enters the
 * SDK is a new STYLE KEY in styleToCss (e.g. a `radial`/`dial`/`glow` tailored to one
 * widget). That surface was ungated — so a borderline key could be added with no
 * friction. This test makes every style key a deliberate, reasoned allowlist entry:
 * add one to style.ts and the build breaks here until you justify it below.
 *
 * The bar (FRAMEWORK.md): a style key must be GENERIC (a whole class of UX, not one
 * widget) and author ZERO values (resolve served tokens / data only). When in doubt,
 * compose it in a definition or push it to the producer — don't grow the vocab.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// ── The FROZEN style vocab. Each key is GENERIC (a class of UX) and authors no value. ──
const ALLOWED_STYLE_KEYS = new Set([
  // box model / layout
  "width", "height", "maxWidth", "minWidth", "minHeight", "flex", "position", "inset", "display", "columns", "overflow",
  // `container` — a container-query context (container-type) so descendants respond to THIS
  // element's width via hideBelow. Generic responsive vocab; value served. Pairs with hideBelow.
  "container",
  // flexbox  (`wrap` = flex-wrap: content-width items sit side-by-side, wrap when no room)
  "direction", "wrap", "gap", "align", "justify",
  // spacing
  "padding", "margin",
  // interaction affordance
  "cursor",
  // colour / surface
  "background", "color",
  // `radial` — a NON-COMPOSABLE conic fill (dials/gauges/donuts/pies). The doc-preferred
  // "new style key over a primitive"; both colours are served tokens, the stop is data.
  "radial",
  // borders
  "border", "borderTop", "borderRight", "borderBottom", "borderLeft", "outline",
  // radius
  "radius", "radiusTopLeft", "radiusTopRight", "radiusBottomLeft", "radiusBottomRight",
  // elevation
  "shadow",
  // image
  "fit",
  // typography
  "font", "weight", "lineHeight",
  // motion
  "transition", "animation", "animationDelay",
]);

test("styleToCss reads ONLY the frozen style vocab", () => {
  const src = readFileSync(join(SRC, "style.ts"), "utf8");
  const found = new Set();
  for (const m of src.matchAll(/\bs\.([a-zA-Z][a-zA-Z0-9]*)/g)) found.add(m[1]);
  const extra = [...found].filter((k) => !ALLOWED_STYLE_KEYS.has(k));
  assert.equal(
    extra.length,
    0,
    `STYLE-VOCAB VIOLATION — a style key was added without passing the gate.\n` +
      `New key(s): ${extra.join(", ")}\n\n` +
      `STOP. A style key must be GENERIC (a whole class of UX, not one widget) and author\n` +
      `ZERO values (resolve served tokens / data only). If it's tailored to one widget,\n` +
      `compose it in a definition or push it to the producer instead. If it genuinely\n` +
      `passes the bar, add it to the allowlist in test/style-keys.test.mjs WITH a one-line\n` +
      `reason — that edit is the deliberate, reviewable gate.`,
  );
});

// Injected style keys live in primitives.tsx's nodeChrome (hover/active/disabled/hideBelow) —
// they bypass styleToCss because they need <style> injection (pseudo-classes, media queries),
// so the style.ts scan above can't see them. Freeze that surface too: this is where `radial`'s
// twin slip happened with hideBelow (added ungated). Same bar — GENERIC, ZERO authored values.
const ALLOWED_INJECTED_KEYS = new Set(["hover", "active", "disabled", "hideBelow"]);

test("primitives.tsx injects ONLY the frozen set of stateful/responsive style keys", () => {
  const src = readFileSync(join(SRC, "primitives.tsx"), "utf8");
  const found = new Set();
  for (const m of src.matchAll(/\["(\w+)",\s*":/g)) found.add(m[1]); // INTERACTION_STATES entries
  for (const m of src.matchAll(/\bs\?\.([a-zA-Z][a-zA-Z0-9]*)/g)) found.add(m[1]); // s?.hideBelow
  for (const m of src.matchAll(/node\.style\?\.([a-zA-Z][a-zA-Z0-9]*)/g)) found.add(m[1]); // node.style?.disabled
  const extra = [...found].filter((k) => !ALLOWED_INJECTED_KEYS.has(k));
  assert.equal(
    extra.length,
    0,
    `INJECTED STYLE-VOCAB VIOLATION — a new injected style key was added to primitives.tsx\n` +
      `without passing the gate: ${extra.join(", ")}\n\n` +
      `STOP. Injected style keys bypass styleToCss (they need <style> injection), so the style.ts\n` +
      `guard can't see them. Same bar applies — GENERIC, ZERO authored values. If it genuinely\n` +
      `passes, add it to ALLOWED_INJECTED_KEYS in test/style-keys.test.mjs WITH a one-line reason.`,
  );
});
