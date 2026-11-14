/**
 * Minimal HUD overlay. DOM writes are throttled and only happen when a value
 * changes, so the HUD never causes layout work every frame.
 */

export interface HudData {
  speedKmh: number;
  gear: string;
  /** Steering-wheel angle in degrees, positive = turned left. */
  steerDeg: number;
  handbrake: boolean;
  fps: number;
}

const UPDATE_INTERVAL_S = 0.1;

type HudKey = 'speed' | 'gear' | 'steer' | 'hb' | 'fps';

export class Hud {
  private readonly speed: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly steer: HTMLElement;
  private readonly handbrake: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly pause: HTMLElement;
  private timer = 0;
  private last: Record<HudKey, string> = { speed: '', gear: '', steer: '', hb: '', fps: '' };

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-panel hud-speed"><span class="hud-big" data-k="speed">0</span><span class="hud-unit">km/h</span></div>
      <div class="hud-panel hud-gear"><span class="hud-big" data-k="gear">D</span><span class="hud-unit" data-k="hb">P-BRAKE</span></div>
      <div class="hud-panel hud-info"><div>Wheel: <span data-k="steer">0°</span></div><div><span data-k="fps">--</span> FPS</div></div>
      <div class="hud-help">W/↑ accelerate · S/↓ brake, hold to reverse · A/D or ←/→ steer · Space handbrake · R reset · Esc pause</div>
      <div class="hud-pause hidden" data-k="pause">Paused<small>Press Esc to resume</small></div>`;
    const q = (k: string) => root.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    this.speed = q('speed');
    this.gear = q('gear');
    this.steer = q('steer');
    this.handbrake = q('hb');
    this.fps = q('fps');
    this.pause = q('pause');
    root.classList.remove('hidden');
  }

  update(d: HudData, dt: number): void {
    this.timer += dt;
    if (this.timer < UPDATE_INTERVAL_S) return;
    this.timer = 0;
    this.set('speed', this.speed, Math.round(Math.abs(d.speedKmh)).toString());
    this.set('gear', this.gear, d.gear);
    const deg = Math.round(Math.abs(d.steerDeg));
    this.set('steer', this.steer, deg === 0 ? '0°' : `${deg}° ${d.steerDeg > 0 ? 'L' : 'R'}`);
    this.set('hb', this.handbrake, d.handbrake ? 'P-BRAKE' : '\u00a0');
    this.set('fps', this.fps, Math.round(d.fps).toString());
  }

  setPaused(paused: boolean): void {
    this.pause.classList.toggle('hidden', !paused);
  }

  private set(key: HudKey, el: HTMLElement, value: string): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = value;
  }
}
