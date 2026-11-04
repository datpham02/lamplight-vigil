// The three sound cues the MVP ships, as waveforms.
//
// What is worth asserting here is not that a cue sounds good — nothing in Node
// can hear it — but that it is a well-formed confirmation: in range, finite, and
// silent at both ends. A cue that starts or stops on a non-zero sample is a
// click, and every one of these plays at the exact moment the player is reading
// something off the screen.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SOUND_BANISH,
  SOUND_FREEZE,
  SOUND_LAMP_HIT,
  type ToneSpec,
} from '../config/index';
import { renderTone } from './soundSynth';

/** Every cue the game ships, by the name it is wired to. */
const CUES: ReadonlyArray<readonly [string, ToneSpec]> = [
  ['freeze', SOUND_FREEZE],
  ['banish', SOUND_BANISH],
  ['lamp hit', SOUND_LAMP_HIT],
];

/** A common rate, and one a browser is unlikely to actually hand us. */
const RATES = [44100, 48000];

/** Deterministic noise, so a failure here is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sound cues (design.md §13 — the freeze, the burn, the lamp hit)', () => {
  for (const [name, spec] of CUES) {
    describe(name, () => {
      it('is as long as its spec says, at any sample rate', () => {
        for (const rate of RATES) {
          const samples = renderTone(spec, rate, seededRandom(1));
          assert.equal(samples.length, Math.round(spec.durationSeconds * rate));
        }
      });

      it('stays in range and finite', () => {
        const samples = renderTone(spec, RATES[0] ?? 44100, seededRandom(2));

        for (const sample of samples) {
          assert.ok(Number.isFinite(sample), 'no NaN reached the buffer');
          assert.ok(sample >= -1 && sample <= 1, `sample ${sample} is out of range`);
        }
      });

      it('opens and closes on silence, so it cannot click', () => {
        const samples = renderTone(spec, RATES[0] ?? 44100, seededRandom(3));

        // Math.abs, because the envelope reaching zero through a negative sample
        // produces -0, which is silence by every measure except assert.strict's.
        assert.equal(Math.abs(samples[0] ?? NaN), 0, 'the attack starts from nothing');
        assert.equal(
          Math.abs(samples[samples.length - 1] ?? NaN),
          0,
          'and the decay reaches nothing',
        );
      });

      it('decays — it is a confirmation, not a drone', () => {
        const samples = renderTone(spec, RATES[0] ?? 44100, seededRandom(4));
        const half = Math.floor(samples.length / 2);

        const peak = (from: number, to: number): number => {
          let loudest = 0;
          for (let i = from; i < to; i += 1) {
            loudest = Math.max(loudest, Math.abs(samples[i] ?? 0));
          }
          return loudest;
        };

        assert.ok(peak(0, half) > peak(half, samples.length), 'the back half is quieter');
      });

      it('is reproducible from its seed', () => {
        const a = renderTone(spec, RATES[0] ?? 44100, seededRandom(5));
        const b = renderTone(spec, RATES[0] ?? 44100, seededRandom(5));

        assert.deepEqual(Array.from(a), Array.from(b));
      });
    });
  }

  it('is short enough to be a confirmation rather than an event', () => {
    for (const [name, spec] of CUES) {
      assert.ok(spec.durationSeconds <= 0.5, `${name} runs ${spec.durationSeconds}s`);
    }
  });
});
