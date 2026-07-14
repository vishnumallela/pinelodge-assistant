/**
 * Front-desk room tone for phone calls, so Sarah sounds like she's on an open
 * line at a real desk instead of in a dead-silent studio. Off by default,
 * enabled per center.
 *
 * Presets — each center picks an environment (quiet office, busy lobby,
 * clinic front desk). Each preset prefers a REAL recording dropped in at
 * `src/assets/room-tone-<preset>.ulaw` (raw 8 kHz mono G.711 μ-law, no
 * header) for genuine texture, and falls back to a procedural tone shaped for
 * that room when no file is present — so the feature always works. To add a
 * recording, convert any clip (ideally 20-60 s of steady ambience) with
 * ffmpeg, e.g. for the office preset:
 *
 *   ffmpeg -i office.wav -ac 1 -ar 8000 -f mulaw \
 *     apps/api-gateway/src/assets/room-tone-office.ulaw
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

/** The selectable room environments. `office` is the default. */
export const AMBIENCE_PROFILES = ["office", "lobby", "clinic"] as const;
export type AmbienceProfile = (typeof AMBIENCE_PROFILES)[number];

/** A sealed room-tone loop (PCM16 at 8 kHz), passed to the mix functions. */
export type AmbienceLoop = Int16Array;

/** Per-preset shaping for the procedural fallback. Each is band-limited to
 *  the 8 kHz phone path; they differ in brightness (`airHz`), how much low
 *  "room" body they carry (`body`), and how much the level swells over the
 *  loop (`drift`) — a quiet office barely moves, a busy lobby breathes more. */
const PROFILE_SHAPE: Record<
  AmbienceProfile,
  { airHz: number; hpHz: number; body: number; drift: number }
> = {
  office: { airHz: 1200, hpHz: 180, body: 0.6, drift: 0.22 },
  lobby: { airHz: 1600, hpHz: 150, body: 0.5, drift: 0.34 },
  clinic: { airHz: 1000, hpHz: 200, body: 0.8, drift: 0.12 },
};

/** A seamless 24 s procedural room tone at 8 kHz — band-shaped noise (HVAC-like
 *  hiss plus a little low body) with slow, loop-aligned level drift so the
 *  room breathes instead of hissing like static. The energy sits in the
 *  200–2000 Hz band the narrowband phone path actually reproduces. The
 *  fallback for a preset when no real recording is present. */
function buildProceduralLoop(profile: AmbienceProfile): Int16Array {
  const shape = PROFILE_SHAPE[profile];
  const seconds = 24;
  const fade = 400;
  const len = seconds * RATE;
  const gen = new Float32Array(len + fade);

  // One-pole coefficients, tuned for the 8 kHz narrowband path.
  const air = 1 - Math.exp((-2 * Math.PI * shape.airHz) / RATE);
  const hpA = Math.exp((-2 * Math.PI * shape.hpHz) / RATE);
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
    // Slow swell in whole cycles per loop, so the wrap stays in phase.
    const t = i / len;
    const drift =
      1 +
      shape.drift * Math.sin(tau * 3 * t + 0.7) +
      shape.drift * 0.6 * Math.sin(tau * 7 * t + 2.1);
    gen[i] = (hp + shape.body * body) * drift;
  }
  return sealLoop(gen, fade);
}

/** Load a real recording for a preset from `src/assets/room-tone-<preset>.ulaw`
 *  (raw 8 kHz mono μ-law) if present, decode it, and seal it into a gapless
 *  loop. Returns null when there's no usable file, so we fall back to the
 *  procedural tone. */
function loadRealLoop(profile: AmbienceProfile): Int16Array | null {
  const path = join(import.meta.dir, "assets", `room-tone-${profile}.ulaw`);
  if (!existsSync(path)) return null;
  try {
    const bytes = readFileSync(path);
    const fade = 800;
    if (bytes.length < RATE + fade) return null;
    const pcm = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) pcm[i] = muLawToLinear(bytes[i]!);
    return sealLoop(pcm, fade);
  } catch {
    return null;
  }
}

/** Loops are built once per preset on first use and cached — a real recording
 *  when one is dropped in, otherwise the procedural fallback for that room. */
const LOOP_CACHE = new Map<AmbienceProfile, AmbienceLoop>();

/** The active loop for a preset. Unknown values fall back to "office". */
export function getAmbienceLoop(profile: string): AmbienceLoop {
  const key: AmbienceProfile = (AMBIENCE_PROFILES as readonly string[]).includes(profile)
    ? (profile as AmbienceProfile)
    : "office";
  const cached = LOOP_CACHE.get(key);
  if (cached) return cached;
  const loop = loadRealLoop(key) ?? buildProceduralLoop(key);
  LOOP_CACHE.set(key, loop);
  return loop;
}

/** Clamp a per-center ambience level (percent, 1–25) to a caller-facing gain,
 *  or 0 when disabled — 0 means the bridge forwards the agent audio untouched
 *  and never paces gap tone. */
export function ambienceGain(enabled: boolean, level: number): number {
  if (!enabled) return 0;
  return Math.min(25, Math.max(1, Math.round(level))) / 100;
}

/** A per-call keyboard-typing layer: the shared bed plus its own gain. Rides
 *  only in the gaps (see the bridge) — a real receptionist types while she
 *  listens and takes notes, not while she's talking, so it never masks her
 *  voice. */
export interface TypingLayer {
  bed: AmbienceLoop;
  gain: number;
}

/** Synthesize one keystroke into `buf` at sample offset `at`: a sharp click
 *  (high-passed noise, fast attack, quick decay) with a little low "thock" so
 *  it reads as a mechanical key, not a tick. */
function addKeystroke(buf: Float32Array, at: number, amp: number): void {
  const len = 260; // ~32 ms
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len && at + i < buf.length; i++) {
    const env = i < 6 ? i / 6 : Math.exp(-(i - 6) / 55); // fast attack, exp decay
    const white = Math.random() * 2 - 1;
    hp = 0.85 * (hp + white - prev); // one-pole high-pass → click "snap"
    prev = white;
    const thock = Math.sin((2 * Math.PI * 220 * i) / RATE) * Math.exp(-i / 30); // key body
    buf[at + i]! += amp * env * (0.8 * hp + 0.35 * thock);
  }
}

/** A seamless ~48 s typing bed: mostly silence with occasional bursts of
 *  keystrokes (a flurry of a few words, then a pause), like someone noting a
 *  caller's details. Sparse and irregular, so the loop rarely sounds repeated.
 *  The first/last second are kept silent so the wrap is a clean seam. */
function buildTypingBed(): AmbienceLoop {
  const seconds = 48;
  const fade = 400;
  const len = seconds * RATE;
  const gen = new Float32Array(len + fade);
  const quietEnd = RATE; // keep 1 s of silence at each end

  let t = quietEnd + Math.floor(Math.random() * 4 * RATE);
  while (t < len - quietEnd) {
    const keys = 4 + Math.floor(Math.random() * 9); // 4–12 keystrokes per burst
    for (let k = 0; k < keys && t < len - quietEnd; k++) {
      addKeystroke(gen, t, 0.7 + Math.random() * 0.3);
      t += Math.floor((0.09 + Math.random() * 0.09) * RATE); // ~5–7 keys/sec
    }
    t += Math.floor((2.5 + Math.random() * 5) * RATE); // 2.5–7.5 s gap between bursts
  }
  return sealLoop(gen, fade);
}

let TYPING_BED: AmbienceLoop | null = null;

/** The shared typing bed, built once on first use. */
export function getTypingBed(): AmbienceLoop {
  if (!TYPING_BED) TYPING_BED = buildTypingBed();
  return TYPING_BED;
}

/** Mix room tone into one base64 μ-law agent delta, advancing the loop
 *  cursor. The tone is ducked (see DUCK) so it sits UNDER her voice instead of
 *  competing with it. Returns the new payload, the next cursor, and the
 *  frame's sample count so the bridge can advance its playhead clock. */
export function mixAmbience(
  loop: AmbienceLoop,
  base64Ulaw: string,
  gain: number,
  cursor: number,
): { payload: string; cursor: number; samples: number } {
  const ulaw = Buffer.from(base64Ulaw, "base64");
  const out = Buffer.allocUnsafe(ulaw.length);
  const ducked = gain * DUCK;
  let c = cursor % loop.length;
  for (let i = 0; i < ulaw.length; i++) {
    let pcm = muLawToLinear(ulaw[i]!) + loop[c]! * ducked;
    c = c + 1 === loop.length ? 0 : c + 1;
    if (pcm > 32767) pcm = 32767;
    else if (pcm < -32768) pcm = -32768;
    out[i] = linearToMuLaw(pcm | 0);
  }
  return { payload: out.toString("base64"), cursor: c, samples: ulaw.length };
}

/** One room-tone frame (default 20 ms / 160 samples at 8 kHz) for the gaps
 *  between agent turns, so the line never goes studio-dead. Continues the same
 *  loop cursor the mixed deltas use — one unbroken room. When a typing layer
 *  is given, keystrokes are mixed on top (gaps only), advancing their own
 *  cursor so the flurries stay continuous across frames. */
export function ambienceFrame(
  loop: AmbienceLoop,
  gain: number,
  cursor: number,
  typing: TypingLayer | null,
  typingCursor: number,
  samples = 160,
): { payload: string; cursor: number; typingCursor: number } {
  const out = Buffer.allocUnsafe(samples);
  let c = cursor % loop.length;
  const bed = typing?.bed ?? null;
  const tGain = typing?.gain ?? 0;
  let tc = bed ? typingCursor % bed.length : typingCursor;
  for (let i = 0; i < samples; i++) {
    let pcm = loop[c]! * gain;
    if (bed) {
      pcm += bed[tc]! * tGain;
      tc = tc + 1 === bed.length ? 0 : tc + 1;
    }
    if (pcm > 32767) pcm = 32767;
    else if (pcm < -32768) pcm = -32768;
    out[i] = linearToMuLaw(Math.trunc(pcm));
    c = c + 1 === loop.length ? 0 : c + 1;
  }
  return { payload: out.toString("base64"), cursor: c, typingCursor: tc };
}
