/**
 * Front-desk room tone for phone calls, so Sarah sounds like she's on an open
 * line at a real desk instead of in a dead-silent studio. Off by default,
 * enabled per center.
 *
 * The loop — prefers a REAL office recording dropped in at
 * `src/assets/room-tone.ulaw` (raw 8 kHz mono G.711 μ-law, no header) for
 * genuine texture; falls back to a procedural "office air" tone when no file
 * is present, so the feature always works. To add a recording, convert any
 * clip (ideally 20-60 s of steady office ambience) with ffmpeg:
 *
 *   ffmpeg -i office.wav -ac 1 -ar 8000 -f mulaw \
 *     apps/api-gateway/src/assets/room-tone.ulaw
 *
 * Realism model — a real phone mic is always open, so the caller hears the
 * room continuously: under the agent's voice, in her pauses, and even while
 * they themselves speak. The bridge keeps ONE continuous ambience timeline
 * per call: agent audio deltas get the tone mixed in, and the gaps between
 * them are filled with paced pure-tone frames (see twilio.ts). Gating the
 * tone on and off with speech would produce the classic walkie-talkie
 * artifact — the opposite of a real call. This module changes only the audio
 * bytes sent to the caller, never the call/transfer flow.
 *
 * Quality — G.711 μ-law decode → mix → encode happens exactly once per frame.
 * The codec's decode/encode round trip is bit-exact for unmodified samples,
 * and mixing adds at most half a quantization step of error, below the noise
 * floor μ-law itself already has (~38 dB SNR). Nothing is resampled.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BIAS = 0x84;
const CLIP = 32635;
const RATE = 8000;

/** How far the room tone drops while the agent is actually speaking. Real
 *  desks, broadcast, and other realtime voice bots all "duck" background under
 *  the voice: full level fills the pauses, a lower level rides under speech so
 *  it never masks her words or feeds the caller's echo back into Grok's VAD. */
const DUCK = 0.55;

/** G.711 μ-law byte → linear PCM16. */
function muLawToLinear(u: number): number {
  const v = ~u & 0xff;
  const sign = v & 0x80;
  const exponent = (v >> 4) & 0x07;
  const mantissa = v & 0x0f;
  const sample = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -sample : sample;
}

/** Linear PCM16 → G.711 μ-law byte. */
function linearToMuLaw(input: number): number {
  let sample = input;
  let sign = 0;
  if (sample < 0) {
    sample = -sample;
    sign = 0x80;
  }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Peak-normalize float samples into a seamless Int16 loop: the first `fade`
 *  samples crossfade with the tail so the wrap is inaudible, and the whole
 *  thing is scaled to 16-bit full scale so a caller-facing gain of ~0.08
 *  lands around -22 dBFS — barely there. Shared by the procedural tone and
 *  the real recording. */
function sealLoop(samples: Float32Array, fade: number): Int16Array {
  const len = samples.length - fade;
  let peak = 1e-6;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!);
    if (a > peak) peak = a;
  }
  const norm = 32767 / peak;
  const out = new Int16Array(len);
  for (let i = fade; i < len; i++) out[i] = Math.round(samples[i]! * norm);
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = Math.round((samples[i]! * w + samples[len + i]! * (1 - w)) * norm);
  }
  return out;
}

/** A seamless 24 s "office air" loop at 8 kHz — band-shaped noise (HVAC-like
 *  hiss plus a little low body) with slow, loop-aligned level drift so the
 *  room breathes instead of hissing like static. The energy sits in the
 *  200–2000 Hz band the narrowband phone path actually reproduces; a pure
 *  sub-100 Hz rumble would be inaudible mud through a handset. The fallback
 *  when no real recording is present. */
function buildProceduralLoop(): Int16Array {
  const seconds = 24;
  const fade = 400;
  const len = seconds * RATE;
  const gen = new Float32Array(len + fade);

  // One-pole coefficients, tuned for the 8 kHz narrowband path.
  const air = 1 - Math.exp((-2 * Math.PI * 1200) / RATE);
  const hpA = Math.exp((-2 * Math.PI * 180) / RATE);
  const bodyK = 1 - Math.exp((-2 * Math.PI * 120) / RATE);

  const tau = 2 * Math.PI;
  let lp1 = 0;
  let lp2 = 0;
  let hp = 0;
  let hpPrev = 0;
  let body = 0;
  for (let i = 0; i < gen.length; i++) {
    const white = Math.random() * 2 - 1;
    lp1 += air * (white - lp1);
    lp2 += air * (lp1 - lp2);
    hp = hpA * (hp + lp2 - hpPrev);
    hpPrev = lp2;
    body += bodyK * (white - body);
    // Slow swell: 3 and 7 whole cycles per loop, so the wrap stays in phase.
    const t = i / len;
    const drift = 1 + 0.22 * Math.sin(tau * 3 * t + 0.7) + 0.13 * Math.sin(tau * 7 * t + 2.1);
    gen[i] = (hp + 0.6 * body) * drift;
  }
  return sealLoop(gen, fade);
}

/** Load a real office recording from `src/assets/room-tone.ulaw` (raw 8 kHz
 *  mono μ-law) if present, decode it to PCM, and seal it into a gapless loop.
 *  Returns null when there is no usable file, so we fall back to procedural. */
function loadRealLoop(): Int16Array | null {
  const path = join(import.meta.dir, "assets", "room-tone.ulaw");
  if (!existsSync(path)) return null;
  try {
    const bytes = readFileSync(path);
    const fade = 800; // 100 ms crossfade hides the seam of an arbitrary clip
    if (bytes.length < RATE + fade) return null; // too short to loop cleanly
    const pcm = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) pcm[i] = muLawToLinear(bytes[i]!);
    return sealLoop(pcm, fade);
  } catch {
    return null;
  }
}

/** The active room-tone loop: a real recording when one is dropped in,
 *  otherwise the procedural fallback. Resolved once at boot. */
const LOOP = loadRealLoop() ?? buildProceduralLoop();

/** Clamp a per-center ambience level (percent, 1–25) to a caller-facing gain,
 *  or 0 when disabled — 0 means the bridge forwards the agent audio untouched
 *  and never paces gap tone. */
export function ambienceGain(enabled: boolean, level: number): number {
  if (!enabled) return 0;
  return Math.min(25, Math.max(1, Math.round(level))) / 100;
}

/** Mix room tone into one base64 μ-law agent delta, advancing the loop
 *  cursor. The tone is ducked (see DUCK) so it sits UNDER her voice instead of
 *  competing with it. Returns the new payload, the next cursor, and the
 *  frame's sample count so the bridge can advance its playhead clock. */
export function mixAmbience(
  base64Ulaw: string,
  gain: number,
  cursor: number,
): { payload: string; cursor: number; samples: number } {
  const ulaw = Buffer.from(base64Ulaw, "base64");
  const out = Buffer.allocUnsafe(ulaw.length);
  const ducked = gain * DUCK;
  let c = cursor % LOOP.length;
  for (let i = 0; i < ulaw.length; i++) {
    let pcm = muLawToLinear(ulaw[i]!) + LOOP[c]! * ducked;
    c = c + 1 === LOOP.length ? 0 : c + 1;
    if (pcm > 32767) pcm = 32767;
    else if (pcm < -32768) pcm = -32768;
    out[i] = linearToMuLaw(pcm | 0);
  }
  return { payload: out.toString("base64"), cursor: c, samples: ulaw.length };
}

/** One pure room-tone frame (default 20 ms / 160 samples at 8 kHz) for the
 *  gaps between agent turns, so the line never goes studio-dead. Continues
 *  the same loop cursor the mixed deltas use — one unbroken room. */
export function ambienceFrame(
  gain: number,
  cursor: number,
  samples = 160,
): { payload: string; cursor: number } {
  const out = Buffer.allocUnsafe(samples);
  let c = cursor % LOOP.length;
  for (let i = 0; i < samples; i++) {
    out[i] = linearToMuLaw((LOOP[c]! * gain) | 0);
    c = c + 1 === LOOP.length ? 0 : c + 1;
  }
  return { payload: out.toString("base64"), cursor: c };
}
