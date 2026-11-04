// src/scenes owns the scenes and their wiring. This file is the sound hook: the
// three confirmations in `docs/design.md` §13 — the freeze, the burn, the lamp
// hit — and nothing else.
//
// PILLAR 2. Every cue here confirms something the screen is already showing: the
// frost ring and the catch flash, the banish burst and the crawler's absence,
// the game-over state and the shake. Mute the tab and the game loses no
// information a player needs in order to act. Nothing may be added to this file
// that is the only evidence of anything — that is the rule, not a preference.
//
// The waveforms are synthesised at boot from the ToneSpecs in `src/config`
// (soundSynth.ts) and held as AudioBuffers. There is no audio file in the
// repository, nothing is fetched, and nothing is decoded per play.
import Phaser from 'phaser';

import {
  AUDIO_MASTER_VOLUME,
  SOUND_BANISH,
  SOUND_BANISH_VOLUME,
  SOUND_FREEZE,
  SOUND_FREEZE_MIN_INTERVAL,
  SOUND_FREEZE_VOLUME,
  SOUND_LAMP_HIT,
  SOUND_LAMP_HIT_VOLUME,
  type ToneSpec,
} from '../config/index';
import { renderTone } from './soundSynth';

/** Mono, and the only channel index anything here uses. */
const CHANNEL = 0;
const CHANNEL_COUNT = 1;

interface Cue {
  readonly spec: ToneSpec;
  readonly volume: number;
}

const CUES = {
  freeze: { spec: SOUND_FREEZE, volume: SOUND_FREEZE_VOLUME },
  banish: { spec: SOUND_BANISH, volume: SOUND_BANISH_VOLUME },
  lampHit: { spec: SOUND_LAMP_HIT, volume: SOUND_LAMP_HIT_VOLUME },
} as const satisfies Record<string, Cue>;

type CueName = keyof typeof CUES;

/** Synthesises one cue into a buffer the context can play without decoding. */
function bake(context: AudioContext, spec: ToneSpec): AudioBuffer {
  const samples = renderTone(spec, context.sampleRate);
  const buffer = context.createBuffer(CHANNEL_COUNT, samples.length, context.sampleRate);
  buffer.getChannelData(CHANNEL).set(samples);

  return buffer;
}

/**
 * The game's sound.
 *
 * Every method is a no-op when there is no Web Audio context — a browser with
 * audio disabled, or Phaser falling back to its no-audio manager. That is a
 * supported way to play this game, not a degraded one, because of the pillar 2
 * rule above.
 */
export class VigilAudio {
  private readonly context: AudioContext | null;
  private readonly output: GainNode | null;
  private readonly buffers: Map<CueName, AudioBuffer> = new Map();

  /** Seconds before another freeze cue is allowed. See SOUND_FREEZE_MIN_INTERVAL. */
  private freezeCooldown = 0;

  public constructor(scene: Phaser.Scene) {
    const manager = scene.sound;
    this.context =
      manager instanceof Phaser.Sound.WebAudioSoundManager ? manager.context : null;

    if (this.context === null) {
      this.output = null;
      return;
    }

    this.output = this.context.createGain();
    this.output.gain.value = AUDIO_MASTER_VOLUME;
    this.output.connect(this.context.destination);

    // Bake every cue once, here, for the same reason the textures are baked once
    // at boot: synthesising a few thousand samples is cheap, but it is not
    // something to do on the frame a crawler dies.
    for (const name of Object.keys(CUES) as CueName[]) {
      this.buffers.set(name, bake(this.context, CUES[name].spec));
    }
  }

  /**
   * @param deltaSeconds Already clamped by the scene (§2.4). Only runs the
   * freeze throttle down; no cue's playback is driven from here.
   */
  public update(deltaSeconds: number): void {
    this.freezeCooldown = Math.max(0, this.freezeCooldown - deltaSeconds);
  }

  /** A run is starting. Nothing should be left over from the last one. */
  public reset(): void {
    this.freezeCooldown = 0;
  }

  /**
   * A crawler was caught by the light.
   *
   * Throttled: one wide sweep can catch a dozen crawlers on the same frame, and
   * a dozen simultaneous blips read as a glitch rather than as a confirmation.
   * Dropping the extras costs nothing — the frost rings all appeared anyway, and
   * they are what the player is actually reading.
   */
  public freeze(): void {
    if (this.freezeCooldown > 0) {
      return;
    }

    this.freezeCooldown = SOUND_FREEZE_MIN_INTERVAL;
    this.play('freeze');
  }

  /** A crawler finished its dwell. */
  public banish(): void {
    this.play('banish');
  }

  /** A crawler reached the lamp. */
  public lampHit(): void {
    this.play('lampHit');
  }

  private play(name: CueName): void {
    const context = this.context;
    const output = this.output;
    const buffer = this.buffers.get(name);

    if (context === null || output === null || buffer === undefined) {
      return;
    }

    // Phaser unlocks its context on the first input, and the first input in this
    // game is the one that starts a run — so by the time there is anything to
    // confirm, the context is running. This is belt and braces for a browser
    // that suspends it again, and the rejection is ignored on purpose: a cue
    // that cannot play is not a reason to interrupt a run.
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    const gain = context.createGain();
    gain.gain.value = CUES[name].volume;

    source.connect(gain);
    gain.connect(output);
    source.start();

    // Buffer sources are single-use; release the nodes when the cue is done so
    // a long run does not accumulate them.
    source.onended = (): void => {
      source.disconnect();
      gain.disconnect();
    };
  }
}
