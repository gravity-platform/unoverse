/**
 * useRealtimeWebSocket — binary WebSocket for real-time audio streaming.
 *
 * Bidirectional audio over the `/ws/gravity` lane: sends binary PCM Int16 16 kHz
 * up, receives binary LPCM Int16 24 kHz back, plus JSON control messages for
 * audio-state events. This is the ONLY remaining WS use (docs/VOICE_STREAMING_GUIDE);
 * the audio-state control events ride this lane WITH the frames so they stay
 * frame-synchronized — they never go on the MCP component stream.
 *
 * Ported verbatim from gravity-client/src/realtime/useRealtimeWebSocket.ts — it is
 * already self-contained (no dependency on the legacy unified client), which is why
 * the Unoverse `voice` service can own it directly.
 */

import { useCallback, useRef, useState, useEffect } from "react";
import type { ControlMessage, AudioStateEvent } from "./types";

export interface UseRealtimeWebSocketOptions {
  /** Conversation ID for the WebSocket session. */
  sessionId: string;
  userId?: string;
  chatId?: string;
  /** WebSocket base URL (e.g. ws://localhost:4100). Defaults to current origin. */
  wsUrl?: string;
  /** Function to get a fresh access token (called on each connect). */
  getAccessToken?: () => Promise<string | null> | string | null;
  onAudioReceived?: (audioData: ArrayBuffer) => void;
  onConnectionChange?: (connected: boolean) => void;
  onControlMessage?: (message: ControlMessage) => void;
  onAudioState?: (event: AudioStateEvent) => void;
}

export interface UseRealtimeWebSocketReturn {
  isConnected: boolean;
  sendAudio: (audioData: ArrayBuffer) => void;
  sendControl: (type: string, data?: Record<string, unknown>) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useRealtimeWebSocket(options: UseRealtimeWebSocketOptions): UseRealtimeWebSocketReturn {
  const { sessionId, userId, chatId, wsUrl, getAccessToken, onAudioReceived, onConnectionChange, onControlMessage, onAudioState } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const getWsUrl = useCallback(async () => {
    let baseUrl: string;
    if (wsUrl) {
      baseUrl = `${wsUrl}/ws/gravity`;
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      baseUrl = `${protocol}//${window.location.host}/ws/gravity`;
    }
    let token: string | null = null;
    if (getAccessToken) {
      try {
        token = await getAccessToken();
      } catch (error) {
        console.warn("[RealtimeWebSocket] Failed to get access token:", error);
      }
    }
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  }, [wsUrl, getAccessToken]);

  const connect = useCallback(async (): Promise<void> => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
      });
    }

    const url = await getWsUrl();
    console.log("[RealtimeWebSocket] Connecting to:", url.replace(/token=[^&]+/, "token=***"));

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";

      const timeout = setTimeout(() => reject(new Error("WebSocket connection timeout")), 10000);

      ws.onopen = () => {
        clearTimeout(timeout);
        const initMessage = {
          type: "INIT_SESSION",
          conversationId: sessionId,
          userId: userId || "anonymous",
          chatId: chatId || `chat_${sessionId}`,
        };
        ws.send(JSON.stringify(initMessage));
        setIsConnected(true);
        onConnectionChange?.(true);
        resolve();
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          onAudioReceived?.(event.data);
        } else {
          try {
            const message: ControlMessage = JSON.parse(event.data as string);
            onControlMessage?.(message);
            // Only honour control-channel state events (`message.state`).
            // `message.audioState` is per-chunk metadata on audio publishes.
            if (message.state && onAudioState) {
              onAudioState({ state: message.state, metadata: message.metadata });
            }
          } catch (error) {
            console.error("[RealtimeWebSocket] Failed to parse control message:", error);
          }
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        console.error("[RealtimeWebSocket] Error:", error);
        reject(error);
      };

      ws.onclose = () => {
        setIsConnected(false);
        onConnectionChange?.(false);
      };

      wsRef.current = ws;
    });
  }, [getWsUrl, sessionId, userId, chatId, onAudioReceived, onConnectionChange, onControlMessage, onAudioState]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendAudio = useCallback((audioData: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(audioData);
    }
  }, []);

  const sendControl = useCallback((type: string, data?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }));
    }
  }, []);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { isConnected, sendAudio, sendControl, connect, disconnect };
}
