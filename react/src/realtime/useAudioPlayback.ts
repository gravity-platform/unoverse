/**
 * useAudioPlayback — LPCM audio playback with timeline-based scheduling.
 *
 * Web Audio API for low-latency playback and accurate timing. Audio format from
 * the server (Nova / Grok): LPCM Int16, 24 kHz, mono.
 *
 * Ported from gravity-client/src/realtime/useAudioPlayback.ts (the proven, live
 * implementation), trimmed to the surface the `voice` service uses.
 */

import { useRef, useCallback, useEffect, useState } from "react";

/** Decode LPCM (Int16, 24 kHz, mono) → AudioBuffer. */
function decodeLPCM(audioContext: AudioContext, data: ArrayBuffer): AudioBuffer {
  const sampleRate = 24000;
  const int16 = new Int16Array(data);
  const numSamples = int16.length;
  const audioBuffer = audioContext.createBuffer(1, numSamples, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < numSamples; i++) channelData[i] = int16[i] / 32768;
  return audioBuffer;
}

export interface UseAudioPlaybackReturn {
  playAudio: (audioData: ArrayBuffer) => void;
  stopAll: () => void;
  isPlaying: boolean;
  /** Mark that no more chunks are coming — isPlaying clears when the last finishes. */
  markAsLastChunk: () => void;
}

interface QueuedAudio {
  audioData: ArrayBuffer;
}

export function useAudioPlayback(): UseAudioPlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const queueRef = useRef<QueuedAudio[]>([]);
  const nextTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const hasStartedRef = useRef(false);
  const isLastChunkRef = useRef(false);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    if (queueRef.current.length === 0) return;

    isProcessingRef.current = true;
    const audioContext = getAudioContext();
    const gainNode = gainNodeRef.current!;

    while (queueRef.current.length > 0) {
      const item = queueRef.current.shift()!;
      try {
        const audioBuffer = decodeLPCM(audioContext, item.audioData);
        const now = audioContext.currentTime;
        const startTime = Math.max(now, nextTimeRef.current);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode);
        activeSourcesRef.current.add(source);

        if (!hasStartedRef.current) {
          hasStartedRef.current = true;
          setIsPlaying(true);
        }

        source.start(startTime);
        nextTimeRef.current = startTime + audioBuffer.duration;

        source.onended = () => {
          activeSourcesRef.current.delete(source);
          if (isLastChunkRef.current && activeSourcesRef.current.size === 0 && queueRef.current.length === 0) {
            setIsPlaying(false);
            hasStartedRef.current = false;
            isLastChunkRef.current = false;
          }
        };
      } catch (error) {
        console.error("[AudioPlayback] Failed to decode audio:", error);
      }
    }

    isProcessingRef.current = false;
  }, [getAudioContext]);

  const playAudio = useCallback(
    (audioData: ArrayBuffer) => {
      queueRef.current.push({ audioData });
      processQueue();
    },
    [processQueue],
  );

  const stopAll = useCallback(() => {
    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    });
    activeSourcesRef.current.clear();
    queueRef.current = [];
    nextTimeRef.current = 0;
    hasStartedRef.current = false;
    isProcessingRef.current = false;
    isLastChunkRef.current = false;
    setIsPlaying(false);
  }, []);

  const markAsLastChunk = useCallback(() => {
    isLastChunkRef.current = true;
    if (activeSourcesRef.current.size === 0 && queueRef.current.length === 0 && hasStartedRef.current) {
      setIsPlaying(false);
      hasStartedRef.current = false;
      isLastChunkRef.current = false;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopAll();
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [stopAll]);

  return { playAudio, stopAll, isPlaying, markAsLastChunk };
}
