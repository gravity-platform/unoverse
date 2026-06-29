/**
 * <StreamedUnoverseTemplate> — renders a TEMPLATE definition (the layout) and
 * fills its ComponentSlots from the store's timeline.
 *
 * A template owns nothing (UNOVERSE_SPEC.md §2e-0): it reads the shared state
 * and arranges what it finds. This component is that arrangement —
 *   - reads the template recipe by URI (resources/read, via the client),
 *   - subscribes to the store so it re-renders as components stream in,
 *   - resolves each ComponentSlot against the timeline and renders the matched
 *     leaves with the SAME StreamedUnoverseComponent used everywhere else.
 *
 * This slice handles ComponentSlot + Skeleton (Tier-1, e.g. KeyService). The
 * chat primitives (Conversation/Input/…) come in later slices.
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { ComponentStore, ResolvedTheme, UnoverseClient, UnoverseDefinition, UnoverseNode } from "@gravity-platform/unoverse-core";
import { renderNode, styleToCss, keyframesCss, type ActionHandler, type SlotResolver } from "./render";
import { StreamedUnoverseComponent } from "./streamed";
import { useUnoverseTheme } from "./theme";
import { IsolatedRoot } from "./isolate";

export interface StreamedUnoverseTemplateProps {
  client: UnoverseClient;
  store: ComponentStore;
  /** e.g. "unoverse://templates/KeyService" */
  uri: string;
  onAction?: ActionHandler;
  theme?: ResolvedTheme;
  /** Channel overrides for the template's declared props (e.g. per-tenant logoUrl/brandName).
   *  Merged OVER the definition's own `props` defaults into the root data scope. */
  props?: Record<string, unknown>;
  /** Render inside a Shadow DOM for full CSS isolation (default true). See UnoverseComponent. */
  isolate?: boolean;
}

/** The author's declared prop defaults (def.props[k].default) → a flat data object. Content, not policy. */
function propDefaults(props?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v && typeof v === "object" && "default" in (v as Record<string, unknown>)) {
      out[k] = (v as { default: unknown }).default;
    }
  }
  return out;
}

/** Format a turn timestamp as relative copy ("just now" / "5 min ago"). Neutral
 *  projection of a model value (like `text`), not UX policy. Mirrors legacy
 *  ChatHistoryItem.formatRelativeTime. Empty string when unstamped. */
function formatRelative(ts?: number): string {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return new Date(ts).toLocaleDateString();
}

/** Resolve a ComponentSlot's `select` against the store → ordered pointers. Exported for testing. */
export function selectPointers(store: ComponentStore, node: UnoverseNode): string[] {
  const sel = node.select ?? {};
  let pointers =
    sel.from === "all"
      ? store.getResponses().flatMap((r) => r.components)
      : (store.latestResponse()?.components ?? []);

  if (sel.type?.length) {
    const want = sel.type.map((t) => t.toLowerCase());
    pointers = pointers.filter((p) => {
      const t = store.typeOf(p);
      return t != null && want.includes(t.toLowerCase());
    });
  }
  if (sel.limit != null) pointers = pointers.slice(0, sel.limit);
  return pointers;
}

export function StreamedUnoverseTemplate({ client, store, uri, onAction, theme: themeProp, props, isolate = true }: StreamedUnoverseTemplateProps) {
  const [def, setDef] = useState<UnoverseDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  // No theme passed → fetch from the server (the SDK owns zero token values).
  const fetched = useUnoverseTheme(client, "light");
  const theme = themeProp ?? fetched;

  // Re-render whenever the store changes (a component streams in / merges).
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
  );

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

  // Loading/error hints carry NO styling — the SDK owns zero styles.
  if (error) return <div>Unoverse error: {error}</div>;
  if (!def || !theme) return <div>Loading {uri}…</div>;

  // Universal action routing: store-global interaction actions (the named state machines —
  // panels, focus) are handled IN the SDK so every template drives them with the same vocab,
  // no per-channel glue. Everything else (sendMessage, input) bubbles to the channel.
  const dispatch: ActionHandler = (action, data) => {
    const t = typeof action === "string" ? action : action?.type;
    // Template-chrome writes use the SAME vocab as components: `setTemplateValue` writes the
    // dev's chosen key into template state (e.g. a disclosure `openPanel`). The SDK hardcodes
    // no UI concept. Everything else bubbles to the channel.
    if (t === "setTemplateValue") {
      const values = (typeof action === "object" ? action?.values : undefined) ?? [];
      const patch: Record<string, unknown> = {};
      for (const { key, value } of values) patch[key] = value;
      store.mergeTemplateState(patch);
      return;
    }
    onAction?.(action, data);
  };

  const leaf = (pointer: string, extraData?: Record<string, unknown>) => {
    const { chatId, nodeId } = store.split(pointer);
    return <StreamedUnoverseComponent key={pointer} client={client} store={store} chatId={chatId} nodeId={nodeId} onAction={dispatch} theme={theme} extraData={extraData} />;
  };

  // ComponentSlot — filter the timeline to matching component pointers (KeyService).
  const resolveSlot = (node: UnoverseNode, key?: React.Key): ReactNode => {
    const pointers = selectPointers(store, node);
    if (pointers.length === 0) {
      return node.fallback ? renderNode(node.fallback, {}, dispatch, theme, key ?? "fallback") : null;
    }
    return pointers.map((p) => leaf(p));
  };

  // Timeline — GENERIC iterator. Walks the timeline and renders the `user` / `assistant`
  // DATA sub-tree per turn. Zero chat UX in the SDK: bubbles, alignment, structure all live
  // in those sub-trees (rx/templates/chatlayout/*.json). The assistant sub-tree's ComponentSlot
  // is scoped to THAT turn's components.
  const resolveTimeline = (node: UnoverseNode, key?: React.Key): ReactNode => {
    return (
      <div key={key} style={styleToCss(node.style, theme)}>
        {store.getTimeline().map((turn) => {
          const sub = turn.role === "user" ? node.user : node.assistant;
          if (!sub) return null;
          // Slot scoped to this turn's components (assistant turns only).
          const turnSlot: SlotResolver = (slotNode, k) => {
            let ptrs = turn.role === "assistant" ? [...turn.components] : [];
            const want = slotNode.select?.type?.map((t) => t.toLowerCase());
            if (want?.length) ptrs = ptrs.filter((p) => { const t = store.typeOf(p); return t != null && want.includes(t.toLowerCase()); });
            if (slotNode.select?.limit != null) ptrs = ptrs.slice(0, slotNode.select.limit);
            if (ptrs.length === 0) return slotNode.fallback ? renderNode(slotNode.fallback, {}, dispatch, theme, k ?? "fb") : null;
            // Pass the turn's streaming state into each component's scope so a streamed
            // component (e.g. AIResponse) can stop its own loading dots when complete.
            const streaming = turn.role === "assistant" && turn.streamingState === "streaming";
            return ptrs.map((p) => leaf(p, { streaming }));
          };
          // Data scope per turn = author's static data (avatarUrl, thinkingText…)
          // + NEUTRAL projections of the timeline model. The SDK exposes facts, never
          // UX policy: `text` (user message), `streaming` (the turn's streamingState),
          // `empty` (no components yet). It does NOT decide "show a thinking indicator" —
          // the definition composes that from `streaming` + `empty` (nested visibleWhen =
          // AND). Static author data is forwarded verbatim; the SDK interprets none of it.
          const time = formatRelative(turn.createdAt);
          const data =
            turn.role === "user"
              ? { ...(node.userData ?? {}), text: turn.text, time }
              : {
                  ...(node.assistantData ?? {}),
                  time,
                  streaming: turn.streamingState === "streaming",
                  empty: turn.components.length === 0,
                  // `active` = in progress OR has content. A completed-empty turn is
                  // inactive → the definition hides it (legacy ChatHistoryItem null-returns).
                  active: turn.streamingState === "streaming" || turn.components.length > 0,
                };
          return renderNode(sub, data, dispatch, theme, turn.id, turnSlot);
        })}
      </div>
    );
  };

  // One resolver for all store-backed template primitives.
  const resolve: SlotResolver = (node, key) =>
    node.type === "Timeline" ? resolveTimeline(node, key) : resolveSlot(node, key);

  // Root data scope = the author's declared prop defaults (logoUrl, brandName, suggestions…)
  // + channel overrides + NEUTRAL conversation-level facts derived from the store (isEmpty/
  // hasMessages). This is what lets the page AROUND the message list (header, welcome screen,
  // suggestion cards) bind + show/hide — the whole-template counterpart of the per-turn scope
  // Timeline injects. The SDK adds no UX policy: just author content + model projections.
  const isEmpty = store.getTimeline().length === 0;
  const rootData: Record<string, unknown> = {
    ...propDefaults(def.props),
    ...(props ?? {}),
    // The active template's OWN state — one generic bag of the DEV's chosen keys (draft,
    // openPanel, suggestions data, focusMode, voice call state, …). No per-feature
    // projections; the engine knows no key names (UNOVERSE_STATE_MODEL §2).
    ...store.getTemplateState(),
    // Conversation-derived facts — READ OFF the timeline / lifecycle, never stored.
    isEmpty,
    hasMessages: !isEmpty,
    lifecycle: store.getLifecycle(),
    isThinking: store.getLifecycle() === "thinking",
    isStreaming: store.getLifecycle() === "thinking" || store.getLifecycle() === "streaming",
  };

  // Inject the served keyframes ONCE for this render root so any `style.animation` in a
  // definition resolves (the SDK animates generically — no per-animation primitive).
  // The wrapper applies the SERVED base render settings (theme.root — font-smoothing, etc.):
  // `display: contents` keeps it out of layout while its inherited props cascade to the tree.
  // The SDK authors only `display: contents` (structure); every value comes from theme.root.
  // Isolated → theme.root on the shadow-root container (reliable cascade); else → display:contents.
  const keyframes = <style>{keyframesCss(theme)}</style>;
  const tree = renderNode(def.root, rootData, dispatch, theme, undefined, resolve);
  // A template is a SURFACE: its render-root fills the box the host gives it, so a root
  // that declares `height: "full"` (DATA) can resolve. This only fills when the host's box
  // is definite-height; when the host sizes to content the 100% resolves to content — so a
  // content-sized app (fluidHeight:false) still wraps its component. The SDK adds no layout
  // policy beyond "a template fills its container"; the template DATA owns everything else.
  const surfaceRoot = { ...(theme.root as CSSProperties), height: "100%" };
  if (isolate) {
    return (
      <IsolatedRoot rootStyle={surfaceRoot}>
        {keyframes}
        {tree}
      </IsolatedRoot>
    );
  }
  return (
    <>
      {keyframes}
      <div style={{ display: "contents", ...surfaceRoot }}>{tree}</div>
    </>
  );
}
