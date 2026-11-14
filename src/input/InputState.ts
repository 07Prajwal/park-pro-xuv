/**
 * Device-agnostic driver input. Keyboard (and later touch / gamepad) sources write
 * into one shared instance; the game reads it once per physics step.
 */
export interface DriveInput {
  /** Accelerator key/pedal, 0..1. */
  forward: number;
  /** Brake / reverse key/pedal, 0..1. */
  back: number;
  /** Target steering, -1 (full right) .. +1 (full left). */
  steer: number;
  handbrake: boolean;
}

/** One-shot actions; sources increment a counter and the game consumes it. */
export type InputAction = 'reset' | 'camera' | 'pause';

export class InputState implements DriveInput {
  forward = 0;
  back = 0;
  steer = 0;
  handbrake = false;

  private readonly pending: Record<InputAction, number> = { reset: 0, camera: 0, pause: 0 };

  trigger(action: InputAction): void {
    this.pending[action]++;
  }

  /** Returns true (once) if the action was triggered since the last call. */
  consume(action: InputAction): boolean {
    if (this.pending[action] === 0) return false;
    this.pending[action] = 0;
    return true;
  }
}
