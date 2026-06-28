/**
 * useVoiceService — the Unoverse `voice` NATIVE SERVICE (UNOVERSE_SPEC §2e-1 Tier-3).
 *
 * Audio I/O is inherently native (getUserMedia / AudioContext / the /ws/gravity WS
 * lane), so it cannot be expressed as definition data — it is the spec's sanctioned
 * escape hatch: a fixed `{ state, actions }` capability the SDK provides and a template
 * REFERENCES (`service: "voice"`), binding its neutral state + dispatching its actions.
 *
 * This composes the ported realtime hooks (capture / playback / the WS audio lane) +
 * the orchestration from the legacy useVoiceCall + useAudioContext into ONE neutral
 * projection. The channel spreads `state` into the template's data scope and routes the
 * voice action names to the actions — see the workbench wiring. The SDK owns NO styles
 * and exposes only NEUTRAL model facts here (never UX flags).
 *
 * Transport split (docs/UNOVERSE_MCP_TEMPLATE_PROTOCOL §5): the live PCM frames AND the
 * synchronized audio-state control events both ride the /ws/gravity WS lane (they stay
 * frame-synchronized); only structured component data is on MCP, untouched by voice.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRealtimeWebSocket } from "./realtime/useRealtimeWebSocket";
import { useAudioCapture } from "./realtime/useAudioCapture";
import { useAudioPlayback } from "./realtime/useAudioPlayback";
import type { AudioStateEvent } from "./realtime/types";

export type VoiceConnectionStatus = "idle" | "connecting" | "connected" | "ended" | "error";

export interface VoiceSession {
  userId: string;
  conversationId: string;
  chatId?: string;
  workflowId: string;
  targetTriggerNode: string;
}

export interface UseVoiceServiceConfig {
  /** Gateway REST base, e.g. http://localhost:4100 (the workflow `…/execute` host). */
  apiUrl: string;
  /** Audio WS base, e.g. ws://localhost:4100. Defaults to `apiUrl` with http→ws. */
  wsUrl?: string;
  /** Fresh access token provider (rides the WS lane + the REST Authorization header). */
  getAccessToken?: () => Promise<string | null> | string | null;
  session: VoiceSession;
}

/** NEUTRAL voice projections — flat, so the channel can spread them into the template scope. */
export interface VoiceServiceState {
  connectionStatus: VoiceConnectionStatus;
  isIdle: boolean;
  isCallActive: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  isAssistantSpeaking: boolean;
  isUserSpeaking: boolean;
  /** user speaking AND assistant not — mutual exclusion (the template can't express NOT). */
  showUserSpeaking: boolean;
  isMuted: boolean;
  isLookingUp: boolean;
  lookupLabel: string;
  callDuration: number;
  durationText: string;
  statusText: string;
  error: string | null;
}

export interface VoiceService {
  /** Spread into the template's data scope (channel overrides → rootData). */
  state: VoiceServiceState;
  startCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function useVoiceService(config: UseVoiceServiceConfig): VoiceService {
  const { apiUrl, session, getAccessToken } = config;
  const wsUrl = config.wsUrl ?? apiUrl.replace(/^http/, "ws");

  const [connectionStatus, setConnectionStatus] = useState<VoiceConnectionStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [assistantHint, setAssistantHint] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupTool, setLookupTool] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendAudioRef = useRef<(d: ArrayBuffer) => void>(() => {});

  const playback = useAudioPlayback();

  // Audio-state events arrive on the WS lane, in lockstep with the frames.
  const handleAudioState = useCallback(
    (event: AudioStateEvent) => {
      const { state, metadata } = event;
      if (state === "SPEECH_STARTED") {
        setAssistantHint(true);
      } else if (state === "SPEECH_ENDED") {
        setAssistantHint(false);
        playback.markAsLastChunk();
      } else if (state === "USER_SPEECH_STARTED") {
        setUserSpeaking(true);
        playback.stopAll(); // barge-in: cut assistant playback the moment the user speaks
      } else if (state === "USER_SPEECH_ENDED") {
        setUserSpeaking(false);
      } else if (state === "SESSION_READY") {
        setConnectionStatus("connected");
      } else if (state === "SESSION_ENDED") {
        setConnectionStatus("ended");
        setAssistantHint(false);
        setUserSpeaking(false);
        playback.markAsLastChunk();
      } else if (state === "TOOL_USE") {
        setIsLookingUp(true);
        setLookupTool((metadata?.toolName as string | undefined) ?? null);
      } else if (state === "TOOL_USE_COMPLETED") {
        setIsLookingUp(false);
        setLookupTool(null);
      }
    },
    [playback],
  );

  const ws = useRealtimeWebSocket({
    sessionId: session.conversationId,
    userId: session.userId,
    chatId: session.chatId,
    wsUrl,
    getAccessToken,
    onAudioReceived: playback.playAudio,
    onAudioState: handleAudioState,
  });

  // Capture → WS via a ref so the capture graph isn't rebuilt when sendAudio changes.
  const handleAudioData = useCallback((d: ArrayBuffer) => sendAudioRef.current(d), []);
  useEffect(() => {
    sendAudioRef.current = ws.sendAudio;
  }, [ws.sendAudio]);

  const capture = useAudioCapture({ onAudioData: handleAudioData });

  const startCall = useCallback(async () => {
    setConnectionStatus("connecting");
    setError(null);
    setCallDuration(0);
    try {
      // 1. Open the audio lane (sends INIT_SESSION on open) BEFORE the trigger,
      //    so the server can route audio the moment the Nova/Grok session is up.
      await ws.connect();

      // 2. START_CALL via REST — fire-and-forget; the workflow stays open for the call.
      const token = getAccessToken ? await getAccessToken() : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const chatId = session.chatId ?? `voice_${session.conversationId}`;
      fetch(`${apiUrl}/api/workflows/${session.workflowId}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: {
            message: "Start call",
            chatId,
            conversationId: session.conversationId,
            userId: session.userId,
            providerId: "gravity-voice",
            isAudio: true,
            metadata: {
              targetTriggerNode: session.targetTriggerNode,
              action: "START_CALL",
              isAction: true,
              workflowId: session.workflowId,
              continuousStream: true,
            },
          },
          conversationId: session.conversationId,
        }),
      }).catch((e) => console.error("[voice] START_CALL error:", e));

      // 3. Start streaming the mic.
      await capture.startCapture();
      timerRef.current = setInterval(() => setCallDuration((p) => p + 1), 1000);
      setConnectionStatus("connected");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start call");
      setConnectionStatus("error");
    }
  }, [ws, capture, apiUrl, session, getAccessToken]);

  const endCall = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    await capture.stopCapture();
    playback.stopAll();
    // END via WS control — NOT a new REST execute (that would start a new workflow).
    ws.sendControl("AUDIO_CONTROL", { command: "stop", workflowId: session.workflowId });
    ws.disconnect();
    setConnectionStatus("ended");
    setIsMuted(false);
  }, [capture, playback, ws, session.workflowId]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      capture.setMuted(next);
      return next;
    });
  }, [capture]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      ws.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAssistantSpeaking = assistantHint || playback.isPlaying;
  const isUserSpeaking = userSpeaking || capture.isSpeaking;
  const isCallActive = connectionStatus === "connecting" || connectionStatus === "connected";
  const lookupLabel =
    lookupTool === "findIntent" ? "Searching the knowledge base…" : `Looking up ${lookupTool ?? "information"}…`;
  const durationText = formatDuration(callDuration);
  const statusText =
    connectionStatus === "idle"
      ? "Ready to call"
      : connectionStatus === "connecting"
        ? "Connecting…"
        : connectionStatus === "connected"
          ? durationText
          : connectionStatus === "error"
            ? (error ?? "Connection error")
            : "Call ended";

  const state: VoiceServiceState = useMemo(
    () => ({
      connectionStatus,
      isIdle: !isCallActive,
      isCallActive,
      isConnecting: connectionStatus === "connecting",
      isConnected: connectionStatus === "connected",
      isAssistantSpeaking,
      isUserSpeaking,
      showUserSpeaking: isUserSpeaking && !isAssistantSpeaking,
      isMuted,
      isLookingUp,
      lookupLabel,
      callDuration,
      durationText,
      statusText,
      error: error ?? capture.error ?? null,
    }),
    [
      connectionStatus,
      isCallActive,
      isAssistantSpeaking,
      isUserSpeaking,
      isMuted,
      isLookingUp,
      lookupLabel,
      callDuration,
      durationText,
      statusText,
      error,
      capture.error,
    ],
  );

  return { state, startCall, endCall, toggleMute };
}
