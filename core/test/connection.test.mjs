/**
 * applyServerMessage — the pure data-plane mapper (inbound WS event → store).
 *
 * Proves the channel-connector contract (UNOVERSE_MCP_TEMPLATE_PROTOCOL.md §5a):
 *   - COMPONENT_INIT places the component (timeline pointer + props).
 *   - a REPEAT COMPONENT_INIT for the same chatId:nodeId is a props MERGE, not a
 *     second placement (legacy gravity-client behaviour).
 *   - COMPONENT_DATA / OBJECT_DATA merge into the data plane only.
 *   - WORKFLOW_COMPLETED flips the response to complete.
 *   - unknown / out-of-scope message types are ignored.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ComponentStore, applyServerMessage } from "../dist/index.js";

test("COMPONENT_INIT places one component with props", () => {
  const store = new ComponentStore();
  const seen = new Set();
  applyServerMessage(store, { type: "COMPONENT_INIT", chatId: "c1", nodeId: "n1", component: { type: "Card", props: { title: "Hi" } } }, seen);

  const resp = store.latestResponse();
  assert.equal(resp.components.length, 1);
  assert.equal(resp.components[0], "c1:n1");
  assert.equal(store.get("c1", "n1").title, "Hi");
  assert.equal(store.getType("c1", "n1"), "Card");
});

test("repeat COMPONENT_INIT merges props, does NOT place twice", () => {
  const store = new ComponentStore();
  const seen = new Set();
  const m = (props) => applyServerMessage(store, { type: "COMPONENT_INIT", chatId: "c1", nodeId: "n1", component: { type: "Card", props } }, seen);
  m({ title: "Hi" });
  m({ subtitle: "there" });

  const resp = store.latestResponse();
  assert.equal(resp.components.length, 1, "still one pointer");
  assert.deepEqual(store.get("c1", "n1"), { title: "Hi", subtitle: "there" }, "props merged");
});

test("COMPONENT_DATA and OBJECT_DATA merge data only", () => {
  const store = new ComponentStore();
  const seen = new Set();
  applyServerMessage(store, { type: "COMPONENT_INIT", chatId: "c1", nodeId: "n1", component: { type: "Card", props: { title: "Hi" } } }, seen);
  applyServerMessage(store, { type: "COMPONENT_DATA", chatId: "c1", nodeId: "n1", data: { body: "x" } }, seen);
  applyServerMessage(store, { type: "OBJECT_DATA", chatId: "c1", nodeId: "n1", data: { extra: 1 } }, seen);

  assert.deepEqual(store.get("c1", "n1"), { title: "Hi", body: "x", extra: 1 });
  assert.equal(store.latestResponse().components.length, 1);
});

test("WORKFLOW_COMPLETED completes the response", () => {
  const store = new ComponentStore();
  const seen = new Set();
  applyServerMessage(store, { type: "COMPONENT_INIT", chatId: "c1", nodeId: "n1", component: { type: "Card", props: {} } }, seen);
  assert.equal(store.latestResponse().streamingState, "streaming");
  applyServerMessage(store, { type: "WORKFLOW_STATE", state: "WORKFLOW_COMPLETED", chatId: "c1" }, seen);
  assert.equal(store.latestResponse().streamingState, "complete");
});

test("unknown / out-of-scope message types are ignored", () => {
  const store = new ComponentStore();
  const seen = new Set();
  applyServerMessage(store, { type: "NODE_EXECUTION", nodeId: "n1", status: "running" }, seen);
  applyServerMessage(store, { type: "SUGGESTIONS_UPDATE", suggestions: {} }, seen);
  assert.equal(store.getTimeline().length, 0, "no turns created");
});

test("messages missing chatId/nodeId are dropped safely", () => {
  const store = new ComponentStore();
  const seen = new Set();
  applyServerMessage(store, { type: "COMPONENT_INIT", component: { type: "Card" } }, seen);
  assert.equal(store.getTimeline().length, 0);
});

test("WORKFLOW_STARTED opens an empty streaming turn (the thinking window), reused by the first component", () => {
  const store = new ComponentStore();
  const seen = new Set();
  // Before any component: an empty streaming assistant turn must exist (dots show).
  applyServerMessage(store, { type: "WORKFLOW_STATE", state: "WORKFLOW_STARTED", chatId: "r1" }, seen);
  const t = store.latestResponse();
  assert.equal(t.streamingState, "streaming");
  assert.equal(t.components.length, 0, "streaming AND empty → thinking dots window");
  // First component reuses the SAME turn (no duplicate), and it's no longer empty.
  applyServerMessage(store, { type: "COMPONENT_INIT", chatId: "r1", nodeId: "n1", component: { type: "AIResponse", props: {} } }, seen);
  assert.equal(store.getResponses().length, 1, "reused, not duplicated");
  assert.equal(store.latestResponse().components.length, 1);
});

test("WORKFLOW_STARTED is idempotent and re-opens a completed turn to streaming", () => {
  const store = new ComponentStore();
  const seen = new Set();
  applyServerMessage(store, { type: "WORKFLOW_STATE", state: "WORKFLOW_STARTED", chatId: "r1" }, seen);
  applyServerMessage(store, { type: "WORKFLOW_STATE", state: "WORKFLOW_STARTED", chatId: "r1" }, seen);
  assert.equal(store.getResponses().length, 1, "idempotent — no duplicate turn");
  applyServerMessage(store, { type: "WORKFLOW_STATE", state: "WORKFLOW_COMPLETED", chatId: "r1" }, seen);
  assert.equal(store.latestResponse().streamingState, "complete");
});

test("a TEMPLATE directive (isTemplate / _template nodeId) switches the active template, NOT a component", () => {
  const store = new ComponentStore();
  const seen = new Set();
  // legacy-shaped template directive on WORKFLOW_STARTED
  applyServerMessage(store, {
    type: "COMPONENT_INIT", chatId: "c1", nodeId: "sabchatlayout_template",
    component: { type: "SABChatLayout", componentUrl: "/components/SABChatLayout.js", props: { placeholder: "Ask…" } },
    metadata: { isTemplate: true },
  }, seen);
  assert.equal(store.getActiveTemplate().name, "SABChatLayout", "template selected");
  assert.equal(store.getTimeline().length, 0, "NOT placed in the component timeline (no Unknown-component render)");
});

test("WORKFLOW_STATE metadata.template is the official template selection", () => {
  const store = new ComponentStore();
  const seen = new Set();
  applyServerMessage(store, { type: "WORKFLOW_STATE", state: "WORKFLOW_STARTED", chatId: "c1", metadata: { template: "ChatLayout" } }, seen);
  assert.equal(store.getActiveTemplate().name, "ChatLayout");
});

test("a _template nodeId alone (no isTemplate metadata) still switches the template", () => {
  const store = new ComponentStore();
  const seen = new Set();
  applyServerMessage(store, { type: "COMPONENT_INIT", chatId: "c1", nodeId: "chatlayout_template", component: { type: "ChatLayout" } }, seen);
  assert.equal(store.getActiveTemplate().name, "ChatLayout");
  assert.equal(store.getTimeline().length, 0, "template directive never enters the component timeline");
});

test("a real component still streams in after a template directive (early-return doesn't break the stream)", () => {
  const store = new ComponentStore();
  const seen = new Set();
  applyServerMessage(store, { type: "COMPONENT_INIT", chatId: "c1", nodeId: "sabchatlayout_template", component: { type: "SABChatLayout" }, metadata: { isTemplate: true } }, seen);
  applyServerMessage(store, { type: "COMPONENT_INIT", chatId: "c1", nodeId: "n1", component: { type: "AIResponse", props: { text: "hi" } } }, seen);
  assert.equal(store.getResponses().length, 1, "the real component opened a response turn");
  assert.equal(store.latestResponse().components.length, 1);
  assert.equal(store.get("c1", "n1").text, "hi");
});
