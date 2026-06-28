/**
 * The style + animation INTERPRETER — neutral vocab → CSS, resolving token NAMES
 * against a theme FETCHED from the server. ⛔ OWNS ZERO STYLE VALUES (no hex, no
 * px/rem/em, no recipes); every value lives in rx/styles and is served. See
 * FRAMEWORK.md and render.tsx's header. Enforced by test/golden-rule.test.mjs.
 */
import type { CSSProperties } from "react";
import { resolveValue, type ResolvedTheme } from "@gravity-platform/unoverse-core";

const WEIGHTS: Record<string, number> = { normal: 400, medium: 500, semibold: 600, bold: 700 };

/**
 * Map the neutral style vocab → CSS, resolving token names against the theme. Unknown
 * values pass through. When `data` is given, a style value that is a `{{field}}` binding
 * is first resolved from the data scope (e.g. a bar's `height: "{{pct}}"` ← data.pct =
 * "72%") — the data-driven twin of token resolution. This is what lets bar/progress
 * charts be DATA (Box + Each), not a primitive: the producer supplies the proportion,
 * the SDK authors nothing. (Same `{{...}}` resolver the action vocab uses.)
 */
export function styleToCss(s: Record<string, unknown> = {}, theme: ResolvedTheme, data?: Record<string, unknown>): CSSProperties {
  if (data) {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) resolved[k] = typeof v === "string" && v.includes("{{") ? resolveValue(v, data) : v;
    s = resolved;
  }
  const css: CSSProperties = {};
  const space = (v: string) => theme.space[v] ?? v;
  // Resolve a dimension: a `space.*` scale step (e.g. "8" → 2rem) → its value; `full` → 100%;
  // else pass through. ONE scale for spacing AND element sizes (Tailwind-style w-5/p-5).
  const dim = (v: unknown) => theme.space[v as string] ?? (v === "full" ? "100%" : (v as CSSProperties["width"]));

  if (s.width != null) css.width = dim(s.width);
  if (s.height != null) css.height = dim(s.height);
  if (s.maxWidth != null) css.maxWidth = dim(s.maxWidth) as CSSProperties["maxWidth"];
  if (s.minWidth != null) css.minWidth = dim(s.minWidth) as CSSProperties["minWidth"];
  if (s.minHeight != null) css.minHeight = dim(s.minHeight) as CSSProperties["minHeight"];
  if (s.flex != null) css.flex = s.flex as CSSProperties["flex"];
  if (s.position) css.position = s.position as CSSProperties["position"];
  if (s.inset != null) css.inset = s.inset as CSSProperties["inset"];
  if (s.direction) {
    css.display = "flex";
    css.flexDirection = s.direction as CSSProperties["flexDirection"];
  }
  if (s.gap) css.gap = space(s.gap as string);
  if (s.padding) css.padding = Array.isArray(s.padding) ? (s.padding as string[]).map(space).join(" ") : space(s.padding as string);
  if (s.margin) css.margin = Array.isArray(s.margin) ? (s.margin as string[]).map(space).join(" ") : space(s.margin as string);
  if (s.display) css.display = s.display as CSSProperties["display"];
  // `container` — establish a container-query context (e.g. "inline-size") so descendants
  // can respond to THIS element's width via `hideBelow` (component-relative responsiveness,
  // correct for SDUI: the component reacts to its slot, not the page viewport). Value served.
  if (s.container) (css as Record<string, unknown>).containerType = s.container;
  // `columns` → an equal-width CSS grid (generic layout; the welcome card grid uses it).
  if (s.columns) {
    css.display = "grid";
    css.gridTemplateColumns = `repeat(${s.columns}, minmax(0, 1fr))`;
  }
  if (s.cursor) css.cursor = s.cursor as CSSProperties["cursor"];
  if (s.align) css.alignItems = s.align === "start" ? "flex-start" : (s.align as CSSProperties["alignItems"]);
  if (s.justify) css.justifyContent = s.justify as CSSProperties["justifyContent"];
  if (s.background) css.background = theme.color[s.background as string] ?? (s.background as string);
  // `radial` — a neutral dial/gauge fill: a `fill` token sweeps from 0 to `at` (a value
  // or {{field}} binding, e.g. "72%"), the rest is the `track` token. The WEB realization
  // is a conic-gradient; a native channel maps the same neutral intent to an arc. Authors
  // ZERO values — both colours are served tokens, the stop is data. Enables radial gauges
  // as DATA (a circular Box), not a primitive.
  if (s.radial) {
    const r = s.radial as { fill?: string; track?: string; at?: unknown };
    const col = (t?: string) => (t ? (theme.color[t] ?? t) : "transparent");
    const at = r.at != null ? String(resolveValue(r.at, data ?? {})) : "0%";
    css.background = `conic-gradient(${col(r.fill)} ${at}, ${col(r.track)} 0)`;
  }
  // A border value → `<width> solid <color>`. `"subtle"` = thin subtle; an optional
  // leading width token gives a thicker rule, e.g. `"thick action.primary"`.
  const borderVal = (raw: string) => {
    const parts = raw.split(" ");
    const [wTok, cTok] = parts.length > 1 ? parts : ["thin", parts[0]];
    const width = theme.borderWidth[wTok] ?? wTok;
    const color = theme.color[`border.${cTok}`] ?? theme.color[cTok] ?? cTok;
    return `${width} solid ${color}`;
  };
  if (s.border === "none") css.border = "none";
  else if (s.border) css.border = borderVal(s.border as string);
  // Per-side borders (a header rule, a hover edge-accent) — no fake divider Box needed.
  if (s.borderTop) css.borderTop = borderVal(s.borderTop as string);
  if (s.borderRight) css.borderRight = borderVal(s.borderRight as string);
  if (s.borderBottom) css.borderBottom = borderVal(s.borderBottom as string);
  if (s.borderLeft) css.borderLeft = borderVal(s.borderLeft as string);
  // `outline` — pass-through (e.g. "none" to drop the input focus ring inside a pill).
  if (s.outline != null) css.outline = s.outline as CSSProperties["outline"];
  if (s.shadow) css.boxShadow = theme.shadow[s.shadow as string] ?? (s.shadow as string);
  const rad = (v: string) => theme.radius[v] ?? v;
  if (s.radius) css.borderRadius = rad(s.radius as string);
  // Per-corner radius (a chat bubble squares the corner toward its sender).
  if (s.radiusTopLeft) css.borderTopLeftRadius = rad(s.radiusTopLeft as string);
  if (s.radiusTopRight) css.borderTopRightRadius = rad(s.radiusTopRight as string);
  if (s.radiusBottomLeft) css.borderBottomLeftRadius = rad(s.radiusBottomLeft as string);
  if (s.radiusBottomRight) css.borderBottomRightRadius = rad(s.radiusBottomRight as string);
  if (s.overflow) css.overflow = s.overflow as CSSProperties["overflow"];
  if (s.fit) css.objectFit = s.fit as CSSProperties["objectFit"];
  if (s.font && theme.text[s.font as string]) Object.assign(css, theme.text[s.font as string]);
  if (s.weight) css.fontWeight = WEIGHTS[s.weight as string] ?? (s.weight as CSSProperties["fontWeight"]);
  // `lineHeight` — override the text style's line-height (e.g. tighten a single-line
  // card title). Applied AFTER `font` so it wins. Resolves a lineHeight token (tight/…).
  if (s.lineHeight != null) css.lineHeight = (theme.lineHeight[s.lineHeight as string] ?? s.lineHeight) as CSSProperties["lineHeight"];
  if (s.color) css.color = theme.color[s.color as string] ?? (s.color as string);
  // `transition` — smooth state changes (e.g. hover). The value is authored in the
  // definition (e.g. "all 150ms ease"); the SDK passes it through, authoring nothing.
  if (s.transition) css.transition = s.transition as CSSProperties["transition"];
  // Animation — GENERIC vocab. `animation` names a served keyframe (theme.keyframes,
  // injected once via keyframesCss); timing comes from the definition. The SDK authors
  // no motion values, and there is NO per-animation primitive — any animated UX is data.
  if (s.animation) {
    const a = s.animation as { name: string; duration?: string; easing?: string; iteration?: string };
    css.animation = `uno-${a.name} ${a.duration ?? ""} ${a.easing ?? ""} ${a.iteration ?? "infinite"}`.replace(/\s+/g, " ").trim();
  }
  if (s.animationDelay != null) css.animationDelay = s.animationDelay as string;
  return css;
}

/**
 * Serialize a resolved CSSProperties object → a CSS declaration string ("a-b:v;…").
 * `important` is needed for injected state rules (hover/active): the base style is
 * applied INLINE, and an inline style beats any class selector — so a `:hover` rule
 * can only override it with `!important`.
 */
export function cssDecls(css: CSSProperties, important = false): string {
  const flag = important ? " !important" : "";
  return Object.entries(css)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}:${v}${flag}`)
    .join(";");
}

/**
 * Serialize the SERVED keyframes (theme.keyframes ← rx/styles/semantic/keyframes.json)
 * into a CSS string, injected ONCE per render root (<style>). This authors zero values —
 * it only structures DATA into `@keyframes uno-<name>{ <stop>{ <prop>:<val> } }`. Adding a
 * new animation = adding a keyframe to rx/ + a `style.animation` ref in a definition. No
 * SDK edit, no new primitive. Keyframe decls use real CSS prop names (transform, opacity…).
 */
export function keyframesCss(theme: ResolvedTheme): string {
  const kf = (theme.keyframes ?? {}) as Record<string, Record<string, Record<string, string>>>;
  return Object.entries(kf)
    .map(
      ([name, stops]) =>
        `@keyframes uno-${name}{${Object.entries(stops)
          .map(([stop, decls]) => `${stop}{${Object.entries(decls).map(([p, v]) => `${p}:${v}`).join(";")}}`)
          .join("")}}`,
    )
    .join("");
}
