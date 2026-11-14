/**
 * AudioWorklet processor source for the procedural 4-cylinder diesel.
 *
 * Kept as a string and loaded through a Blob URL so it bundles as plain code and
 * works offline / from any static host (no separate worker file to resolve).
 *
 * Each combustion event (2 per crank revolution for an inline-4 four-stroke)
 * produces a damped low-frequency pressure pulse (the "thump") plus a very short
 * high-passed noise burst (diesel injection/combustion clatter). Small per-cylinder
 * amplitude differences and timing jitter give the uneven, mechanical character.
 * Exhaust resonance and load-dependent tone are shaped by WebAudio filters after this node.
 */
export const ENGINE_WORKLET_SOURCE = /* js */ `
class DieselEngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 6000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.phase = 0;
    this.cyl = 0;
    this.cylAmp = [1.0, 0.86, 0.94, 0.8];
    this.t = 1;           // seconds since last firing
    this.amp = 0;
    this.clatter = 0;
    this.hp = 0; this.prevNoise = 0;
    this.jitter = 0;
    this.seed = 12345;
  }
  rand() { // xorshift, no allocation
    let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x;
    return ((x >>> 0) / 4294967296);
  }
  process(_inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const rpm = params.rpm[0];
    const load = params.load[0];
    const sr = sampleRate;
    const rate = rpm / 30; // firings per second
    const thumpHz = 55 + rpm * 0.018;
    const thumpDecay = Math.exp(-1 / (sr * Math.max(0.004, 0.55 / Math.max(rate, 1))));
    const clatterDecay = Math.exp(-1 / (sr * 0.0022));
    const clatterLevel = 0.55 * (1 - Math.min(rpm / 3200, 1)) * (0.5 + 0.5 * load) + 0.12;
    for (let i = 0; i < out.length; i++) {
      if (rate > 0.5) {
        this.phase += rate / sr;
        if (this.phase >= 1 + this.jitter) {
          this.phase -= 1 + this.jitter;
          this.jitter = (this.rand() - 0.5) * 0.06;
          this.cyl = (this.cyl + 1) & 3;
          const a = this.cylAmp[this.cyl] * (0.85 + 0.3 * this.rand());
          this.amp = a * (0.55 + 0.45 * load);
          this.clatter = a;
          this.t = 0;
        }
      }
      this.t += 1 / sr;
      this.amp *= thumpDecay;
      this.clatter *= clatterDecay;
      const thump = this.amp * Math.sin(6.283185 * thumpHz * this.t) * (1 - Math.exp(-this.t * 900));
      const n = this.rand() * 2 - 1;
      this.hp = 0.85 * (this.hp + n - this.prevNoise); // one-pole high-pass
      this.prevNoise = n;
      out[i] = thump * 0.9 + this.hp * this.clatter * clatterLevel;
    }
    return true;
  }
}
registerProcessor('diesel-engine', DieselEngineProcessor);
`;
