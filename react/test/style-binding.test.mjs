/**
 * styleToCss `{{field}}` binding — the data-driven style value (UNOVERSE_DASHBOARDS.md).
 * This is what lets bar/progress charts be DATA (Box + Each) instead of a primitive:
 * a bar's `height: "{{pct}}"` resolves from the producer-supplied proportion.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { styleToCss } from "../dist/index.js";

const theme = { space: {}, color: {}, radius: {}, shadow: {}, borderWidth: {}, lineHeight: {}, text: {} };

test("a {{field}} style value resolves from the data scope", () => {
  const css = styleToCss({ height: "{{pct}}" }, theme, { pct: "72%" });
  assert.equal(css.height, "72%");
});

test("without data, a {{field}} value is left untouched (no resolution)", () => {
  const css = styleToCss({ height: "{{pct}}" }, theme);
  assert.equal(css.height, "{{pct}}");
});

test("radial builds a conic-gradient from served tokens + a bound stop", () => {
  const t = { ...theme, color: { "action.primary": "#d33", "surface.sunken": "#eee" } };
  const css = styleToCss({ radial: { fill: "action.primary", track: "surface.sunken", at: "{{pct}}" } }, t, { pct: "72%" });
  assert.equal(css.background, "conic-gradient(#d33 72%, #eee 0)");
});

test("non-binding values are unaffected by the data pass", () => {
  const css = styleToCss({ background: "action.primary" }, { ...theme, color: { "action.primary": "#fff" } }, { pct: "9%" });
  assert.equal(css.background, "#fff");
});
