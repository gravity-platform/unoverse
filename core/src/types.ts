/**
 * @unoverse/core — shared neutral types.
 *
 * The neutral definition shape, the interaction vocabulary, and the resolved-theme
 * SHAPE (values live on the server). Pure types — no runtime, no imports.
 */

// ---- The neutral definition shape (mirrors apps/unoverse/definitions/*.json) ----

export interface UnoverseNode {
  type: string; // Box | Stack | Row | Column | Text | Image | Button | ComponentSlot | Skeleton | ...
  style?: Record<string, unknown>;
  bind?: Record<string, string>; // target prop -> data field
  visibleWhen?: VisibleWhen; // render only when the condition holds (truthy field, or {field,eq/ne})
  action?: string | ActionSpec; // dispatched on interaction (bare string → server, or a setValue envelope)
  placeholder?: string; // Input: empty-field copy (content, not style)
  children?: UnoverseNode[];
  // --- template primitives (UNOVERSE_SPEC.md §2e) ---
  /** ComponentSlot: which components to pull from the store timeline. */
  select?: { type?: string[]; from?: "latest" | "all"; limit?: number };
  /** ComponentSlot: rendered when the slot resolves to zero components. */
  fallback?: UnoverseNode;
  /** Skeleton: placeholder variant. */
  variant?: "text" | "card" | "image";
  /** Timeline: data sub-tree rendered for a user turn (binds `text`). ALL bubble UX lives here, not the SDK. */
  user?: UnoverseNode;
  /** Timeline: data sub-tree rendered for an assistant turn (its ComponentSlot is scoped to that turn). */
  assistant?: UnoverseNode;
  /** Each: the per-item subtree, rendered once per element of the bound array (`bind.items`),
   *  with that element as its data scope. The node's own `style` is the list container. */
  template?: UnoverseNode;
  /** Timeline: static author data merged into every assistant turn's data scope
   *  (e.g. avatarUrl, thinkingText). The SDK forwards it verbatim — it interprets
   *  nothing chat-specific; the turn STATE flags (streaming/thinking) are added on top. */
  assistantData?: Record<string, unknown>;
  /** Timeline: static author data merged into every user turn's data scope. */
  userData?: Record<string, unknown>;
  /** Icon: the served glyph NAME (literal) — or bind a data field via `bind.name`. */
  icon?: string;
  /** Disable the element (Input/Button) when this data field is truthy; the node's
   *  `style.disabled` is merged while disabled. */
  disabledWhen?: string;
}

export interface UnoverseDefinition {
  unoverse: string;
  kind: "component" | "template";
  name: string;
  description?: string;
  props?: Record<string, unknown>;
  root: UnoverseNode;
}

// ---- The interaction vocabulary (UNOVERSE_SPEC.md §2e-3) ----
//
// A small, declarative layer — NOT a programming language. Stac-inspired
// (set_value + Multi Action + visible-if): an `action` is a bare string (→ the
// workflow) or a `setValue` envelope (a LOCAL store write, the ported `updateData`);
// `visibleWhen` is a truthy field name or an equality test.

/** One `setValue` patch. `value` is a literal OR a `{{field}}` / `{{a.b}}` binding
 *  resolved against the action's data scope (e.g. the tapped item inside an `Each`). */
export interface ActionValue {
  key: string;
  value: unknown;
}

/** A declarative action. `setValue` merges `values` into THIS component's
 *  `chatId:nodeId` slice (no round-trip); any other `type` routes to the workflow
 *  (optionally narrowed by `send`). `then` chains a follow-up (Stac Multi Action). */
export interface ActionSpec {
  // The SDK hardcodes no UI concept — only generic writes + a server route:
  type: string; // "setValue" (component slice) | "setTemplateValue" (template state) | "input" | "submit"/custom (→ server)
  values?: ActionValue[]; // setValue / setTemplateValue patches (the dev's chosen keys)
  send?: string[]; // server route: which scope fields to include (default: all)
  then?: ActionSpec | string; // optional chained follow-up
}

/** `visibleWhen`: a data field name (truthy) OR an equality/inequality test. */
export type VisibleWhen = string | { field: string; eq?: unknown; ne?: unknown };

// ---- The resolved theme (SHAPE only — values live on the server) ----
//
// The MCP server OWNS THE VISUAL: it resolves the design tokens (apps/unoverse/
// rx/styles) live and serves this shape at `unoverse://theme/{name}`. This is the
// token SHAPE, never the token VALUES — the SDK fetches the values (readTheme),
// it does NOT bundle them. A brand change in rx/styles is therefore refresh-only,
// exactly like a definition change (UNOVERSE_SPEC §2d-1).
export interface ResolvedTheme {
  color: Record<string, string>;
  /** Dimension scale (theme.space ← rx/styles/base/spacing.json) — used for BOTH spacing
   *  (gap/padding/margin) AND element sizes (width/height), Tailwind-style. */
  space: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
  borderWidth: Record<string, string>;
  /** Line-height tokens (theme.lineHeight ← font.lineHeight) — tight/snug/normal/relaxed. */
  lineHeight: Record<string, string | number>;
  text: Record<string, Record<string, string | number>>;
  skeleton: Record<string, unknown>;
  prose: Record<string, unknown>;
  /** Named keyframes (theme.keyframes ← rx/styles/semantic/keyframes.json), injected
   *  once per render root. Lets any definition animate via `style.animation` — no SDK edit. */
  keyframes: Record<string, Record<string, Record<string, string>>>;
  /** Named icon glyphs as SERVED DATA. The SERVER sources these from an icon pack
   *  (control plane) → `{ viewBox, attrs, children }` where children are raw SVG
   *  elements `[tag, attrs]`. The generic `Icon` leaf renders them, sized/coloured by
   *  node.style. The SDK never bundles the pack — icons are served like any token. */
  icons: Record<string, { viewBox?: string; attrs?: Record<string, unknown>; children?: [string, Record<string, unknown>][] }>;
  /** Base render-root settings (theme.root ← rx/styles/semantic/root.json) — a CSS
   *  object the SDK spreads onto its outermost wrapper (e.g. font-smoothing). Served,
   *  not authored: a whole-tree rendering normalization, like legacy styles/base.css. */
  root: Record<string, unknown>;
}
