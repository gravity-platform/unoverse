/**
 * The data-plane translation layer (pure, no React, no DOM).
 *
 * The CHANNEL owns the live workflow connection (WS + REST execute); this file
 * is the thin mapping it feeds: one inbound server message → one mutation of the
 * single `ComponentStore`. Keeping it pure makes it unit-testable and lets the
 * React hook (react/src/connection.tsx) own only socket lifecycle.
 *
 * The Unoverse MCP server is NOT involved here — it's the control plane
 * (definitions + theme). See UNOVERSE_MCP_TEMPLATE_PROTOCOL.md §5a.
 */
import type { ComponentStore } from "./index";

// ---- Inbound server messages (the subset this rung handles) ----
// Mirrors the legacy gravity-client contract (core/types.ts). nodeId is
// SERVER-ASSIGNED per emitted component — never minted by the client.

export interface ServerComponentInit {
  type: "COMPONENT_INIT";
  chatId: string;
  nodeId: string;
  component: { type: string; componentUrl?: string; props?: Record<string, unknown> };
  /** Marks a TEMPLATE directive (legacy emits a fake COMPONENT_INIT with nodeId
   *  `<name>_template`). Templates are SERVED apps, loaded via resources/read — never
   *  rendered as components — so we route these to the template plane, not the timeline. */
  metadata?: { isTemplate?: boolean; [k: string]: unknown };
}
export interface ServerComponentData {
  type: "COMPONENT_DATA" | "OBJECT_DATA";
  chatId: string;
  nodeId: string;
  data: Record<string, unknown>;
}
export interface ServerWorkflowState {
  type: "WORKFLOW_STATE";
  state: string; // WORKFLOW_STARTED | WORKFLOW_COMPLETED | ...
  chatId: string;
  workflowId?: string;
  workflowRunId?: string | null;
  /** Template SELECTION rides here (SPEC §5b: `{ template, templateMode }`) — the
   *  OFFICIAL signal for which MCP-app shell to load via resources/read. */
  metadata?: { template?: string; templateMode?: string; [k: string]: unknown };
}
export interface ServerSessionReady {
  type: "SESSION_READY";
}
export type ServerMessage =
  | ServerComponentInit
  | ServerComponentData
  | ServerWorkflowState
  | ServerSessionReady
  | { type: string; [k: string]: unknown }; // forward-compat: unknown types ignored

// Track first-seen components per `chatId:nodeId` so a repeated COMPONENT_INIT
// is applied as a props merge (legacy behaviour), not a second timeline placement.
// Caller passes a Set it owns (per connection), so this stays pure.

/**
 * Apply one inbound server message to the single store. Unknown / out-of-scope
 * message types (NODE_EXECUTION, SUGGESTIONS_UPDATE, audio) are ignored here.
 *
 * @param seen  per-connection set of already-initialised `chatId:nodeId` keys.
 */
export function applyServerMessage(store: ComponentStore, msg: ServerMessage, seen: Set<string>): void {
  switch (msg.type) {
    case "COMPONENT_INIT": {
      const m = msg as ServerComponentInit;
      if (!m.chatId || !m.nodeId) return;
      // TEMPLATE DIRECTIVE — a template is a SERVED MCP app (protocol §0.1), loaded via
      // resources/read unoverse://templates/{name}; it is NEVER a streamed component. Record
      // WHICH app to load (the channel reads it); do not place it in the component timeline
      // (that produced "Unknown Unoverse component: <Template>"). The legacy componentUrl
      // .js bundle is ignored — Unoverse loads the neutral definition, not a React bundle.
      if (m.metadata?.isTemplate === true || m.nodeId.endsWith("_template")) {
        if (m.component?.type) store.setActiveTemplate(m.component.type, m.component.props ?? {});
        return;
      }
      const key = `${m.chatId}:${m.nodeId}`;
      if (seen.has(key)) {
        // Already placed — treat a repeat INIT as a props merge (no re-placement).
        const props = m.component?.props;
        if (props && Object.keys(props).length > 0) {
          store.apply({ type: "COMPONENT_DATA", chatId: m.chatId, nodeId: m.nodeId, data: props });
        }
        return;
      }
      seen.add(key);
      store.apply({ type: "COMPONENT_INIT", chatId: m.chatId, nodeId: m.nodeId, component: m.component });
      return;
    }
    case "COMPONENT_DATA":
    case "OBJECT_DATA": {
      const m = msg as ServerComponentData;
      if (!m.chatId || !m.nodeId) return;
      store.apply({ type: "COMPONENT_DATA", chatId: m.chatId, nodeId: m.nodeId, data: m.data ?? {} });
      return;
    }
    case "WORKFLOW_STATE": {
      const m = msg as ServerWorkflowState;
      // OFFICIAL template selection (SPEC §5b): the workflow names the app shell in
      // metadata.template; the channel loads it via resources/read. (templateMode
      // switch/stack/replace is future — default "switch".)
      if (m.metadata?.template) store.setActiveTemplate(m.metadata.template);
      // Open an EMPTY streaming turn so the timeline shows a thinking state BEFORE the
      // first component (legacy processWorkflowState.ts; aiContext treats these as
      // streaming). COMPONENT_INIT then reuses it. Without this, the assistant turn is
      // born WITH its first component, so the streaming-and-empty window never exists.
      if (m.state === "WORKFLOW_STARTED" || m.state === "THINKING" || m.state === "RESPONDING" || m.state === "WAITING") {
        if (m.chatId) store.startResponse(m.chatId);
      } else if (m.state === "WORKFLOW_COMPLETED" || m.state === "COMPLETE") {
        store.completeResponse(m.chatId);
      }
      return;
    }
    default:
      // SESSION_READY is handled by the hook (it may send initialQuery); everything
      // else (NODE_EXECUTION, SUGGESTIONS_UPDATE, audio) is out of scope this rung.
      return;
  }
}
