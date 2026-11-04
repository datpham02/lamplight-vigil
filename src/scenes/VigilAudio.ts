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
// The waveforms are synthesised from the ToneSpecs in `src/config`
// (soundSynth.ts) and held as AudioBuffers. There is no audio file in the
// repository, nothing is fetched, and nothing is decoded per play.
//
// **When the context is created, and why it is ours.** Phaser's sound manager
// is switched off at the mount (`audio.noAudio`), and this class owns an
// AudioContext of its own that does not exist until the first user gesture
// inside the game's container. A context created at boot is a context the
// browser suspends and warns about, and on an embedded page it is an audio
// device opened by a widget the visitor has not touched yet. The gate in
// `src/host/gestureGate.ts` runs this synchronously inside that first gesture,
// which is also the only moment `resume()` is allowed to work.
//
// The buffers are baked in the same breath, not on first play, for the reason
// the textures are baked at boot: synthesising a few thousand samples is cheap,
// but it is not something to do on the frame a crawler dies. The gesture that
// opens the gate is the key or click that starts the run, so the bake lands
// before there is anything to confirm.

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
import type { HostContext } from '../host/hostContext';
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
 * Every method is a no-op until the gate opens, and a no-op forever in a
 * runtime with no Web Audio or in a game that was constructed without a host.
 * Silence is a supported way to play this game, not a degraded one, because of
 * the pillar 2 rule above.
 */
export class VigilAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;

  private readonly buffers: Map<CueName, AudioBuffer> = new Map();

  /** Seconds before another freeze cue is allowed. See SOUND_FREEZE_MIN_INTERVAL. */
  private freezeCooldown = 0;

  private closed = false;

  /**
   * @param host The mount, or null when the scene is running outside one. With
   * no host there is no gesture to wait for and no teardown to register, so the
   * game runs silent rather than guessing.
   */
  public constructor(host: HostContext | null) {
    if (host === null) {
      return;
    }

    host.gesture.whenOpen(() => {
      this.start();
    });

    // Registered with the mount rather than with the scene's SHUTDOWN, because
    // Phaser's scene teardown is deferred to the next frame and never arrives
    // at all if the game was destroyed while the tab was hidden. An audio
    // device has to come back whether or not a frame ever runs again.
    host.addDisposable(() => {
      this.dispose();
    });
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

  /**
   * Releases the audio device. Called by the mount's `destroy()`, synchronously.
   *
   * Closing the context takes every live buffer source and gain node with it,
   * which is what keeps mount-destroy-mount from accumulating audio nodes.
   */
  public dispose(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    const context = this.context;
    this.output?.disconnect();

    this.context = null;
    this.output = null;
    this.buffers.clear();

    // Nothing waits on this, and a context the browser has already torn down
    // rejects: either way there is nothing left to do about it.
    void context?.close().catch(() => undefined);
  }

  /** Runs inside the first user gesture. See the file header. */
  private start(): void {
    if (this.closed || this.context !== null) {
      return;
    }

    // Guarded rather than assumed: a runtime with no Web Audio is a supported
    // way to play, and the type says this is always there when the DOM lib does
    // not know the difference.
    if (typeof globalThis.AudioContext === 'undefined') {
      return;
    }

    const context = new globalThis.AudioContext();
    this.context = context;

    this.output = context.createGain();
    this.output.gain.value = AUDIO_MASTER_VOLUME;
    this.output.connect(context.destination);

    for (const name of Object.keys(CUES) as CueName[]) {
      this.buffers.set(name, bake(context, CUES[name].spec));
    }

    // Still inside the gesture, which is the only place this is allowed to
    // succeed. Ignored on rejection: silence is not a reason to stop the game.
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
  }

  private play(name: CueName): void {
    const context = this.context;
    const output = this.output;
    const buffer = this.buffers.get(name);

    if (context === null || output === null || buffer === undefined) {
      return;
    }

    // Belt and braces for a browser that suspends the context again mid-run.
    // The rejection is ignored on purpose: a cue that cannot play is not a
    // reason to interrupt a run.
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
