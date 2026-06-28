/**
 * ComponentStore — the single shared state (data plane + pointer-only timeline).
 *
 * Proves the load-bearing claims of UNOVERSE_SPEC.md §2e-0:
 *   - COMPONENT_INIT places a POINTER in the timeline (structure).
 *   - COMPONENT_DATA merges into the data plane ONLY (timeline never moves).
 *   - history holds pointers, never copies — data lives once at chatId:nodeId.
 *   - reusing chatId:nodeId updates the component in place (no duplicate pointer).
 *
 * Tests the built artifact (dist) — same code published consumers get.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ComponentStore } from "../dist/index.js";

const init = (chatId, nodeId, type, props = {}) => ({
  type: "COMPONENT_INIT",
  chatId,
  nodeId,
  component: { type, props },
});
const data = (chatId, nodeId, patch) => ({ type: "COMPONENT_DATA", chatId, nodeId, data: patch });

test("user message creates a user turn", () => {
  const s = new ComponentStore();
  s.addUserMessage("C1", "I want to go to Paris");
  const tl = s.getTimeline();
  assert.equal(tl.length, 1);
  assert.equal(tl[0].role, "user");
  assert.equal(tl[0].text, "I want to go to Paris");
});

test("COMPONENT_INIT places a pointer + seeds data + sets type", () => {
  const s = new ComponentStore();
  s.apply(init("C1", "N1", "Card", { title: "Paris" }));

  // structure: one assistant response holding the pointer C1:N1
  const resp = s.latestResponse();
  assert.ok(resp);
  assert.equal(resp.streamingState, "streaming");
  assert.deepEqual(resp.components, ["C1:N1"]);

  // data + type resolved at the pointer
  assert.equal(s.typeOf("C1:N1"), "Card");
  assert.equal(s.getType("C1", "N1"), "Card");
  assert.deepEqual(s.get("C1", "N1"), { title: "Paris" });
});

test("two INITs (same chatId, different nodeId) go in ONE response, in order", () => {
  const s = new ComponentStore();
  s.apply(init("C1", "N1", "AIResponse"));
  s.apply(init("C1", "N2", "Card"));

  assert.equal(s.getResponses().length, 1);
  assert.deepEqual(s.latestResponse().components, ["C1:N1", "C1:N2"]);
});

test("COMPONENT_DATA merges into data ONLY — the timeline never moves", () => {
  const s = new ComponentStore();
  s.apply(init("C1", "N1", "Card", { title: "Paris" }));
  const timelineBefore = JSON.stringify(s.getTimeline());

  s.apply(data("C1", "N1", { subtitle: "France" }));

  // data merged (merge-not-replace: title survives)
  assert.deepEqual(s.get("C1", "N1"), { title: "Paris", subtitle: "France" });
  // structure unchanged — proves data/structure independence (why swap is safe)
  assert.equal(JSON.stringify(s.getTimeline()), timelineBefore);
});

test("reusing chatId:nodeId updates in place — no duplicate pointer", () => {
  const s = new ComponentStore();
  s.apply(init("C1", "N1", "BookingWidget", { status: "pending" }));
  s.apply(data("C1", "N1", { status: "confirmed" }));
  s.apply(init("C1", "N1", "BookingWidget", { seat: "12A" })); // re-init same instance

  assert.deepEqual(s.latestResponse().components, ["C1:N1"]); // still ONE pointer
  assert.deepEqual(s.get("C1", "N1"), { status: "confirmed", seat: "12A" });
});

test("a new chatId starts a new response turn", () => {
  const s = new ComponentStore();
  s.apply(init("C1", "N1", "Card"));
  s.apply(init("C2", "N1", "Card")); // same nodeId, different chat → isolated instance + new turn

  assert.equal(s.getResponses().length, 2);
  assert.notEqual(s.get("C1", "N1"), s.get("C2", "N1"));
  assert.deepEqual(s.latestResponse().components, ["C2:N1"]);
});

test("completeResponse flips streamingState for that chatId", () => {
  const s = new ComponentStore();
  s.apply(init("C1", "N1", "Card"));
  assert.equal(s.latestResponse().streamingState, "streaming");
  s.completeResponse("C1");
  assert.equal(s.latestResponse().streamingState, "complete");
});

test("split() resolves a pointer back to its parts", () => {
  const s = new ComponentStore();
  assert.deepEqual(s.split("C1:N1"), { chatId: "C1", nodeId: "N1" });
});

test("subscribers fire and version bumps on every write", () => {
  const s = new ComponentStore();
  let hits = 0;
  const unsub = s.subscribe(() => hits++);
  const v0 = s.getVersion();

  s.addUserMessage("C1", "hi");
  s.apply(init("C1", "N1", "Card"));
  s.apply(data("C1", "N1", { x: 1 }));

  assert.ok(hits >= 3);
  assert.ok(s.getVersion() > v0);
  unsub();
});

test("template-swap invariant: the conversation is independent of any template", () => {
  // Build a conversation. No template is involved at all — proving the history
  // lives in the store, so swapping templates (which only READ this) loses nothing.
  const s = new ComponentStore();
  s.addUserMessage("C1", "I want to go to Paris");
  s.apply(init("C1", "N1", "AIResponse", { text: "Sure!" }));
  s.apply(init("C2", "N2", "BookingWidget", { status: "pending" })); // later /booking turn

  // Whatever template renders this, it reads the same 3 entries.
  const tl = s.getTimeline();
  assert.equal(tl.length, 3);
  assert.deepEqual(tl.map((t) => t.role), ["user", "assistant", "assistant"]);
  assert.equal(s.typeOf(s.getResponses()[1].components[0]), "BookingWidget");
});

test("composer draft: set/get, bumps, idempotent, clears", () => {
  const store = new ComponentStore();
  let bumps = 0;
  store.subscribe(() => bumps++);
  store.setDraft("hello");
  assert.equal(store.getDraft(), "hello");
  assert.ok(bumps > 0, "setDraft bumps subscribers");
  const at = bumps;
  store.setDraft("hello");
  assert.equal(bumps, at, "setting the same draft does not bump");
  store.setDraft("");
  assert.equal(store.getDraft(), "");
});

test("turns are stamped with a numeric createdAt (for relative time)", () => {
  const store = new ComponentStore();
  store.addUserMessage("c1", "hi");
  store.startResponse("c1");
  const [u, a] = store.getTimeline();
  assert.equal(typeof u.createdAt, "number");
  assert.ok(u.createdAt > 0);
  assert.equal(typeof a.createdAt, "number");
});
