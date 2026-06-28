/**
 * <UnoverseComponent> — reads a definition by URI from the Unoverse MCP server
 * (via @gravity-platform/unoverse-core) and renders it natively with the given data.
 */
import { useEffect, useState, type CSSProperties } from "react";
import type { ResolvedTheme, UnoverseClient, UnoverseDefinition } from "@gravity-platform/unoverse-core";
import { renderNode, keyframesCss, type ActionHandler } from "./render";
import { useUnoverseTheme } from "./theme";
import { IsolatedRoot } from "./isolate";

export interface UnoverseComponentProps {
  client: UnoverseClient;
  /** e.g. "unoverse://components/Card" */
  uri: string;
  /** instance data bound into the definition (the streamed props) */
  data?: Record<string, unknown>;
  onAction?: ActionHandler;
  /**
   * Resolved theme. Optional — if omitted, the SDK FETCHES it from the server
   * (`unoverse://theme/light`). The SDK bundles no tokens. Pass one to override
   * (e.g. the workbench's light/dark toggle); swap it to restyle, zero def changes.
   */
  theme?: ResolvedTheme;
  /**
   * Render inside a Shadow DOM for full CSS isolation (default true). The SDK owns the
   * isolation boundary so every consumer is protected identically; the canvas/channel no
   * longer wrap it themselves. Set false only for a host that manages its own isolation.
   */
  isolate?: boolean;
}

export function UnoverseComponent({ client, uri, data, onAction, theme, isolate = true }: UnoverseComponentProps) {
  const [def, setDef] = useState<UnoverseDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  // No theme passed → fetch it from the server (the SDK owns zero token values).
  const fetched = useUnoverseTheme(client, "light");
  const activeTheme = theme ?? fetched;

  useEffect(() => {
    let alive = true;
    setDef(null);
    setError(null);
    client
      .readDefinition(uri)
      .then((d) => alive && setDef(d))
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [client, uri]);

  // Loading/error hints carry NO styling — the SDK owns zero styles (tokens or hints).
  if (error) return <div>Unoverse error: {error}</div>;
  if (!def || !activeTheme) return <div>Loading {uri}…</div>;
  // Fill props the instance didn't provide from the definition's defaults; instance `data`
  // overrides. This is what lets a partially-emitted component still render its declared
  // baseline — e.g. AIResponse's `progressText` default ("Thinking…") shows while the node
  // streams and hasn't emitted a progress line. IMPORTANT: a def `default` must therefore be
  // a sensible RUNTIME fallback, NOT a demo placeholder — a demo-y default (e.g. a markdown
  // showcase on `text`) would mask an empty stream. Keep demo content out of prop defaults.
  const propDefaults = Object.fromEntries(
    Object.entries((def.props ?? {}) as Record<string, { default?: unknown }>).map(([k, v]) => [k, v?.default]),
  );
  const merged = { ...propDefaults, ...(data ?? {}) };
  // Apply the SERVED base render-root settings (theme.root — DS typography + font-smoothing)
  // and inject the served keyframes, the SAME as the template path. `display: contents`
  // keeps this wrapper out of layout while its inherited props (font/colour) cascade to the
  // tree — so a standalone component gets the design-system baseline, not the page's default.
  const body = (
    <>
      <style>{keyframesCss(activeTheme)}</style>
      <div style={{ display: "contents", ...(activeTheme.root as CSSProperties) }}>
        {renderNode(def.root, merged, onAction, activeTheme)}
      </div>
    </>
  );
  return isolate ? <IsolatedRoot>{body}</IsolatedRoot> : body;
}
