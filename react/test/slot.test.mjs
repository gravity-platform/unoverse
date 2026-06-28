/**
 * selectPointers — the ComponentSlot resolution logic (KeyService's core move).
 * Proves select.type / from / limit against a real store. Renders nothing —
 * just the pointer selection that drives which leaves a slot shows.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ComponentStore } from "@gravity-platform/unoverse-core";
import { selectPointers } from "../dist/index.js";

const init = (chatId, nodeId, type) => ({ type: "COMPONENT_INIT", chatId, nodeId, component: { type } });
const slot = (select) => ({ type: "ComponentSlot", select });

function keyServiceStore() {
  const s = new ComponentStore();
  s.apply(init("C1", "N1", "AIResponse"));
  s.apply(init("C1", "N2", "UnoverseCard"));
  s.apply(init("C1", "N3", "UnoverseCard"));
  return s;
}

test("selects by type from the latest response", () => {
  const s = keyServiceStore();
  assert.deepEqual(selectPointers(s, slot({ type: ["UnoverseCard"] })), ["C1:N2", "C1:N3"]);
  assert.deepEqual(selectPointers(s, slot({ type: ["AIResponse"] })), ["C1:N1"]);
});

test("type match is case-insensitive", () => {
  const s = keyServiceStore();
  assert.deepEqual(selectPointers(s, slot({ type: ["unoversecard"] })), ["C1:N2", "C1:N3"]);
});

test("limit caps the result", () => {
  const s = keyServiceStore();
  assert.deepEqual(selectPointers(s, slot({ type: ["UnoverseCard"], limit: 1 })), ["C1:N2"]);
});

test("no type → all components in the latest response", () => {
  const s = keyServiceStore();
  assert.deepEqual(selectPointers(s, slot({})), ["C1:N1", "C1:N2", "C1:N3"]);
});

test("no match → empty (slot will render its fallback)", () => {
  const s = keyServiceStore();
  assert.deepEqual(selectPointers(s, slot({ type: ["KenBurnsImage"] })), []);
});

test("from:'all' spans every response; 'latest' is only the last", () => {
  const s = new ComponentStore();
  s.apply(init("C1", "N1", "UnoverseCard")); // turn 1
  s.apply(init("C2", "N1", "UnoverseCard")); // turn 2
  assert.deepEqual(selectPointers(s, slot({ type: ["UnoverseCard"], from: "all" })), ["C1:N1", "C2:N1"]);
  assert.deepEqual(selectPointers(s, slot({ type: ["UnoverseCard"], from: "latest" })), ["C2:N1"]);
});
