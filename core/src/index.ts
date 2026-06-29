/**
 * @unoverse/core — framework-agnostic brain. Public barrel.
 *
 * The implementation is split into focused modules:
 *   - ./types       neutral definition shape + interaction vocab + resolved-theme shape
 *   - ./client      the MCP client (reads definitions + theme)
 *   - ./store       the single shared state + interaction state machines
 *   - ./connection  data-plane translation (server message → store)
 *   - ./actions     the action interpreter (§2e-3)
 * No UI framework here; the React binding lives in @gravity-platform/unoverse-react.
 */

export * from "./types";
export * from "./client";
export * from "./store";

// Data-plane translation layer (pure event→store mapping; channel-owned connection).
export {
  applyServerMessage,
  type ServerMessage,
  type ServerComponentInit,
  type ServerComponentData,
  type ServerWorkflowState,
  type ServerSessionReady,
  type ServerTemplateData,
} from "./connection";

// The action interpreter (§2e-3) — local `setValue` store write + server route.
export { dispatchAction, resolveValue, type ActionContext } from "./actions";
