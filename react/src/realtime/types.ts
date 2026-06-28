/**
 * Shared types for realtime audio streaming.
 *
 * Ported verbatim from gravity-client/src/realtime/types.ts (the proven, live
 * implementation) — the Unoverse `voice` native service reuses the same audio
 * lane (`/ws/gravity`) and the same control-channel AUDIO_STATE vocabulary, so
 * the contract is identical. See docs/VOICE_STREAMING_GUIDE.md.
 */

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "ended";

/**
 * Control-channel audio state events emitted by the server, in lockstep with the
 * audio frames on the SAME WS lane (they are the control half of the live-audio
 * conversation — NOT component/UI data; they never ride the MCP stream).
 */
export type AudioState =
  | "SESSION_READY"
  | "SESSION_ENDED"
  | "SPEECH_STARTED"
  | "SPEECH_ENDED"
  | "USER_SPEECH_STARTED"
  | "USER_SPEECH_ENDED"
  | "TOOL_USE"
  | "TOOL_USE_COMPLETED";

export interface AudioStateMessage {
  type: "audioState";
  state: AudioState;
  metadata?: Record<string, unknown>;
}

export interface ControlMessage {
  type: string;
  state?: AudioState;
  audioState?: AudioState;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AudioStateEvent {
  state: AudioState;
  metadata?: Record<string, unknown>;
  message?: string;
}
