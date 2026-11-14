/**
 * Keyboard source for InputState. Uses `event.code` so bindings are layout
 * independent (WASD stays in place on AZERTY etc.).
 */

import type { InputState } from './InputState';

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const HANDBRAKE = ['Space'];
const PREVENT_DEFAULT = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...HANDBRAKE]);

export class KeyboardInput {
  private readonly down = new Set<string>();

  constructor(private readonly state: InputState, target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** Write the held-key state into the shared InputState. Call once per frame. */
  poll(): void {
    this.state.forward = this.any(FORWARD) ? 1 : 0;
    this.state.back = this.any(BACK) ? 1 : 0;
    this.state.steer = (this.any(LEFT) ? 1 : 0) - (this.any(RIGHT) ? 1 : 0);
    this.state.handbrake = this.any(HANDBRAKE);
  }

  private any(codes: string[]): boolean {
    for (let i = 0; i < codes.length; i++) if (this.down.has(codes[i])) return true;
    return false;
  }

  private readonly onDown = (e: KeyboardEvent): void => {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    switch (e.code) {
      case 'KeyR':
        this.state.trigger('reset');
        break;
      case 'KeyC':
        this.state.trigger('camera');
        break;
      case 'Escape':
      case 'KeyP':
        this.state.trigger('pause');
        break;
    }
  };

  private readonly onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };
}
