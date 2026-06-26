/**
 * Streaming binding: subscribe to the merge-state store and render the
 * component instance, re-rendering when COMPONENT_INIT/COMPONENT_DATA merge in.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { ComponentStore, UnoverseClient } from "@gravity-platform/unoverse-core";
import { UnoverseComponent } from "./UnoverseComponent";
import type { ActionHandler } from "./render";

/** Subscribe to a component instance in the store (re-renders on merge). */
export function useUnoverseInstance(store: ComponentStore, chatId: string, nodeId: string) {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const getVersion = useCallback(() => store.getVersion(), [store]);
  useSyncExternalStore(subscribe, getVersion);
  return { type: store.getType(chatId, nodeId), data: store.get(chatId, nodeId) };
}

export interface StreamedUnoverseComponentProps {
  client: UnoverseClient;
  store: ComponentStore;
  chatId: string;
  nodeId: string;
  onAction?: ActionHandler;
}

/** Resolves `type` from the store → its definition → renders with merged data. */
export function StreamedUnoverseComponent({ client, store, chatId, nodeId, onAction }: StreamedUnoverseComponentProps) {
  const { type, data } = useUnoverseInstance(store, chatId, nodeId);
  if (!type) return <div style={{ color: "#9ca3af", fontSize: 13 }}>waiting for COMPONENT_INIT…</div>;
  return <UnoverseComponent client={client} uri={`unoverse://components/${type}`} data={data} onAction={onAction} />;
}
