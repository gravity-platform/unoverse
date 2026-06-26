/**
 * The generic tree renderer: UnoverseNode → React. No per-component code.
 */
import type { CSSProperties, ReactNode } from "react";
import type { UnoverseNode } from "@gravity-platform/unoverse-core";
import { spacing, colors, fonts, shadows, radii, borders, buttonStyle } from "./tokens";

export type ActionHandler = (action: string, data: Record<string, unknown>) => void;

/** Map the neutral style vocab → CSS. Unknown keys pass through as-is. */
function styleToCss(s: Record<string, unknown> = {}): CSSProperties {
  const css: CSSProperties = {};
  const dim = (v: unknown) => (v === "full" ? "100%" : (v as CSSProperties["width"]));

  if (s.width != null) css.width = dim(s.width);
  if (s.height != null) css.height = dim(s.height);
  if (s.direction) {
    css.display = "flex";
    css.flexDirection = s.direction as CSSProperties["flexDirection"];
  }
  if (s.gap) css.gap = spacing[s.gap as string] ?? (s.gap as string);
  if (s.padding) css.padding = spacing[s.padding as string] ?? (s.padding as string);
  if (s.align) css.alignItems = s.align === "start" ? "flex-start" : (s.align as CSSProperties["alignItems"]);
  if (s.justify) css.justifyContent = s.justify as CSSProperties["justifyContent"];
  if (s.background) css.background = colors[s.background as string] ?? (s.background as string);
  if (s.border) css.border = borders[s.border as string] ?? (s.border as string);
  if (s.shadow) css.boxShadow = shadows[s.shadow as string] ?? (s.shadow as string);
  if (s.radius) css.borderRadius = radii[s.radius as string] ?? (s.radius as string);
  if (s.overflow) css.overflow = s.overflow as CSSProperties["overflow"];
  if (s.fit) css.objectFit = s.fit as CSSProperties["objectFit"];
  if (s.font && fonts[s.font as string]) Object.assign(css, fonts[s.font as string]);
  if (s.weight === "semibold") css.fontWeight = 600;
  if (s.color) css.color = colors[s.color as string] ?? (s.color as string);
  return css;
}

function bound(field: string | undefined, data: Record<string, unknown>): string | undefined {
  return field ? (data[field] as string | undefined) : undefined;
}

export function renderNode(
  node: UnoverseNode,
  data: Record<string, unknown>,
  onAction?: ActionHandler,
  key?: React.Key,
): ReactNode {
  // visibleWhen — conditional visibility (the interaction vocab)
  if (node.visibleWhen) {
    const v = data[node.visibleWhen];
    if (v == null || v === "" || v === false) return null;
  }

  const style = styleToCss(node.style);
  const kids = (node.children ?? []).map((c, i) => renderNode(c, data, onAction, i));

  switch (node.type) {
    case "Box":
    case "Stack":
    case "Row":
    case "Column":
      return (
        <div key={key} style={style}>
          {kids}
        </div>
      );
    case "Text":
      return (
        <span key={key} style={style}>
          {bound(node.bind?.value, data)}
        </span>
      );
    case "Image":
      return <img key={key} style={style} src={bound(node.bind?.src, data)} alt={bound(node.bind?.alt, data) ?? ""} />;
    case "Button":
      return (
        <button
          key={key}
          style={{ ...buttonStyle(node.style?.variant as string), ...style }}
          onClick={() => onAction?.(node.action ?? "click", data)}
        >
          {bound(node.bind?.label, data)}
        </button>
      );
    default:
      // Unknown primitive — render children so the tree doesn't break.
      return (
        <div key={key} style={style} data-unoverse-unknown={node.type}>
          {kids}
        </div>
      );
  }
}
