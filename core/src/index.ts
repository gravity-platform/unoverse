/**
 * @unoverse/core — framework-agnostic brain.
 *
 * This slice: an MCP client that reads neutral definitions from the Unoverse
 * MCP server (resources/read). Merge-state store + subscriptions come with
 * the streaming slice (AIResponse). No UI framework here.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Data-plane translation layer (pure event→store mapping; channel-owned connection).
export {
  applyServerMessage,
  type ServerMessage,
  type ServerComponentInit,
  type ServerComponentData,
  type ServerWorkflowState,
  type ServerSessionReady,
} from "./connection";

// The action interpreter (§2e-3) — local `setValue` store write + server route.
export { dispatchAction, resolveValue, type ActionContext } from "./actions";

// ---- The neutral definition shape (mirrors apps/unoverse/definitions/*.json) ----

export interface UnoverseNode {
  type: string; // Box | Stack | Row | Column | Text | Image | Button | ComponentSlot | Skeleton | ...
  style?: Record<string, unknown>;
  bind?: Record<string, string>; // target prop -> data field
  visibleWhen?: VisibleWhen; // render only when the condition holds (truthy field, or {field,eq/ne})
  action?: string | ActionSpec; // dispatched on interaction (bare string → server, or a setValue envelope)
  placeholder?: string; // Input: empty-field copy (content, not style)
  children?: UnoverseNode[];
  // --- template primitives (UNOVERSE_SPEC.md §2e) ---
  /** ComponentSlot: which components to pull from the store timeline. */
  select?: { type?: string[]; from?: "latest" | "all"; limit?: number };
  /** ComponentSlot: rendered when the slot resolves to zero components. */
  fallback?: UnoverseNode;
  /** Skeleton: placeholder variant. */
  variant?: "text" | "card" | "image";
  /** Timeline: data sub-tree rendered for a user turn (binds `text`). ALL bubble UX lives here, not the SDK. */
  user?: UnoverseNode;
  /** Timeline: data sub-tree rendered for an assistant turn (its ComponentSlot is scoped to that turn). */
  assistant?: UnoverseNode;
  /** Each: the per-item subtree, rendered once per element of the bound array (`bind.items`),
   *  with that element as its data scope. The node's own `style` is the list container. */
  template?: UnoverseNode;
  /** Timeline: static author data merged into every assistant turn's data scope
   *  (e.g. avatarUrl, thinkingText). The SDK forwards it verbatim — it interprets
   *  nothing chat-specific; the turn STATE flags (streaming/thinking) are added on top. */
  assistantData?: Record<string, unknown>;
  /** Timeline: static author data merged into every user turn's data scope. */
  userData?: Record<string, unknown>;
  /** Icon: the served glyph NAME (literal) — or bind a data field via `bind.name`. */
  icon?: string;
  /** Disable the element (Input/Button) when this data field is truthy; the node's
   *  `style.disabled` is merged while disabled. */
  disabledWhen?: string;
}

export interface UnoverseDefinition {
  unoverse: string;
  kind: "component" | "template";
  name: string;
  description?: string;
  props?: Record<string, unknown>;
  root: UnoverseNode;
}

// ---- The interaction vocabulary (UNOVERSE_SPEC.md §2e-3) ----
//
// A small, declarative layer — NOT a programming language. Stac-inspired
// (set_value + Multi Action + visible-if): an `action` is a bare string (→ the
// workflow) or a `setValue` envelope (a LOCAL store write, the ported `updateData`);
// `visibleWhen` is a truthy field name or an equality test.

/** One `setValue` patch. `value` is a literal OR a `{{field}}` / `{{a.b}}` binding
 *  resolved against the action's data scope (e.g. the tapped item inside an `Each`). */
export interface ActionValue {
  key: string;
  value: unknown;
}

/** A declarative action. `setValue` merges `values` into THIS component's
 *  `chatId:nodeId` slice (no round-trip); any other `type` routes to the workflow
 *  (optionally narrowed by `send`). `then` chains a follow-up (Stac Multi Action). */
export interface ActionSpec {
  type: string; // "setValue" (local) | "submit" | "click" | custom (→ server)
  values?: ActionValue[]; // setValue patches
  send?: string[]; // server route: which scope fields to include (default: all)
  then?: ActionSpec | string; // optional chained follow-up
}

/** `visibleWhen`: a data field name (truthy) OR an equality/inequality test. */
export type VisibleWhen = string | { field: string; eq?: unknown; ne?: unknown };

// ---- The resolved theme (SHAPE only — values live on the server) ----
//
// The MCP server OWNS THE VISUAL: it resolves the design tokens (apps/unoverse/
// rx/styles) live and serves this shape at `unoverse://theme/{name}`. This is the
// token SHAPE, never the token VALUES — the SDK fetches the values (readTheme),
// it does NOT bundle them. A brand change in rx/styles is therefore refresh-only,
// exactly like a definition change (UNOVERSE_SPEC §2d-1).
export interface ResolvedTheme {
  color: Record<string, string>;
  /** Dimension scale (theme.space ← rx/styles/base/spacing.json) — used for BOTH spacing
   *  (gap/padding/margin) AND element sizes (width/height), Tailwind-style. */
  space: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
  borderWidth: Record<string, string>;
  /** Line-height tokens (theme.lineHeight ← font.lineHeight) — tight/snug/normal/relaxed. */
  lineHeight: Record<string, string | number>;
  text: Record<string, Record<string, string | number>>;
  skeleton: Record<string, unknown>;
  prose: Record<string, unknown>;
  /** Named keyframes (theme.keyframes ← rx/styles/semantic/keyframes.json), injected
   *  once per render root. Lets any definition animate via `style.animation` — no SDK edit. */
  keyframes: Record<string, Record<string, Record<string, string>>>;
  /** Named icon glyphs as SERVED DATA. The SERVER sources these from an icon pack
   *  (control plane) → `{ viewBox, attrs, children }` where children are raw SVG
   *  elements `[tag, attrs]`. The generic `Icon` leaf renders them, sized/coloured by
   *  node.style. The SDK never bundles the pack — icons are served like any token. */
  icons: Record<string, { viewBox?: string; attrs?: Record<string, unknown>; children?: [string, Record<string, unknown>][] }>;
  /** Base render-root settings (theme.root ← rx/styles/semantic/root.json) — a CSS
   *  object the SDK spreads onto its outermost wrapper (e.g. font-smoothing). Served,
   *  not authored: a whole-tree rendering normalization, like legacy styles/base.css. */
  root: Record<string, unknown>;
}

// ---- The client ----

export interface UnoverseClientOptions {
  /**
   * Returns a fresh bearer token per request (e.g. an OIDC access_token). The token
   * rides the `Authorization` header on every MCP call so a secured server (default-deny)
   * accepts it. Omit for anonymous/dev (server with AUTH_ENABLED=false). Called per
   * request, so it can return a refreshed token transparently.
   */
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
}

export class UnoverseClient {
  private client: Client;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private cache = new Map<string, UnoverseDefinition>();
  private themeCache = new Map<string, ResolvedTheme>();

  constructor(
    private readonly url: string,
    private readonly options: UnoverseClientOptions = {},
  ) {
    this.client = new Client({ name: "unoverse-core", version: "0.0.1" });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    // Single shared connect — concurrent readDefinition() calls must not each
    // open a transport ("Already connected to a transport").
    if (!this.connecting) {
      this.connecting = (async () => {
        const getToken = this.options.getAccessToken;
        // Inject the bearer on every underlying request (fresh per call → refresh-safe).
        const authFetch = getToken
          ? async (url: string | URL, init?: RequestInit): Promise<Response> => {
              const token = await getToken();
              const headers = new Headers(init?.headers);
              if (token) headers.set("Authorization", `Bearer ${token}`);
              return fetch(url, { ...init, headers });
            }
          : undefined;
        const transport = new StreamableHTTPClientTransport(
          new URL(this.url),
          authFetch ? { fetch: authFetch } : undefined,
        );
        await this.client.connect(transport);
        this.connected = true;
      })().catch((err) => {
        // Don't cache a FAILED connect (e.g. a 401 before sign-in) — clearing
        // `connecting` lets a later call retry fresh once a token is available.
        this.connecting = null;
        throw err;
      });
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

  /**
   * resources/read the RESOLVED theme by name (e.g. "light"). The server owns the
   * values (rx/styles); the SDK only fetches — it bundles no tokens. Cached.
   */
  async readTheme(name = "light"): Promise<ResolvedTheme> {
    const cached = this.themeCache.get(name);
    if (cached) return cached;
    await this.connect();
    const res = await this.client.readResource({ uri: `unoverse://theme/${name}` });
    const first = res.contents[0] as { text?: string };
    if (!first?.text) throw new Error(`No theme content for ${name}`);
    const theme = JSON.parse(first.text) as ResolvedTheme;
    this.themeCache.set(name, theme);
    return theme;
  }

  /** List available theme names (e.g. ["light", "dark"]) from the server. */
  async listThemes(): Promise<string[]> {
    await this.connect();
    const res = await this.client.listResources();
    return res.resources
      .filter((r) => r.uri.startsWith("unoverse://theme/"))
      .map((r) => r.uri.replace("unoverse://theme/", ""));
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

// ---- The single shared state (UNOVERSE_SPEC.md §2e-0) ----
//
// ONE store, ONE subscribe. Two facets of the same object:
//
//   1. DATA     — every component instance keyed `${chatId}:${nodeId}`,
//                 MERGE-not-replace. The live, high-frequency plane.
//   2. TIMELINE — the conversation: an ordered list of turns. An assistant
//                 turn holds POINTERS (the `chatId:nodeId` keys) into the data
//                 plane — never copies. This is what templates read.
//
// The split that makes template-swapping safe: COMPONENT_INIT *places a
// pointer* in the timeline (structure changes once); COMPONENT_DATA only
// merges into the data plane (the timeline never moves). A template reads
// structure, never the stream — so you can swap templates mid-stream and the
// conversation + live data are untouched.

/** A pointer into the data plane — the `${chatId}:${nodeId}` key. */
export type Pointer = string;

export interface UserTurn {
  role: "user";
  id: string;
  chatId: string;
  text: string;
  /** Epoch ms when the turn was created — the renderer formats it (e.g. "just now"). */
  createdAt: number;
}
export interface AssistantTurn {
  role: "assistant";
  id: string;
  chatId: string;
  streamingState: "streaming" | "complete";
  /** Pointers into the data plane (`chatId:nodeId`), in arrival order. NOT copies. */
  components: Pointer[];
  /** Epoch ms when the response opened — the renderer formats it (e.g. "just now"). */
  createdAt: number;
}
export type Turn = UserTurn | AssistantTurn;

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
  // --- data plane ---
  private data = new Map<string, Record<string, unknown>>();
  private types = new Map<string, string>();
  // --- timeline plane (pointers only) ---
  private timeline: Turn[] = [];
  // --- shared ---
  private listeners = new Set<() => void>();
  private version = 0;
  private seq = 0;
  // --- composer draft (shared state so a send button can submit what the input holds) ---
  private draftText = "";
  // --- active template (the workflow-selected MCP app shell; §0.1) ---
  private activeTemplateName: string | null = null;
  private activeTemplateProps: Record<string, unknown> = {};

  // ============ writes ============

  /** The current composer draft (what the input holds). */
  getDraft(): string {
    return this.draftText;
  }
  /** Set the composer draft (input onChange writes here; a send button reads it). */
  setDraft(text: string): void {
    if (this.draftText === text) return;
    this.draftText = text;
    this.bump();
  }

  /** The workflow-selected template (MCP app shell) + its props, or null if the channel picks. */
  getActiveTemplate(): { name: string | null; props: Record<string, unknown> } {
    return { name: this.activeTemplateName, props: this.activeTemplateProps };
  }
  /**
   * Switch the active template (a workflow "render this app" directive — a COMPONENT_INIT
   * marked isTemplate). Templates are SERVED apps, never streamed components (protocol
   * §0.1); this records WHICH app the channel should load, never a timeline component.
   */
  setActiveTemplate(name: string, props: Record<string, unknown> = {}): void {
    if (this.activeTemplateName === name && JSON.stringify(this.activeTemplateProps) === JSON.stringify(props)) return;
    this.activeTemplateName = name;
    this.activeTemplateProps = props;
    this.bump();
  }

  // --- focus plane (Focus Mode): which component is the active interaction surface ---
  private focus: { chatId: string; nodeId: string } | null = null;

  /** The currently focused component pointer (Focus Mode), or null. */
  getFocus(): { chatId: string; nodeId: string } | null {
    return this.focus;
  }
  /**
   * Enter Focus Mode for a component: record it as focused AND flip its `displayState`
   * to "focused" via a local COMPONENT_DATA merge — the def gates its inline/focused
   * views on that field, so the component owns both looks (zero per-component code). A
   * previously-focused component collapses back to "inline". A template reads getFocus()
   * to render the focus container; the connection routes focused messages to this node.
   */
  openFocus(chatId: string, nodeId: string): void {
    if (this.focus && (this.focus.chatId !== chatId || this.focus.nodeId !== nodeId)) {
      this.merge(`${this.focus.chatId}:${this.focus.nodeId}`, { displayState: "inline" });
    }
    this.focus = { chatId, nodeId };
    this.merge(`${chatId}:${nodeId}`, { displayState: "focused" }); // bumps
  }
  /** Exit Focus Mode: collapse the focused component back to "inline" and clear focus. */
  closeFocus(): void {
    if (!this.focus) return;
    const { chatId, nodeId } = this.focus;
    this.focus = null;
    this.merge(`${chatId}:${nodeId}`, { displayState: "inline" }); // bumps (reflects focus=null too)
  }

  /** Apply a streamed event (COMPONENT_INIT or COMPONENT_DATA). */
  apply(event: UnoverseEvent): void {
    const key = `${event.chatId}:${event.nodeId}`;
    if (event.type === "COMPONENT_INIT") {
      this.types.set(key, event.component.type);
      this.placeInTimeline(event.chatId, key); // structure: place the pointer ONCE
      this.merge(key, event.component.props ?? {}); // data: seed
    } else {
      this.merge(key, event.data); // data only — timeline never moves
    }
  }

  /** Append a user message turn. Response identity = its chatId. */
  addUserMessage(chatId: string, text: string): void {
    this.timeline.push({ role: "user", id: `u${this.seq++}`, chatId, text, createdAt: Date.now() });
    this.bump();
  }

  /**
   * Open (or re-open) the assistant response for chatId in streaming state, WITHOUT
   * attaching a component. Mirrors legacy WORKFLOW_STARTED (processWorkflowState.ts):
   * it creates the EMPTY streaming turn so the timeline shows a "thinking" state in
   * the window BEFORE the first component arrives. The first COMPONENT_INIT then
   * reuses this same turn (responseFor matches by chatId). Idempotent.
   */
  startResponse(chatId: string): void {
    const resp = this.responseFor(chatId);
    if (!resp) {
      this.timeline.push({ role: "assistant", id: `a${this.seq++}`, chatId, streamingState: "streaming", components: [], createdAt: Date.now() });
      this.bump();
    } else if (resp.streamingState !== "streaming") {
      resp.streamingState = "streaming";
      this.bump();
    }
  }

  /** Mark the assistant response for this chatId complete (e.g. on workflow-completed). */
  completeResponse(chatId: string): void {
    const resp = this.responseFor(chatId);
    if (resp && resp.streamingState !== "complete") {
      resp.streamingState = "complete";
      this.bump();
    }
  }

  /** Place a component pointer into the open assistant turn for chatId (lazily creating it). */
  private placeInTimeline(chatId: string, key: Pointer): void {
    let resp = this.responseFor(chatId);
    if (!resp) {
      resp = { role: "assistant", id: `a${this.seq++}`, chatId, streamingState: "streaming", components: [], createdAt: Date.now() };
      this.timeline.push(resp);
    }
    if (!resp.components.includes(key)) resp.components.push(key);
    this.bump();
  }

  private responseFor(chatId: string): AssistantTurn | undefined {
    // Response identity is the chatId — all components of one turn share it.
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      const t = this.timeline[i];
      if (t.role === "assistant" && t.chatId === chatId) return t;
    }
    return undefined;
  }

  private merge(key: string, patch: Record<string, unknown>): void {
    // merge-not-replace
    this.data.set(key, { ...(this.data.get(key) ?? {}), ...patch });
    this.bump();
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // ============ reads — data plane (unchanged API; streamed.tsx depends on these) ============

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

  // ============ reads — timeline plane (what templates iterate) ============

  /** The full conversation, in order. */
  getTimeline(): readonly Turn[] {
    return this.timeline;
  }
  /** Just the assistant responses, in order. */
  getResponses(): AssistantTurn[] {
    return this.timeline.filter((t): t is AssistantTurn => t.role === "assistant");
  }
  /** The most recent assistant response (KeyService-style single-response layouts). */
  latestResponse(): AssistantTurn | undefined {
    const r = this.getResponses();
    return r[r.length - 1];
  }
  /** Resolve a pointer back to its parts (for handing to the leaf renderer). */
  split(pointer: Pointer): { chatId: string; nodeId: string } {
    const i = pointer.indexOf(":");
    return { chatId: pointer.slice(0, i), nodeId: pointer.slice(i + 1) };
  }
  /** Type of the component a pointer refers to (for filter-by-type in templates). */
  typeOf(pointer: Pointer): string | undefined {
    return this.types.get(pointer);
  }
}
