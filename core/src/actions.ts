/**
 * The action interpreter (UNOVERSE_SPEC.md §2e-3) — pure state logic, no React,
 * no DOM. Turns a node's `action` (a bare string or a `setValue` envelope) into
 * a store write and/or a server route. This is the ported `updateData`: a LOCAL
 * write into a component's own `chatId:nodeId` slice via the store's existing
 * merge — the generalisation of the composer's `setDraft`.
 *
 * Shape taken from Stac (set_value + Multi Action): `values:[{key,value}]` with
 * `{{binding}}` resolution, an optional chained `then`, and a hard split between
 * LOCAL `setValue` and a server route for anything computed/transactional.
 */
import type { ComponentStore } from "./store";
import type { ActionSpec } from "./types";

export interface ActionContext {
  store: ComponentStore;
  chatId: string;
  nodeId: string;
  /** Route a non-`setValue` action to the workflow (channel-provided, e.g. USER_ACTION). */
  sendToServer?: (type: string, data: Record<string, unknown>) => void;
}

/** Resolve a value: a `"{{path}}"` template reads from `scope` (dot-path); anything
 *  else is a literal. Mirrors Stac's `{{response}}` / `order.status` references. */
export function resolveValue(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value !== "string") return value;
  const m = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
  if (!m) return value;
  return m[1]
    .split(".")
    .reduce<unknown>((acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]), scope);
}

/**
 * Interpret an action (bare string or envelope) against the data scope at the
 * interaction site. `setValue` → local store merge into this `chatId:nodeId`;
 * any other type → the workflow (narrowed by `send`). `then` chains.
 */
export function dispatchAction(
  action: string | ActionSpec | undefined,
  scope: Record<string, unknown>,
  ctx: ActionContext,
): void {
  if (action == null) return;
  const spec: ActionSpec = typeof action === "string" ? { type: action } : action;

  if (spec.type === "setValue") {
    // Write the dev's chosen keys into THIS COMPONENT's OWN slice (chatId:nodeId) — its own
    // view state: tab / edit / wizard-step / displayState / anything. Read back via
    // `visibleWhen`. Same merge inbound COMPONENT_DATA uses; no server round-trip.
    const patch: Record<string, unknown> = {};
    for (const { key, value } of spec.values ?? []) patch[key] = resolveValue(value, scope);
    ctx.store.apply({ type: "COMPONENT_DATA", chatId: ctx.chatId, nodeId: ctx.nodeId, data: patch });
  } else if (spec.type === "setTemplateValue") {
    // Write the dev's chosen keys into TEMPLATE state — the template-state twin of setValue.
    // No component scope. The dev builds disclosure / focus / etc. from a key THEY name
    // (openPanel, focusMode, …) and reads it via `visibleWhen`. The SDK hardcodes NO UI
    // concept — only "write a key to component state" and "write a key to template state".
    const patch: Record<string, unknown> = {};
    for (const { key, value } of spec.values ?? []) patch[key] = resolveValue(value, scope);
    ctx.store.mergeTemplateState(patch);
  } else if (spec.type === "input") {
    // A controlled Input changed — write its bound field into THIS slice (local two-way
    // binding). The typing-buffer twin of the composer's `setDraft`: every keystroke is
    // local, never a server round-trip. `scope.field` names the bound field, `scope.text`
    // the new value (InputView). No field (the composer's draft case) → nothing here; the
    // template channel handles that. This is the only special-cased event name.
    const field = typeof scope.field === "string" ? scope.field : undefined;
    if (field) ctx.store.apply({ type: "COMPONENT_DATA", chatId: ctx.chatId, nodeId: ctx.nodeId, data: { [field]: scope.text } });
  } else {
    // SERVER — narrow the payload by `send` if given, else forward the whole scope.
    const payload = spec.send ? Object.fromEntries(spec.send.map((k) => [k, scope[k]])) : scope;
    ctx.sendToServer?.(spec.type, payload);
  }

  if (spec.then) dispatchAction(spec.then, scope, ctx);
}
