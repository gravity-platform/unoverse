/**
 * Streaming binding: subscribe to the merge-state store and render the
 * component instance, re-rendering when COMPONENT_INIT/COMPONENT_DATA merge in.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { dispatchAction, type ComponentStore, type ResolvedTheme, type UnoverseClient } from "@gravity-platform/unoverse-core";
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
  theme?: ResolvedTheme;
  /** Neutral turn state merged into the component's data scope (e.g. `streaming`), so a
   *  component can reflect it — like legacy passing `streamingState` to AIResponse. */
  extraData?: Record<string, unknown>;
}

/** Resolves `type` from the store → its definition → renders with merged data. */
export function StreamedUnoverseComponent({ client, store, chatId, nodeId, onAction, theme, extraData }: StreamedUnoverseComponentProps) {
  const { type, data } = useUnoverseInstance(store, chatId, nodeId);
  // Interpret the action envelope (§2e-3): `setValue` writes THIS instance's slice
  // locally (the ported `updateData`); any other type routes to the channel handler
  // (the workflow). `then` chains. The component never sees the store directly.
  const handleAction = useMemo<ActionHandler>(
    () => (action, scope) =>
      dispatchAction(action, scope, {
        store,
        chatId,
        nodeId,
        sendToServer: onAction ? (t, payload) => onAction(t, payload) : undefined,
      }),
    [store, chatId, nodeId, onAction],
  );
  if (!type) return <div>waiting for COMPONENT_INIT…</div>;
  // No focus/displayState injection: a component's inline/focused look is its OWN state,
  // written via the `setValue` action into this slice and read via `visibleWhen` — the SDK
  // hardcodes no focus concept (UNOVERSE_STATE_MODEL §2). It's just another data field.
  const merged = extraData ? { ...data, ...extraData } : data;
  return <UnoverseComponent client={client} uri={`unoverse://components/${type}`} data={merged} onAction={handleAction} theme={theme} />;
}
