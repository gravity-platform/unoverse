/**
 * @unoverse/core — the single shared state (UNOVERSE_SPEC.md §2e-0).
 *
 * ONE store, ONE subscribe. Framework-agnostic (NO Zustand/XState) so it ports to
 * every platform; the React binding is `useSyncExternalStore` in the react package.
 * Two facets of the same object:
 *
 *   1. DATA     — every component instance keyed `${chatId}:${nodeId}`,
 *                 MERGE-not-replace. The live, high-frequency plane.
 *   2. TIMELINE — the conversation: an ordered list of turns. An assistant
 *                 turn holds POINTERS (the `chatId:nodeId` keys) into the data
 *                 plane — never copies. This is what templates read.
 *
 * Plus a generic TEMPLATE-STATE bag (`templateState`) + `lifecycle` (derived from the
 * conversation) + `draft` (the shared composer buffer). The SDK hardcodes NO UI concept —
 * disclosure/focus/etc. are keys the dev writes via the `setValue` (component) or
 * `setTemplateValue` (template) actions and reads via `visibleWhen`. (Voice is a native
 * SERVICE — WS audio lane, react package — whose call state a producer merges into
 * template state, per UNOVERSE_SPEC §2e-1. The store holds structured state only.)
 *
 * The split that makes template-swapping safe: COMPONENT_INIT *places a pointer* in
 * the timeline (structure changes once); COMPONENT_DATA only merges into the data
 * plane (the timeline never moves). A template reads structure, never the stream — so
 * you can swap templates mid-stream and the conversation + live data are untouched.
 */

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

/** Lifecycle machine states (the workflow turn's status). */
export type LifecycleState = "idle" | "thinking" | "streaming" | "complete" | "error";

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
  // --- active template (the workflow-selected MCP app shell; §0.1) ---
  private activeTemplateName: string | null = null;
  private activeTemplateProps: Record<string, unknown> = {};
  // --- template state: the active template's OWN generic bag (UNOVERSE_STATE_MODEL §2).
  //     draft / suggestions / openPanel / focusedId / voice call state all live here as
  //     plain keys — core knows NO key names. Replace/merge only (O(1), never append). ---
  private templateState: Record<string, unknown> = {};
  // --- history cap (UNOVERSE_STATE_MODEL §6a): hold at most N turns, oldest-out-first. ---
  private maxTurns: number;

  /** @param opts.maxTurns history cap (default 100; §6a). Channels may raise/lower it. */
  constructor(opts?: { maxTurns?: number }) {
    this.maxTurns = opts?.maxTurns ?? 100;
  }

  // ============ writes ============

  /** The current composer draft (a key in template state). */
  getDraft(): string {
    return (this.templateState.draft as string) ?? "";
  }
  /** Set the composer draft (input onChange writes here; a send button reads it). */
  setDraft(text: string): void {
    if (this.getDraft() === text) return;
    this.mergeTemplateState({ draft: text });
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

  /** The active template's state bag (templates read this into their root scope). */
  getTemplateState(): Readonly<Record<string, unknown>> {
    return this.templateState;
  }
  /** Merge a patch into template state (replace/merge — never append, stays O(1)). */
  mergeTemplateState(patch: Record<string, unknown>): void {
    this.templateState = { ...this.templateState, ...patch };
    this.bump();
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  STATE HAS TWO HOMES, BY SCOPE (UNOVERSE_STATE_MODEL §2) — and the SDK hardcodes
  //  NO UI concept (no panel / focus / faq / voice). The dev picks the key and the home:
  //   • COMPONENT state — a component's own data + view state (tab / edit / wizard-step /
  //     displayState / …), keyed by its id, written via the `setValue` action (data plane).
  //   • TEMPLATE state — the active template's own bag (`templateState`), written via the
  //     `setTemplateValue` action (or `mergeTemplateState` from a producer). Just keys.
  //  `lifecycle` is the one thing that is NEITHER: it's READ OFF the conversation (the turn's
  //  streaming/complete status), so it stays a tiny derived machine here. `draft` is the one
  //  named convenience (the shared composer buffer the channel reads to send).
  //  (Voice is a NATIVE SERVICE — WS audio lane, react package — whose call state a producer
  //   merges into template state. Not a store machine.)
  //  ⛔ Do NOT add a UI-pattern method here (togglePanel/openFocus/…). It's a key the dev
  //     writes via setValue / setTemplateValue and reads via `visibleWhen`. Removed twice.
  // ════════════════════════════════════════════════════════════════════════════

  // --- lifecycle: the workflow turn's status (derived from WORKFLOW_STATE) ---
  private lifecycleState: LifecycleState = "idle";

  /** The conversation lifecycle status. */
  getLifecycle(): LifecycleState {
    return this.lifecycleState;
  }
  /** Move the lifecycle machine to a status (idempotent). */
  setLifecycle(s: LifecycleState): void {
    if (this.lifecycleState === s) return;
    this.lifecycleState = s;
    this.bump();
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
    this.evict();
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
      this.evict();
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
      this.evict();
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

  /** Trim the timeline to the last `maxTurns`, deleting the component slices the dropped
   *  turns pointed at so the data/types maps can't leak (UNOVERSE_STATE_MODEL §6a). */
  private evict(): void {
    while (this.timeline.length > this.maxTurns) {
      const dropped = this.timeline.shift();
      if (dropped?.role === "assistant") {
        for (const ptr of dropped.components) {
          this.data.delete(ptr);
          this.types.delete(ptr);
        }
      }
    }
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
