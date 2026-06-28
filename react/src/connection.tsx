/**
 * useUnoverseConnection — the CHANNEL's data-plane connector (MCP stream).
 *
 * Opens the live workflow connection to the Unoverse server's `/stream` MCP endpoint
 * (Streamable-HTTP SSE) for the inbound component stream, and REST `…/execute` for
 * sending messages. Inbound `notifications/unoverse/event` messages feed the single
 * `ComponentStore` via the pure `applyServerMessage` mapper.
 *
 * Per UNOVERSE_MCP_TEMPLATE_PROTOCOL.md §5/§5a/§5b: the component stream rides MCP
 * (NOT the legacy `/ws/gravity` WS — that's reserved for live audio). The node
 * executes in the same Unoverse process that serves this stream, so there's no
 * gateway relay and no Redis in the component path.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { applyServerMessage, type ComponentStore, type ServerMessage } from "@gravity-platform/unoverse-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface UnoverseConnectionConfig {
  /** Gravity API base, e.g. "http://localhost:4100". REST execute lives here. */
  apiUrl: string;
  /** Unoverse server base, e.g. "http://localhost:4105" (or the workbench origin in
   *  dev). The `/stream` MCP data-plane endpoint (§5b) is appended. */
  streamUrl: string;
  /** Optional JWT provider — the token rides the MCP transport fetch + REST Authorization header. */
  getAccessToken?: () => Promise<string | null>;
}

export interface UnoverseSessionParams {
  workflowId: string;
  targetTriggerNode: string;
  userId: string;
  conversationId: string;
  /** Groups one request→response turn. Defaults to conversationId if omitted. */
  chatId?: string;
}

export interface UnoverseConnection {
  isConnected: boolean;
  isReady: boolean;
  /** Composer target: optimistic user turn + REST workflow trigger. */
  sendMessage: (text: string) => void;
  /** Fire the bound workflow WITHOUT a user turn — the "load → run the workflow" ping
   *  (its component streams back into the shell). `input` shapes the execute payload per
   *  the app's `inputSchema`; omit for a bare trigger. (§5b REST `/execute`; the future
   *  MCP-native form is a `tools/call` on the InputTrigger tool, same call site.) */
  trigger: (input?: Record<string, unknown>) => void;
  /** Other component actions (button clicks, etc.) → MCP `user_action` tool. */
  sendAction: (action: string, data: Record<string, unknown>) => void;
  /** The workflow-selected template (MCP app) name, or null. The channel renders
   *  `unoverse://templates/{activeTemplate}` when set — the official resources/read load. */
  activeTemplate: string | null;
}

/** The data-plane endpoint on the Unoverse server (§5b). */
const STREAM_ENDPOINT = "/stream";
/** Custom notification carrying one ServerMessage as `params` (§5b). */
const UNOVERSE_EVENT = "notifications/unoverse/event";

export function useUnoverseConnection(
  config: UnoverseConnectionConfig,
  session: UnoverseSessionParams,
  store: ComponentStore,
  options: { enabled?: boolean } = {},
): UnoverseConnection {
  const enabled = options.enabled ?? true;
  const { apiUrl, streamUrl, getAccessToken } = config;
  const { workflowId, targetTriggerNode, userId, conversationId } = session;
  const chatId = session.chatId ?? conversationId;

  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const clientRef = useRef<Client | null>(null);
  // First-seen component keys for this connection (repeat INIT → props merge).
  const seenRef = useRef<Set<string>>(new Set());

  // ---- connection lifecycle (MCP stream) ----
  useEffect(() => {
    if (!enabled) return; // mock mode — no live stream
    if (!workflowId || !userId || !conversationId) {
      console.warn("[unoverse] connection missing workflowId/userId/conversationId");
      return;
    }
    let cancelled = false;
    seenRef.current = new Set();

    const client = new Client({ name: "unoverse-channel", version: "0.0.1" });
    clientRef.current = client;

    // The server pushes the live stream as `notifications/unoverse/event` over the
    // GET SSE channel. Custom notification methods land on the fallback handler —
    // route their `params` (one ServerMessage) into the store.
    client.fallbackNotificationHandler = async (notification) => {
      if (notification.method !== UNOVERSE_EVENT) return;
      const msg = (notification.params ?? {}) as unknown as ServerMessage;
      if ((msg as { type?: string }).type === "SESSION_READY") {
        setIsReady(true);
        return;
      }
      applyServerMessage(store, msg, seenRef.current);
    };

    (async () => {
      // Inject the bearer on every underlying request (fresh per call → refresh-safe).
      const authFetch = getAccessToken
        ? async (url: string | URL, init?: RequestInit): Promise<Response> => {
            const token = await getAccessToken();
            const headers = new Headers(init?.headers);
            if (token) headers.set("Authorization", `Bearer ${token}`);
            return fetch(url, { ...init, headers });
          }
        : undefined;
      try {
        const transport = new StreamableHTTPClientTransport(
          new URL(`${streamUrl}${STREAM_ENDPOINT}`),
          authFetch ? { fetch: authFetch } : undefined,
        );
        await client.connect(transport);
        if (cancelled) {
          await client.close().catch(() => {});
          return;
        }
        setIsConnected(true);
        // Bind this stream to the session — the server then pushes the live component
        // stream and an immediate SESSION_READY.
        await client.callTool({
          name: "register_session",
          arguments: { userId, conversationId, workflowId, targetTriggerNode, chatId },
        });
      } catch (e) {
        if (!cancelled) console.error("[unoverse] stream connect failed", e);
      }
    })();

    return () => {
      cancelled = true;
      setIsConnected(false);
      setIsReady(false);
      void clientRef.current?.close().catch(() => {});
      clientRef.current = null;
    };
  }, [enabled, apiUrl, streamUrl, workflowId, targetTriggerNode, userId, conversationId, chatId, getAccessToken, store]);

  // ---- outbound: fire the bound workflow over REST (§5b /execute) ----
  // No user turn — this is the raw trigger. `sendMessage` layers a user turn on top.
  const trigger = useCallback(
    (input?: Record<string, unknown>) => {
      (async () => {
        try {
          const token = getAccessToken ? await getAccessToken() : null;
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (token) headers["Authorization"] = `Bearer ${token}`;
          const res = await fetch(`${apiUrl}/api/workflows/${workflowId}/execute`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              input: { chatId, conversationId, userId, providerId: "gravity-ds", metadata: { targetTriggerNode }, ...input },
              conversationId,
            }),
          });
          if (!res.ok) console.error("[unoverse] execute failed", res.status, await res.text().catch(() => ""));
        } catch (e) {
          console.error("[unoverse] execute error", e);
        }
      })();
    },
    [apiUrl, workflowId, targetTriggerNode, userId, conversationId, chatId, getAccessToken],
  );

  // ---- outbound: send a message (optimistic user turn + trigger) ----
  const sendMessage = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message) return;
      store.addUserMessage(chatId, message); // optimistic user turn
      trigger({ message });
    },
    [chatId, store, trigger],
  );

  // ---- outbound: generic component action → MCP `user_action` tool ----
  const sendAction = useCallback(
    (action: string, data: Record<string, unknown>) => {
      void clientRef.current
        ?.callTool({ name: "user_action", arguments: { action, data, userId, conversationId, chatId } })
        .catch((e) => console.error("[unoverse] user_action failed", e));
    },
    [userId, conversationId, chatId],
  );

  // The workflow-selected template, reactively (a primitive snapshot so the store
  // subscription doesn't loop). The channel renders it via resources/read.
  const activeTemplate = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getActiveTemplate().name,
  );

  return { isConnected, isReady, sendMessage, trigger, sendAction, activeTemplate };
}
