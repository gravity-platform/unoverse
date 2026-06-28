/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE DISPATCHER: UnoverseNode → React.   ⛔ READ BEFORE EDITING ⛔
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  THIS FILE RENDERS NOTHING. It only WALKS the tree and DISPATCHES `node.type`
 *  to a primitive component in ./primitives. There is NOT A SINGLE raw element
 *  here — no `<div>`, `<span>`, `<button>`, `<img>`, `<input>`, `<svg>`. If you
 *  are about to write one, STOP: it belongs in ./primitives. This is enforced by
 *  test/dispatcher-only.test.mjs (the build fails if a raw element appears here),
 *  so the engine/primitive split can't silently rot — which is exactly how
 *  `Button` (and its styling logic) kept leaking back into the dispatcher.
 *
 *  THE FRAMEWORK IN ONE SENTENCE: this SDK is a FIXED, GENERIC interpreter. ALL
 *  UX is built in DATA (rx/ definitions + the served theme) — an author creates
 *  ANY interface WITHOUT editing this SDK. (See FRAMEWORK.md.)
 *
 *  WHERE THINGS LIVE:
 *    • ./render     — this dispatcher (control flow: visibleWhen, Each, slots) ONLY.
 *    • ./primitives — EVERY primitive (Box/Text/Image/Button/Icon/Skeleton/Input/
 *                     Markdown/Unknown) + the shared per-element chrome.
 *    • ./style      — the style + animation interpreter (styleToCss/keyframesCss).
 *
 *  Two laws (govern all three files + the whole package):
 *    LAW 1 — OWN ZERO STYLE VALUES. No hex/px/rem/em/recipes; resolve token NAMES
 *            against the SERVED theme. Enforced by test/golden-rule.test.mjs.
 *    LAW 2 — OWN ZERO UX SHAPE. A primitive renders ONE generic element, nothing
 *            about a specific UX. A composer/card/loader is a LAYOUT — compose it
 *            in a DEFINITION. Never a per-UX primitive or per-UX config.
 *
 *  Need something the vocab can't express? Prefer extending the generic interpreter
 *  ONCE (a new style-vocab key in ./style, a new model projection) over a primitive.
 *  You almost never need to touch this file — build it in rx/ first.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { ReactNode } from "react";
import type { ActionSpec, ResolvedTheme, UnoverseNode } from "@gravity-platform/unoverse-core";
import { BoxView, TextView, ImageView, ButtonView, UnknownView, SkeletonView, InputView, MarkdownView, IconView } from "./primitives";

// The style + animation interpreter lives in ./style; re-exported so consumers keep
// importing it from "./render".
export { styleToCss, keyframesCss } from "./style";

// An action is a bare string (→ workflow) or a declarative envelope (§2e-3). The
// binding layer (streamed.tsx) interprets it; primitives just forward node.action.
export type ActionHandler = (action: string | ActionSpec, data: Record<string, unknown>) => void;

/**
 * Resolves a `ComponentSlot` node against the store (provided by the template
 * renderer). Returns the rendered leaves (or the slot's fallback). Components
 * don't use slots, so this is undefined on the component render path.
 */
export type SlotResolver = (node: UnoverseNode, key?: React.Key) => ReactNode;

export function renderNode(
  node: UnoverseNode,
  data: Record<string, unknown>,
  onAction: ActionHandler | undefined,
  theme: ResolvedTheme,
  key?: React.Key,
  slot?: SlotResolver,
): ReactNode {
  // visibleWhen — conditional visibility (§2e-3). A bare field name is a truthiness
  // test; an object is an equality/inequality test (Stac visible-if) so one field can
  // drive tabs/wizard steps without a boolean per state.
  if (node.visibleWhen != null) {
    const vw = node.visibleWhen;
    if (typeof vw === "string") {
      const v = data[vw];
      if (v == null || v === "" || v === false) return null;
    } else {
      const v = data[vw.field];
      if ("eq" in vw) {
        if (v !== vw.eq) return null;
      } else if ("ne" in vw) {
        if (v === vw.ne) return null;
      } else if (v == null || v === "" || v === false) return null;
    }
  }

  // Store-backed / leaf primitives → dispatch to ./primitives.
  if (node.type === "Skeleton") return <SkeletonView key={key} variant={node.variant} theme={theme} />;
  if (node.type === "Icon") return <IconView key={key} name={node.bind?.name ? (data[node.bind.name] as string) : node.icon} style={node.style} theme={theme} />;
  if (node.type === "Input") return <InputView key={key} node={node} data={data} theme={theme} onAction={onAction} />;
  if (node.type === "Markdown") return <MarkdownView key={key} node={node} data={data} theme={theme} />;
  if (node.type === "ComponentSlot" || node.type === "Timeline") return slot ? slot(node, key) : null;

  // `Each` — control flow: map a bound array (bind.items) → the `template` subtree once
  // per item (that item as the data scope), inside the node's own container (a Box).
  // A PRIMITIVE item (string/number — e.g. a `string[]` of follow-up questions) is exposed
  // as `{ value: item }`, so the template binds `value` like any field; object items pass
  // through unchanged. This is what lets an `Each` iterate a plain list of strings.
  if (node.type === "Each") {
    const src = node.bind?.items ? data[node.bind.items] : undefined;
    const items = Array.isArray(src) ? src : [];
    const tpl = node.template;
    const scopeOf = (item: unknown): Record<string, unknown> =>
      item != null && typeof item === "object" ? (item as Record<string, unknown>) : { value: item };
    const rendered = tpl ? items.map((item, i) => renderNode(tpl, scopeOf(item), onAction, theme, i, slot)) : null;
    return (
      <BoxView key={key} node={node} data={data} theme={theme}>
        {rendered}
      </BoxView>
    );
  }

  // Element primitives → dispatch. Children are rendered here (control flow) and handed down.
  const kids = (node.children ?? []).map((c, i) => renderNode(c, data, onAction, theme, i, slot));
  switch (node.type) {
    case "Box":
    case "Stack":
    case "Row":
    case "Column":
      return (
        <BoxView key={key} node={node} data={data} theme={theme}>
          {kids}
        </BoxView>
      );
    case "Text":
      return <TextView key={key} node={node} data={data} theme={theme} />;
    case "Image":
      return <ImageView key={key} node={node} data={data} theme={theme} />;
    case "Button":
      return (
        <ButtonView key={key} node={node} data={data} theme={theme} onAction={onAction}>
          {kids}
        </ButtonView>
      );
    default:
      return (
        <UnknownView key={key} node={node} theme={theme}>
          {kids}
        </UnknownView>
      );
  }
}
