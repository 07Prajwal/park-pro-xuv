/**
 * WebAudio sound system: procedural diesel engine (AudioWorklet), turbo and intake,
 * starter motor, indicator relay, reverse beeper, parking-sensor beeps, horn,
 * gear-engagement clunk, collision thud, kerb scrape and the success chime.
 *
 * No audio files are needed. The context is created on the first user gesture
 * (required by iOS Safari / Chrome autoplay rules). All per-frame updates only set
 * AudioParam targets; one-shot sounds reuse pre-rendered buffers.
 */

import { ENGINE_WORKLET_SOURCE } from './engineWorklet';

export interface AudioFrame {
  rpm: number;
  load: number;
  throttle: number;
  cranking: boolean;
  running: boolean;
  horn: boolean;
  reverse: boolean;
  /** Nearest parking-sensor distance in metres, or null when the sensors are inactive. */
  sensorM: number | null;
}

/** Beyond this the sensors stay silent; below SENSOR_SOLID_M the tone is continuous. */
const SENSOR_SILENT_M = 1.5;
const SENSOR_SOLID_M = 0.3;

export class AudioEngine {
  private constructor(
    private readonly ctx: AudioContext,
    private readonly master: GainNode,
    private readonly engine: AudioWorkletNode,
    private readonly engineGain: GainNode,
    private readonly engineTone: BiquadFilterNode,
    private readonly turbo: OscillatorNode,
    private readonly turboGain: GainNode,
    private readonly intake: BiquadFilterNode,
    private readonly intakeGain: GainNode,
    private readonly starterGain: GainNode,
    private readonly hornGain: GainNode,
    private readonly sensorGain: GainNode,
    private readonly buffers: {
      tickOn: AudioBuffer;
      tickOff: AudioBuffer;
      beep: AudioBuffer;
      clunk: AudioBuffer;
      sensor: AudioBuffer;
      thud: AudioBuffer;
      scrape: AudioBuffer;
      chime: AudioBuffer;
    },
  ) {}

  private reverseTimer = 0;
  private sensorTimer = 0;
  private lastParamUpdate = 0;

  /** Create and start the audio graph. Must be called from (or after) a user gesture. */
  static async create(volume = 0.8): Promise<AudioEngine> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') await ctx.resume();
    const url = URL.createObjectURL(new Blob([ENGINE_WORKLET_SOURCE], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    // Engine: worklet -> exhaust resonances -> load-dependent low-pass -> gain.
    const engine = new AudioWorkletNode(ctx, 'diesel-engine', { outputChannelCount: [1] });
    const res1 = peaking(ctx, 95, 4, 6);
    const res2 = peaking(ctx, 280, 3, 4);
    const body = peaking(ctx, 1400, 1.5, -6);
    const engineTone = ctx.createBiquadFilter();
    engineTone.type = 'lowpass';
    engineTone.frequency.value = 900;
    engineTone.Q.value = 0.7;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engine.connect(res1).connect(res2).connect(body).connect(engineTone).connect(engineGain).connect(master);

    // Turbo whistle.
    const turbo = ctx.createOscillator();
    turbo.type = 'sine';
    turbo.frequency.value = 2500;
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turbo.connect(turboGain).connect(master);
    turbo.start();

    // Intake / air rush: looping noise through a band-pass.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 2);
    noise.loop = true;
    const intake = ctx.createBiquadFilter();
    intake.type = 'bandpass';
    intake.frequency.value = 900;
    intake.Q.value = 0.8;
    const intakeGain = ctx.createGain();
    intakeGain.gain.value = 0;
    noise.connect(intake).connect(intakeGain).connect(master);
    noise.start();

    // Starter motor: buzzy saw with a cranking wobble.
    const starter = ctx.createOscillator();
    starter.type = 'sawtooth';
    starter.frequency.value = 140;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 9;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 35;
    wobble.connect(wobbleDepth).connect(starter.frequency);
    const starterFilter = ctx.createBiquadFilter();
    starterFilter.type = 'lowpass';
    starterFilter.frequency.value = 1200;
    const starterGain = ctx.createGain();
    starterGain.gain.value = 0;
    starter.connect(starterFilter).connect(starterGain).connect(master);
    starter.start();
    wobble.start();

    // Horn: two detuned square tones (typical dual-tone car horn).
    const hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 2600;
    for (const f of [415, 498]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hornFilter);
      o.start();
    }
    hornFilter.connect(hornGain).connect(master);

    // Parking-sensor continuous tone (very close); intermittent beeps use a buffer.
    const sensorOsc = ctx.createOscillator();
    sensorOsc.frequency.value = 2050;
    const sensorGain = ctx.createGain();
    sensorGain.gain.value = 0;
    sensorOsc.connect(sensorGain).connect(master);
    sensorOsc.start();

    const buffers = {
      tickOn: clickBuffer(ctx, 2600, 0.012, 0.5),
      tickOff: clickBuffer(ctx, 1800, 0.01, 0.32),
      beep: toneBuffer(ctx, 1150, 0.13, 0.18),
      clunk: clickBuffer(ctx, 120, 0.09, 0.6),
      sensor: toneBuffer(ctx, 2050, 0.07, 0.16),
      thud: thudBuffer(ctx),
      scrape: scrapeBuffer(ctx),
      chime: chimeBuffer(ctx),
    };

    return new AudioEngine(ctx, master, engine, engineGain, engineTone, turbo, turboGain, intake, intakeGain, starterGain, hornGain, sensorGain, buffers);
  }

  setVolume(v: number): void {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Call every frame; parameter changes are throttled to ~30 Hz. */
  update(f: AudioFrame, dt: number): void {
    const now = this.ctx.currentTime;

    const solid = f.sensorM !== null && f.sensorM < SENSOR_SOLID_M;
    if (f.sensorM !== null && !solid && f.sensorM < SENSOR_SILENT_M) {
      this.sensorTimer -= dt;
      if (this.sensorTimer <= 0) {
        this.play(this.buffers.sensor);
        this.sensorTimer = 0.1 + (0.6 * (f.sensorM - SENSOR_SOLID_M)) / (SENSOR_SILENT_M - SENSOR_SOLID_M);
      }
    } else {
      this.sensorTimer = 0;
    }
    this.sensorGain.gain.setTargetAtTime(solid ? 0.14 : 0, now, 0.01);

    // The sensors replace the reverse beeper while they are active.
    if (f.reverse && f.sensorM === null) {
      this.reverseTimer -= dt;
      if (this.reverseTimer <= 0) {
        this.play(this.buffers.beep);
        this.reverseTimer = 0.9;
      }
    } else {
      this.reverseTimer = 0;
    }

    if (now - this.lastParamUpdate < 1 / 30) return;
    this.lastParamUpdate = now;
    const tc = 0.04;
    const p = this.engine.parameters;
    p.get('rpm')!.setTargetAtTime(f.rpm, now, tc);
    p.get('load')!.setTargetAtTime(f.load, now, tc);

    const on = f.running || f.cranking ? 1 : 0;
    const rpmN = Math.min(f.rpm / 4500, 1);
    this.engineGain.gain.setTargetAtTime(on * (0.32 + 0.38 * f.load + 0.2 * rpmN), now, tc);
    this.engineTone.frequency.setTargetAtTime(500 + 2200 * f.load + 900 * rpmN, now, tc);

    const boost = f.running ? f.load * rpmN * rpmN : 0;
    this.turbo.frequency.setTargetAtTime(1800 + f.rpm * 1.6, now, 0.15);
    this.turboGain.gain.setTargetAtTime(0.02 * boost, now, 0.2);
    this.intake.frequency.setTargetAtTime(500 + f.rpm * 0.45, now, tc);
    this.intakeGain.gain.setTargetAtTime(f.running ? 0.05 * f.throttle * (0.3 + rpmN) : 0, now, 0.08);

    this.starterGain.gain.setTargetAtTime(f.cranking ? 0.22 : 0, now, 0.02);
    this.hornGain.gain.setTargetAtTime(f.horn ? 0.12 : 0, now, 0.01);
  }

  indicatorTick(on: boolean): void {
    this.play(on ? this.buffers.tickOn : this.buffers.tickOff);
  }

  gearClunk(): void {
    this.play(this.buffers.clunk);
  }

  /** Body contact; strength 0..1 from the impact speed. */
  bump(strength: number): void {
    this.play(this.buffers.thud, 0.35 + 0.65 * Math.min(1, strength));
  }

  kerbScrape(): void {
    this.play(this.buffers.scrape, 0.7);
  }

  chime(): void {
    this.play(this.buffers.chime);
  }

  private play(buffer: AudioBuffer, gain = 1): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    if (gain === 1) {
      src.connect(this.master);
    } else {
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.master);
    }
    src.start();
  }
}

function peaking(ctx: AudioContext, freq: number, q: number, gainDb: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = 'peaking';
  f.frequency.value = freq;
  f.Q.value = q;
  f.gain.value = gainDb;
  return f;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Short resonant click (relay tick, clunk). */
function clickBuffer(ctx: AudioContext, freq: number, decayS: number, level: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * decayS * 6);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const env = Math.exp(-t / decayS);
    d[i] = level * env * (0.6 * Math.sin(2 * Math.PI * freq * t) + 0.4 * (Math.random() * 2 - 1) * Math.exp(-t / (decayS * 0.2)));
  }
  return b;
}

function toneBuffer(ctx: AudioContext, freq: number, seconds: number, level: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  const fade = Math.floor(ctx.sampleRate * 0.008);
  for (let i = 0; i < len; i++) {
    const env = Math.min(1, i / fade, (len - i) / fade);
    d[i] = level * env * Math.sin((2 * Math.PI * freq * i) / ctx.sampleRate);
  }
  return b;
}

/** Low body thump: damped 60-90 Hz sine with a short noise transient. */
function thudBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.35);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const f = 90 - 30 * Math.min(1, t / 0.15);
    d[i] = 0.8 * Math.exp(-t / 0.07) * Math.sin(2 * Math.PI * f * t) + 0.25 * Math.exp(-t / 0.008) * (Math.random() * 2 - 1);
  }
  return b;
}

/** Tyre rubbing a kerb: band-limited noise with a rough amplitude. */
function scrapeBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.4);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    lp += 0.25 * (Math.random() * 2 - 1 - lp);
    const env = Math.min(1, t / 0.02) * Math.exp(-t / 0.18) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 31 * t));
    d[i] = 0.5 * env * lp;
  }
  return b;
}

/** Two-note success chime. */
function chimeBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1.1);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    let v = 0;
    for (const [f, t0] of [
      [880, 0],
      [1318.5, 0.16],
    ]) {
      if (t < t0) continue;
      const u = t - t0;
      v += Math.min(1, u / 0.005) * Math.exp(-u / 0.35) * (Math.sin(2 * Math.PI * f * u) + 0.3 * Math.sin(4 * Math.PI * f * u));
    }
    d[i] = 0.14 * v;
  }
  return b;
}
