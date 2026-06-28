/**
 * dispatchAction — the §2e-3 interaction interpreter.
 *
 * Proves the load-bearing claims:
 *   - `setValue` merges into THIS chatId:nodeId slice LOCALLY (no server route).
 *   - `value` resolves `{{field}}` / `{{a.b}}` bindings against the action scope; literals pass through.
 *   - a non-`setValue` type routes to the server, narrowed by `send` (else the whole scope).
 *   - a bare string action is a server route.
 *   - `then` chains a follow-up (Stac Multi Action) — the optimistic-then-confirm pattern.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ComponentStore, dispatchAction, resolveValue } from "../dist/index.js";

test("resolveValue: {{field}}, dot-path, and literal passthrough", () => {
  const scope = { id: "x1", order: { status: "open" } };
  assert.equal(resolveValue("{{id}}", scope), "x1");
  assert.equal(resolveValue("{{order.status}}", scope), "open");
  assert.equal(resolveValue("faq", scope), "faq"); // literal
  assert.equal(resolveValue(42, scope), 42); // non-string literal
  assert.equal(resolveValue("{{missing}}", scope), undefined);
});

test("setValue writes the instance slice locally — no server route", () => {
  const store = new ComponentStore();
  store.apply({ type: "COMPONENT_INIT", chatId: "demo", nodeId: "n1", component: { type: "Tabs", props: { count: 1 } } });
  let serverCalls = 0;
  dispatchAction(
    { type: "setValue", values: [{ key: "activeTab", value: "faq" }] },
    {},
    { store, chatId: "demo", nodeId: "n1", sendToServer: () => serverCalls++ },
  );
  assert.equal(serverCalls, 0, "setValue must not route to the server");
  assert.deepEqual(store.get("demo", "n1"), { count: 1, activeTab: "faq" }, "merge-not-replace into the slice");
});

test("setValue resolves a {{binding}} from the action scope", () => {
  const store = new ComponentStore();
  dispatchAction(
    { type: "setValue", values: [{ key: "selectedId", value: "{{id}}" }] },
    { id: "row-7" },
    { store, chatId: "demo", nodeId: "n1" },
  );
  assert.equal(store.get("demo", "n1").selectedId, "row-7");
});

test("input event writes the bound field locally (two-way binding) — no server route", () => {
  const store = new ComponentStore();
  let serverCalls = 0;
  // InputView emits { text, field } on every keystroke for a controlled Input.
  dispatchAction("input", { text: "luke@x.org", field: "email" }, { store, chatId: "demo", nodeId: "n1", sendToServer: () => serverCalls++ });
  assert.equal(serverCalls, 0, "typing must not round-trip to the server");
  assert.equal(store.get("demo", "n1").email, "luke@x.org");
});

test("input with no field is a no-op locally (composer draft case is the channel's job)", () => {
  const store = new ComponentStore();
  let serverCalls = 0;
  dispatchAction("input", { text: "hi" }, { store, chatId: "demo", nodeId: "n1", sendToServer: () => serverCalls++ });
  assert.equal(serverCalls, 0);
  assert.deepEqual(store.get("demo", "n1"), {}, "no field → nothing written");
});

test("non-setValue routes to the server, narrowed by send", () => {
  const store = new ComponentStore();
  const calls = [];
  dispatchAction(
    { type: "submit", send: ["amount"] },
    { amount: 50, recipient: "acct", secret: "x" },
    { store, chatId: "demo", nodeId: "n1", sendToServer: (t, d) => calls.push([t, d]) },
  );
  assert.deepEqual(calls, [["submit", { amount: 50 }]]);
});

test("bare string action is a server route with full scope", () => {
  const calls = [];
  dispatchAction("click", { foo: 1 }, { store: new ComponentStore(), chatId: "c", nodeId: "n", sendToServer: (t, d) => calls.push([t, d]) });
  assert.deepEqual(calls, [["click", { foo: 1 }]]);
});

test("then chains: optimistic local setValue, then a server submit", () => {
  const store = new ComponentStore();
  const calls = [];
  dispatchAction(
    { type: "setValue", values: [{ key: "status", value: "pending" }], then: { type: "submit", send: ["amount"] } },
    { amount: 99 },
    { store, chatId: "demo", nodeId: "n1", sendToServer: (t, d) => calls.push([t, d]) },
  );
  assert.equal(store.get("demo", "n1").status, "pending", "local flip happened first");
  assert.deepEqual(calls, [["submit", { amount: 99 }]], "then routed to the server");
});
