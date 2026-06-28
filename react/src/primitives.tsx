/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EVERY PRIMITIVE LIVES HERE — render.tsx is the dispatcher and renders NONE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  This file is the CLOSED set of leaf primitives — the web realization of the
 *  irreducible neutral elements: Box, Text, Image, Button, Icon, Skeleton, Input,
 *  Markdown (+ the Unknown fallback). If you are writing a `<div>`, `<button>`,
 *  `<span>`, `<img>`, `<input>`, `<svg>` … it goes HERE, never in render.tsx.
 *  render.tsx ONLY dispatches `node.type` → one of these components. (A build
 *  guard, test/dispatcher-only.test.mjs, fails if a raw element appears in
 *  render.tsx — so this separation can't silently rot again.)
 *
 *  ⛔ A primitive renders ONE generic element and NOTHING about a specific UX.
 *     No icons-in-the-input, no send buttons, no pills, no cards, no loaders.
 *     Those are LAYOUTS — compose them in a DEFINITION from generic primitives.
 *     Every style VALUE is served (theme.*); this file authors none. The bar to
 *     ADD a primitive is high — it must be an irreducible element at the tier of
 *     Text/Image (see FRAMEWORK.md), never a composite.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createElement, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Markdown from "markdown-to-jsx";
import type { ResolvedTheme, UnoverseNode } from "@gravity-platform/unoverse-core";
import { styleToCss, cssDecls } from "./style";
import type { ActionHandler } from "./render";

/** Read a bound data field as a string (for Text/Image/Button content). */
function bound(field: string | undefined, data: Record<string, unknown>): string | undefined {
  return field ? (data[field] as string | undefined) : undefined;
}

/** Stable class name from a string (identical state specs share one injected rule). */
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Interaction states are CSS pseudo-classes — inline styles can't express them, so we
// resolve each state's tokens → a scoped rule and inject it (deduped by class hash).
// Generic vocab (any element), values served; the SDK authors none. Add a state here.
const INTERACTION_STATES: [string, string][] = [
  ["hover", ":hover"],
  ["active", ":active"],
];

/**
 * Resolve the generic per-element "chrome" shared by interactive primitives:
 * the base inline style, hover/active rules (injected as <style>), and the
 * data-driven `disabled` state (known at render via `disabledWhen` → merges the
 * `disabled` style + sets the attr). All values are served; this authors none.
 */
function nodeChrome(node: UnoverseNode, data: Record<string, unknown>, theme: ResolvedTheme) {
  const base = styleToCss(node.style, theme, data);
  const disabled = node.disabledWhen ? !!data[node.disabledWhen] : false;
  const style = disabled && node.style?.disabled ? { ...base, ...styleToCss(node.style.disabled as Record<string, unknown>, theme) } : base;
  const classes: string[] = [];
  const styleEls: ReactNode[] = [];
  const s = node.style as Record<string, unknown> | undefined;
  for (const [key, pseudo] of INTERACTION_STATES) {
    const spec = s?.[key];
    if (!spec) continue;
    // !important — the base style is inline, which beats a class selector otherwise.
    const decls = cssDecls(styleToCss(spec as Record<string, unknown>, theme), true);
    const cls = `uno-${key}-${hashStr(decls)}`;
    classes.push(cls);
    styleEls.push(<style key={key}>{`.${cls}${pseudo}{${decls}}`}</style>);
  }
  // `hideBelow` — responsive visibility via a CONTAINER query (inline styles can't express
  // one): hides the element when its nearest container ancestor (an element with the
  // `container` style) is narrower than a SERVED width token — e.g. drop a side image when
  // the COMPONENT (not the viewport) is mobile-width. Correct for SDUI: a component reacts to
  // its slot, not the page. Generic vocab, value served; the SDK authors none.
  if (s?.hideBelow) {
    const w = theme.space[s.hideBelow as string] ?? (s.hideBelow as string);
    const cls = `uno-hidebelow-${hashStr(String(w))}`;
    classes.push(cls);
    styleEls.push(<style key="hideBelow">{`@container (max-width:${w}){.${cls}{display:none !important}}`}</style>);
  }
  return { className: classes.join(" ") || undefined, styleEls, style, disabled };
}

/** `Box`/`Stack`/`Row`/`Column` — the generic container (`<div>`). Children are
 *  pre-rendered by the dispatcher; layout/look come entirely from node.style. */
export function BoxView({ node, data, theme, children }: { node: UnoverseNode; data: Record<string, unknown>; theme: ResolvedTheme; children?: ReactNode }): ReactNode {
  const { className, styleEls, style } = nodeChrome(node, data, theme);
  return (
    <div className={className} style={style}>
      {styleEls}
      {children}
    </div>
  );
}

/** `Text` — a bound string (`<span>`). */
export function TextView({ node, data, theme }: { node: UnoverseNode; data: Record<string, unknown>; theme: ResolvedTheme }): ReactNode {
  return <span style={styleToCss(node.style, theme)}>{bound(node.bind?.value, data)}</span>;
}

/** `Image` — a bound src (`<img>`). */
export function ImageView({ node, data, theme }: { node: UnoverseNode; data: Record<string, unknown>; theme: ResolvedTheme }): ReactNode {
  return <img style={styleToCss(node.style, theme)} src={bound(node.bind?.src, data)} alt={bound(node.bind?.alt, data) ?? ""} />;
}

/** `Button` — fires `onAction(node.action, data)`. Content is a bound label OR composed
 *  children (so an Icon can sit in a button). The SDK authors no button styling. */
export function ButtonView({ node, data, theme, onAction, children }: { node: UnoverseNode; data: Record<string, unknown>; theme: ResolvedTheme; onAction?: ActionHandler; children?: ReactNode }): ReactNode {
  const { className, styleEls, style, disabled } = nodeChrome(node, data, theme);
  return (
    <button className={className} style={style} disabled={disabled} onClick={() => onAction?.(node.action ?? "click", data)}>
      {styleEls}
      {node.children?.length ? children : bound(node.bind?.label, data)}
    </button>
  );
}

/** Unknown node type — render children so the tree doesn't break (degenerate fallback). */
export function UnknownView({ node, theme, children }: { node: UnoverseNode; theme: ResolvedTheme; children?: ReactNode }): ReactNode {
  return (
    <div style={styleToCss(node.style, theme)} data-unoverse-unknown={node.type}>
      {children}
    </div>
  );
}

/**
 * `Icon` — leaf primitive (the irreducible SVG, like Text→<span>/Image→<img>).
 * Renders a named glyph whose element DATA is SERVED (theme.icons): the server sources
 * it from an icon pack (control plane) and serves `{ viewBox, attrs, children }`, where
 * children are raw SVG elements `[tag, attrs]`. The SDK NEVER bundles a pack — it's
 * pack-agnostic, just rendering served elements. Size = node.style width/height, colour
 * = node.style color (→ `currentColor`). Name is literal (`node.icon`) or bound
 * (`bind.name`). NOT a composite — one glyph, no buttons/chrome.
 */
export function IconView({ name, style, theme }: { name?: string; style?: Record<string, unknown>; theme: ResolvedTheme }): ReactNode {
  const set = (theme.icons ?? {}) as Record<string, { viewBox?: string; attrs?: Record<string, unknown>; children?: [string, Record<string, unknown>][] }>;
  const ic = name ? set[name] : undefined;
  if (!ic) return null;
  const children = Array.isArray(ic.children) ? ic.children : [];
  return (
    <svg viewBox={ic.viewBox ?? "0 0 24 24"} {...(ic.attrs ?? {})} aria-hidden="true" style={styleToCss(style ?? {}, theme)}>
      {children.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

/**
 * `Skeleton` — built-in loading placeholder. ALL dimensions are DATA, fetched
 * from the theme (theme.skeleton ← rx/styles/semantic/skeleton.json). The SDK
 * authors nothing here but structure (flex/full). `bars` are 'width height' pairs.
 */
export function SkeletonView({ variant = "text", theme }: { variant?: string; theme: ResolvedTheme }): ReactNode {
  const sk = theme.skeleton as Record<string, any>;
  const bar = (spec: string, i: number): ReactNode => {
    const [w, h] = spec.split(" ");
    return <div key={i} style={{ width: w, height: h, background: sk.fill, borderRadius: sk.barRadius }} />;
  };
  if (variant === "image")
    return <div style={{ width: "100%", height: "100%", minHeight: sk.image.minHeight, background: sk.fill, borderRadius: sk.radius }} />;
  if (variant === "card")
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: sk.gap, padding: sk.card.padding, border: `${theme.borderWidth.thin} solid ${sk.fill}`, borderRadius: sk.radius }}>
        {(sk.card.bars as string[]).map(bar)}
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sk.gap }}>
      {(sk.text.bars as string[]).map(bar)}
    </div>
  );
}

/**
 * `Input` — single-line composer (the irreducible `<input>`, like Text→<span>).
 * Holds its own draft text (local, not store state); on Enter it fires
 * `onAction(node.action, { text })` and clears. The SDK authors NO styling here —
 * look comes entirely from `node.style` (data), exactly like Button. `placeholder`
 * is copy (content), not a style value.
 *
 * ⛔ DO NOT add icons, send buttons, pills, or any composer chrome here. That is
 *    UX — compose it in a DEFINITION from generic primitives (Box + Icon + Input).
 *    A primitive renders ONE generic element; it never encodes a specific layout.
 */
export function InputView({ node, data, theme, onAction }: { node: UnoverseNode; data: Record<string, unknown>; theme: ResolvedTheme; onAction?: ActionHandler }): ReactNode {
  // CONTROLLED when `bind.value` is set: value comes from shared data and changes are
  // emitted as an "input" action (the channel writes it to the store). This is what lets
  // a sibling send button submit the draft. Otherwise the field keeps its own local text.
  const field = node.bind?.value;
  const [local, setLocal] = useState("");
  const value = field != null ? String(data[field] ?? "") : local;
  // CONTROLLED: report the change as an "input" event carrying WHICH field changed.
  // The component dispatcher writes that field into this instance's slice (local two-way
  // binding, §2e-3); the template composer's channel reads `text` and ignores `field`
  // (its bound field is the shared `draft`). The SDK authors no UX — just the fact.
  const setValue = (t: string) => (field != null ? onAction?.("input", { text: t, field }) : setLocal(t));
  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onAction?.(node.action ?? "submit", { text: t });
    if (field == null) setLocal("");
  };
  const { style, disabled } = nodeChrome(node, data, theme);
  return (
    <input
      style={style}
      disabled={disabled}
      value={value}
      placeholder={node.placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
      }}
    />
  );
}

/**
 * markdown-to-jsx overrides for the `Markdown` primitive.
 *
 * ⛔ AUTHORS ZERO STYLE VALUES. Every element style is read verbatim from the
 *    SERVED prose recipe (`theme.prose` ← rx/styles/semantic/prose.json). The SDK
 *    only maps element → recipe key and supplies BEHAVIOUR (target=_blank, image
 *    error-fallback). No hex, no px/rem, no weights here — they live in rx/.
 *
 * Built once per theme (stable component identities so streaming re-renders don't
 * remount images and drop their broken-state).
 */
function buildMarkdownOverrides(theme: ResolvedTheme) {
  const p = theme.prose as Record<string, CSSProperties | Record<string, string> | string>;
  const s = (k: string) => (p[k] as CSSProperties | undefined) ?? {};
  // Heading element → served text-style NAME (the map lives in the recipe, not here).
  const headings = (p.heading as Record<string, string>) ?? {};
  const head = (tag: string) => (theme.text[headings[tag]] as CSSProperties | undefined) ?? {};

  // Served external-link glyph (theme.icons.externalLink), styled by served prose.linkIcon.
  // The icon inherits the link's colour via `currentColor`. The SDK authors no geometry.
  const li = (theme.icons?.externalLink ?? {}) as { viewBox?: string; attrs?: Record<string, unknown>; children?: [string, Record<string, unknown>][] };
  const linkArrow = li.children?.length ? (
    <svg viewBox={li.viewBox ?? "0 0 24 24"} {...(li.attrs ?? {})} aria-hidden="true" style={s("linkIcon")}>
      {li.children.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  ) : null;
  const ExternalLink = ({ children, ...a }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...a} target="_blank" rel="noopener noreferrer" style={s("link")}>
      {children}
      {linkArrow}
    </a>
  );
  // Wide tables scroll instead of crushing columns (legacy ScrollableTable).
  const ScrollableTable = (a: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div style={s("tableWrap")}>
      <table {...a} style={s("table")} />
    </div>
  );
  // Broken external image URLs degrade to alt text, not a broken-image icon.
  const MarkdownImage = ({ src, alt, title }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const [broken, setBroken] = useState(false);
    if (!src || broken) return <span style={s("imageFallback")}>{alt || "Image unavailable"}</span>;
    return (
      <img src={src as string} alt={alt || ""} title={title} loading="lazy" decoding="async" onError={() => setBroken(true)} style={s("image")} />
    );
  };

  return {
    p: { props: { style: s("paragraph") } },
    a: { component: ExternalLink },
    table: { component: ScrollableTable },
    img: { component: MarkdownImage },
    th: { props: { style: { ...s("cell"), ...s("headerCell") } } },
    td: { props: { style: s("cell") } },
    ul: { props: { style: { ...s("list"), listStyleType: p.bulletStyle as string } } },
    ol: { props: { style: { ...s("list"), listStyleType: p.orderedStyle as string } } },
    li: { props: { style: s("listItem") } },
    h1: { props: { style: head("h1") } },
    h2: { props: { style: head("h2") } },
    h3: { props: { style: head("h3") } },
    h4: { props: { style: head("h4") } },
    h5: { props: { style: head("h5") } },
    h6: { props: { style: head("h6") } },
  };
}

/**
 * `Markdown` leaf primitive (SPEC §2d:197). Renders a bound markdown string; the
 * web impl is markdown-to-jsx (a per-platform primitive impl, like Text→<span>).
 * Container takes node.style (tokens); elements map to served theme tokens via
 * buildMarkdownOverrides. The SDK authors ZERO style values.
 */
export function MarkdownView({ node, data, theme }: { node: UnoverseNode; data: Record<string, unknown>; theme: ResolvedTheme }): ReactNode {
  const value = (node.bind?.value ? (data[node.bind.value] as string) : "") ?? "";
  const overrides = useMemo(() => buildMarkdownOverrides(theme), [theme]);
  return (
    <div style={styleToCss(node.style, theme)}>
      <Markdown options={{ overrides, forceBlock: true }}>{value}</Markdown>
    </div>
  );
}
