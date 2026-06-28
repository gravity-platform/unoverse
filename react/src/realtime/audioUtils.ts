/**
 * Audio utility functions for PCM conversion and processing.
 * Ported verbatim from gravity-client/src/realtime/audioUtils.ts (the proven,
 * live implementation). Only the two helpers the continuous-capture path uses.
 */

/**
 * Convert Float32Array audio (range -1..1, from the Web Audio API) to Int16Array
 * PCM (16-bit signed).
 */
export function float32ToInt16(float32Audio: Float32Array): Int16Array {
  const int16Data = new Int16Array(float32Audio.length);
  for (let i = 0; i < float32Audio.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Audio[i]));
    int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Data;
}

/**
 * Downsample a Float32 PCM frame from `fromRate` to `toRate` using linear
 * interpolation. Returns the source frame unchanged if rates already match.
 *
 * Mic capture picks the native device rate (typically 44100 / 48000 Hz) and the
 * realtime LLM expects 16000 Hz.
 */
export function downsampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIdx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}
