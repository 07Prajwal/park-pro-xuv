/**
 * HUD overlay: speed, tachometer, P/R/N/D selector with current gear, tell-tales
 * (parking brake, auto hold, indicators, headlights), driver messages and FPS.
 *
 * DOM writes are throttled and only happen when a value changes; the tachometer
 * bar uses a compositor-only transform.
 */

import { GEAR_ORDER, type Gear } from '../vehicle/Drivetrain';

export interface HudData {
  speedKmh: number;
  rpm: number;
  revLimitRpm: number;
  selector: Gear;
  gear: number;
  engineRunning: boolean;
  cranking: boolean;
  parkingBrake: boolean;
  autoHoldEnabled: boolean;
  autoHoldActive: boolean;
  leftLit: boolean;
  rightLit: boolean;
  headlights: boolean;
  /** Steering-wheel angle in degrees, positive = turned left. */
  steerDeg: number;
  fps: number;
  message: string;
  messageAge: number;
}

const TEXT_INTERVAL_S = 0.1;
const MESSAGE_S = 2.5;

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly gearEls: Record<Gear, HTMLElement>;
  private readonly cache = new Map<string, string>();
  private timer = 0;
  private lastTach = -1;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-cluster">
        <div class="hud-tach"><div class="hud-tach-fill" data-k="tach"></div><div class="hud-tach-red"></div></div>
        <div class="hud-row">
          <div class="hud-speed"><span class="hud-big" data-k="speed">0</span><span class="hud-unit">km/h</span></div>
          <div class="hud-prnd">${GEAR_ORDER.map((g) => `<span data-g="${g}">${g}</span>`).join('')}<sub data-k="gear"></sub></div>
        </div>
        <div class="hud-row hud-telltales">
          <span class="tt tt-left" data-k="left">◀</span>
          <span class="tt tt-epb" data-k="epb">(P)</span>
          <span class="tt tt-hold" data-k="hold">A</span>
          <span class="tt tt-lights" data-k="lights">≣D</span>
          <span class="tt tt-right" data-k="right">▶</span>
          <span class="hud-rpm"><span data-k="rpm">0</span> rpm</span>
        </div>
      </div>
      <div class="hud-info"><div>Wheel <span data-k="steer">0°</span></div><div><span data-k="fps">--</span> FPS</div></div>
      <div class="hud-message" data-k="message"></div>
      <div class="hud-help">I engine · E/Q gear D↔P (hold brake) · W/S pedals (Shift = gentle) · A/D steer · Space park brake · B auto hold · , . / indicators · L lights · H horn · R reset · Esc pause</div>
      <div class="hud-pause hidden" data-k="pause">Paused<small>Press Esc to resume</small></div>`;
    for (const n of root.querySelectorAll<HTMLElement>('[data-k]')) this.el[n.dataset.k!] = n;
    this.gearEls = Object.fromEntries(
      GEAR_ORDER.map((g) => [g, root.querySelector<HTMLElement>(`[data-g="${g}"]`)!]),
    ) as Record<Gear, HTMLElement>;
    root.classList.remove('hidden');
  }

  update(d: HudData, dt: number): void {
    // Tachometer every frame (transform only, no layout).
    const frac = Math.round(Math.min(d.rpm / (d.revLimitRpm + 400), 1) * 400) / 400;
    if (frac !== this.lastTach) {
      this.lastTach = frac;
      this.el.tach.style.transform = `scaleX(${frac})`;
    }

    // Blinkers must react immediately to stay in sync with the tick sound.
    this.toggle('left', d.leftLit);
    this.toggle('right', d.rightLit);

    this.timer += dt;
    if (this.timer < TEXT_INTERVAL_S) return;
    this.timer = 0;

    this.text('speed', Math.round(Math.abs(d.speedKmh)).toString());
    this.text('rpm', (Math.round(d.rpm / 50) * 50).toString());
    for (const g of GEAR_ORDER) this.gearEls[g].classList.toggle('on', g === d.selector);
    this.text('gear', d.selector === 'D' ? String(d.gear) : '');
    this.toggle('epb', d.parkingBrake);
    this.toggle('hold', d.autoHoldEnabled);
    this.el.hold.classList.toggle('active', d.autoHoldActive);
    this.toggle('lights', d.headlights);
    const deg = Math.round(Math.abs(d.steerDeg));
    this.text('steer', deg === 0 ? '0°' : `${deg}° ${d.steerDeg > 0 ? 'L' : 'R'}`);
    this.text('fps', Math.round(d.fps).toString());

    let msg = d.messageAge < MESSAGE_S ? d.message : '';
    if (!msg && !d.engineRunning && !d.cranking) msg = 'Engine off — press I to start (in P or N)';
    this.text('message', msg);
    this.el.message.classList.toggle('show', msg !== '');
  }

  setPaused(paused: boolean): void {
    this.el.pause.classList.toggle('hidden', !paused);
  }

  private text(key: string, value: string): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    this.el[key].textContent = value;
  }

  private toggle(key: string, on: boolean): void {
    const k = `t:${key}`;
    const v = on ? '1' : '0';
    if (this.cache.get(k) === v) return;
    this.cache.set(k, v);
    this.el[key].classList.toggle('on', on);
  }
}
