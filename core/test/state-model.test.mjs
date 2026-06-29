/**
 * State-model GUARDS (docs/unoverse/UNOVERSE_STATE_MODEL.md).
 *
 * Freezes the agreed model so it can't silently drift:
 *   - the engine is FEATURE-FREE and hardcodes NO UI concept (no faq/suggestion/voice,
 *     and no togglePanel/openFocus/… verbs),
 *   - the TWO generic writes behave: `setValue` → a component's own slice,
 *     `setTemplateValue` → template state (the dev picks the key + the bucket),
 *   - `TEMPLATE_DATA` merges opaque keys into template state,
 *   - history is capped + evicted data is freed.
 *
 * Tests the built artifact (dist) like consumers, plus a source scan for the guard.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ComponentStore, applyServerMessage, dispatchAction } from "../dist/index.js";

const init = (chatId, nodeId, type = "X") => ({ type: "COMPONENT_INIT", chatId, nodeId, component: { type } });
const ctx = (s, chatId = "C", nodeId = "n1") => ({ store: s, chatId, nodeId });

// ── The anti-drift guard: core code names no feature AND no UI pattern ───────────
test("core source hardcodes NO feature/UI concept (faq/suggestion/voice/panel/focus verbs)", () => {
  const forbidden = /\b(faqs?|suggestions?|voice|togglePanel|closePanel|openFocus|closeFocus|getOpenPanel|getFocus)\b/i;
  for (const f of ["store.ts", "connection.ts", "actions.ts", "types.ts"]) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    const offenders = src
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("*/"));
      })
      .map((line) => line.split("//")[0]) // drop trailing inline comments
      .filter((code) => forbidden.test(code));
    assert.equal(offenders.length, 0, `feature/UI concept leaked into core/src/${f}:\n  ${offenders.join("\n  ")}`);
  }
});

// ── Write 1: setValue → the COMPONENT's own slice (focus is just its own displayState) ──
test("setValue writes the dev's key into the COMPONENT's own slice — NOT template state", () => {
  const s = new ComponentStore();
  applyServerMessage(s, init("C", "n1"), new Set());
  dispatchAction({ type: "setValue", values: [{ key: "displayState", value: "focused" }] }, {}, ctx(s));
  assert.equal(s.get("C", "n1").displayState, "focused"); // component state
  assert.equal(s.getTemplateState().displayState, undefined); // not template state
});

// ── Write 2: setTemplateValue → template state (the dev names the key, e.g. openPanel) ──
test("setTemplateValue writes the dev's key into TEMPLATE state (no UI concept in core)", () => {
  const s = new ComponentStore();
  dispatchAction({ type: "setTemplateValue", values: [{ key: "openPanel", value: "faq" }] }, {}, ctx(s));
  assert.equal(s.getTemplateState().openPanel, "faq");
  dispatchAction({ type: "setTemplateValue", values: [{ key: "openPanel", value: null }] }, {}, ctx(s));
  assert.equal(s.getTemplateState().openPanel, null);
});

// ── Inbound TEMPLATE_DATA merges OPAQUE keys into template state ─────────────────
test("TEMPLATE_DATA merges OPAQUE keys into template state (engine knows no names)", () => {
  const s = new ComponentStore();
  applyServerMessage(s, { type: "TEMPLATE_DATA", data: { faqs: [{ text: "a" }], anything: 7 } }, new Set());
  assert.deepEqual(s.getTemplateState().faqs, [{ text: "a" }]);
  assert.equal(s.getTemplateState().anything, 7);
});

// ── Draft lives in template state ────────────────────────────────────────────────
test("draft lives in template state", () => {
  const s = new ComponentStore();
  s.setDraft("hi");
  assert.equal(s.getDraft(), "hi");
  assert.equal(s.getTemplateState().draft, "hi");
});

// ── History cap: evicting a turn frees its component data ────────────────────────
test("eviction caps the timeline AND frees evicted component data", () => {
  const s = new ComponentStore({ maxTurns: 2 });
  applyServerMessage(s, init("A", "n1"), new Set());
  applyServerMessage(s, init("B", "n2"), new Set());
  applyServerMessage(s, init("C", "n3"), new Set());
  assert.ok(s.getTimeline().length <= 2, "timeline must be capped at maxTurns");
  assert.deepEqual(s.get("A", "n1"), {}, "evicted turn's component data must be freed");
  assert.equal(s.getType("C", "n3"), "X", "newest turn survives");
});
