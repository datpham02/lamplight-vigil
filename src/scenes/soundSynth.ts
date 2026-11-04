// src/scenes owns the scenes and their wiring, including the game's three sound
// cues. This file is the synthesis half: samples in, samples out, no Web Audio
// and no Phaser, so a waveform can be asserted on without a browser.
// VigilAudio.ts wraps what comes out of here into AudioBuffers and plays them.
//
// The game ships no audio file. Every cue is generated from a ToneSpec in
// `src/config` once at boot, which is the same rule the textures follow
// (`docs/concept.md` §9) and which makes the licensing question in AGENTS.md
// answer itself: there is nothing to license.

import { type ToneSpec } from '../config/index';

/** A sine's full period, as a phase step multiplier. */
const PHASE_PER_CYCLE = Math.PI * 2;

/** Hard limit on a sample, so a loud spec clips rather than wraps. */
function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Renders one cue to mono samples in [-1, 1].
 *
 * The frequency glides geometrically from `startFrequency` to `endFrequency`
 * across the cue — that is what makes the freeze read as a catch (rising) and
 * the banish as something leaving (falling) without either carrying information
 * of its own. Amplitude is an attack ramp into a `decayExponent` falloff, and
 * the envelope is zero at both ends by construction: a cue that starts or stops
 * on a non-zero sample is a click, and a click is the one thing a confirmation
 * must never sound like.
 *
 * @param random Injected so the noise component is reproducible in a test. The
 * game uses Math.random, and only at boot.
 */
export function renderTone(
  spec: ToneSpec,
  sampleRate: number,
  random: () => number = Math.random,
): Float32Array {
  const count = Math.max(2, Math.round(spec.durationSeconds * sampleRate));
  const samples = new Float32Array(count);

  const attackSamples = Math.max(1, Math.round(spec.attackSeconds * sampleRate));
  const lastIndex = count - 1;

  let phase = 0;

  for (let i = 0; i < count; i += 1) {
    // Exactly 0 on the first sample and exactly 1 on the last, so the envelope
    // closes on silence rather than near it.
    const t = i / lastIndex;

    const frequency = spec.startFrequency * (spec.endFrequency / spec.startFrequency) ** t;
    const tone = Math.sin(phase);
    phase += (PHASE_PER_CYCLE * frequency) / sampleRate;

    const noise = random() * 2 - 1;
    const blended = tone * (1 - spec.noiseMix) + noise * spec.noiseMix;

    const attack = Math.min(1, i / attackSamples);
    const decay = (1 - t) ** spec.decayExponent;

    samples[i] = clampSample(blended * attack * decay * spec.peakAmplitude);
  }

  return samples;
}
