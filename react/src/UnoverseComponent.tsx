/**
 * <UnoverseComponent> — reads a definition by URI from the Unoverse MCP server
 * (via @gravity-platform/unoverse-core) and renders it natively with the given data.
 */
import { useEffect, useState } from "react";
import type { UnoverseClient, UnoverseDefinition } from "@gravity-platform/unoverse-core";
import { renderNode, type ActionHandler } from "./render";

export interface UnoverseComponentProps {
  client: UnoverseClient;
  /** e.g. "unoverse://components/Card" */
  uri: string;
  /** instance data bound into the definition (the streamed props) */
  data?: Record<string, unknown>;
  onAction?: ActionHandler;
}

export function UnoverseComponent({ client, uri, data, onAction }: UnoverseComponentProps) {
  const [def, setDef] = useState<UnoverseDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) return <div style={{ color: "#d81e2c", fontSize: 13 }}>Unoverse error: {error}</div>;
  if (!def) return <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading {uri}…</div>;
  return <>{renderNode(def.root, data ?? {}, onAction)}</>;
}
