/**
 * Indicator / hazard / headlight state, including blink timing and
 * steering-based self-cancel of indicators (like a real column switch).
 */

const BLINK_HZ = 1.4; // ~85 flashes per minute

export class VehicleLights {
  left = false;
  right = false;
  hazards = false;
  headlights = false;
  /** True during the "on" half of the blink cycle. */
  blinkOn = false;
  /** Fires true for one update when the blink relay flips (for the tick sound). */
  relayFlipped = false;

  private phase = 0;
  private maxSteerSinceOn = 0;

  toggleLeft(): void {
    this.left = !this.left;
    if (this.left) this.right = false;
    this.restartBlink();
  }

  toggleRight(): void {
    this.right = !this.right;
    if (this.right) this.left = false;
    this.restartBlink();
  }

  toggleHazards(): void {
    this.hazards = !this.hazards;
    this.restartBlink();
  }

  get leftLit(): boolean {
    return (this.left || this.hazards) && this.blinkOn;
  }

  get rightLit(): boolean {
    return (this.right || this.hazards) && this.blinkOn;
  }

  get anyBlinking(): boolean {
    return this.left || this.right || this.hazards;
  }

  /** @param steer current steering position, -1..1 (+ = left) */
  update(dt: number, steer: number): void {
    // Self-cancel: once the wheel has turned past ~1/3 lock in the indicated
    // direction and comes back near centre, switch the indicator off.
    if (this.left || this.right) {
      const s = this.left ? steer : -steer;
      this.maxSteerSinceOn = Math.max(this.maxSteerSinceOn, s);
      if (this.maxSteerSinceOn > 0.35 && s < 0.08) {
        this.left = this.right = false;
      }
    }

    this.relayFlipped = false;
    if (!this.anyBlinking) {
      if (this.blinkOn) this.relayFlipped = true;
      this.blinkOn = false;
      this.phase = 0;
      return;
    }
    this.phase += dt * BLINK_HZ;
    const on = this.phase % 1 < 0.5;
    if (on !== this.blinkOn) this.relayFlipped = true;
    this.blinkOn = on;
  }

  private restartBlink(): void {
    this.phase = 0;
    this.maxSteerSinceOn = 0;
  }
}
