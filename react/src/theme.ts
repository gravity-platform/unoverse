/**
 * useUnoverseTheme — fetch the RESOLVED theme from the MCP server by name.
 *
 * The SDK owns ZERO token values. The server owns the visual (apps/unoverse/
 * rx/styles, resolved live) and serves it at `unoverse://theme/{name}`; this hook
 * fetches it (cached in the client). A brand change in rx/styles is refresh-only
 * — there is no baked theme in this bundle to rebuild (UNOVERSE_SPEC §2d-1).
 */
import { useEffect, useState } from "react";
import type { ResolvedTheme, UnoverseClient } from "@gravity-platform/unoverse-core";

/** Returns the resolved theme (null until the first fetch resolves). */
export function useUnoverseTheme(client: UnoverseClient, name = "light"): ResolvedTheme | null {
  const [theme, setTheme] = useState<ResolvedTheme | null>(null);
  useEffect(() => {
    let alive = true;
    client
      .readTheme(name)
      .then((t) => alive && setTheme(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, name]);
  return theme;
}
