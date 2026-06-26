/**
 * @unoverse/core — framework-agnostic brain.
 *
 * This slice: an MCP client that reads neutral definitions from the Unoverse
 * MCP server (resources/read). Merge-state store + subscriptions come with
 * the streaming slice (AIResponse). No UI framework here.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ---- The neutral definition shape (mirrors apps/unoverse/definitions/*.json) ----

export interface UnoverseNode {
  type: string; // Box | Stack | Row | Column | Text | Image | Button | ...
  style?: Record<string, unknown>;
  bind?: Record<string, string>; // target prop -> data field
  visibleWhen?: string; // data field; render only if truthy
  action?: string; // dispatched on interaction
  children?: UnoverseNode[];
}

export interface UnoverseDefinition {
  unoverse: string;
  kind: "component" | "template";
  name: string;
  description?: string;
  props?: Record<string, unknown>;
  root: UnoverseNode;
}

// ---- The client ----

export class UnoverseClient {
  private client: Client;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private cache = new Map<string, UnoverseDefinition>();

  constructor(private readonly url: string) {
    this.client = new Client({ name: "unoverse-core", version: "0.0.1" });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    // Single shared connect — concurrent readDefinition() calls must not each
    // open a transport ("Already connected to a transport").
    if (!this.connecting) {
      this.connecting = (async () => {
        const transport = new StreamableHTTPClientTransport(new URL(this.url));
        await this.client.connect(transport);
        this.connected = true;
      })();
    }
    return this.connecting;
  }

  /** resources/read a definition by URI (e.g. unoverse://components/Card). Cached. */
  async readDefinition(uri: string): Promise<UnoverseDefinition> {
    const cached = this.cache.get(uri);
    if (cached) return cached;
    await this.connect();
    const res = await this.client.readResource({ uri });
    const first = res.contents[0] as { text?: string };
    if (!first?.text) throw new Error(`No definition content for ${uri}`);
    const def = JSON.parse(first.text) as UnoverseDefinition;
    this.cache.set(uri, def);
    return def;
  }

  /** List available component definitions (resources/templates + list). */
  async listComponents(): Promise<{ uri: string; name?: string }[]> {
    await this.connect();
    const res = await this.client.listResources();
    return res.resources
      .filter((r) => r.uri.startsWith("unoverse://components/"))
      .map((r) => ({ uri: r.uri, name: r.name }));
  }
}

// ---- The merge-state store (port of DESIGN_SYSTEM_STATE.md) ----
//
// State keyed `${chatId}:${nodeId}`, MERGE-not-replace. COMPONENT_INIT adds
// the instance + its type; COMPONENT_DATA merges a delta. Components re-render
// on change. This is the channel's runtime brain — framework-agnostic.

export interface ComponentInitEvent {
  type: "COMPONENT_INIT";
  chatId: string;
  nodeId: string;
  component: { type: string; componentUrl?: string; props?: Record<string, unknown> };
}
export interface ComponentDataEvent {
  type: "COMPONENT_DATA";
  chatId: string;
  nodeId: string;
  data: Record<string, unknown>;
}
export type UnoverseEvent = ComponentInitEvent | ComponentDataEvent;

export class ComponentStore {
  private data = new Map<string, Record<string, unknown>>();
  private types = new Map<string, string>();
  private listeners = new Set<() => void>();
  private version = 0;

  /** Apply a streamed event (COMPONENT_INIT or COMPONENT_DATA). */
  apply(event: UnoverseEvent): void {
    const key = `${event.chatId}:${event.nodeId}`;
    if (event.type === "COMPONENT_INIT") {
      this.types.set(key, event.component.type);
      this.merge(key, event.component.props ?? {});
    } else {
      this.merge(key, event.data);
    }
  }

  private merge(key: string, patch: Record<string, unknown>): void {
    // merge-not-replace
    this.data.set(key, { ...(this.data.get(key) ?? {}), ...patch });
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get(chatId: string, nodeId: string): Record<string, unknown> {
    return this.data.get(`${chatId}:${nodeId}`) ?? {};
  }
  getType(chatId: string, nodeId: string): string | undefined {
    return this.types.get(`${chatId}:${nodeId}`);
  }
  getVersion(): number {
    return this.version;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
