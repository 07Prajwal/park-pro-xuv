/**
 * HUD overlay: speed, tachometer, current direction (R/D) with gear, tell-tales
 * (parking brake, indicators, headlights), driver messages and FPS,
 * plus the level panel (timer and penalties), the step hint, the parking-sensor
 * display and status chips (slow motion, ghost demo...).
 *
 * DOM writes are throttled and only happen when a value changes; the tachometer
 * bar uses a compositor-only transform.
 */

import type { ScreenRect } from '../cameras/PipView';
import { GEAR_ORDER, type Gear } from '../vehicle/Drivetrain';
import { SENSOR_COUNT } from '../vehicle/ParkingSensors';

export interface LevelHudData {
  timeS: number;
  collisions: number;
  kerbTouches: number;
  conesHit: number;
  directionChanges: number;
  /** "3 / 9" style gate progress, or '' */
  gates: string;
}

/** Sensor segment paths around a top-down car icon (front at the top), indices as in ParkingSensors. */
const SENSOR_PATHS = [
  'M14 22 Q16 10 26 7', // front left corner (car's left = screen left when viewed from above, heading up)
  'M29 5 Q36 3 39 3',
  'M41 3 Q44 3 51 5',
  'M54 7 Q64 10 66 22',
  'M14 98 Q16 110 26 113',
  'M29 115 Q36 117 39 117',
  'M41 117 Q44 117 51 115',
  'M54 113 Q64 110 66 98',
];

export interface HudData {
  speedKmh: number;
  rpm: number;
  revLimitRpm: number;
  selector: Gear;
  gear: number;
  engineRunning: boolean;
  cranking: boolean;
  parkingBrake: boolean;
  leftLit: boolean;
  rightLit: boolean;
  headlights: boolean;
  /** Steering-wheel angle in degrees, positive = turned left. */
  steerDeg: number;
  fps: number;
  cameraLabel: string;
  message: string;
  messageAge: number;
}

const TEXT_INTERVAL_S = 0.1;
const MESSAGE_S = 2.5;

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly gearEls: Record<Gear, HTMLElement>;
  private readonly sensorEls: SVGPathElement[];
  private readonly sensorState = new Int8Array(SENSOR_COUNT).fill(-1);
  private levelTimer = 0;
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
          <span class="tt tt-lights" data-k="lights">≣D</span>
          <span class="tt tt-right" data-k="right">▶</span>
          <span class="hud-rpm"><span data-k="rpm">0</span> rpm</span>
        </div>
      </div>
      <div class="hud-info"><div data-k="camera"></div><div>Wheel <span data-k="steer">0°</span></div><div><span data-k="fps">--</span> FPS</div></div>
      <div class="hud-pip-caption hidden" data-k="pipCaption">Check surroundings for safety</div>
      <div class="hud-level hidden" data-k="level"><div class="hud-level-title" data-k="levelTitle"></div><div class="hud-level-stats" data-k="levelStats"></div></div>
      <div class="hud-hint hidden" data-k="hint"></div>
      <div class="hud-chips" data-k="chips"></div>
      <div class="hud-sensors hidden" data-k="sensors">
        <svg viewBox="0 0 80 120" aria-hidden="true">
          <rect x="22" y="14" width="36" height="92" rx="12" class="car"/>
          <rect x="27" y="36" width="26" height="18" rx="4" class="glass"/>
          ${SENSOR_PATHS.map((d, i) => `<path d="${d}" data-s="${i}"/>`).join('')}
        </svg>
        <div class="hud-sensor-dist" data-k="sensorDist"></div>
      </div>
      <div class="hud-message" data-k="message"></div>
      <div class="hud-help">W/↑ forward · S/↓ brake and reverse (Shift = gentle) · A/D steer · Space parking brake · I engine · , . / indicators · L lights · H horn · C / 1–7 camera · drag look · M mirrors · G guides · O Eon · V rear cam · T slow-mo · K last stop · R / ⌫ retry · Esc menu</div>`;
    for (const n of root.querySelectorAll<HTMLElement>('[data-k]')) this.el[n.dataset.k!] = n;
    this.gearEls = Object.fromEntries(
      GEAR_ORDER.map((g) => [g, root.querySelector<HTMLElement>(`[data-g="${g}"]`)!]),
    ) as Record<Gear, HTMLElement>;
    this.sensorEls = [...root.querySelectorAll<SVGPathElement>('[data-s]')];
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
    this.toggle('lights', d.headlights);
    const deg = Math.round(Math.abs(d.steerDeg));
    this.text('steer', deg === 0 ? '0°' : `${deg}° ${d.steerDeg > 0 ? 'L' : 'R'}`);
    this.text('fps', Math.round(d.fps).toString());
    this.text('camera', d.cameraLabel);

    let msg = d.messageAge < MESSAGE_S ? d.message : '';
    if (!msg && !d.engineRunning && !d.cranking) msg = 'Engine off — press W or S (or I) to start';
    this.text('message', msg);
    this.el.message.classList.toggle('show', msg !== '');
  }

  /** Show the safety caption under the reverse-camera view, or hide it (null). */
  setReverseCaption(r: ScreenRect | null): void {
    const el = this.el.pipCaption;
    const key = r ? `${r.x},${r.y},${r.w},${r.h}` : '';
    if (this.cache.get('pip') === key) return;
    this.cache.set('pip', key);
    el.classList.toggle('hidden', !r);
    if (r) {
      el.style.left = `${r.x}px`;
      el.style.top = `${r.y + r.h - 26}px`;
      el.style.width = `${r.w}px`;
    }
  }

  /** Level title, or null to hide the level panel. */
  setLevel(title: string | null): void {
    this.el.level.classList.toggle('hidden', title === null);
    if (title !== null) this.text('levelTitle', title);
  }

  updateLevel(d: LevelHudData, dt: number): void {
    this.levelTimer += dt;
    if (this.levelTimer < TEXT_INTERVAL_S) return;
    this.levelTimer = 0;
    const parts = [`⏱ ${d.timeS.toFixed(1)} s`];
    if (d.gates) parts.push(`Gates ${d.gates}`);
    parts.push(`Hits ${d.collisions}`, `Kerb ${d.kerbTouches}`);
    if (d.conesHit) parts.push(`Cones ${d.conesHit}`);
    parts.push(`Direction changes ${d.directionChanges}`);
    this.text('levelStats', parts.join(' · '));
  }

  setHint(text: string): void {
    this.el.hint.classList.toggle('hidden', text === '');
    this.text('hint', text);
  }

  setChips(chips: string[]): void {
    const html = chips.map((c) => `<span>${c}</span>`).join('');
    if (this.cache.get('chips') === html) return;
    this.cache.set('chips', html);
    this.el.chips.innerHTML = html;
  }

  /** Parking-sensor display: per-sensor zone (grey / green / yellow / red) and the nearest distance. */
  setSensors(distances: Float32Array, active: boolean, nearest: number | null): void {
    this.toggleHidden('sensors', !active);
    if (!active) return;
    for (let i = 0; i < SENSOR_COUNT; i++) {
      const d = distances[i];
      const z = !Number.isFinite(d) ? 0 : d < 0.3 ? 3 : d < 0.8 ? 2 : 1;
      if (this.sensorState[i] === z) continue;
      this.sensorState[i] = z;
      this.sensorEls[i].setAttribute('class', `z${z}`);
    }
    this.text('sensorDist', nearest !== null && Number.isFinite(nearest) ? `${nearest.toFixed(2)} m` : '');
  }

  private toggleHidden(key: string, hidden: boolean): void {
    const k = `h:${key}`;
    const v = hidden ? '1' : '0';
    if (this.cache.get(k) === v) return;
    this.cache.set(k, v);
    this.el[key].classList.toggle('hidden', hidden);
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
