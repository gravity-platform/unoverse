/**
 * <UnoverseComponent> — reads a definition by URI from the Unoverse MCP server
 * (via @gravity-platform/unoverse-core) and renders it natively with the given data.
 */
import { useEffect, useState, type CSSProperties } from "react";
import type { ResolvedTheme, UnoverseClient, UnoverseDefinition } from "@gravity-platform/unoverse-core";
import { renderNode, keyframesCss, type ActionHandler } from "./render";
import { useUnoverseTheme } from "./theme";

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
}

export function UnoverseComponent({ client, uri, data, onAction, theme }: UnoverseComponentProps) {
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
  // The definition's prop DEFAULTS are the static baseline (e.g. an option list declared
  // as a prop default); the instance `data` (streamed props) OVERRIDES them. So a component
  // renders its declared defaults even when the node only emits the dynamic props — without
  // this, any prop the node didn't set resolves to `undefined` (an empty `Each`, blank text…).
  const propDefaults = Object.fromEntries(
    Object.entries((def.props ?? {}) as Record<string, { default?: unknown }>).map(([k, v]) => [k, v?.default]),
  );
  const merged = { ...propDefaults, ...(data ?? {}) };
  // Apply the SERVED base render-root settings (theme.root — DS typography + font-smoothing)
  // and inject the served keyframes, the SAME as the template path. `display: contents`
  // keeps this wrapper out of layout while its inherited props (font/colour) cascade to the
  // tree — so a standalone component gets the design-system baseline, not the page's default.
  return (
    <>
      <style>{keyframesCss(activeTheme)}</style>
      <div style={{ display: "contents", ...(activeTheme.root as CSSProperties) }}>
        {renderNode(def.root, merged, onAction, activeTheme)}
      </div>
    </>
  );
}
