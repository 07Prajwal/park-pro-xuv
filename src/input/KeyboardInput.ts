/**
 * Keyboard source for InputState. Uses `event.code` so bindings are layout
 * independent (WASD stays in place on AZERTY etc.).
 *
 * Keys are digital, so pedals ramp in/out over time (see config `pedals`), and
 * holding Shift caps them for fine parking control.
 */

import type { VehicleTuning } from '../config';
import type { InputAction, InputState } from './InputState';

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const FINE = ['ShiftLeft', 'ShiftRight'];
const HORN = ['KeyH'];

const ACTION_KEYS: Record<string, InputAction> = {
  KeyR: 'reset',
  KeyC: 'camera',
  Escape: 'pause',
  KeyP: 'pause',
  KeyQ: 'selectorUp',
  KeyZ: 'selectorUp',
  KeyE: 'selectorDown',
  KeyX: 'selectorDown',
  Space: 'parkingBrake',
  KeyB: 'autoHold',
  KeyI: 'ignition',
  Comma: 'indicatorLeft',
  Period: 'indicatorRight',
  Slash: 'hazards',
  KeyL: 'lights',
};

const PREVENT_DEFAULT = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, 'Space', 'Slash']);

export class KeyboardInput {
  private readonly down = new Set<string>();

  constructor(
    private readonly state: InputState,
    private readonly pedals: VehicleTuning['pedals'],
    target: Window = window,
  ) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** Write the held-key state into the shared InputState. Call once per frame. */
  poll(dt: number): void {
    const p = this.pedals;
    const fine = this.any(FINE);
    const throttleTarget = this.any(FORWARD) ? (fine ? p.fineThrottleCap : 1) : 0;
    const brakeTarget = this.any(BACK) ? (fine ? p.fineBrakeCap : 1) : 0;
    this.state.forward = ramp(this.state.forward, throttleTarget, dt / p.throttleRiseS, dt / p.throttleFallS);
    this.state.back = ramp(this.state.back, brakeTarget, dt / p.brakeRiseS, dt / p.brakeFallS);
    this.state.steer = (this.any(LEFT) ? 1 : 0) - (this.any(RIGHT) ? 1 : 0);
    this.state.horn = this.any(HORN);
  }

  private any(codes: string[]): boolean {
    for (let i = 0; i < codes.length; i++) if (this.down.has(codes[i])) return true;
    return false;
  }

  private readonly onDown = (e: KeyboardEvent): void => {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    this.state.hadUserGesture = true;
    if (e.repeat) return;
    this.down.add(e.code);
    const action = ACTION_KEYS[e.code];
    if (action) this.state.trigger(action);
  };

  private readonly onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };
}

/** Move towards target, rising and falling at different rates (per-call max deltas). */
function ramp(current: number, target: number, riseDelta: number, fallDelta: number): number {
  if (current < target) return Math.min(current + riseDelta, target);
  return Math.max(current - fallDelta, target);
}
