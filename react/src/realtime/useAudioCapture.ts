/**
 * useAudioCapture — continuous microphone capture for full-duplex voice.
 *
 * Streams raw mic audio continuously while a call is active. The remote provider
 * (Grok / Nova) handles VAD server-side, so we don't gate locally. Audio is
 * downsampled to 16 kHz mono Int16 PCM and emitted in ~80 ms chunks via
 * `onAudioData`.
 *
 * Ported verbatim from gravity-client/src/realtime/useAudioCapture.ts (the proven,
 * live implementation) — the Unoverse `voice` service reuses it unchanged.
 */

import { useRef, useCallback, useEffect, useState } from "react";
import { float32ToInt16, downsampleFloat32 } from "./audioUtils";

const TARGET_SAMPLE_RATE = 16000;
// ~80 ms of audio at 16 kHz: 1280 samples
const CHUNK_SAMPLES = 1280;

export interface UseAudioCaptureOptions {
  /** Callback when an audio chunk is captured (PCM Int16 16 kHz mono ArrayBuffer) */
  onAudioData?: (audioData: ArrayBuffer) => void;
  /** Whether to mute capture. Defaults to false — full-duplex barge-in. */
  isMuted?: boolean;
}

export interface UseAudioCaptureReturn {
  startCapture: () => Promise<{ success: boolean; reason?: string }>;
  stopCapture: () => Promise<{ success: boolean; reason?: string }>;
  toggleCapture: () => Promise<{ success: boolean; reason?: string }>;
  /** Manually mute / unmute outgoing mic frames (keeps the stream open) */
  setMuted: (muted: boolean) => void;
  isCapturing: boolean;
  /** Server-driven (Grok / Nova VAD); updated externally via onAudioState. */
  isSpeaking: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useAudioCapture(options: UseAudioCaptureOptions = {}): UseAudioCaptureReturn {
  const { onAudioData, isMuted = false } = options;

  const [isCapturing, setIsCapturing] = useState(false);
  const [isSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const scriptRef = useRef<ScriptProcessorNode | null>(null);
  const onAudioDataRef = useRef(onAudioData);
  const isMutedRef = useRef(isMuted);
  const pendingRef = useRef<number[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    onAudioDataRef.current = onAudioData;
  }, [onAudioData]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const setMuted = useCallback((muted: boolean) => {
    isMutedRef.current = muted;
  }, []);

  // Convert a Float32 frame at the source sample rate to 16 kHz Int16 chunks and
  // emit them via onAudioData. Frames accumulate until we have at least
  // CHUNK_SAMPLES at 16 kHz, then flush.
  const handleFrame = useCallback((frame: Float32Array, fromRate: number) => {
    if (isMutedRef.current) return;
    const cb = onAudioDataRef.current;
    if (!cb) return;

    const downsampled = fromRate === TARGET_SAMPLE_RATE ? frame : downsampleFloat32(frame, fromRate, TARGET_SAMPLE_RATE);

    const pending = pendingRef.current;
    for (let i = 0; i < downsampled.length; i++) pending.push(downsampled[i]);

    while (pending.length >= CHUNK_SAMPLES) {
      const chunk = new Float32Array(pending.splice(0, CHUNK_SAMPLES));
      const int16 = float32ToInt16(chunk);
      const buf = int16.buffer.slice(int16.byteOffset, int16.byteOffset + int16.byteLength) as ArrayBuffer;
      cb(buf);
    }
  }, []);

  const teardownGraph = useCallback(async () => {
    try {
      if (workletRef.current) {
        workletRef.current.port.onmessage = null;
        workletRef.current.disconnect();
        workletRef.current = null;
      }
      if (scriptRef.current) {
        scriptRef.current.onaudioprocess = null;
        scriptRef.current.disconnect();
        scriptRef.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        await audioContextRef.current.close();
      }
      audioContextRef.current = null;
      pendingRef.current = [];
    } catch (err) {
      console.warn("[AudioCapture] teardown error:", err);
    }
  }, []);

  const startCapture = useCallback(async (): Promise<{ success: boolean; reason?: string }> => {
    if (isCapturing || streamRef.current) {
      return { success: true };
    }

    setIsLoading(true);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const AudioContextClass = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const audioContext: AudioContext = new (AudioContextClass as typeof AudioContext)();
      audioContextRef.current = audioContext;
      const fromRate = audioContext.sampleRate;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Prefer AudioWorklet (modern). Fall back to ScriptProcessor.
      let usedWorklet = false;
      if (audioContext.audioWorklet) {
        try {
          const workletCode = `
            class CaptureProcessor extends AudioWorkletProcessor {
              process(inputs) {
                const ch = inputs[0] && inputs[0][0];
                if (ch && ch.length) {
                  this.port.postMessage(new Float32Array(ch));
                }
                return true;
              }
            }
            registerProcessor('gravity-capture-processor', CaptureProcessor);
          `;
          const blob = new Blob([workletCode], { type: "application/javascript" });
          const url = URL.createObjectURL(blob);
          await audioContext.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);

          const node = new AudioWorkletNode(audioContext, "gravity-capture-processor");
          node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
            handleFrame(ev.data, fromRate);
          };
          source.connect(node);
          // The worklet must connect to destination to keep ticking; route through a
          // muted gain so the mic is not played back.
          const sink = audioContext.createGain();
          sink.gain.value = 0;
          node.connect(sink).connect(audioContext.destination);
          workletRef.current = node;
          usedWorklet = true;
        } catch (err) {
          console.warn("[AudioCapture] AudioWorklet unavailable, falling back to ScriptProcessor:", err);
        }
      }

      if (!usedWorklet) {
        const bufferSize = 4096;
        const node = audioContext.createScriptProcessor(bufferSize, 1, 1);
        node.onaudioprocess = (ev) => {
          const ch = ev.inputBuffer.getChannelData(0);
          handleFrame(new Float32Array(ch), fromRate);
        };
        source.connect(node);
        const sink = audioContext.createGain();
        sink.gain.value = 0;
        node.connect(sink).connect(audioContext.destination);
        scriptRef.current = node;
      }

      if (isMountedRef.current) {
        setIsCapturing(true);
        setIsLoading(false);
      }
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[AudioCapture] Failed to start:", err);
      if (isMountedRef.current) {
        setError(msg);
        setIsLoading(false);
      }
      await teardownGraph();
      return { success: false, reason: msg };
    }
  }, [isCapturing, handleFrame, teardownGraph]);

  const stopCapture = useCallback(async (): Promise<{ success: boolean; reason?: string }> => {
    if (!streamRef.current && !audioContextRef.current) {
      return { success: false, reason: "not_running" };
    }
    await teardownGraph();
    if (isMountedRef.current) {
      setIsCapturing(false);
    }
    return { success: true };
  }, [teardownGraph]);

  const toggleCapture = useCallback(async () => {
    if (isCapturing) return await stopCapture();
    return await startCapture();
  }, [isCapturing, startCapture, stopCapture]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      teardownGraph();
    };
  }, [teardownGraph]);

  return { startCapture, stopCapture, toggleCapture, setMuted, isCapturing, isSpeaking, isLoading, error };
}
