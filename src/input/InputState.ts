/**
 * Device-agnostic driver input. Keyboard (and later touch / gamepad) sources write
 * into one shared instance; the game reads it once per frame.
 *
 * Pedal values are final pedal positions: digital sources (keys) ramp them so a
 * held key presses the pedal progressively, like a real foot.
 */
export interface DriveInput {
  /** Forward pedal (W / up arrow), 0..1: drives forward, or brakes while the car is reversing. */
  forward: number;
  /** Back pedal (S / down arrow), 0..1: brakes while the car moves forward, drives in reverse once it is stopped. */
  back: number;
  /** Target steering, -1 (full right) .. +1 (full left). */
  steer: number;
  horn: boolean;
}

/** One-shot actions; sources increment a counter and the game consumes it. */
export type InputAction =
  | 'reset'
  | 'camera'
  | 'pause'
  | 'parkingBrake'
  | 'ignition'
  | 'indicatorLeft'
  | 'indicatorRight'
  | 'hazards'
  | 'lights'
  | 'mirrors'
  | 'checkpoint'
  | 'slowMotion'
  | 'guides'
  | 'eonOutline'
  | 'autoRearCamera';

const ACTIONS: readonly InputAction[] = [
  'reset',
  'camera',
  'pause',
  'parkingBrake',
  'ignition',
  'indicatorLeft',
  'indicatorRight',
  'hazards',
  'lights',
  'mirrors',
  'checkpoint',
  'slowMotion',
  'guides',
  'eonOutline',
  'autoRearCamera',
];

export class InputState implements DriveInput {
  forward = 0;
  back = 0;
  steer = 0;
  horn = false;
  /** Set on the first user gesture (needed to unlock audio on mobile). */
  hadUserGesture = false;
  /** Camera picked directly (index into the camera list), or -1. Cleared by the consumer. */
  selectCamera = -1;
  /** Accumulated look / orbit drag (pixels) and zoom (wheel steps) since the camera last read them. */
  lookX = 0;
  lookY = 0;
  zoom = 0;

  private readonly pending = Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<InputAction, number>;

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
